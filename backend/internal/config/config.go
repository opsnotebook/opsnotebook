package config

import (
	"encoding/json"
	"fmt"
	"os"
)

// Config represents the generic configuration file
type Config struct {
	Targets   []TargetConfig `json:"targets"`
	Variables []VariableRule `json:"variables,omitempty"`
}

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
	DriverCmd  string                 `json:"driver_cmd"`
	Visual     map[string]string      `json:"visual,omitempty"`
	Variables  map[string]interface{} `json:"variables,omitempty"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var config Config
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}
	
	if err := config.Validate(); err != nil {
		return nil, err
	}

	return &config, nil
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
