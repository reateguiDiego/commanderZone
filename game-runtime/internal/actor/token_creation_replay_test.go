package actor

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strconv"
	"testing"

	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

func TestTokenCreationReplayMatchesLiveFinalEffects(t *testing.T) {
	for _, quantity := range []int{1, 2, 10, 20} {
		t.Run(testQuantityName(quantity), func(t *testing.T) {
			initial := testState()
			state.NormalizeForRecovery("game-1", &initial)
			gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
			result := gameActor.ApplyDirect(context.Background(), tokenCreationCommand(quantity), "p1")
			if result.Err != nil {
				t.Fatalf("live token creation failed: %v", result.Err)
			}

			persisted := roundTripTokenEvent(t, result.Event)
			replayed, err := ReplayEvents(initial.Clone(), []protocol.EventPayloadV2{persisted}, DefaultAppliers())
			if err != nil {
				t.Fatalf("replay failed: %v", err)
			}
			live := gameActor.Snapshot()
			// Recovery normalizes the legacy nil stack to an empty stack; that
			// unrelated representation detail is outside token creation.
			live.Stack = replayed.Stack
			if !reflect.DeepEqual(replayed, live) {
				t.Fatalf("replayed state differs from live state\nlive: %#v\nreplayed: %#v", live, replayed)
			}
			liveBootstrap := BootstrapV2ForViewer(live, "p1")
			replayedBootstrap := BootstrapV2ForViewer(replayed, "p1")
			if !reflect.DeepEqual(replayedBootstrap, liveBootstrap) {
				t.Fatalf("replayed bootstrap differs from live bootstrap\nlive: %#v\nreplayed: %#v", liveBootstrap, replayedBootstrap)
			}
			assertTokenEventFinalEffects(t, persisted, quantity)
		})
	}
}

func TestTokenCreationRejectsInvalidQuantityWithoutMutation(t *testing.T) {
	tests := []struct {
		name    string
		value   any
		present bool
	}{
		{name: "missing"},
		{name: "null", value: nil, present: true},
		{name: "string", value: "2", present: true},
		{name: "decimal", value: 1.5, present: true},
		{name: "zero", value: 0, present: true},
		{name: "negative", value: -1, present: true},
		{name: "twenty_one", value: 21, present: true},
		{name: "one_hundred", value: 100, present: true},
		{name: "one_thousand", value: 1000, present: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			initial := testState()
			store := persistence.NewInMemoryEventStore()
			gameActor := NewGameActor("game-1", initial.Clone(), store, 8, DefaultAppliers())
			before := gameActor.Snapshot()
			payload := map[string]any{"playerId": "p1", "card": map[string]any{"name": "Treasure"}}
			if test.present {
				payload["quantity"] = test.value
			}
			result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "invalid-token-"+test.name, "card.token.created", payload), "p1")
			quantityError, ok := AsTokenQuantityValidationError(result.Err)
			if !ok || quantityError.CommandType != "card.token.created" {
				t.Fatalf("error = %v, want %s", result.Err, TokenQuantityErrorCode)
			}
			if !reflect.DeepEqual(gameActor.Snapshot(), before) {
				t.Fatalf("invalid quantity mutated state: %#v", gameActor.Snapshot())
			}
			if result.Event.Version != 0 || len(result.Patches) != 0 {
				t.Fatalf("invalid quantity emitted event or patches: %#v", result)
			}
			events, err := store.EventsAfter(context.Background(), "game-1", 0)
			if err != nil || len(events) != 0 {
				t.Fatalf("invalid quantity persisted events: events=%#v err=%v", events, err)
			}
		})
	}
}

