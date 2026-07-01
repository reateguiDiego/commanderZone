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
	if scale.Store.LatestSnapshotReads != 0 {
		t.Fatalf("snapshot reads = %d, want 0 in runtime command path", scale.Store.LatestSnapshotReads)
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
				LatestSnapshotReads: 1,
				SnapshotWrites:      1,
			},
			Runtime: RuntimeSummary{
				InitialStatePerCommandCount: 1,
				LegacyFallbackCount:         1,
				UnsupportedCommandCount:     1,
			},
			Payload: PayloadSummary{
				SimplePatchBytesMax: DefaultSimplePatchBytesLimit + 1,
			},
			PerCommand: []CommandSummary{{
				Type:                 "life.changed",
				Count:                1,
				ResyncCount:          1,
				RefetchCount:         1,
				ContractInvalidCount: 1,
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
		"snapshot_load_runtime_path",
		"snapshot_write_runtime_path",
		"initial_state_per_command",
		"unsupported_runtime_command",
		"patch_event_contract_invalid",
		"benchmark_command_errors",
		"resync_rate",
	} {
		if !failed[key] {
			t.Fatalf("missing failed gate %q in %#v", key, gate.Failures)
		}
	}
	if len(gate.CriticalFailures) == 0 {
		t.Fatalf("critical failures were not classified: %#v", gate)
	}
	if len(gate.AdvisoryFailures) != 1 || gate.AdvisoryFailures[0].Key != "simple_patch_bytes_max" {
		t.Fatalf("advisory failures = %#v, want simple_patch_bytes_max only", gate.AdvisoryFailures)
	}
}

func TestEvaluateGateAdvisoryFailureDoesNotFailCriticalStatus(t *testing.T) {
	report := Report{
		Scales: []ScaleReport{{
			Commands: 1,
			Payload: PayloadSummary{
				SimplePatchBytesMax: DefaultSimplePatchBytesLimit + 1,
			},
			PerCommand: []CommandSummary{{
				Type:  "life.changed",
				Count: 1,
			}},
		}},
	}
	gate := EvaluateGate(report, DefaultConfig())
	if gate.Status != "pass" {
		t.Fatalf("gate status = %s, want pass for advisory-only failure", gate.Status)
	}
	if len(gate.CriticalFailures) != 0 {
		t.Fatalf("critical failures = %#v, want none", gate.CriticalFailures)
	}
	if len(gate.AdvisoryFailures) != 1 || gate.AdvisoryFailures[0].Key != "simple_patch_bytes_max" {
		t.Fatalf("advisory failures = %#v, want simple_patch_bytes_max", gate.AdvisoryFailures)
	}
}

func TestEvaluateGateSnapshotPostAppendFailureIsAdvisory(t *testing.T) {
	report := Report{
		Scales: []ScaleReport{{
			Commands: 1,
			Runtime: RuntimeSummary{
				SnapshotPostAppendFailureCount: 1,
			},
			PerCommand: []CommandSummary{{
				Type:  "life.changed",
				Count: 1,
			}},
		}},
	}
	gate := EvaluateGate(report, DefaultConfig())
	if gate.Status != "pass" {
		t.Fatalf("gate status = %s, want pass for advisory-only snapshot failure", gate.Status)
	}
	if len(gate.CriticalFailures) != 0 {
		t.Fatalf("critical failures = %#v, want none", gate.CriticalFailures)
	}
	if len(gate.AdvisoryFailures) != 1 || gate.AdvisoryFailures[0].Key != "snapshot_post_append_failure" {
		t.Fatalf("advisory failures = %#v, want snapshot_post_append_failure only", gate.AdvisoryFailures)
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
