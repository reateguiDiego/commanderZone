package actor

import (
	"context"
	"testing"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

type tappedApplier struct{}

func (tappedApplier) Type() string { return "card.tapped" }

func (tappedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	instanceID, _ := command.Payload["instanceId"].(string)
	instance := game.Instances[instanceID]
	instance.Tapped = true
	game.Instances[instanceID] = instance
	emitter.EmitPublic(protocol.PatchOp{Op: "card.field.set", Data: map[string]any{"instanceId": instanceID, "field": "tapped", "value": true}})
	return map[string]any{"instanceId": instanceID, "tapped": true}, nil
}

func TestGameActorAppliesSingleCommandAndIsIdempotent(t *testing.T) {
	initial := state.GameState{
		GameID:  "game-1",
		Version: 1,
		Instances: map[string]state.CardInstanceRuntime{
			"i1": {InstanceID: "i1", OwnerID: "p1", ControllerID: "p1", Zone: state.ZoneBattlefield},
		},
		Loc: map[string]state.Location{"i1": {PlayerID: "p1", Zone: state.ZoneBattlefield}},
	}
	actor := NewGameActor("game-1", initial, nil, 1, []Applier{tappedApplier{}})
	command := protocol.CommandEnvelopeV2{
		GameID:         "game-1",
		BaseVersion:   1,
		ClientActionID: "a1",
		Type:           "card.tapped",
		Payload:        map[string]any{"instanceId": "i1"},
	}

	result := actor.ApplyDirect(context.Background(), command, "p1")
	if result.Err != nil {
		t.Fatalf("apply failed: %v", result.Err)
	}
	if result.Event.Version != 2 {
		t.Fatalf("expected version 2, got %d", result.Event.Version)
	}
	if len(result.Patches) != 1 {
		t.Fatalf("expected one patch envelope, got %d", len(result.Patches))
	}

	duplicate := actor.ApplyDirect(context.Background(), command, "p1")
	if duplicate.Err != nil {
		t.Fatalf("duplicate should return cached result: %v", duplicate.Err)
	}
	if duplicate.Event.Version != result.Event.Version {
		t.Fatalf("duplicate changed version: got %d want %d", duplicate.Event.Version, result.Event.Version)
	}
}
