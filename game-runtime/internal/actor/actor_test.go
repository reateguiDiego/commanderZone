package actor

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

func TestGameActorAppliesSimpleCommandsInOrder(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	gameActor := NewGameActor("game-1", testState(), store, 8, DefaultAppliers())

	commands := []protocol.CommandEnvelopeV2{
		command("game-1", 1, "a-life", "life.changed", map[string]any{"playerId": "p1", "life": 37}),
		command("game-1", 2, "a-turn", "turn.changed", map[string]any{"activePlayerId": "p2", "phase": "combat", "number": 3}),
		command("game-1", 3, "a-dice", "dice.rolled", map[string]any{"playerId": "p1", "sides": 20, "result": 17}),
		command("game-1", 4, "a-tap", "card.tapped", map[string]any{"instanceId": "i1", "tapped": true}),
		command("game-1", 5, "a-counter", "card.counter.changed", map[string]any{"instanceId": "i1", "counter": "+1/+1", "value": 2}),
		command("game-1", 6, "a-position", "card.position.changed", map[string]any{"instanceId": "i1", "position": map[string]any{"x": 0.4, "y": 0.2, "unit": "ratio"}}),
	}

	for _, command := range commands {
		result := gameActor.ApplyDirect(context.Background(), command, "p1")
		if result.Err != nil {
			t.Fatalf("%s failed: %v", command.Type, result.Err)
		}
		if result.Event.Version != command.BaseVersion+1 {
			t.Fatalf("%s version got %d want %d", command.Type, result.Event.Version, command.BaseVersion+1)
		}
		if len(result.Patches) != 1 {
			t.Fatalf("%s patches got %d want 1", command.Type, len(result.Patches))
		}
		if result.Patches[0].AckClientActionID != command.ClientActionID {
			t.Fatalf("%s ack mismatch", command.Type)
		}
	}

	snapshot := gameActor.Snapshot()
	if snapshot.Version != 7 {
		t.Fatalf("version got %d want 7", snapshot.Version)
	}
	if snapshot.Players["p1"]["life"] != 37 {
		t.Fatalf("life not updated: %#v", snapshot.Players["p1"]["life"])
	}
	if snapshot.Turn["activePlayerId"] != "p2" {
		t.Fatalf("turn not updated: %#v", snapshot.Turn)
	}
	instance := snapshot.Instances["i1"]
	if !instance.Tapped || instance.Rotation != 90 {
		t.Fatalf("tap not updated: %#v", instance)
	}
	if instance.Counters["+1/+1"] != 2 {
		t.Fatalf("counter not updated: %#v", instance.Counters)
	}
	if instance.Position["x"] != 0.4 {
		t.Fatalf("position not updated: %#v", instance.Position)
	}

	events, err := store.EventsAfter(context.Background(), "game-1", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != len(commands) {
		t.Fatalf("events got %d want %d", len(events), len(commands))
	}
}

func TestGameActorDuplicateClientActionIsIdempotent(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	gameActor := NewGameActor("game-1", testState(), store, 8, DefaultAppliers())
	cmd := command("game-1", 1, "a1", "card.tapped", map[string]any{"instanceId": "i1", "tapped": true})

	first := gameActor.ApplyDirect(context.Background(), cmd, "p1")
	if first.Err != nil {
		t.Fatalf("first failed: %v", first.Err)
	}
	duplicate := gameActor.ApplyDirect(context.Background(), cmd, "p1")
	if duplicate.Err != nil {
		t.Fatalf("duplicate failed: %v", duplicate.Err)
	}
	if duplicate.Event.Version != first.Event.Version {
		t.Fatalf("duplicate version got %d want %d", duplicate.Event.Version, first.Event.Version)
	}
	events, err := store.EventsAfter(context.Background(), "game-1", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("events got %d want 1", len(events))
	}
}

func TestGameActorDuplicateClientActionAfterRecoveryUsesStore(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	existing := protocol.EventPayloadV2{
		GameID:         "game-1",
		Version:        2,
		Type:           "life.changed",
		Payload:        map[string]any{"playerId": "p1", "life": 39},
		CreatedBy:      "p1",
		ClientActionID: "a1",
		CreatedAt:      time.Now().UTC(),
	}
	if err := store.AppendEvent(context.Background(), existing); err != nil {
		t.Fatalf("append failed: %v", err)
	}
	gameActor := NewGameActor("game-1", testState(), store, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "a1", "life.changed", map[string]any{"playerId": "p1", "life": 39}), "p1")
	if result.Err != nil {
		t.Fatalf("duplicate failed: %v", result.Err)
	}
	if result.Event.Version != existing.Version {
		t.Fatalf("version got %d want %d", result.Event.Version, existing.Version)
	}
	events, err := store.EventsAfter(context.Background(), "game-1", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("events got %d want 1", len(events))
	}
}

