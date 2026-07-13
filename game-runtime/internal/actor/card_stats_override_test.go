package actor

import (
	"context"
	"reflect"
	"testing"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

func TestPrintedStatClassifierPreservesNumericFormulaSymbolicAndAbsentValues(t *testing.T) {
	tests := []struct {
		value any
		want  string
		kind  PrintedStatKind
	}{
		{" 1.5 ", "1.5", PrintedStatNumeric}, {"+3", "+3", PrintedStatNumeric}, {"-1", "-1", PrintedStatNumeric},
		{"1+x", "1+X", PrintedStatFormula}, {"*+1", "*+1", PrintedStatFormula}, {"?", "?", PrintedStatSymbolic},
		{"∞", "∞", PrintedStatSymbolic}, {nil, "", PrintedStatAbsent}, {"", "", PrintedStatAbsent},
	}
	for _, tt := range tests {
		got, kind := NormalizePrintedStat(tt.value)
		if got != tt.want || kind != tt.kind {
			t.Fatalf("NormalizePrintedStat(%#v) = (%q,%q), want (%q,%q)", tt.value, got, kind, tt.want, tt.kind)
		}
	}
}

func TestCardStatsOverrideSetIsPerFaceAxisIndependentAndPreservesZeroAndDecimals(t *testing.T) {
	initial := dynamicStatsState()
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())

	setPower := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "pt-power", "card.stats.override.set", map[string]any{
		"playerId": "p1", "instanceId": "i1", "faceIndex": 0, "power": 0,
	}), "p1")
	if setPower.Err != nil {
		t.Fatalf("set power failed: %v", setPower.Err)
	}
	override := gameActor.Snapshot().Instances["i1"].ManualOverrides["0"]
	if override["power"] != 0 {
		t.Fatalf("explicit zero lost: %#v", override)
	}
	if _, exists := override["toughness"]; exists {
		t.Fatalf("unmodified toughness was materialized: %#v", override)
	}
	if setPower.Patches[0].Ops[0].Op != "card.stats.override.set" {
		t.Fatalf("unexpected patch: %#v", setPower.Patches)
	}

	setBackFace := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "pt-back", "card.stats.override.set", map[string]any{
		"playerId": "p1", "instanceId": "i1", "faceIndex": 1, "toughness": 2.5,
	}), "p1")
	if setBackFace.Err != nil {
		t.Fatalf("set back face failed: %v", setBackFace.Err)
	}
	card := gameActor.Snapshot().Instances["i1"]
	if card.ManualOverrides["0"]["power"] != 0 || card.ManualOverrides["1"]["toughness"] != 2.5 {
		t.Fatalf("per-face overrides not preserved: %#v", card.ManualOverrides)
	}
}

func TestCardStatsOverrideClearOnlyClearsRequestedFaceAndAxis(t *testing.T) {
	initial := dynamicStatsState()
	card := initial.Instances["i1"]
	card.ManualOverrides = map[string]map[string]any{
		"0": {"power": 4, "toughness": 5, "provenance": "manual"},
		"1": {"power": 2.5, "provenance": "manual"},
	}
	initial.Instances["i1"] = card
	gameActor := NewGameActor("game-1", initial, nil, 8, DefaultAppliers())

	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "pt-clear", "card.stats.override.clear", map[string]any{
		"playerId": "p1", "instanceId": "i1", "faceIndex": 0, "axes": []string{"power"},
	}), "p1")
	if result.Err != nil {
		t.Fatalf("clear failed: %v", result.Err)
	}
	card = gameActor.Snapshot().Instances["i1"]
	if _, exists := card.ManualOverrides["0"]["power"]; exists || card.ManualOverrides["0"]["toughness"] != 5 {
		t.Fatalf("clear changed wrong axes: %#v", card.ManualOverrides)
	}
	if card.ManualOverrides["1"]["power"] != 2.5 {
		t.Fatalf("clear changed another face: %#v", card.ManualOverrides)
	}
	if result.Event.Type != "card.stats.override.cleared" {
		t.Fatalf("event type = %q", result.Event.Type)
	}
}

func TestPowerToughnessCountersNeverMutateOverridesOrLegacyMutableStats(t *testing.T) {
	initial := dynamicStatsState()
	card := initial.Instances["i1"]
	card.MutableStats = map[string]any{"power": "*", "toughness": "?"}
	card.ManualOverrides = map[string]map[string]any{"0": {"power": 4, "toughness": 5, "provenance": "manual"}}
	initial.Instances["i1"] = card
	gameActor := NewGameActor("game-1", initial, nil, 8, DefaultAppliers())

	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "counter", "card.counter.changed", map[string]any{
		"instanceId": "i1", "counter": "+1/+1", "value": 2,
	}), "p1")
	if result.Err != nil {
		t.Fatalf("counter failed: %v", result.Err)
	}
	after := gameActor.Snapshot().Instances["i1"]
	if !reflect.DeepEqual(after.MutableStats, card.MutableStats) || !reflect.DeepEqual(after.ManualOverrides, card.ManualOverrides) {
		t.Fatalf("counter destructively changed stats: before=%#v after=%#v", card, after)
	}
	if after.Counters["+1/+1"] != 2 {
		t.Fatalf("counter not stored independently: %#v", after.Counters)
	}
}

func TestCardStatsOverrideAuthorizationRejectionIsAtomic(t *testing.T) {
	initial := dynamicStatsState()
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
	before := gameActor.Snapshot()
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "pt-denied", "card.stats.override.set", map[string]any{
		"playerId": "p2", "instanceId": "i1", "faceIndex": 0, "power": 6,
	}), "p2")
	assertAuthorizationError(t, result.Err, AuthorizationCodeInstanceNotControlled, "i1", 0)
	if !reflect.DeepEqual(before, gameActor.Snapshot()) || result.Event.Version != 0 || len(result.Patches) != 0 {
		t.Fatalf("rejection mutated state/output: result=%#v", result)
	}
}

func TestCardStatsOverrideReplayCopiesPersistedFinalOverride(t *testing.T) {
	initial := dynamicStatsState()
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "pt-replay", "card.stats.override.set", map[string]any{
		"playerId": "p1", "instanceId": "i1", "faceIndex": 0, "power": "X+1", "toughness": 0,
	}), "p1")
	if result.Err != nil {
		t.Fatalf("set failed: %v", result.Err)
	}
	replayed, err := ReplayEvents(initial.Clone(), []protocol.EventPayloadV2{result.Event}, DefaultAppliers())
	if err != nil {
		t.Fatalf("replay failed: %v", err)
	}
	if !reflect.DeepEqual(replayed.Instances["i1"].ManualOverrides, gameActor.Snapshot().Instances["i1"].ManualOverrides) {
		t.Fatalf("replay override mismatch: %#v", replayed.Instances["i1"].ManualOverrides)
	}
}

func dynamicStatsState() state.GameState {
	game := testState()
	card := game.Instances["i1"]
	card.PrintedStats = map[string]map[string]any{
		"0": {"power": "*", "toughness": "1+*", "provenance": "printed"},
		"1": {"power": "1.5", "toughness": "2.5", "provenance": "printed"},
	}
	game.Instances["i1"] = card
	return game
}
