package actor

import (
	"context"
	"fmt"
	"reflect"
	"testing"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

func TestAuthoritativeAttachmentAndBattlefieldStackLifecycle(t *testing.T) {
	initial := relationActorState()
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 32, DefaultAppliers())
	events := make([]protocol.EventPayloadV2, 0, 10)
	apply := func(actionID string, commandType string, payload map[string]any) CommandResult {
		t.Helper()
		result := gameActor.ApplyDirect(context.Background(), command("game-1", gameActor.Snapshot().Version, actionID, commandType, payload), "p1")
		if result.Err != nil {
			t.Fatalf("%s failed: %v", commandType, result.Err)
		}
		events = append(events, result.Event)
		return result
	}

	first := apply("attach-1", "attachment.created", map[string]any{
		"equipmentInstanceId": "i2", "attachedToInstanceId": "o1",
	})
	second := apply("attach-2", "attachment.created", map[string]any{
		"equipmentInstanceId": "i3", "attachedToInstanceId": "o1",
	})
	if patchForVisibility(first.Patches, "public", "attachment.set") == nil || patchForVisibility(second.Patches, "public", "attachment.set") == nil {
		t.Fatalf("missing attachment patches: %#v %#v", first.Patches, second.Patches)
	}
	attachmentOne := first.Event.Payload["id"].(string)
	attachmentTwo := second.Event.Payload["id"].(string)
	reordered := apply("attach-order", "attachment.reordered", map[string]any{
		"attachedToInstanceId": "o1", "orderedAttachmentIds": []any{attachmentTwo, attachmentOne},
	})
	if patchForVisibility(reordered.Patches, "public", "attachment.order.set") == nil {
		t.Fatalf("missing attachment order patch: %#v", reordered.Patches)
	}
	removedOne := apply("attach-remove-1", "attachment.removed", map[string]any{
		"id": attachmentOne, "position": map[string]any{"x": 0.25, "y": 0.35, "unit": "ratio"},
	})
	apply("attach-remove-2", "attachment.removed", map[string]any{
		"id": attachmentTwo, "position": map[string]any{"x": 0.3, "y": 0.4, "unit": "ratio"},
	})
	if patchForVisibility(removedOne.Patches, "public", "attachment.remove") == nil || patchForVisibility(removedOne.Patches, "public", "card.position.set") == nil {
		t.Fatalf("attachment detach is not atomic in patches: %#v", removedOne.Patches)
	}

	created := apply("stack-create", "battlefield.stack.created", map[string]any{
		"rootInstanceId": "i1", "orderedInstanceIds": []any{"i1", "i2", "i3"}, "stackKind": "land",
	})
	stackID := created.Event.Payload["stackId"].(string)
	if patchForVisibility(created.Patches, "public", "battlefield.stack.set") == nil {
		t.Fatalf("missing stack set patch: %#v", created.Patches)
	}
	apply("stack-add", "battlefield.stack.member_added", map[string]any{
		"stackId": stackID, "instanceId": "i4", "index": 3,
	})
	apply("stack-order", "battlefield.stack.reordered", map[string]any{
		"stackId": stackID, "rootInstanceId": "i3", "orderedInstanceIds": []any{"i3", "i1", "i2", "i4"},
	})
	removedMember := apply("stack-remove", "battlefield.stack.member_removed", map[string]any{
		"stackId": stackID, "instanceId": "i2", "position": map[string]any{"x": 0.61, "y": 0.42, "unit": "ratio"},
	})
	if patchForVisibility(removedMember.Patches, "public", "battlefield.stack.set") == nil || patchForVisibility(removedMember.Patches, "public", "card.position.set") == nil {
		t.Fatalf("member removal did not publish final effects: %#v", removedMember.Patches)
	}
	dissolved := apply("stack-dissolve", "battlefield.stack.dissolved", map[string]any{
		"stackId": stackID,
		"positions": []any{
			map[string]any{"instanceId": "i3", "position": map[string]any{"x": 0.1, "y": 0.2, "unit": "ratio"}},
			map[string]any{"instanceId": "i1", "position": map[string]any{"x": 0.3, "y": 0.2, "unit": "ratio"}},
			map[string]any{"instanceId": "i4", "position": map[string]any{"x": 0.5, "y": 0.2, "unit": "ratio"}},
		},
	})
	if patchForVisibility(dissolved.Patches, "public", "battlefield.stack.remove") == nil || patchForVisibility(dissolved.Patches, "public", "cards.position.set") == nil {
		t.Fatalf("dissolve did not publish graph plus geometry: %#v", dissolved.Patches)
	}
	final := gameActor.Snapshot()
	if len(final.Relations.Attachments) != 0 || len(final.Relations.BattlefieldStacks) != 0 {
		t.Fatalf("relations survived lifecycle: %#v", final.Relations)
	}

	replayed := initial.Clone()
	for _, event := range events {
		if err := ReplayEventWithAppliers(&replayed, event, DefaultAppliers()); err != nil {
			t.Fatalf("replay %s: %v", event.Type, err)
		}
		replayed.Version = event.Version
	}
	if !reflect.DeepEqual(replayed.Relations, final.Relations) {
		t.Fatalf("replay relation mismatch\nreplayed=%#v\nfinal=%#v", replayed.Relations, final.Relations)
	}
	for _, instanceID := range []string{"i1", "i2", "i3", "i4"} {
		if !reflect.DeepEqual(replayed.Instances[instanceID].Position, final.Instances[instanceID].Position) {
			t.Fatalf("replay position %s = %#v, want %#v", instanceID, replayed.Instances[instanceID].Position, final.Instances[instanceID].Position)
		}
	}
}