func TestTokenCreationRetryAndActorRestartAreIdempotent(t *testing.T) {
	initial := testState()
	state.NormalizeForRecovery("game-1", &initial)
	store := persistence.NewInMemoryEventStore()
	cmd := tokenCreationCommand(10)
	original := NewGameActor("game-1", initial.Clone(), store, 8, DefaultAppliers())
	first := original.ApplyDirect(context.Background(), cmd, "p1")
	if first.Err != nil {
		t.Fatalf("first command failed: %v", first.Err)
	}
	retry := original.ApplyDirect(context.Background(), cmd, "p1")
	if retry.Err != nil || !reflect.DeepEqual(retry.Patches, first.Patches) || !reflect.DeepEqual(retry.Event, first.Event) {
		t.Fatalf("in-memory retry differs: first=%#v retry=%#v", first, retry)
	}
	restarted := NewGameActor("game-1", original.Snapshot(), store, 8, DefaultAppliers())
	durableRetry := restarted.ApplyDirect(context.Background(), cmd, "p1")
	if durableRetry.Err != nil || !reflect.DeepEqual(durableRetry.Patches, first.Patches) || !reflect.DeepEqual(durableRetry.Event, first.Event) {
		t.Fatalf("durable retry differs: first=%#v retry=%#v", first, durableRetry)
	}
	events, err := store.EventsAfter(context.Background(), "game-1", 0)
	if err != nil || len(events) != 1 {
		t.Fatalf("persisted event count = %d, err=%v", len(events), err)
	}
	replayed, err := ReplayEvents(initial.Clone(), []protocol.EventPayloadV2{roundTripTokenEvent(t, events[0])}, DefaultAppliers())
	if err != nil {
		t.Fatalf("restart replay failed: %v", err)
	}
	live := original.Snapshot()
	live.Stack = replayed.Stack
	if !reflect.DeepEqual(replayed, live) {
		t.Fatalf("actor restart state differs from live")
	}
}

func TestTokenCreationRetryAfterPrePersistFailureUsesTheSameFinalEffects(t *testing.T) {
	initial := testState()
	state.NormalizeForRecovery("game-1", &initial)
	store := &tokenFailOnceStore{delegate: persistence.NewInMemoryEventStore(), err: errors.New("token append failed")}
	cmd := tokenCreationCommand(2)
	gameActor := NewGameActor("game-1", initial.Clone(), store, 8, DefaultAppliers())
	before := gameActor.Snapshot()

	failed := gameActor.ApplyDirect(context.Background(), cmd, "p1")
	if !errors.Is(failed.Err, store.err) {
		t.Fatalf("first error = %v, want %v", failed.Err, store.err)
	}
	if !reflect.DeepEqual(gameActor.Snapshot(), before) || len(failed.Patches) != 0 || failed.Event.Version != 0 {
		t.Fatalf("pre-persist failure was not rolled back: result=%#v state=%#v", failed, gameActor.Snapshot())
	}

	retry := gameActor.ApplyDirect(context.Background(), cmd, "p1")
	if retry.Err != nil {
		t.Fatalf("retry failed: %v", retry.Err)
	}
	assertTokenEventFinalEffects(t, roundTripTokenEvent(t, retry.Event), 2)
	events, err := store.EventsAfter(context.Background(), "game-1", 0)
	if err != nil || len(events) != 1 {
		t.Fatalf("retry persisted events=%d err=%v", len(events), err)
	}
}

func TestLegacyTokenCreationEventWithoutFinalTokensRemainsReplayable(t *testing.T) {
	initial := testState()
	state.NormalizeForRecovery("game-1", &initial)
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), tokenCreationCommand(1), "p1")
	if result.Err != nil {
		t.Fatalf("live token creation failed: %v", result.Err)
	}
	legacy := roundTripTokenEvent(t, result.Event)
	delete(legacy.Payload, "effectVersion")
	delete(legacy.Payload, "tokens")
	replayed, err := ReplayEvents(initial.Clone(), []protocol.EventPayloadV2{legacy}, DefaultAppliers())
	if err != nil {
		t.Fatalf("legacy event replay failed: %v", err)
	}
	instanceID := legacy.Payload["instanceIds"].([]any)[0].(string)
	instance := replayed.Instances[instanceID]
	if instance.CardKey != "treasure-print-id:token" || instance.PrintID != "treasure-print-id" || instance.CardVersion != "oracle-v7" || instance.Language != "es" {
		t.Fatalf("legacy identity mismatch: %#v", instance)
	}
}

func TestTokenCreationReplayFailsClosedForUnknownEffectVersion(t *testing.T) {
	initial := testState()
	state.NormalizeForRecovery("game-1", &initial)
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), tokenCreationCommand(2), "p1")
	if result.Err != nil {
		t.Fatalf("live token creation failed: %v", result.Err)
	}
	event := roundTripTokenEvent(t, result.Event)
	event.Payload["effectVersion"] = 99
	replayed := initial.Clone()
	before := replayed.Clone()
	if err := ReplayEventWithAppliers(&replayed, event, DefaultAppliers()); err == nil {
		t.Fatal("unknown token effectVersion replay unexpectedly succeeded")
	}
	if !reflect.DeepEqual(replayed, before) {
		t.Fatalf("unknown token effectVersion mutated state: %#v", replayed)
	}
}

