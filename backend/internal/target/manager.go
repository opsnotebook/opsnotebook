package target

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"opsnotebook/backend/internal/config"
)

// ANSI color codes
const (
	colorReset   = "\033[0m"
	colorRed     = "\033[31m"
	colorGreen   = "\033[32m"
	colorYellow  = "\033[33m"
	colorBlue    = "\033[34m"
	colorMagenta = "\033[35m"
	colorCyan    = "\033[36m"
)

// colorizeMethod returns the HTTP method with ANSI color
func colorizeMethod(method string) string {
	switch method {
	case "GET":
		return colorGreen + method + colorReset
	case "POST":
		return colorBlue + method + colorReset
	case "PUT":
		return colorYellow + method + colorReset
	case "DELETE":
		return colorRed + method + colorReset
	case "PATCH":
		return colorMagenta + method + colorReset
	case "HEAD":
		return colorCyan + method + colorReset
	default:
		return method
	}
}

// colorizeStatus returns the status code with ANSI color
func colorizeStatus(code int) string {
	switch {
	case code >= 200 && code < 300:
		return colorGreen + fmt.Sprintf("%d", code) + colorReset
	case code >= 300 && code < 400:
		return colorCyan + fmt.Sprintf("%d", code) + colorReset
	case code >= 400 && code < 500:
		return colorYellow + fmt.Sprintf("%d", code) + colorReset
	case code >= 500:
		return colorRed + fmt.Sprintf("%d", code) + colorReset
	default:
		return fmt.Sprintf("%d", code)
	}
}

// ConnectionInfo represents the handshake data returned by the connector script
type ConnectionInfo struct {
	ControlURL string                 `json:"control_url"` // Internal field
	URL        string                 `json:"target_url"`
	Headers    map[string]string      `json:"headers"`
	Metadata   map[string]interface{} `json:"metadata"`
}

// State represents the runtime state of a target connection
type State struct {
	Config      config.TargetConfig `json:"config"`
	Status      string              `json:"status"` // "disconnected", "connecting", "connected", "error"
	Connection  ConnectionInfo      `json:"connection,omitempty"`
	Error       string              `json:"error,omitempty"`
	LastChecked time.Time           `json:"last_checked,omitempty"`

	// Private fields
	cmd    *exec.Cmd
	cancel context.CancelFunc
	mu     sync.RWMutex
}

func (s *State) Mu() *sync.RWMutex {
	return &s.mu
}

// Manager manages all target connections
type Manager struct {
	targets map[string]*State
	rules   []config.VariableRule
	groupBy []string
	mu      sync.RWMutex
	ctx     context.Context
	cancel  context.CancelFunc
}

func NewManager(cfg *config.Config) *Manager {
	ctx, cancel := context.WithCancel(context.Background())
	m := &Manager{
		targets: make(map[string]*State),
		rules:   cfg.Variables,
		groupBy: cfg.GroupBy,
		ctx:     ctx,
		cancel:  cancel,
	}

	for _, t := range cfg.Targets {
		m.targets[t.ID] = &State{
			Config: t,
			Status: StatusDisconnected,
		}
	}
	return m
}

func (m *Manager) Shutdown() {
	// Disconnect first to terminate driver *process groups* before the manager
	// context cancels (which would otherwise only kill the direct child process).
	m.DisconnectAll()
	m.cancel()
}

func (m *Manager) ConnectAll() {
	m.mu.RLock()
	targets := make([]*State, 0, len(m.targets))
	for _, t := range m.targets {
		targets = append(targets, t)
	}
	m.mu.RUnlock()

	var wg sync.WaitGroup
	for _, t := range targets {
		wg.Add(1)
		go func(state *State) {
			defer wg.Done()
			m.Connect(state)
		}(t)
	}
	wg.Wait()
}

