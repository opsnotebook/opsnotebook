package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Config represents the generic configuration file
type Config struct {
	GroupBy   []string       `json:"group_by,omitempty"`
	Targets   []TargetConfig `json:"targets"`
	Variables []VariableRule `json:"variables,omitempty"`
}

// DefaultGroupBy is the default grouping when not specified in config
var DefaultGroupBy = []string{"environment", "region", "name"}

// VariableRule represents a rule for applying variables based on tags
type VariableRule struct {
	When map[string]string      `json:"when"`
	Then map[string]interface{} `json:"then"`
}

// TargetConfig represents a generic target system
type TargetConfig struct {
	ID         string                 `json:"id"`
	Name       string                 `json:"name"`
	Tags       map[string]string      `json:"tags"`
	Labels     map[string]string      `json:"labels,omitempty"`
	DriverCmd  string                 `json:"driver_cmd"`
	Visual     map[string]string      `json:"visual,omitempty"`
	Variables  map[string]interface{} `json:"variables,omitempty"`
}

// Load reads a config file and optionally filters targets by pattern
func Load(path string) (*Config, error) {
	return LoadWithPattern(path, "")
}

// LoadWithPattern reads a config file and filters targets by glob pattern
// Pattern format matches against composite keys built from group_by fields (e.g., "staging:sg:*" for ["environment", "region", "name"])
// If pattern is empty or all wildcards, all targets are loaded
func LoadWithPattern(path string, pattern string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var config Config
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}

	// Set default group_by if not specified
	if len(config.GroupBy) == 0 {
		config.GroupBy = DefaultGroupBy
	}

	if pattern != "" && pattern != "*" {
		config.Targets = filterTargets(config.Targets, pattern, config.GroupBy)
	}

	if err := config.Validate(); err != nil {
		return nil, err
	}

	return &config, nil
}

// filterTargets filters targets by glob pattern matching against a composite key
// The composite key is built by joining tag values specified in groupBy (e.g., "staging:sg:myapp")
// e.g., pattern "*staging*" matches against "staging:sg:myapp"
func filterTargets(targets []TargetConfig, pattern string, groupBy []string) []TargetConfig {
	var filtered []TargetConfig
	for _, t := range targets {
		keyParts := make([]string, len(groupBy))
		for i, key := range groupBy {
			keyParts[i] = t.Tags[key]
		}
		fullKey := strings.Join(keyParts, ":")
		if matchGlob(pattern, fullKey) {
			filtered = append(filtered, t)
		}
	}
	return filtered
}

// matchGlob matches a pattern against a value using filepath.Match
func matchGlob(pattern, value string) bool {
	matched, _ := filepath.Match(pattern, value)
	return matched
}

func (c *Config) Validate() error {
	seenIDs := make(map[string]bool)
	for _, t := range c.Targets {
		if t.ID == "" {
			return fmt.Errorf("target missing required 'id' field")
		}
		if seenIDs[t.ID] {
			return fmt.Errorf("duplicate target ID %q detected - IDs must be unique", t.ID)
		}
		seenIDs[t.ID] = true

		if t.DriverCmd == "" {
			return fmt.Errorf("target %q missing required 'driver_cmd'", t.ID)
		}
	}
	return nil
}