func roundTripTokenEvent(t *testing.T, event protocol.EventPayloadV2) protocol.EventPayloadV2 {
	t.Helper()
	encoded, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	var persisted protocol.EventPayloadV2
	if err := json.Unmarshal(encoded, &persisted); err != nil {
		t.Fatal(err)
	}
	return persisted
}

func assertTokenEventFinalEffects(t *testing.T, event protocol.EventPayloadV2, quantity int) {
	t.Helper()
	if effectVersion, ok := strictInteger(event.Payload["effectVersion"]); !ok || effectVersion != tokenCreatedEffectVersion {
		t.Fatalf("effectVersion = %#v", event.Payload["effectVersion"])
	}
	tokens, ok := tokenEventMaps(event.Payload["tokens"])
	if !ok || len(tokens) != quantity {
		t.Fatalf("tokens = %#v, want %d", event.Payload["tokens"], quantity)
	}
	ids, err := stringSliceField(event.Payload, "instanceIds")
	if err != nil || len(ids) != quantity {
		t.Fatalf("instanceIds = %#v, err=%v", event.Payload["instanceIds"], err)
	}
	for index, token := range tokens {
		if token["instanceId"] != ids[index] || token["cardKey"] != "treasure-print-id:token" || token["printId"] != "treasure-print-id" || token["cardVersion"] != "oracle-v7" || token["language"] != "es" {
			t.Fatalf("token[%d] identity = %#v", index, token)
		}
		for _, required := range []string{"tokenMeta", "ownerPlayerId", "controllerPlayerId", "zone", "position", "counters", "tapped", "rotation", "faceDown", "activeFace", "printedStats", "manualOverrides", "mutableStats"} {
			if _, exists := token[required]; !exists {
				t.Fatalf("token[%d] missing %s: %#v", index, required, token)
			}
		}
	}
	logs, ok := event.Payload["eventLogEntries"].([]any)
	if !ok || len(logs) != 1 {
		t.Fatalf("eventLogEntries = %#v, want one aggregated entry", event.Payload["eventLogEntries"])
	}
}

func tokenCreationCommand(quantity int) protocol.CommandEnvelopeV2 {
	return command("game-1", 1, "token-create-exact", "card.token.created", map[string]any{
		"playerId": "p1",
		"quantity": quantity,
		"card": map[string]any{
			"name":        "Treasure",
			"scryfallId":  "treasure-print-id",
			"cardVersion": "oracle-v7",
			"language":    "es",
			"typeLine":    "Token Artifact - Treasure",
			"power":       "0",
			"toughness":   "1",
			"colors":      []any{"C"},
		},
	})
}

func testQuantityName(quantity int) string {
	return "quantity_" + strconv.Itoa(quantity)
}

type tokenFailOnceStore struct {
	delegate persistence.EventStore
	err      error
	failed   bool
}

func (s *tokenFailOnceStore) AppendEvent(ctx context.Context, event protocol.EventPayloadV2) error {
	if !s.failed {
		s.failed = true
		return s.err
	}
	return s.delegate.AppendEvent(ctx, event)
}

func (s *tokenFailOnceStore) EventByClientActionID(ctx context.Context, gameID string, clientActionID string) (protocol.EventPayloadV2, bool, error) {
	return s.delegate.EventByClientActionID(ctx, gameID, clientActionID)
}

func (s *tokenFailOnceStore) LatestSnapshot(ctx context.Context, gameID string) (persistence.CompactSnapshot, bool, error) {
	return s.delegate.LatestSnapshot(ctx, gameID)
}

func (s *tokenFailOnceStore) EventsAfter(ctx context.Context, gameID string, version int64) ([]protocol.EventPayloadV2, error) {
	return s.delegate.EventsAfter(ctx, gameID, version)
}

func (s *tokenFailOnceStore) SaveSnapshot(ctx context.Context, snapshot persistence.CompactSnapshot) error {
	return s.delegate.SaveSnapshot(ctx, snapshot)
}
