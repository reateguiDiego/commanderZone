package actor

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"commanderzone/game-runtime/internal/protocol"
)

func TestPublicRevealUsesCanonicalAudienceAcrossPatchEventAndState(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "reveal-all", "card.revealed", map[string]any{
		"instanceId": "h1",
		"to":         "all",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("reveal all failed: %v", result.Err)
	}
	patch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "private.cards.materialize")
	if patch == nil {
		t.Fatalf("public patch audience = %#v", result.Patches)
	}
	entries := patch.Data["entries"].([]map[string]any)
	if len(entries) != 1 || !reflect.DeepEqual(entries[0]["card"].(map[string]any)["revealedTo"], []string{"all"}) {
		t.Fatalf("public materialization audience = %#v", entries)
	}
	audience, ok := result.Event.Payload["audience"].(map[string]any)
	if !ok || audience["scope"] != audienceScopePublic {
		t.Fatalf("event audience = %#v", result.Event.Payload["audience"])
	}
	if result.Event.Payload["visibleToMask"] != uint64(3) || !reflect.DeepEqual(result.Event.Payload["viewers"], []string{"all"}) {
		t.Fatalf("event compatibility audience = %#v", result.Event.Payload)
	}
	if got := gameActor.Snapshot().Visibility.InstanceMasks["h1"]; got != 3 {
		t.Fatalf("state mask = %d, want 3", got)
	}
}

func TestVisibilityAudienceRejectsClientOwnedAndUnknownTargets(t *testing.T) {
	tests := []struct {
		name    string
		payload map[string]any
	}{
		{name: "mask", payload: map[string]any{"instanceId": "h1", "visibleToMask": 1}},
		{name: "viewers", payload: map[string]any{"instanceId": "h1", "viewers": []any{"p1"}}},
		{name: "audience", payload: map[string]any{"instanceId": "h1", "audience": map[string]any{"scope": "public"}}},
		{name: "unknown player", payload: map[string]any{"instanceId": "h1", "to": "invented-player"}},
		{name: "mixed all", payload: map[string]any{"instanceId": "h1", "to": []any{"all", "p1"}}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
			result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "invalid-"+test.name, "card.revealed", test.payload), "p1")
			if !errors.Is(result.Err, ErrInvalidPayloadField) {
				t.Fatalf("error = %v, want invalid payload", result.Err)
			}
			if gameActor.Snapshot().Version != 1 {
				t.Fatalf("invalid audience advanced state")
			}
		})
	}
}
