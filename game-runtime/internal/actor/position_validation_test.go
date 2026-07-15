package actor

import (
	"context"
	"math"
	"reflect"
	"testing"
	"time"

	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
)

func TestCardPositionChangedAcceptsCanonicalRatioBoundaries(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "spatial-boundaries", "card.position.changed", map[string]any{
		"playerId":   "p1",
		"zone":       "battlefield",
		"instanceId": "i1",
		"position":   map[string]any{"x": 0, "y": 1, "unit": "ratio"},
	}), "p1")
	if result.Err != nil {
		t.Fatalf("canonical boundary position failed: %v", result.Err)
	}
	position := gameActor.Snapshot().Instances["i1"].Position
	if position["x"] != float64(0) || position["y"] != float64(1) || position["unit"] != "ratio" {
		t.Fatalf("position = %#v", position)
	}
	patch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "card.position.set")
	if patch == nil {
		t.Fatalf("missing canonical patch: %#v", result.Patches)
	}
	if patch.Data["effectVersion"] != PositionContractEffectVersion {
		t.Fatalf("patch effect version missing: %#v", patch.Data)
	}
	if result.Event.Payload["effectVersion"] != PositionContractEffectVersion || result.Event.Payload["actorPlayerId"] != "p1" {
		t.Fatalf("event contract metadata missing: %#v", result.Event.Payload)
	}
	if previous := result.Event.Payload["previousPosition"].(map[string]any); previous["x"] != 0.1 || previous["y"] != 0.1 {
		t.Fatalf("previous position = %#v", previous)
	}
}

func TestPositionCommandsRejectMalformedCoordinatesWithoutSideEffects(t *testing.T) {
	tests := []struct {
		name     string
		position map[string]any
		code     string
	}{
		{name: "missing unit", position: map[string]any{"x": 0.2, "y": 0.3}, code: PositionCodeUnsupportedUnit},
		{name: "pixel unit", position: map[string]any{"x": 10, "y": 20, "unit": "px"}, code: PositionCodeUnsupportedUnit},
		{name: "numeric string", position: map[string]any{"x": "0.2", "y": 0.3, "unit": "ratio"}, code: PositionCodeInvalid},
		{name: "missing coordinate", position: map[string]any{"x": 0.2, "unit": "ratio"}, code: PositionCodeInvalid},
		{name: "viewport field", position: map[string]any{"x": 0.2, "y": 0.3, "unit": "ratio", "viewportWidth": 900}, code: PositionCodeInvalid},
		{name: "negative", position: map[string]any{"x": -0.1, "y": 0.3, "unit": "ratio"}, code: PositionCodeOutOfRange},
		{name: "above one", position: map[string]any{"x": 0.2, "y": 1.1, "unit": "ratio"}, code: PositionCodeOutOfRange},
		{name: "nan", position: map[string]any{"x": math.NaN(), "y": 0.3, "unit": "ratio"}, code: PositionCodeNotFinite},
		{name: "infinity", position: map[string]any{"x": 0.2, "y": math.Inf(1), "unit": "ratio"}, code: PositionCodeNotFinite},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := persistence.NewInMemoryEventStore()
			gameActor := NewGameActor("game-1", testState(), store, 8, DefaultAppliers())
			before := gameActor.Snapshot()
			result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "invalid-"+tt.name, "card.position.changed", map[string]any{
				"instanceId": "i1", "position": tt.position,
			}), "p1")
			positionError, ok := AsPositionValidationError(result.Err)
			if !ok || positionError.Code != tt.code {
				t.Fatalf("error = %#v, want %s", result.Err, tt.code)
			}
			if !reflect.DeepEqual(before, gameActor.Snapshot()) || len(result.Patches) != 0 || result.Event.Type != "" {
				t.Fatalf("rejection changed output/state: result=%#v", result)
			}
			events, err := store.EventsAfter(context.Background(), "game-1", 0)
			if err != nil || len(events) != 0 {
				t.Fatalf("rejection persisted event: %#v %v", events, err)
			}
		})
	}
}

