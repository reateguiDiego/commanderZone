package actor

import (
	"bytes"
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
			assertAuthoritativeTokenGroup(t, live, persisted, quantity)
		})
	}
}

func TestTokenCreationPatchOrdersInstancesBeforeAuthoritativeGroup(t *testing.T) {
	for _, quantity := range []int{1, 2, 10, 20} {
		t.Run(testQuantityName(quantity), func(t *testing.T) {
			game := testState()
			state.NormalizeForRecovery("game-1", &game)
			result := NewGameActor("game-1", game, nil, 8, DefaultAppliers()).ApplyDirect(context.Background(), tokenCreationCommand(quantity), "p1")
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			public := patchForVisibility(result.Patches, protocol.VisibilityPublic, "zone.cards.add")
			if public == nil {
				t.Fatalf("missing zone.cards.add: %#v", result.Patches)
			}
			groupPatch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "token.group.set")
			if quantity == 1 {
				if groupPatch != nil {
					t.Fatalf("quantity one emitted TokenGroup patch: %#v", groupPatch)
				}
				return
			}
			if groupPatch == nil {
				t.Fatalf("quantity %d missing TokenGroup patch: %#v", quantity, result.Patches)
			}
			for _, envelope := range result.Patches {
				for index, op := range envelope.Ops {
					if op.Op == "token.group.set" && (index == 0 || envelope.Ops[index-1].Op != "zone.cards.add") {
						t.Fatalf("TokenGroup set was not ordered after materialization: %#v", envelope.Ops)
					}
				}
			}
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

func TestLegacyTokenCreationQuantityTenWithoutTokenGroupDoesNotInferOne(t *testing.T) {
	initial := testState()
	state.NormalizeForRecovery("game-1", &initial)
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), tokenCreationCommand(10), "p1")
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	legacy := roundTripTokenEvent(t, result.Event)
	delete(legacy.Payload, "effectVersion")
	delete(legacy.Payload, "tokens")
	delete(legacy.Payload, "tokenGroup")
	replayed, err := ReplayEvents(initial.Clone(), []protocol.EventPayloadV2{legacy}, DefaultAppliers())
	if err != nil {
		t.Fatal(err)
	}
	if len(replayed.Relations.TokenGroups) != 0 {
		t.Fatalf("legacy replay inferred token group: %#v", replayed.Relations.TokenGroups)
	}
}

func TestNewTokenCreationQuantityTenWithoutTokenGroupFailsClosed(t *testing.T) {
	initial := testState()
	state.NormalizeForRecovery("game-1", &initial)
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), tokenCreationCommand(10), "p1")
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	event := roundTripTokenEvent(t, result.Event)
	delete(event.Payload, "tokenGroup")
	replayed := initial.Clone()
	before := replayed.Clone()
	if err := ReplayEventWithAppliers(&replayed, event, DefaultAppliers()); err == nil {
		t.Fatal("new token effect without TokenGroup unexpectedly replayed")
	}
	if !reflect.DeepEqual(replayed, before) {
		t.Fatalf("invalid new token effect mutated state: %#v", replayed)
	}
}

func TestLegacyFinalEffectsQuantityTenWithoutTokenGroupStayIndependent(t *testing.T) {
	initial := testState()
	state.NormalizeForRecovery("game-1", &initial)
	result := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers()).ApplyDirect(context.Background(), tokenCreationCommand(10), "p1")
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	event := roundTripTokenEvent(t, result.Event)
	event.Payload["effectVersion"] = legacyTokenCreatedEffectVersion
	delete(event.Payload, "tokenGroup")
	replayed, err := ReplayEvents(initial.Clone(), []protocol.EventPayloadV2{event}, DefaultAppliers())
	if err != nil {
		t.Fatal(err)
	}
	if len(replayed.Relations.TokenGroups) != 0 || len(replayed.Instances) != len(initial.Instances)+10 {
		t.Fatalf("legacy final effects changed grouping semantics: %#v", replayed.Relations.TokenGroups)
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

func TestTokenCreationReplayFailsClosedForUnknownTokenGroupEffectVersion(t *testing.T) {
	initial := testState()
	state.NormalizeForRecovery("game-1", &initial)
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), tokenCreationCommand(2), "p1")
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	event := roundTripTokenEvent(t, result.Event)
	group := event.Payload["tokenGroup"].(map[string]any)
	group["effectVersion"] = 99
	before := initial.Clone()
	if err := ReplayEventWithAppliers(&before, event, DefaultAppliers()); err == nil {
		t.Fatal("unknown token group effect version succeeded")
	}
	if len(before.Relations.TokenGroups) != 0 || len(before.Instances) != len(initial.Instances) {
		t.Fatalf("failed replay left token group effects: %#v", before.Relations.TokenGroups)
	}
}