func TestGameActorSnapshotPolicySavesCompactSnapshot(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	gameActor := NewGameActorWithSnapshotPolicy("game-1", testState(), store, 8, DefaultAppliers(), SnapshotPolicy{EveryEvents: 2})
	for i := 0; i < 2; i++ {
		result := gameActor.ApplyDirect(context.Background(), command("game-1", int64(i+1), fmt.Sprintf("a%d", i), "life.changed", map[string]any{"playerId": "p1", "delta": 1}), "p1")
		if result.Err != nil {
			t.Fatalf("apply failed: %v", result.Err)
		}
	}
	snapshot, ok, err := store.LatestSnapshot(context.Background(), "game-1")
	if err != nil {
		t.Fatal(err)
	}
	if !ok || snapshot.Version != 3 {
		t.Fatalf("snapshot = %#v ok=%v", snapshot, ok)
	}
}

func TestGameActorRejectsOldBaseVersion(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	first := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "a1", "life.changed", map[string]any{"playerId": "p1", "life": 39}), "p1")
	if first.Err != nil {
		t.Fatalf("first failed: %v", first.Err)
	}
	stale := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "a2", "life.changed", map[string]any{"playerId": "p1", "life": 38}), "p1")
	if !errors.Is(stale.Err, ErrVersionConflict) {
		t.Fatalf("stale error got %v want %v", stale.Err, ErrVersionConflict)
	}
}

func TestGameActorQueueBackpressure(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 1, DefaultAppliers())
	err := gameActor.Enqueue(CommandRequest{Command: command("game-1", 1, "a1", "life.changed", map[string]any{"playerId": "p1", "life": 39})})
	if err != nil {
		t.Fatalf("first enqueue failed: %v", err)
	}
	err = gameActor.Enqueue(CommandRequest{Command: command("game-1", 1, "a2", "life.changed", map[string]any{"playerId": "p1", "life": 38})})
	if !errors.Is(err, ErrQueueFull) {
		t.Fatalf("second enqueue got %v want %v", err, ErrQueueFull)
	}
}

func TestGameActorLoopSerializesSubmittedCommands(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	gameActor.Start(ctx)
	defer func() {
		stopCtx, stopCancel := context.WithTimeout(context.Background(), time.Second)
		defer stopCancel()
		if err := gameActor.Stop(stopCtx); err != nil {
			t.Fatalf("stop failed: %v", err)
		}
	}()

	first := gameActor.Submit(context.Background(), command("game-1", 1, "a1", "life.changed", map[string]any{"playerId": "p1", "life": 39}), "p1")
	if first.Err != nil {
		t.Fatalf("first failed: %v", first.Err)
	}
	second := gameActor.Submit(context.Background(), command("game-1", 2, "a2", "card.tapped", map[string]any{"instanceId": "i1", "tapped": true}), "p1")
	if second.Err != nil {
		t.Fatalf("second failed: %v", second.Err)
	}
	if gameActor.Version() != 3 {
		t.Fatalf("version got %d want 3", gameActor.Version())
	}
}

func TestConcurrentSnapshotAccessUsesLocks(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 32, DefaultAppliers())
	stop := make(chan struct{})
	var wg sync.WaitGroup
	var closeOnce sync.Once
	defer func() {
		closeOnce.Do(func() { close(stop) })
		wg.Wait()
	}()
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
				_ = gameActor.Snapshot()
				_ = gameActor.Heartbeat()
				_ = gameActor.Version()
			}
		}
	}()
	for i := 0; i < 20; i++ {
		version := int64(i + 1)
		result := gameActor.ApplyDirect(context.Background(), command("game-1", version, fmt.Sprintf("a%d", i), "life.changed", map[string]any{"playerId": "p1", "delta": 1}), "p1")
		if result.Err != nil {
			t.Fatalf("apply failed: %v", result.Err)
		}
	}
	closeOnce.Do(func() { close(stop) })
}