func (m *Manager) Connect(state *State) {
	state.mu.Lock()
	if state.Status == StatusConnected || state.Status == StatusConnecting {
		state.mu.Unlock()
		return
	}
	state.Status = StatusConnecting
	state.Error = ""
	state.mu.Unlock()

	cfg := state.Config
	log.Printf("[%s] Connecting...", cfg.ID)

	ctx, cancel := context.WithCancel(m.ctx)
	connectCtx, connectCancel := context.WithTimeout(ctx, 2*time.Minute)
	defer connectCancel()

	// 1. Find free port for Control Plane
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		cancel()
		m.setError(state, fmt.Sprintf("find port: %v", err))
		return
	}
	controlPort := l.Addr().(*net.TCPAddr).Port
	l.Close()

	// 2. Start Driver Process
	cmd := exec.CommandContext(ctx, "bash", "-c", cfg.DriverCmd)
	configureDriverCmd(cmd)
	cmd.Env = append(os.Environ(), fmt.Sprintf("OPSNOTEBOOK_CONTROL_PORT=%d", controlPort))
	
	// Log stderr for debugging
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		cancel()
		m.setError(state, fmt.Sprintf("start cmd: %v", err))
		return
	}

	state.mu.Lock()
	state.cmd = cmd
	state.cancel = cancel
	state.mu.Unlock()

	// 3. Wait for Driver HTTP Server (poll /status)
	controlURL := fmt.Sprintf("http://127.0.0.1:%d", controlPort)
	if !m.waitForDriver(connectCtx, controlURL) {
		cancel()
		m.setError(state, "driver failed to start http server")
		return
	}

	// 4. Send Connect Request
	connInfo, err := m.sendConnect(connectCtx, controlURL)
	if err != nil {
		cancel()
		m.setError(state, fmt.Sprintf("connect failed: %v", err))
		return
	}
	connInfo.ControlURL = controlURL

	state.mu.Lock()
	state.Connection = *connInfo
	state.Status = StatusConnected
	state.LastChecked = time.Now()
	state.mu.Unlock()

	log.Printf("[%s] Connected: %s (Control: %s)", cfg.ID, connInfo.URL, controlURL)

	go func() {
		_ = cmd.Wait()
		if ctx.Err() != nil || m.ctx.Err() != nil {
			return
		}

		state.mu.Lock()
		wasConnected := state.Status == StatusConnected
		if wasConnected {
			state.Status = StatusDisconnected
			state.Connection = ConnectionInfo{}
			log.Printf("[%s] Process exited unexpectedly", cfg.ID)
		}
		state.mu.Unlock()

		if wasConnected {
			// Auto-reconnect only for unexpected exits.
			time.Sleep(5 * time.Second)
			m.Connect(state)
		}
	}()
}

func (m *Manager) waitForDriver(ctx context.Context, url string) bool {
	client := &http.Client{Timeout: 500 * time.Millisecond}
	for i := 0; i < 50; i++ { // 5 seconds timeout
		req, _ := http.NewRequestWithContext(ctx, "GET", url+"/status", nil)
		resp, err := client.Do(req)
		if err == nil && resp.StatusCode == 200 {
			log.Printf("[driver] %s %s/status -> %s", colorizeMethod("GET"), url, colorizeStatus(resp.StatusCode))
			resp.Body.Close()
			return true
		}
		if resp != nil {
			resp.Body.Close()
		}
		time.Sleep(100 * time.Millisecond)
	}
	log.Printf("[driver] %s %s/status -> %stimeout after 5s%s", colorizeMethod("GET"), url, colorYellow, colorReset)
	return false
}

func (m *Manager) sendConnect(ctx context.Context, url string) (*ConnectionInfo, error) {
	client := &http.Client{Timeout: 2 * time.Minute}
	req, _ := http.NewRequestWithContext(ctx, "POST", url+"/connect", nil)
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[driver] %s %s/connect -> error: %v", colorizeMethod("POST"), url, err)
		return nil, err
	}
	defer resp.Body.Close()

	log.Printf("[driver] %s %s/connect -> %s", colorizeMethod("POST"), url, colorizeStatus(resp.StatusCode))
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}

	var info ConnectionInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, err
	}
	return &info, nil
}

func (m *Manager) Disconnect(state *State) {
	state.mu.Lock()
	cmd := state.cmd
	cancel := state.cancel
	state.cmd = nil
	state.cancel = nil
	state.Status = StatusDisconnected
	state.Connection = ConnectionInfo{}
	state.mu.Unlock()

	if cmd != nil {
		terminateDriverCmd(cmd)
	}
	if cancel != nil {
		cancel()
	}
}

func (m *Manager) DisconnectAll() {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, t := range m.targets {
		m.Disconnect(t)
	}
}

func (m *Manager) setError(state *State, err string) {
	state.mu.Lock()
	state.Status = StatusError
	state.Error = err
	state.mu.Unlock()
	log.Printf("[%s] Error: %s", state.Config.ID, err)

	go func() {
		time.Sleep(30 * time.Second)
		if m.ctx.Err() != nil {
			return
		}
		m.Connect(state)
	}()
}

