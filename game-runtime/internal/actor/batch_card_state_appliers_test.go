package actor

import (
	"context"
	"encoding/json"
	"testing"

	"commanderzone/game-runtime/internal/protocol"
)

func TestCardsTappedSetIsAtomicReplayableAndViewerSpecific(t *testing.T) {
	initial := testStateWithTwoBattlefieldCards()
	hidden := initial.Instances["i2"]
	hidden.FaceDown = true
	initial.Instances["i2"] = hidden
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
	cmd := command("game-1", 1, "tap-batch", "cards.tapped.set", map[string]any{
		"playerId": "p1", "instanceIds": []string{"i1", "i2"}, "tapped": true,
	})

	result := gameActor.ApplyDirect(context.Background(), cmd, "p1")
	if result.Err != nil {
		t.Fatalf("batch tap failed: %v", result.Err)
	}
	if result.Event.Version != 2 || result.Event.Type != "cards.tapped.set" || result.Event.Payload["count"] != 2 {
		t.Fatalf("unexpected event: %#v", result.Event)
	}
	for _, instanceID := range []string{"i1", "i2"} {
		instance := gameActor.Snapshot().Instances[instanceID]
		if !instance.Tapped || instance.Rotation != 90 {
			t.Fatalf("%s not tapped: %#v", instanceID, instance)
		}
	}
	assertViewerPatchReference(t, result.Patches, "player:p1", "i2", true)
	assertViewerPatchReference(t, result.Patches, "player:p2", "i2", false)

	replayed, err := ReplayEvents(initial.Clone(), []protocol.EventPayloadV2{result.Event}, DefaultAppliers())
	if err != nil {
		t.Fatalf("batch tap replay failed: %v", err)
	}
	if !replayed.Instances["i1"].Tapped || !replayed.Instances["i2"].Tapped || replayed.Version != 2 {
		t.Fatalf("batch tap replay mismatch: %#v", replayed.Instances)
	}

	retry := gameActor.ApplyDirect(context.Background(), cmd, "p1")
	if retry.Err != nil || retry.Event.Version != 2 || gameActor.Snapshot().Version != 2 {
		t.Fatalf("idempotent retry changed state: result=%#v version=%d", retry, gameActor.Snapshot().Version)
	}
}