func TestCardsPositionChangedPrevalidatesEntireBatchAndEmitsOneBatchPatch(t *testing.T) {
	initial := testStateWithTwoBattlefieldCards()
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
	before := gameActor.Snapshot()
	invalid := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "invalid-batch", "cards.position.changed", map[string]any{
		"playerId": "p1",
		"positions": []map[string]any{
			{"instanceId": "i1", "position": map[string]any{"x": 0.2, "y": 0.3, "unit": "ratio"}},
			{"instanceId": "i2", "position": map[string]any{"x": 1.2, "y": 0.6, "unit": "ratio"}},
		},
	}), "p1")
	positionError, ok := AsPositionValidationError(invalid.Err)
	if !ok || positionError.Code != PositionCodeOutOfRange || positionError.Index != 1 {
		t.Fatalf("batch error = %#v", invalid.Err)
	}
	if !reflect.DeepEqual(before, gameActor.Snapshot()) {
		t.Fatal("invalid batch mutated an earlier entry")
	}

	valid := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "valid-batch", "cards.position.changed", map[string]any{
		"playerId": "p1",
		"positions": []map[string]any{
			{"instanceId": "i1", "position": map[string]any{"x": 0.2, "y": 0.3, "unit": "ratio"}},
			{"instanceId": "i2", "position": map[string]any{"x": 0.8, "y": 0.6, "unit": "ratio"}},
		},
	}), "p1")
	if valid.Err != nil {
		t.Fatalf("valid batch failed: %v", valid.Err)
	}
	patch := patchForVisibility(valid.Patches, protocol.VisibilityPublic, "cards.position.set")
	if patch == nil {
		t.Fatalf("missing batch position patch: %#v", valid.Patches)
	}
	if patch.Data["effectVersion"] != PositionContractEffectVersion {
		t.Fatalf("batch patch effect version missing: %#v", patch.Data)
	}
	if len(valid.Event.Payload["previousPositions"].([]map[string]any)) != 2 {
		t.Fatalf("missing previous positions: %#v", valid.Event.Payload)
	}
}

func TestCardsPositionChangedRejectsStalePlayerLocationBeforeMutation(t *testing.T) {
	gameActor := NewGameActor("game-1", testStateWithTwoBattlefieldCards(), nil, 8, DefaultAppliers())
	before := gameActor.Snapshot()
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "stale-player", "cards.position.changed", map[string]any{
		"playerId": "p2",
		"positions": []map[string]any{
			{"instanceId": "i1", "position": map[string]any{"x": 0.2, "y": 0.3, "unit": "ratio"}},
			{"instanceId": "i2", "position": map[string]any{"x": 0.8, "y": 0.6, "unit": "ratio"}},
		},
	}), "p1")
	authorizationError, ok := AsAuthorizationError(result.Err)
	if !ok || authorizationError.Code != AuthorizationCodeZoneMismatch || authorizationError.Index != 0 {
		t.Fatalf("stale location error = %#v", result.Err)
	}
	if !reflect.DeepEqual(before, gameActor.Snapshot()) || len(result.Patches) != 0 {
		t.Fatalf("stale location mutated state: %#v", result)
	}
}

func TestCardPositionChangedRejectsStalePlayerLocationBeforeMutation(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	before := gameActor.Snapshot()
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "stale-single-player", "card.position.changed", map[string]any{
		"playerId": "p2", "zone": "battlefield", "instanceId": "i1",
		"position": map[string]any{"x": 0.2, "y": 0.3, "unit": "ratio"},
	}), "p1")
	authorizationError, ok := AsAuthorizationError(result.Err)
	if !ok || authorizationError.Code != AuthorizationCodeZoneMismatch {
		t.Fatalf("stale location error = %#v", result.Err)
	}
	if !reflect.DeepEqual(before, gameActor.Snapshot()) || len(result.Patches) != 0 {
		t.Fatalf("stale location mutated state: %#v", result)
	}
}

