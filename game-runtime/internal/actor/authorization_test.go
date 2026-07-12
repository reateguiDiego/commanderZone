package actor

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/state"
)

func TestMovementAuthorityUsesControllerOnBattlefieldAndOwnerElsewhere(t *testing.T) {
	tests := []struct {
		name       string
		actorID    string
		instanceID string
		wantCode   string
	}{
		{name: "owner controller moves own permanent", actorID: "p1", instanceID: "a1"},
		{name: "current controller moves borrowed permanent", actorID: "p3", instanceID: "b1"},
		{name: "owner cannot move permanent controlled by another player", actorID: "p2", instanceID: "b1", wantCode: AuthorizationCodeInstanceNotControlled},
		{name: "public visibility grants no authority", actorID: "p1", instanceID: "b1", wantCode: AuthorizationCodeInstanceNotControlled},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			initial := batchAuthorizationState()
			gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
			before := gameActor.Snapshot()
			result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-"+tt.name, "card.moved", map[string]any{
				"playerId":   tt.actorID,
				"fromZone":   "battlefield",
				"toZone":     "graveyard",
				"instanceId": tt.instanceID,
			}), tt.actorID)
			if tt.wantCode == "" {
				if result.Err != nil {
					t.Fatalf("authorized move failed: %v", result.Err)
				}
				return
			}
			assertAuthorizationError(t, result.Err, tt.wantCode, tt.instanceID, 0)
			if !reflect.DeepEqual(before, gameActor.Snapshot()) {
				t.Fatal("rejected single movement mutated state")
			}
		})
	}
}

func TestCardsMovedPrevalidatesEntireBatchBeforeMutation(t *testing.T) {
	tests := []struct {
		name        string
		instanceIDs []string
		fromZone    string
		wantCode    string
		wantID      string
		wantIndex   int
	}{
		{name: "mixed authority", instanceIDs: []string{"a1", "b1"}, fromZone: "battlefield", wantCode: AuthorizationCodeMixedAuthorityBatch, wantID: "b1", wantIndex: 1},
		{name: "missing instance", instanceIDs: []string{"a1", "missing"}, fromZone: "battlefield", wantCode: AuthorizationCodeInstanceNotFound, wantID: "missing", wantIndex: 1},
		{name: "duplicate instance", instanceIDs: []string{"a1", "a1"}, fromZone: "battlefield", wantCode: AuthorizationCodeDuplicateInstance, wantID: "a1", wantIndex: 1},
		{name: "stale source zone", instanceIDs: []string{"a1"}, fromZone: "hand", wantCode: AuthorizationCodeZoneMismatch, wantID: "a1", wantIndex: 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			initial := batchAuthorizationState()
			store := persistence.NewInMemoryEventStore()
			gameActor := NewGameActor("game-1", initial.Clone(), store, 8, DefaultAppliers())
			before := gameActor.Snapshot()
			result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "batch-"+tt.name, "cards.moved", map[string]any{
				"playerId":    "p1",
				"fromZone":    tt.fromZone,
				"toZone":      "graveyard",
				"instanceIds": tt.instanceIDs,
			}), "p1")
			assertAuthorizationError(t, result.Err, tt.wantCode, tt.wantID, tt.wantIndex)
			if len(result.Patches) != 0 || result.Event.Version != 0 {
				t.Fatalf("rejected batch emitted output: event=%#v patches=%#v", result.Event, result.Patches)
			}
			if !reflect.DeepEqual(before, gameActor.Snapshot()) {
				t.Fatal("rejected batch mutated state or version")
			}
			events, err := store.EventsAfter(context.Background(), "game-1", 0)
			if err != nil || len(events) != 0 {
				t.Fatalf("rejected batch persisted events: events=%#v err=%v", events, err)
			}
		})
	}
}

func TestCardsPositionChangedIsAtomicAcrossMixedAuthority(t *testing.T) {
	initial := batchAuthorizationState()
	store := persistence.NewInMemoryEventStore()
	gameActor := NewGameActor("game-1", initial.Clone(), store, 8, DefaultAppliers())
	before := gameActor.Snapshot()
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "position-mixed", "cards.position.changed", map[string]any{
		"playerId": "p1",
		"positions": []map[string]any{
			{"instanceId": "a1", "position": map[string]any{"x": 0.3, "y": 0.4, "unit": "ratio"}},
			{"instanceId": "b1", "position": map[string]any{"x": 0.7, "y": 0.8, "unit": "ratio"}},
		},
	}), "p1")
	assertAuthorizationError(t, result.Err, AuthorizationCodeMixedAuthorityBatch, "b1", 1)
	if len(result.Patches) != 0 || !reflect.DeepEqual(before, gameActor.Snapshot()) {
		t.Fatalf("rejected position batch was not atomic: patches=%#v state=%#v", result.Patches, gameActor.Snapshot())
	}
	events, err := store.EventsAfter(context.Background(), "game-1", 0)
	if err != nil || len(events) != 0 {
		t.Fatalf("rejected position batch persisted events: events=%#v err=%v", events, err)
	}
}