func TestCardsFaceDownSetIsAtomicPrivateAndReplayable(t *testing.T) {
	initial := testStateWithTwoBattlefieldCards()
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
	cmd := command("game-1", 1, "hide-batch", "cards.face_down.set", map[string]any{
		"playerId": "p1", "instanceIds": []string{"i1", "i2"}, "faceDown": true,
	})
	result := gameActor.ApplyDirect(context.Background(), cmd, "p1")
	if result.Err != nil {
		t.Fatalf("batch face-down failed: %v", result.Err)
	}
	if result.Event.Version != 2 || result.Event.Payload["count"] != 2 {
		t.Fatalf("unexpected event: %#v", result.Event)
	}
	for _, instanceID := range []string{"i1", "i2"} {
		if !gameActor.Snapshot().Instances[instanceID].FaceDown {
			t.Fatalf("%s remained face up", instanceID)
		}
		assertViewerPatchReference(t, result.Patches, "player:p1", instanceID, true)
	}
	publicPatches := patchesForVisibility(result.Patches, protocol.VisibilityPublic)
	unauthorized, _ := json.Marshal(publicPatches)
	for _, privateValue := range []string{"card-a@1", "card-b@1"} {
		if contains(string(unauthorized), privateValue) {
			t.Fatalf("unauthorized face-down patch leaked %q: %s", privateValue, unauthorized)
		}
	}
	for _, envelope := range publicPatches {
		for _, op := range envelope.Ops {
			if op.Op != "private.cards.conceal" {
				continue
			}
			entries, _ := op.Data["entries"].([]map[string]any)
			for _, entry := range entries {
				if _, leaked := entry["instanceId"]; leaked {
					t.Fatalf("unauthorized concealment carried canonical id: %#v", entry)
				}
			}
		}
	}
	if !contains(string(unauthorized), "p1-hidden-battlefield-0") || !contains(string(unauthorized), "p1-hidden-battlefield-1") {
		t.Fatalf("unauthorized face-down patch missing opaque placeholders: %s", unauthorized)
	}
	logEntries, _ := result.Event.Payload["eventLogEntries"].([]map[string]any)
	encodedLog, _ := json.Marshal(logEntries)
	if len(logEntries) != 1 || !contains(string(encodedLog), `"count":2`) || contains(string(encodedLog), `"i1"`) || contains(string(encodedLog), `"i2"`) {
		t.Fatalf("batch face-down log is not one safe aggregate: %s", encodedLog)
	}

	replayed, err := ReplayEvents(initial.Clone(), []protocol.EventPayloadV2{result.Event}, DefaultAppliers())
	if err != nil {
		t.Fatalf("batch face-down replay failed: %v", err)
	}
	if !replayed.Instances["i1"].FaceDown || !replayed.Instances["i2"].FaceDown {
		t.Fatalf("batch face-down replay mismatch: %#v", replayed.Instances)
	}
	retry := gameActor.ApplyDirect(context.Background(), cmd, "p1")
	if retry.Err != nil || retry.Event.Version != 2 || gameActor.Snapshot().Version != 2 {
		t.Fatalf("idempotent face-down retry changed state: result=%#v version=%d", retry, gameActor.Snapshot().Version)
	}

	tap := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "tap-hidden", "cards.tapped.set", map[string]any{
		"playerId": "p1", "instanceIds": []string{"i1", "i2"}, "tapped": true,
	}), "p1")
	if tap.Err != nil {
		t.Fatalf("hidden batch tap failed: %v", tap.Err)
	}
	encoded, _ := json.Marshal(patchesForVisibility(tap.Patches, "player:p2"))
	for _, privateID := range []string{"i1", "i2", "card-a@1", "card-b@1"} {
		if contains(string(encoded), privateID) {
			t.Fatalf("unauthorized tap patch leaked %q: %s", privateID, encoded)
		}
	}
}

func TestBatchCardStateRejectsDuplicateAndMixedAuthorityWithoutMutation(t *testing.T) {
	initial := relationActorState()
	for _, test := range []struct {
		name string
		ids  []string
		code string
	}{
		{name: "duplicate", ids: []string{"i1", "i1"}, code: AuthorizationCodeDuplicateInstance},
		{name: "mixed authority", ids: []string{"i1", "o1"}, code: AuthorizationCodeMixedAuthorityBatch},
	} {
		t.Run(test.name, func(t *testing.T) {
			gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
			result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "reject-"+test.name, "cards.tapped.set", map[string]any{
				"playerId": "p1", "instanceIds": test.ids, "tapped": true,
			}), "p1")
			auth, ok := AsAuthorizationError(result.Err)
			if !ok || auth.Code != test.code {
				t.Fatalf("error = %#v, want %s", result.Err, test.code)
			}
			if gameActor.Snapshot().Version != 1 || gameActor.Snapshot().Instances["i1"].Tapped || len(result.Patches) != 0 {
				t.Fatalf("rejected batch mutated state: %#v", result)
			}
		})
	}
}

func assertViewerPatchReference(t *testing.T, patches []protocol.PatchEnvelopeV2, visibility protocol.Visibility, canonicalID string, expectCanonical bool) {
	t.Helper()
	found := false
	for _, envelope := range patchesForVisibility(patches, visibility) {
		for _, op := range envelope.Ops {
			if op.Op != "card.field.set" {
				continue
			}
			instanceID, _ := op.Data["instanceId"].(string)
			if expectCanonical && instanceID == canonicalID {
				found = true
			}
			if !expectCanonical && instanceID != "" && instanceID != canonicalID {
				found = true
			}
			if !expectCanonical && instanceID == canonicalID {
				t.Fatalf("unauthorized viewer received canonical id %s: %#v", canonicalID, envelope)
			}
		}
	}
	if !found {
		t.Fatalf("missing projected %s reference for %s", visibility, canonicalID)
	}
}
