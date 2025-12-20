package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"opsnotebook/backend/internal/config"
	"opsnotebook/backend/internal/target"
)

type Server struct {
	Manager *target.Manager
}

func NewServer(m *target.Manager) *Server {
	return &Server{Manager: m}
}

func (s *Server) Routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/config", s.handleConfig)
	mux.HandleFunc("/api/targets", s.handleTargets)
	mux.HandleFunc("/api/targets/", s.handleTargetAction)
	mux.HandleFunc("/api/groups", s.handleGroups)
	mux.HandleFunc("/api/health", s.handleHealth)
	return mux
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"group_by": s.Manager.GetGroupBy(),
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok"}`))
}

func (s *Server) handleGroups(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	type targetInfo struct {
		ID       string            `json:"id"`
		Status   string            `json:"status"`
		LocalURL string            `json:"local_url,omitempty"`
		Headers  map[string]string `json:"headers,omitempty"`
		Error    string            `json:"error,omitempty"`
	}

	type groupInfo struct {
		Key     string                `json:"key"`
		Values  map[string]string     `json:"values"`
		Targets map[string]targetInfo `json:"targets"`
	}

	groupBy := s.Manager.GetGroupBy()
	targets := s.Manager.GetAllTargets()
	groups := make(map[string]*groupInfo)

	for _, state := range targets {
		state.Mu().RLock()

		// Build group key and values from group_by keys
		values := make(map[string]string)
		keyParts := make([]string, len(groupBy))
		for i, key := range groupBy {
			val := getTag(state.Config.Tags, key, "unknown")
			values[key] = val
			keyParts[i] = val
		}
		groupKey := strings.Join(keyParts, ":")

		variant := getTag(state.Config.Tags, "variant", "default")

		if groups[groupKey] == nil {
			groups[groupKey] = &groupInfo{
				Key:     groupKey,
				Values:  values,
				Targets: make(map[string]targetInfo),
			}
		}

		groups[groupKey].Targets[variant] = targetInfo{
			ID:       state.Config.ID,
			Status:   state.Status,
			LocalURL: state.Connection.URL,
			Headers:  state.Connection.Headers,
			Error:    state.Error,
		}
		state.Mu().RUnlock()
	}

	list := make([]groupInfo, 0, len(groups))
	for _, g := range groups {
		list = append(list, *g)
	}
	json.NewEncoder(w).Encode(list)
}

func getTag(tags map[string]string, key, defaultVal string) string {
	if tags == nil {
		return defaultVal
	}
	if v, ok := tags[key]; ok {
		return v
	}
	return defaultVal
}

func (s *Server) handleTargets(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	type targetInfo struct {
		config.TargetConfig
		Status    string                 `json:"status"`
		LocalURL  string                 `json:"local_url,omitempty"`
		Headers   map[string]string      `json:"headers,omitempty"`
		Metadata  map[string]interface{} `json:"metadata,omitempty"`
		Error     string                 `json:"error,omitempty"`
		Variables map[string]interface{} `json:"variables"`
	}

	targets := s.Manager.GetAllTargets()
	list := make([]targetInfo, 0, len(targets))
	
	for _, state := range targets {
		state.Mu().RLock()
		vars := s.Manager.ResolveVariables(state.Config)
		info := targetInfo{
			TargetConfig: state.Config,
			Status:       state.Status,
			LocalURL:     state.Connection.URL,
			Headers:      state.Connection.Headers,
			Metadata:     state.Connection.Metadata,
			Error:        state.Error,
			Variables:    vars,
		}
		list = append(list, info)
		state.Mu().RUnlock()
	}
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleTargetAction(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/targets/")
	parts := strings.Split(path, "/")
	if len(parts) < 1 {
		http.Error(w, "invalid path", 400)
		return
	}
	id := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	state, ok := s.Manager.GetTarget(id)
	if !ok {
		http.Error(w, "target not found", 404)
		return
	}

	switch action {
	case "reconnect":
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		s.Manager.Disconnect(state)
		go s.Manager.Connect(state)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success":true}`))
		return
	case "exec":
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			Command string `json:"command"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid json body", http.StatusBadRequest)
			return
		}
		res, code, err := state.DoExec(body.Command)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		w.Write(res)
		return
	case "proxy":
		proxyPath := "/" + strings.Join(parts[2:], "/")
		if proxyPath == "/" && r.URL.RawQuery != "" {
			proxyPath = "/?" + r.URL.RawQuery
		} else if r.URL.RawQuery != "" {
			proxyPath += "?" + r.URL.RawQuery
		}
		
		var body []byte
		var err error
		if r.Body != nil {
			body, err = io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, "failed to read request body", 400)
				return
			}
		}

		res, code, err := state.DoProxyRequest(r.Method, proxyPath, body)
		
		if err != nil {
			http.Error(w, err.Error(), 502)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		w.Write(res)
		return
	default:
		state.Mu().RLock()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id": state.Config.ID,
			"status": state.Status,
			"error": state.Error,
		})
		state.Mu().RUnlock()
		return
	}
}