func TestTokenCreationReplayRejectsIncompleteTokenGroupFinalEffects(t *testing.T) {
	initial := testState()
	state.NormalizeForRecovery("game-1", &initial)
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), tokenCreationCommand(2), "p1")
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	event := roundTripTokenEvent(t, result.Event)
	group := event.Payload["tokenGroup"].(map[string]any)
	delete(group, "createdByPlayerId")
	replayed := initial.Clone()
	before := replayed.Clone()
	if err := ReplayEventWithAppliers(&replayed, event, DefaultAppliers()); err == nil {
		t.Fatal("incomplete token group final effects succeeded")
	}
	if !reflect.DeepEqual(replayed, before) {
		t.Fatalf("incomplete token group replay mutated state: %#v", replayed)
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
	encodedLog, err := json.Marshal(logs)
	if err != nil {
		t.Fatal(err)
	}
	for _, instanceID := range ids {
		if bytes.Contains(encodedLog, []byte(instanceID)) {
			t.Fatalf("aggregated token log leaked member id %q: %s", instanceID, encodedLog)
		}
	}
	if group, ok := event.Payload["tokenGroup"].(map[string]any); ok {
		if groupID := optionalString(group, "groupId"); groupID != "" && bytes.Contains(encodedLog, []byte(groupID)) {
			t.Fatalf("aggregated token log leaked group id %q: %s", groupID, encodedLog)
		}
	}
}

func assertAuthoritativeTokenGroup(t *testing.T, game state.GameState, event protocol.EventPayloadV2, quantity int) {
	t.Helper()
	if quantity == 1 {
		if len(game.Relations.TokenGroups) != 0 || event.Payload["tokenGroup"] != nil {
			t.Fatalf("quantity one created group: state=%#v event=%#v", game.Relations.TokenGroups, event.Payload["tokenGroup"])
		}
		return
	}
	if len(game.Relations.TokenGroups) != 1 {
		t.Fatalf("token groups = %#v", game.Relations.TokenGroups)
	}
	groupPayload, ok := event.Payload["tokenGroup"].(map[string]any)
	if !ok {
		t.Fatalf("tokenGroup payload = %#v", event.Payload["tokenGroup"])
	}
	groupID := optionalString(groupPayload, "groupId")
	group, ok := game.Relations.TokenGroups[groupID]
	if !ok || group.GroupID == "" || group.RootInstanceID != group.OrderedMemberIDs[0] || group.Revision != 1 || group.Quantity() != quantity || group.EffectVersion != state.TokenGroupEffectVersion {
		t.Fatalf("group = %#v", group)
	}
	ids, err := stringSliceField(event.Payload, "instanceIds")
	if err != nil || !reflect.DeepEqual(group.OrderedMemberIDs, ids) {
		t.Fatalf("membership = %#v ids=%#v err=%v", group.OrderedMemberIDs, ids, err)
	}
	rootPosition := game.Instances[group.RootInstanceID].Position
	for _, memberID := range group.OrderedMemberIDs {
		if !reflect.DeepEqual(game.Instances[memberID].Position, rootPosition) {
			t.Fatalf("member %s position differs", memberID)
		}
		indexed, ok := game.Relations.TokenGroupForMember(memberID)
		if !ok || indexed.GroupID != groupID {
			t.Fatalf("member index %s = %#v %t", memberID, indexed, ok)
		}
	}
}

func BenchmarkTokenCreationWithAuthoritativeGroup(b *testing.B) {
	for _, quantity := range []int{1, 2, 10, 20} {
		b.Run(testQuantityName(quantity), func(b *testing.B) {
			for index := 0; index < b.N; index++ {
				game := testState()
				state.NormalizeForRecovery("game-1", &game)
				gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
				cmd := tokenCreationCommand(quantity)
				cmd.ClientActionID += "-" + strconv.Itoa(index)
				if result := gameActor.ApplyDirect(context.Background(), cmd, "p1"); result.Err != nil {
					b.Fatal(result.Err)
				}
			}
		})
	}
}

func BenchmarkTokenCreationReplayWithAuthoritativeGroup(b *testing.B) {
	for _, quantity := range []int{1, 2, 10, 20} {
		initial := testState()
		state.NormalizeForRecovery("game-1", &initial)
		result := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers()).ApplyDirect(context.Background(), tokenCreationCommand(quantity), "p1")
		if result.Err != nil {
			b.Fatal(result.Err)
		}
		encoded, err := json.Marshal(result.Event)
		if err != nil {
			b.Fatal(err)
		}
		var event protocol.EventPayloadV2
		if err := json.Unmarshal(encoded, &event); err != nil {
			b.Fatal(err)
		}
		b.Run(testQuantityName(quantity), func(b *testing.B) {
			for index := 0; index < b.N; index++ {
				if _, err := ReplayEvents(initial.Clone(), []protocol.EventPayloadV2{event}, DefaultAppliers()); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func BenchmarkTokenGroupSerializedPayloadSizes(b *testing.B) {
	for _, quantity := range []int{1, 2, 10, 20} {
		game := testState()
		state.NormalizeForRecovery("game-1", &game)
		gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
		result := gameActor.ApplyDirect(context.Background(), tokenCreationCommand(quantity), "p1")
		if result.Err != nil {
			b.Fatal(result.Err)
		}
		eventBytes, err := json.Marshal(result.Event)
		if err != nil {
			b.Fatal(err)
		}
		patchBytes, err := json.Marshal(result.Patches)
		if err != nil {
			b.Fatal(err)
		}
		snapshotBytes, err := json.Marshal(gameActor.Snapshot())
		if err != nil {
			b.Fatal(err)
		}
		b.Run(testQuantityName(quantity), func(b *testing.B) {
			b.ReportMetric(float64(len(eventBytes)), "event_B")
			b.ReportMetric(float64(len(patchBytes)), "patch_B")
			b.ReportMetric(float64(len(snapshotBytes)), "snapshot_B")
			for index := 0; index < b.N; index++ {
				_, _ = json.Marshal(gameActor.Snapshot())
			}
		})
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
