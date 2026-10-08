package api

import (
	"log"

	"github.com/gastownhall/gascity/internal/config"
)

// configuredAgentModel projects the same effective model option used at launch.
// Executable availability is reported separately by the agent response.
func configuredAgentModel(agent config.Agent, cfg *config.City) string {
	resolved, err := config.ResolveProvider(&agent, &cfg.Workspace, cfg.Providers, func(command string) (string, error) { return command, nil })
	if err != nil {
		log.Printf("api: resolving configured model for agent %q: %v", agent.QualifiedName(), err)
		return ""
	}
	return resolved.EffectiveDefaults["model"]
}