func (m *Manager) GetTarget(id string) (*State, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	t, ok := m.targets[id]
	return t, ok
}

func (m *Manager) GetAllTargets() []*State {
	m.mu.RLock()
	defer m.mu.RUnlock()
	list := make([]*State, 0, len(m.targets))
	for _, t := range m.targets {
		list = append(list, t)
	}
	return list
}

func (m *Manager) GetGroupBy() []string {
	return m.groupBy
}

func (m *Manager) ResolveVariables(cfg config.TargetConfig) map[string]interface{} {
	result := make(map[string]interface{})
	for k, v := range cfg.Variables {
		result[k] = v
	}
	for _, rule := range m.rules {
		match := true
		for k, v := range rule.When {
			if cfg.Tags[k] != v {
				match = false
				break
			}
		}
		if match {
			for k, v := range rule.Then {
				result[k] = v
			}
		}
	}
	return result
}

// Proxy Methods

func (s *State) DoProxyRequest(method, path string, body []byte) (json.RawMessage, int, error) {
	s.mu.RLock()
	status := s.Status
	baseURL := s.Connection.URL
	headers := s.Connection.Headers
	targetID := s.Config.ID
	s.mu.RUnlock()

	if status != StatusConnected {
		log.Printf("[%s] PROXY %s %s -> error: target not connected (status: %s)", targetID, colorizeMethod(method), path, status)
		return nil, 0, fmt.Errorf("target not connected (status: %s)", status)
	}
	if baseURL == "" {
		log.Printf("[%s] PROXY %s %s -> error: target has no base URL", targetID, colorizeMethod(method), path)
		return nil, 0, fmt.Errorf("target has no base URL")
	}

	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
		Timeout: 1 * time.Hour,
	}

	fullURL := strings.TrimSuffix(baseURL, "/") + path
	var bodyReader io.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	}

	req, err := http.NewRequest(method, fullURL, bodyReader)
	if err != nil {
		log.Printf("[%s] PROXY %s %s -> error: %v", targetID, colorizeMethod(method), path, err)
		return nil, 0, err
	}

	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	start := time.Now()
	resp, err := client.Do(req)
	duration := time.Since(start)
	if err != nil {
		log.Printf("[%s] PROXY %s %s -> error: %v (took %v)", targetID, colorizeMethod(method), path, err, duration)
		return nil, 0, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[%s] PROXY %s %s -> %s (read body error: %v, took %v)", targetID, colorizeMethod(method), path, colorizeStatus(resp.StatusCode), err, duration)
		return nil, resp.StatusCode, fmt.Errorf("read body: %w", err)
	}

	log.Printf("[%s] PROXY %s %s -> %s (took %v)", targetID, colorizeMethod(method), path, colorizeStatus(resp.StatusCode), duration)
	return respBody, resp.StatusCode, nil
}

func (s *State) DoExec(command string) (json.RawMessage, int, error) {
	s.mu.RLock()
	controlURL := s.Connection.ControlURL
	targetID := s.Config.ID
	s.mu.RUnlock()

	if controlURL == "" {
		log.Printf("[%s] EXEC -> error: driver control url not available", targetID)
		return nil, 0, fmt.Errorf("driver control url not available")
	}

	execCtx, cancel := context.WithTimeout(context.Background(), 1*time.Hour)
	defer cancel()

	payload, _ := json.Marshal(map[string]string{"command": command})
	req, err := http.NewRequestWithContext(execCtx, http.MethodPost, controlURL+"/execute", bytes.NewReader(payload))
	if err != nil {
		log.Printf("[%s] EXEC %s -> error: %v", targetID, command, err)
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")

	start := time.Now()
	client := &http.Client{Timeout: 1 * time.Hour}
	resp, err := client.Do(req)
	duration := time.Since(start)
	if err != nil {
		log.Printf("[%s] EXEC %s -> error: %v (took %v)", targetID, command, err, duration)
		return nil, 0, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[%s] EXEC %s -> %s (read body error: %v, took %v)", targetID, command, colorizeStatus(resp.StatusCode), err, duration)
		return nil, resp.StatusCode, err
	}

	log.Printf("[%s] EXEC %s -> %s (took %v)", targetID, command, colorizeStatus(resp.StatusCode), duration)
	return body, resp.StatusCode, nil
}
