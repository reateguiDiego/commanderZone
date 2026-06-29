package perf

import (
	"context"
	"testing"
)

func TestRunSmokeBenchmarkProducesMetricsAndPassesGates(t *testing.T) {
	report, err := Run(context.Background(), Config{
		GameCounts:            []int{1},
		Iterations:            1,
		Transport:             "actor",
		QueueSize:             32,
		SimplePatchBytesLimit: DefaultSimplePatchBytesLimit,
		ResyncRateLimit:       DefaultResyncRateLimit,
	})
	if err != nil {
		t.Fatalf("run smoke benchmark: %v", err)
	}
	if len(report.Scales) != 1 {
		t.Fatalf("scales = %d, want 1", len(report.Scales))
	}
	scale := report.Scales[0]
	if scale.Commands == 0 {
		t.Fatalf("commands = 0, want representative command samples")
	}
	if scale.CommandLatency.P95 <= 0 {
		t.Fatalf("p95 latency = %f, want measured latency", scale.CommandLatency.P95)
	}
	if scale.Store.EventAppends != int64(scale.Commands) {
		t.Fatalf("event appends = %d, commands = %d", scale.Store.EventAppends, scale.Commands)
	}
	if scale.Store.SnapshotWrites != 0 {
		t.Fatalf("snapshot writes = %d, want 0 in runtime command path", scale.Store.SnapshotWrites)
	}
	if scale.Runtime.InitialStatePerCommandCount != 0 {
		t.Fatalf("initialState per command = %d, want 0", scale.Runtime.InitialStatePerCommandCount)
	}
	if scale.Runtime.LegacyFallbackCount != 0 {
		t.Fatalf("legacy fallback count = %d, want 0", scale.Runtime.LegacyFallbackCount)
	}
	if scale.Payload.BootstrapBytes.P50 <= 0 {
		t.Fatalf("bootstrap bytes were not measured: %#v", scale.Payload.BootstrapBytes)
	}
	if report.Gate.Status != "pass" {
		t.Fatalf("gate = %#v, want pass", report.Gate)
	}
}

func TestEvaluateGateFailsOnRuntimePathRegressions(t *testing.T) {
	report := Report{
		Scales: []ScaleReport{{
			Commands: 1,
			Store: StoreSummary{
				SnapshotWrites: 1,
			},
			Runtime: RuntimeSummary{
				InitialStatePerCommandCount: 1,
				LegacyFallbackCount:         1,
			},
			Payload: PayloadSummary{
				SimplePatchBytesMax: DefaultSimplePatchBytesLimit + 1,
			},
			PerCommand: []CommandSummary{{
				Type:         "life.changed",
				Count:        1,
				ResyncCount:  1,
				RefetchCount: 1,
			}},
			CommandErrors: map[string]int{"life.changed: failed": 1},
		}},
	}
	gate := EvaluateGate(report, DefaultConfig())
	if gate.Status != "fail" {
		t.Fatalf("gate status = %s, want fail", gate.Status)
	}
	failed := map[string]bool{}
	for _, check := range gate.Failures {
		failed[check.Key] = true
	}
	for _, key := range []string{
		"refetch_per_normal_command",
		"legacy_fallback_final_mode",
		"snapshot_write_runtime_path",
		"initial_state_per_command",
		"benchmark_command_errors",
		"resync_rate",
		"simple_patch_bytes_max",
	} {
		if !failed[key] {
			t.Fatalf("missing failed gate %q in %#v", key, gate.Failures)
		}
	}
}

func BenchmarkRuntimeGameplaySmoke(b *testing.B) {
	for i := 0; i < b.N; i++ {
		report, err := Run(context.Background(), Config{
			GameCounts:            []int{1},
			Iterations:            1,
			Transport:             "actor",
			QueueSize:             32,
			SimplePatchBytesLimit: DefaultSimplePatchBytesLimit,
			ResyncRateLimit:       DefaultResyncRateLimit,
		})
		if err != nil {
			b.Fatal(err)
		}
		if report.Gate.Status != "pass" {
			b.Fatalf("gate failed: %#v", report.Gate)
		}
	}
}