func TestCardPositionChangedRequiresCurrentController(t *testing.T) {
	allowedActor := NewGameActor("game-1", batchAuthorizationState(), nil, 8, DefaultAppliers())
	allowed := allowedActor.ApplyDirect(context.Background(), command("game-1", 1, "position-controlled", "card.position.changed", map[string]any{
		"instanceId": "b1", "position": map[string]any{"x": 0.4, "y": 0.5, "unit": "ratio"},
	}), "p3")
	if allowed.Err != nil {
		t.Fatalf("controller position failed: %v", allowed.Err)
	}

	deniedActor := NewGameActor("game-1", batchAuthorizationState(), nil, 8, DefaultAppliers())
	before := deniedActor.Snapshot()
	denied := deniedActor.ApplyDirect(context.Background(), command("game-1", 1, "position-visible", "card.position.changed", map[string]any{
		"instanceId": "b1", "position": map[string]any{"x": 0.4, "y": 0.5, "unit": "ratio"},
	}), "p1")
	assertAuthorizationError(t, denied.Err, AuthorizationCodeInstanceNotControlled, "b1", 0)
	if !reflect.DeepEqual(before, deniedActor.Snapshot()) {
		t.Fatal("denied single position mutated state")
	}
}

func TestBattlefieldStateCommandsRequireCurrentController(t *testing.T) {
	tests := []struct {
		name        string
		commandType string
		payload     map[string]any
	}{
		{name: "tap", commandType: "card.tapped", payload: map[string]any{"tapped": true}},
		{name: "counter", commandType: "card.counter.changed", payload: map[string]any{"counter": "charge", "value": 1}},
		{name: "stats", commandType: "card.power_toughness.changed", payload: map[string]any{"power": 4, "toughness": 5}},
		{name: "face", commandType: "card.face.changed", payload: map[string]any{"faceIndex": 1}},
		{name: "face down", commandType: "card.face_down.changed", payload: map[string]any{"faceDown": true}},
		{name: "controller", commandType: "card.controller.changed", payload: map[string]any{"targetPlayerId": "p1"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			allowedPayload := cloneMap(tt.payload)
			allowedPayload["instanceId"] = "b1"
			allowedActor := NewGameActor("game-1", batchAuthorizationState(), nil, 8, DefaultAppliers())
			allowed := allowedActor.ApplyDirect(context.Background(), command("game-1", 1, "allowed-"+tt.name, tt.commandType, allowedPayload), "p3")
			if allowed.Err != nil {
				t.Fatalf("controller command failed: %v", allowed.Err)
			}

			initial := batchAuthorizationState()
			deniedPayload := cloneMap(tt.payload)
			deniedPayload["instanceId"] = "b1"
			deniedActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
			before := deniedActor.Snapshot()
			denied := deniedActor.ApplyDirect(context.Background(), command("game-1", 1, "denied-"+tt.name, tt.commandType, deniedPayload), "p1")
			assertAuthorizationError(t, denied.Err, AuthorizationCodeInstanceNotControlled, "b1", 0)
			if !reflect.DeepEqual(before, deniedActor.Snapshot()) {
				t.Fatal("denied battlefield state command mutated state")
			}
		})
	}
}

func TestPrivateZoneMovementRequiresOwnerWithoutIdentityLeak(t *testing.T) {
	initial := batchAuthorizationState()
	initial.Instances["private-b"] = state.CardInstanceRuntime{InstanceID: "private-b", CardKey: "secret-card@1", OwnerID: "p2", ControllerID: "p2", Zone: state.ZoneHand}
	p2Zones := initial.Zones["p2"]
	p2Zones.Hand = []string{"private-b"}
	initial.Zones["p2"] = p2Zones
	initial.Loc["private-b"] = state.Location{PlayerID: "p2", Zone: state.ZoneHand, Index: 0, ControllerID: "p2"}
	gameActor := NewGameActor("game-1", initial, nil, 8, DefaultAppliers())
	before := gameActor.Snapshot()
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-private-opponent", "card.moved", map[string]any{
		"playerId": "p1", "fromZone": "hand", "toZone": "graveyard", "instanceId": "private-b",
	}), "p1")
	assertAuthorizationError(t, result.Err, AuthorizationCodeInstanceNotOwned, "private-b", 0)
	if contains(result.Err.Error(), "secret-card@1") || !reflect.DeepEqual(before, gameActor.Snapshot()) {
		t.Fatalf("private rejection leaked identity or mutated state: %v", result.Err)
	}
}