func TestCardTappedPatchShape(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "a1", "card.tapped", map[string]any{"instanceId": "i1", "tapped": true}), "p1")
	if result.Err != nil {
		t.Fatalf("apply failed: %v", result.Err)
	}
	op := result.Patches[0].Ops[0]
	if op.Op != "card.field.set" {
		t.Fatalf("op got %q want card.field.set", op.Op)
	}
	fields, ok := op.Data["fields"].(map[string]any)
	if !ok {
		t.Fatalf("missing fields: %#v", op.Data)
	}
	if fields["tapped"] != true || fields["rotation"] != 90 {
		t.Fatalf("fields mismatch: %#v", fields)
	}
}

func testState() state.GameState {
	return state.GameState{
		GameID:  "game-1",
		Version: 1,
		Status:  "playing",
		Players: map[string]map[string]any{
			"p1": map[string]any{"life": 40},
			"p2": map[string]any{"life": 40},
		},
		Turn: map[string]any{"activePlayerId": "p1", "phase": "main-1", "number": 1},
		Instances: map[string]state.CardInstanceRuntime{
			"i1": {
				InstanceID:   "i1",
				CardKey:      "card-a@1",
				OwnerID:      "p1",
				ControllerID: "p1",
				Zone:         state.ZoneBattlefield,
				Counters:     map[string]int{},
				Position:     map[string]any{"x": 0.1, "y": 0.1, "unit": "ratio"},
			},
			"l1": {InstanceID: "l1", CardKey: "library-1@1", OwnerID: "p1", ControllerID: "p1", Zone: state.ZoneLibrary},
			"l2": {InstanceID: "l2", CardKey: "library-2@1", OwnerID: "p1", ControllerID: "p1", Zone: state.ZoneLibrary},
			"l3": {InstanceID: "l3", CardKey: "library-3@1", OwnerID: "p1", ControllerID: "p1", Zone: state.ZoneLibrary},
			"h1": {InstanceID: "h1", CardKey: "hand-1@1", OwnerID: "p1", ControllerID: "p1", Zone: state.ZoneHand},
			"h2": {InstanceID: "h2", CardKey: "hand-2@1", OwnerID: "p1", ControllerID: "p1", Zone: state.ZoneHand},
		},
		Zones: map[string]state.PlayerZones{
			"p1": {Library: []string{"l1", "l2", "l3"}, Hand: []string{"h1", "h2"}, Battlefield: []string{"i1"}},
		},
		Loc: map[string]state.Location{
			"i1": {PlayerID: "p1", Zone: state.ZoneBattlefield, Index: 0, ControllerID: "p1"},
			"l1": {PlayerID: "p1", Zone: state.ZoneLibrary, Index: 0, ControllerID: "p1"},
			"l2": {PlayerID: "p1", Zone: state.ZoneLibrary, Index: 1, ControllerID: "p1"},
			"l3": {PlayerID: "p1", Zone: state.ZoneLibrary, Index: 2, ControllerID: "p1"},
			"h1": {PlayerID: "p1", Zone: state.ZoneHand, Index: 0, ControllerID: "p1"},
			"h2": {PlayerID: "p1", Zone: state.ZoneHand, Index: 1, ControllerID: "p1"},
		},
		Visibility: state.VisibilityIndex{
			InstanceMasks:       map[string]uint64{},
			LibraryEpochByOwner: map[string]int64{},
			TopRevealWindows:    map[string]state.TopRevealWindow{},
		},
	}
}

func command(gameID string, baseVersion int64, actionID string, commandType string, payload map[string]any) protocol.CommandEnvelopeV2 {
	return protocol.CommandEnvelopeV2{
		GameID:         gameID,
		BaseVersion:    baseVersion,
		ClientActionID: actionID,
		Type:           commandType,
		Payload:        payload,
	}
}