func TestPositionRetryIsIdempotent(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), persistence.NewInMemoryEventStore(), 8, DefaultAppliers())
	cmd := command("game-1", 1, "position-retry", "card.position.changed", map[string]any{
		"instanceId": "i1", "position": map[string]any{"x": 0.42, "y": 0.68, "unit": "ratio"},
	})
	first := gameActor.ApplyDirect(context.Background(), cmd, "p1")
	retry := gameActor.ApplyDirect(context.Background(), cmd, "p1")
	if first.Err != nil || retry.Err != nil || first.Event.Version != retry.Event.Version || gameActor.Version() != 2 {
		t.Fatalf("retry was not idempotent: first=%#v retry=%#v version=%d", first, retry, gameActor.Version())
	}
}

func TestReplayCopiesCanonicalAndLegacyPositionWithoutViewportNormalization(t *testing.T) {
	canonical := protocol.EventPayloadV2{
		GameID: "game-1", Version: 2, Type: "card.position.changed", CreatedBy: "p1", ClientActionID: "canonical-replay", CreatedAt: time.Now().UTC(),
		Payload: map[string]any{"instanceId": "i1", "position": map[string]any{"x": 0.42123456789, "y": 0.68123456789, "unit": "ratio"}},
	}
	canonicalState, err := ReplayEvents(testState(), []protocol.EventPayloadV2{canonical}, DefaultAppliers())
	if err != nil {
		t.Fatalf("canonical replay failed: %v", err)
	}
	if got := canonicalState.Instances["i1"].Position; !reflect.DeepEqual(got, canonical.Payload["position"]) {
		t.Fatalf("canonical replay recalculated position: %#v", got)
	}

	legacy := canonical
	legacy.ClientActionID = "legacy-replay"
	legacy.Payload = map[string]any{"instanceId": "i1", "position": map[string]any{"x": 420, "y": 180}}
	legacyState, err := ReplayEvents(testState(), []protocol.EventPayloadV2{legacy}, DefaultAppliers())
	if err != nil {
		t.Fatalf("legacy replay failed: %v", err)
	}
	if got := legacyState.Instances["i1"].Position; !reflect.DeepEqual(got, legacy.Payload["position"]) {
		t.Fatalf("legacy replay rewrote pixels: %#v", got)
	}
}

func TestReplayPreservesLegacyPixelPositionFromHistoricalMovementEvent(t *testing.T) {
	legacy := map[string]any{"x": 420, "y": 180, "unit": "px"}
	event := protocol.EventPayloadV2{
		GameID: "game-1", Version: 2, Type: "card.moved", CreatedBy: "p1", ClientActionID: "legacy-move", CreatedAt: time.Now().UTC(),
		Payload: map[string]any{
			"playerId": "p1", "fromZone": "battlefield", "toZone": "battlefield", "instanceId": "i1",
			"position": legacy,
			"moves":    []any{map[string]any{"instanceId": "i1", "position": legacy}},
		},
	}
	replayed, err := ReplayEvents(testState(), []protocol.EventPayloadV2{event}, DefaultAppliers())
	if err != nil {
		t.Fatalf("legacy movement replay failed: %v", err)
	}
	if got := replayed.Instances["i1"].Position; !reflect.DeepEqual(got, legacy) {
		t.Fatalf("legacy movement position = %#v", got)
	}
}

func TestBattlefieldMovementPreservesCanonicalZeroBoundaryWithoutNewPosition(t *testing.T) {
	initial := testState()
	instance := initial.Instances["i1"]
	instance.Position = map[string]any{"x": 0.0, "y": 0.0, "unit": "ratio"}
	initial.Instances["i1"] = instance
	gameActor := NewGameActor("game-1", initial, nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "preserve-zero", "card.moved", map[string]any{
		"playerId": "p1", "fromZone": "battlefield", "toZone": "battlefield", "instanceId": "i1",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("battlefield movement failed: %v", result.Err)
	}
	if got := gameActor.Snapshot().Instances["i1"].Position; !reflect.DeepEqual(got, instance.Position) {
		t.Fatalf("zero boundary position changed: %#v", got)
	}
}