func TestBattlefieldRelationAuthorizationAndMixedMembershipAreAtomic(t *testing.T) {
	gameActor := NewGameActor("game-1", relationActorState(), nil, 16, DefaultAppliers())

	foreignTarget := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "foreign-target", "attachment.created", map[string]any{
		"equipmentInstanceId": "i2", "attachedToInstanceId": "o1",
	}), "p1")
	if foreignTarget.Err != nil {
		t.Fatalf("controller could not attach to a foreign target: %v", foreignTarget.Err)
	}
	before := gameActor.Snapshot()
	foreignSource := gameActor.ApplyDirect(context.Background(), command("game-1", before.Version, "foreign-source", "attachment.created", map[string]any{
		"equipmentInstanceId": "o1", "attachedToInstanceId": "i1",
	}), "p1")
	if foreignSource.Err == nil || gameActor.Snapshot().Version != before.Version {
		t.Fatalf("foreign source rejection was not atomic: err=%v version=%d", foreignSource.Err, gameActor.Snapshot().Version)
	}
	mixed := gameActor.ApplyDirect(context.Background(), command("game-1", before.Version, "mixed", "battlefield.stack.created", map[string]any{
		"rootInstanceId": "i1", "orderedInstanceIds": []any{"i1", "i2"}, "stackKind": "land",
	}), "p1")
	if mixed.Err == nil || gameActor.Snapshot().Version != before.Version || len(gameActor.Snapshot().Relations.BattlefieldStacks) != 0 {
		t.Fatalf("mixed relation rejection was not atomic: err=%v state=%#v", mixed.Err, gameActor.Snapshot().Relations)
	}
}

func TestFaceDownCounterProjectionPreservesAttachmentAndStackGraphs(t *testing.T) {
	for _, tt := range []struct {
		name       string
		prepare    func(t *testing.T, gameActor *GameActor)
		instanceID string
		index      int
	}{
		{
			name: "attachment source",
			prepare: func(t *testing.T, gameActor *GameActor) {
				result := gameActor.ApplyDirect(context.Background(), command("game-1", gameActor.Snapshot().Version, "attach-before-counter", "attachment.created", map[string]any{
					"equipmentInstanceId": "i2", "attachedToInstanceId": "i1",
				}), "p1")
				if result.Err != nil {
					t.Fatalf("attachment setup failed: %v", result.Err)
				}
			},
			instanceID: "i2",
			index:      1,
		},
		{
			name: "stack root",
			prepare: func(t *testing.T, gameActor *GameActor) {
				result := gameActor.ApplyDirect(context.Background(), command("game-1", gameActor.Snapshot().Version, "stack-before-counter", "battlefield.stack.created", map[string]any{
					"rootInstanceId": "i1", "orderedInstanceIds": []any{"i1", "i2", "i3", "i4"}, "stackKind": "land",
				}), "p1")
				if result.Err != nil {
					t.Fatalf("stack setup failed: %v", result.Err)
				}
			},
			instanceID: "i1",
			index:      0,
		},
		{
			name: "stack member",
			prepare: func(t *testing.T, gameActor *GameActor) {
				result := gameActor.ApplyDirect(context.Background(), command("game-1", gameActor.Snapshot().Version, "stack-member-before-counter", "battlefield.stack.created", map[string]any{
					"rootInstanceId": "i1", "orderedInstanceIds": []any{"i1", "i2", "i3", "i4"}, "stackKind": "land",
				}), "p1")
				if result.Err != nil {
					t.Fatalf("stack setup failed: %v", result.Err)
				}
			},
			instanceID: "i3",
			index:      2,
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			initial := relationActorState()
			initial.Players["p3"] = map[string]any{"life": 40, "counters": map[string]any{}, "commanderDamage": map[string]any{}}
			initial.Zones["p3"] = state.PlayerZones{}
			initial.EnsureVisibility()
			gameActor := NewGameActor("game-1", initial, nil, 16, DefaultAppliers())
			tt.prepare(t, gameActor)

			faceDown := gameActor.ApplyDirect(context.Background(), command("game-1", gameActor.Snapshot().Version, "hide-"+tt.instanceID, "card.face_down.changed", map[string]any{
				"instanceId": tt.instanceID, "faceDown": true,
			}), "p1")
			if faceDown.Err != nil {
				t.Fatalf("face down failed: %v", faceDown.Err)
			}
			beforeRelations := gameActor.Snapshot().Relations.Clone()
			counter := gameActor.ApplyDirect(context.Background(), command("game-1", gameActor.Snapshot().Version, "counter-"+tt.instanceID, "card.counter.changed", map[string]any{
				"instanceId": tt.instanceID, "counter": "shield", "value": 2,
			}), "p1")
			if counter.Err != nil {
				t.Fatalf("counter failed: %v", counter.Err)
			}
			if !reflect.DeepEqual(beforeRelations, gameActor.Snapshot().Relations) {
				t.Fatalf("counter changed relation graph\nbefore=%#v\nafter=%#v", beforeRelations, gameActor.Snapshot().Relations)
			}
			owner := patchForVisibility(counter.Patches, protocol.PlayerVisibility("p1"), "card.counters.patch")
			if owner == nil || owner.Data["instanceId"] != tt.instanceID {
				t.Fatalf("owner counter projection = %#v", counter.Patches)
			}
			for _, viewerID := range []string{"p2", "p3"} {
				op := patchForVisibility(counter.Patches, protocol.PlayerVisibility(viewerID), "card.counters.patch")
				wantID := fmt.Sprintf("p1-hidden-battlefield-%d", tt.index)
				if op == nil || op.Data["instanceId"] != wantID {
					t.Fatalf("viewer %s counter projection got %#v want %s", viewerID, op, wantID)
				}
			}
		})
	}
}

