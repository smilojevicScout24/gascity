package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gastownhall/gascity/internal/config"
	"github.com/gastownhall/gascity/internal/runtime"
)

func TestAgentConfiguredModelWithoutTranscript(t *testing.T) {
	for _, running := range []bool{false, true} {
		t.Run(map[bool]string{false: "stopped", true: "running"}[running], func(t *testing.T) {
			state := newFakeState(t)
			state.cfg.Providers["test-agent"] = config.ProviderSpec{
				Command: "test-agent",
				OptionsSchema: []config.ProviderOption{{
					Key: "model", Default: "base",
					Choices: []config.OptionChoice{{Value: "base"}, {Value: "provider-model"}, {Value: "agent-model"}},
				}},
				OptionDefaults: map[string]string{"model": "provider-model"},
			}
			state.cfg.Agents = []config.Agent{{
				Name: "worker", Dir: "myrig", Provider: "test-agent",
				MaxActiveSessions: intPtr(2),
				OptionDefaults:    map[string]string{"model": "agent-model"},
			}}
			if running {
				if err := state.sp.Start(context.Background(), "myrig--worker-1", runtime.Config{}); err != nil {
					t.Fatal(err)
				}
			}
			srv := New(state)
			h := newTestCityHandlerWith(t, state, srv)
			for _, path := range []string{"/agents", "/agent/myrig/worker-1"} {
				rec := httptest.NewRecorder()
				h.ServeHTTP(rec, httptest.NewRequest("GET", cityURL(state, path), nil))
				if rec.Code != 200 {
					t.Fatalf("%s: status %d: %s", path, rec.Code, rec.Body.String())
				}
				var row struct {
					ConfiguredModel string `json:"configured_model"`
					Model           string `json:"model"`
				}
				if path == "/agents" {
					var list struct {
						Items []struct {
							ConfiguredModel string `json:"configured_model"`
							Model           string `json:"model"`
						} `json:"items"`
					}
					if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
						t.Fatal(err)
					}
					if len(list.Items) != 2 {
						t.Fatalf("got %d pool members", len(list.Items))
					}
					for _, item := range list.Items {
						if item.ConfiguredModel != "agent-model" {
							t.Errorf("configured_model = %q, want agent-model", item.ConfiguredModel)
						}
						if item.Model != "" {
							t.Errorf("configured model presented as observed: %q", item.Model)
						}
					}
				} else {
					if err := json.Unmarshal(rec.Body.Bytes(), &row); err != nil {
						t.Fatal(err)
					}
					if row.ConfiguredModel != "agent-model" {
						t.Errorf("configured_model = %q, want agent-model", row.ConfiguredModel)
					}
					if row.Model != "" {
						t.Errorf("configured model presented as observed: %q", row.Model)
					}
				}
			}
		})
	}
}