func TestLibraryPutAndRelationsDoNotUsePublicVisibilityAsPermission(t *testing.T) {
	tests := []struct {
		name        string
		commandType string
		payload     map[string]any
		wantCode    string
	}{
		{name: "put opponent public card into library", commandType: "library.put_top", payload: map[string]any{"playerId": "p1", "instanceId": "b1"}, wantCode: AuthorizationCodeInstanceNotControlled},
		{name: "create arrow from opponent permanent", commandType: "arrow.created", payload: map[string]any{"ownerId": "p1", "fromInstanceId": "b1", "toInstanceId": "a1"}, wantCode: AuthorizationCodeInstanceNotControlled},
		{name: "add opponent permanent to stack", commandType: "stack.card_added", payload: map[string]any{"playerId": "p1", "instanceId": "b1"}, wantCode: AuthorizationCodeInstanceNotControlled},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			initial := batchAuthorizationState()
			gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
			before := gameActor.Snapshot()
			result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "relation-"+tt.name, tt.commandType, tt.payload), "p1")
			assertAuthorizationError(t, result.Err, tt.wantCode, "b1", 0)
			if !reflect.DeepEqual(before, gameActor.Snapshot()) {
				t.Fatal("denied instance-referencing command mutated state")
			}
			if result.Err != nil && (contains(result.Err.Error(), "card-b@1") || contains(result.Err.Error(), "Borrowed")) {
				t.Fatalf("authorization error leaked card identity: %v", result.Err)
			}
		})
	}
}

func TestRejectedAuthorizationRetryRemainsSideEffectFree(t *testing.T) {
	initial := batchAuthorizationState()
	store := persistence.NewInMemoryEventStore()
	gameActor := NewGameActor("game-1", initial.Clone(), store, 8, DefaultAppliers())
	before := gameActor.Snapshot()
	cmd := command("game-1", 1, "retry-denied", "card.tapped", map[string]any{"instanceId": "b1", "tapped": true})
	for attempt := 0; attempt < 2; attempt++ {
		result := gameActor.ApplyDirect(context.Background(), cmd, "p1")
		assertAuthorizationError(t, result.Err, AuthorizationCodeInstanceNotControlled, "b1", 0)
	}
	if !reflect.DeepEqual(before, gameActor.Snapshot()) {
		t.Fatal("authorization retry mutated state")
	}
	events, err := store.EventsAfter(context.Background(), "game-1", 0)
	if err != nil || len(events) != 0 {
		t.Fatalf("authorization retry persisted events: events=%#v err=%v", events, err)
	}
}

func assertAuthorizationError(t *testing.T, err error, code string, instanceID string, index int) {
	t.Helper()
	if !errors.Is(err, ErrActorPermission) {
		t.Fatalf("err=%v want actor permission", err)
	}
	authorizationError, ok := AsAuthorizationError(err)
	if !ok {
		t.Fatalf("err=%v is not structured authorization error", err)
	}
	if authorizationError.Code != code || authorizationError.InstanceID != instanceID || authorizationError.Index != index {
		t.Fatalf("authorization error=%#v want code=%s instance=%s index=%d", authorizationError, code, instanceID, index)
	}
}

func batchAuthorizationState() state.GameState {
	game := testState()
	game.Players["p3"] = map[string]any{"life": 40, "counters": map[string]any{}, "commanderDamage": map[string]any{}}
	a1 := game.Instances["i1"]
	delete(game.Instances, "i1")
	delete(game.Loc, "i1")
	a1.InstanceID = "a1"
	a1.CardKey = "card-a@1"
	a1.OwnerID = "p1"
	a1.ControllerID = "p1"
	a1.Position = map[string]any{"x": 0.1, "y": 0.1, "unit": "ratio"}
	game.Instances["a1"] = a1
	game.Loc["a1"] = state.Location{PlayerID: "p1", Zone: state.ZoneBattlefield, Index: 0, ControllerID: "p1"}
	p1Zones := game.Zones["p1"]
	p1Zones.Battlefield = []string{"a1"}
	game.Zones["p1"] = p1Zones

	game.Instances["b1"] = state.CardInstanceRuntime{
		InstanceID:   "b1",
		CardKey:      "card-b@1",
		OwnerID:      "p2",
		ControllerID: "p3",
		Zone:         state.ZoneBattlefield,
		Counters:     map[string]int{},
		Position:     map[string]any{"x": 0.7, "y": 0.7, "unit": "ratio"},
	}
	game.Zones["p2"] = state.PlayerZones{}
	game.Zones["p3"] = state.PlayerZones{Battlefield: []string{"b1"}}
	game.Loc["b1"] = state.Location{PlayerID: "p3", Zone: state.ZoneBattlefield, Index: 0, ControllerID: "p3"}
	return game
}