func TestBattlefieldStackZoneExitNormalizesThenDissolves(t *testing.T) {
	gameActor := NewGameActor("game-1", relationActorState(), nil, 16, DefaultAppliers())
	created := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "zone-stack", "battlefield.stack.created", map[string]any{
		"rootInstanceId": "i1", "orderedInstanceIds": []any{"i1", "i2", "i3"}, "stackKind": "land",
	}), "p1")
	if created.Err != nil {
		t.Fatal(created.Err)
	}
	stackID := created.Event.Payload["stackId"].(string)
	rootExit := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "root-exit", "card.moved", map[string]any{
		"playerId": "p1", "fromZone": "battlefield", "toZone": "graveyard", "instanceId": "i1",
	}), "p1")
	if rootExit.Err != nil {
		t.Fatal(rootExit.Err)
	}
	stack := gameActor.Snapshot().Relations.BattlefieldStacks[stackID]
	if stack.RootInstanceID != "i2" || !reflect.DeepEqual(stack.OrderedMemberIDs, []string{"i2", "i3"}) {
		t.Fatalf("root exit did not normalize stack: %#v", stack)
	}
	if patchForVisibility(rootExit.Patches, "public", "battlefield.stack.set") == nil {
		t.Fatalf("root exit did not emit stack set: %#v", rootExit.Patches)
	}
	changes, ok := rootExit.Event.Payload["relationChanges"].([]map[string]any)
	if !ok || len(changes) != 1 || changes[0]["kind"] != "battlefield_stack_set" {
		t.Fatalf("root exit event lacks final relation effect: %#v", rootExit.Event.Payload)
	}
	memberExit := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "member-exit", "card.moved", map[string]any{
		"playerId": "p1", "fromZone": "battlefield", "toZone": "graveyard", "instanceId": "i2",
	}), "p1")
	if memberExit.Err != nil {
		t.Fatal(memberExit.Err)
	}
	if len(gameActor.Snapshot().Relations.BattlefieldStacks) != 0 || patchForVisibility(memberExit.Patches, "public", "battlefield.stack.remove") == nil {
		t.Fatalf("two-member exit did not dissolve stack: state=%#v patches=%#v", gameActor.Snapshot().Relations, memberExit.Patches)
	}
}

func relationActorState() state.GameState {
	game := testStateWithTwoBattlefieldCards()
	for _, instanceID := range []string{"i3", "i4"} {
		index := len(game.Zones["p1"].Battlefield)
		game.Instances[instanceID] = state.CardInstanceRuntime{
			InstanceID: instanceID, CardKey: instanceID + "@1", OwnerID: "p1", ControllerID: "p1", Zone: state.ZoneBattlefield,
			Position: map[string]any{"x": 0.1 * float64(index+1), "y": 0.2, "unit": "ratio"}, Counters: map[string]int{},
		}
		zones := game.Zones["p1"]
		zones.Battlefield = append(zones.Battlefield, instanceID)
		game.Zones["p1"] = zones
		game.Loc[instanceID] = state.Location{PlayerID: "p1", Zone: state.ZoneBattlefield, Index: index, ControllerID: "p1"}
	}
	game.Instances["o1"] = state.CardInstanceRuntime{
		InstanceID: "o1", CardKey: "opponent@1", OwnerID: "p2", ControllerID: "p2", Zone: state.ZoneBattlefield,
		Position: map[string]any{"x": 0.5, "y": 0.5, "unit": "ratio"}, Counters: map[string]int{}, FaceDown: true,
	}
	game.Zones["p2"] = state.PlayerZones{Battlefield: []string{"o1"}}
	game.Loc["o1"] = state.Location{PlayerID: "p2", Zone: state.ZoneBattlefield, Index: 0, ControllerID: "p2"}
	return game
}
