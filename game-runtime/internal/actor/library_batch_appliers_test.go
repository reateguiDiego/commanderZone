package actor

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
)

func TestLibraryViewCreatesAuthoritativeWindowAndReplacesPriorTab(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	first := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "view-a", "library.view", map[string]any{"playerId": "p1", "count": 3}), "p1")
	if first.Err != nil {
		t.Fatal(first.Err)
	}
	firstID := first.Event.Payload["windowId"].(string)
	if firstID == "" || first.Event.Payload["expectedEpoch"] != int64(0) {
		t.Fatalf("first window payload = %#v", first.Event.Payload)
	}
	if got := first.Patches[0].Ops[0].Data["instanceIds"]; got != nil {
		t.Fatalf("window metadata patch must not duplicate private ids: %#v", first.Patches)
	}

	second := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "view-b", "library.view", map[string]any{"playerId": "p1", "count": 2}), "p1")
	if second.Err != nil {
		t.Fatal(second.Err)
	}
	secondID := second.Event.Payload["windowId"].(string)
	if secondID == firstID {
		t.Fatal("server reused library window id")
	}
	invalidated := patchForVisibility(second.Patches, protocol.PlayerVisibility("p1"), "library.window.invalidated")
	if invalidated == nil || invalidated.Data["windowId"] != firstID || invalidated.Data["reason"] != "replaced" {
		t.Fatalf("replacement invalidation = %#v", invalidated)
	}
	snapshot := gameActor.Snapshot()
	window, ok := snapshot.LibraryWindow("p1")
	if !ok || window.WindowID != secondID || window.Status != "active" || !reflect.DeepEqual(window.InstanceIDs, []string{"l3", "l2"}) {
		t.Fatalf("active window = %#v", window)
	}
	staleTop := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "stale-top", "library.top.play_face_down", map[string]any{
		"playerId": "p1", "windowId": firstID, "count": 1, "expectedEpoch": 0,
	}), "p1")
	windowErr, ok := AsLibraryWindowError(staleTop.Err)
	if !ok || windowErr.Code != LibraryWindowCodeStale || gameActor.Snapshot().Version != 3 {
		t.Fatalf("stale top intent = %#v err=%#v", staleTop, windowErr)
	}
}

func TestLibraryShuffleInvalidatesActionWindowForEveryOwnerTab(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	view := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "view", "library.view", map[string]any{"playerId": "p1", "count": 3}), "p1")
	if view.Err != nil {
		t.Fatal(view.Err)
	}
	windowID := view.Event.Payload["windowId"].(string)
	shuffled := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "shuffle", "library.shuffle", map[string]any{"playerId": "p1"}), "p1")
	if shuffled.Err != nil {
		t.Fatal(shuffled.Err)
	}
	invalidated := patchForVisibility(shuffled.Patches, protocol.PlayerVisibility("p1"), "library.window.invalidated")
	if invalidated == nil || invalidated.Data["windowId"] != windowID || invalidated.Data["reason"] != "shuffle" || invalidated.Data["currentEpoch"] != int64(1) {
		t.Fatalf("shuffle invalidation = %#v", invalidated)
	}
	snapshot := gameActor.Snapshot()
	window, _ := snapshot.LibraryWindow("p1")
	if window.Status != "stale" || len(window.InstanceIDs) != 0 {
		t.Fatalf("stale window retained identity: %#v", window)
	}
	stale := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "stale-after-shuffle", "library.selection.move", map[string]any{
		"playerId": "p1", "windowId": windowID, "expectedEpoch": 0,
		"orderedInstanceIds": []string{"l3"}, "toZone": "hand",
	}), "p1")
	windowErr, ok := AsLibraryWindowError(stale.Err)
	if !ok || windowErr.Code != LibraryWindowCodeStale || gameActor.Snapshot().Version != 3 {
		t.Fatalf("post-shuffle stale result=%#v err=%#v", stale, windowErr)
	}
}

func TestLibraryWindowClosesWhenOwnerLeavesActiveLifecycle(t *testing.T) {
	initial := testState()
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
	view := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "view", "library.view", map[string]any{"playerId": "p1", "count": 2}), "p1")
	if view.Err != nil {
		t.Fatal(view.Err)
	}
	windowID := view.Event.Payload["windowId"].(string)
	conceded := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "concede", "game.concede", map[string]any{"playerId": "p1"}), "p1")
	if conceded.Err != nil {
		t.Fatal(conceded.Err)
	}
	invalidated := patchForVisibility(conceded.Patches, protocol.PlayerVisibility("p1"), "library.window.invalidated")
	if invalidated == nil || invalidated.Data["windowId"] != windowID || invalidated.Data["status"] != "closed" || invalidated.Data["reason"] != "player_eliminated" {
		t.Fatalf("lifecycle invalidation = %#v", invalidated)
	}
	snapshot := gameActor.Snapshot()
	window, _ := snapshot.LibraryWindow("p1")
	if window.Status != "closed" || len(window.InstanceIDs) != 0 {
		t.Fatalf("closed lifecycle window = %#v", window)
	}
	replayed, err := ReplayEvents(initial, []protocol.EventPayloadV2{view.Event, conceded.Event}, DefaultAppliers())
	if err != nil {
		t.Fatal(err)
	}
	replayedWindow, _ := replayed.LibraryWindow("p1")
	if replayedWindow.Status != "closed" || len(replayedWindow.InstanceIDs) != 0 {
		t.Fatalf("replayed lifecycle window = %#v", replayedWindow)
	}
}

func TestLibrarySelectedBatchMovesAtomicallyAndReplaysFinalEffects(t *testing.T) {
	initial := testState()
	store := persistence.NewInMemoryEventStore()
	gameActor := NewGameActor("game-1", initial.Clone(), store, 8, DefaultAppliers())
	view := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "view", "library.view", map[string]any{"playerId": "p1", "count": 3}), "p1")
	if view.Err != nil {
		t.Fatal(view.Err)
	}
	windowID := view.Event.Payload["windowId"].(string)
	moveCommand := command("game-1", 2, "move", "library.selection.move", map[string]any{
		"playerId": "p1", "windowId": windowID, "expectedEpoch": 0,
		"orderedInstanceIds": []string{"l3", "l1"}, "toZone": "hand",
	})
	move := gameActor.ApplyDirect(context.Background(), moveCommand, "p1")
	if move.Err != nil {
		t.Fatal(move.Err)
	}
	if got := gameActor.Snapshot().Zones["p1"]; !reflect.DeepEqual(got.Library, []string{"l2"}) || !reflect.DeepEqual(got.Hand, []string{"h1", "h2", "l3", "l1"}) {
		t.Fatalf("zones after batch = %#v", got)
	}
	if move.Event.Version != 3 || move.Event.Type != "library.selection.move" || move.Event.Payload["effectVersion"] != LibraryBatchEffectVersion {
		t.Fatalf("event = %#v", move.Event)
	}
	entry := requireRuntimeLogEntry(t, move)
	if entry["i18nKey"] != "gameLog.library.selectedToHand" {
		t.Fatalf("semantic log = %#v", entry)
	}
	for _, privateValue := range []string{"l3", "l1", "library-3@1", "library-1@1"} {
		assertPublicLogOmitsPrivateCard(t, entry, privateValue)
	}
	params := requireMap(t, entry["params"])
	if params["count"] != 2 || params["destination"] != "hand" || params["faceDown"] != false {
		t.Fatalf("safe log params = %#v", params)
	}
	consumedSnapshot := gameActor.Snapshot()
	window, _ := consumedSnapshot.LibraryWindow("p1")
	if window.Status != "consumed" || len(window.InstanceIDs) != 0 {
		t.Fatalf("consumed window retained identity: %#v", window)
	}

	replayed, err := ReplayEvents(initial, []protocol.EventPayloadV2{view.Event, move.Event}, DefaultAppliers())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(replayed.Zones, gameActor.Snapshot().Zones) || !reflect.DeepEqual(replayed.Instances, gameActor.Snapshot().Instances) {
		t.Fatalf("replay mismatch\nreplayed=%#v\nlive=%#v", replayed.Zones, gameActor.Snapshot().Zones)
	}
	if events, err := store.EventsAfter(context.Background(), "game-1", 0); err != nil || len(events) != 2 {
		t.Fatalf("events=%d err=%v", len(events), err)
	}
	retry := gameActor.ApplyDirect(context.Background(), moveCommand, "p1")
	if retry.Err != nil || retry.Event.Version != move.Event.Version || gameActor.Snapshot().Version != move.Event.Version {
		t.Fatalf("idempotent selected retry = %#v", retry)
	}
}

func TestLibrarySelectedBatchDestinationAndFaceDownMatrix(t *testing.T) {
	tests := []struct {
		name     string
		toZone   string
		faceDown bool
	}{
		{name: "hand", toZone: "hand"},
		{name: "graveyard", toZone: "graveyard"},
		{name: "exile", toZone: "exile"},
		{name: "battlefield face up", toZone: "battlefield"},
		{name: "battlefield face down", toZone: "battlefield", faceDown: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
			view := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "view", "library.view", map[string]any{"playerId": "p1", "count": 3}), "p1")
			result := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "move", "library.selection.move", map[string]any{
				"playerId": "p1", "windowId": view.Event.Payload["windowId"], "expectedEpoch": 0,
				"orderedInstanceIds": []string{"l3", "l2"}, "toZone": tt.toZone, "faceDown": tt.faceDown,
			}), "p1")
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			entry := requireRuntimeLogEntry(t, result)
			for _, privateValue := range []string{"l3", "l2", "library-3@1", "library-2@1"} {
				assertPublicLogOmitsPrivateCard(t, entry, privateValue)
			}
			snapshot := gameActor.Snapshot()
			for _, instanceID := range []string{"l3", "l2"} {
				location := snapshot.Loc[instanceID]
				if string(location.Zone) != tt.toZone || snapshot.Instances[instanceID].FaceDown != tt.faceDown {
					t.Fatalf("%s effect = loc:%#v card:%#v", instanceID, location, snapshot.Instances[instanceID])
				}
				if tt.toZone == "battlefield" && !validBattlefieldPosition(snapshot.Instances[instanceID].Position) {
					t.Fatalf("%s missing ratio position", instanceID)
				}
			}
		})
	}

	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	view := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "view", "library.view", map[string]any{"playerId": "p1", "count": 2}), "p1")
	before := gameActor.Snapshot()
	invalid := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "invalid-face-down", "library.selection.move", map[string]any{
		"playerId": "p1", "windowId": view.Event.Payload["windowId"], "expectedEpoch": 0,
		"orderedInstanceIds": []string{"l3"}, "toZone": "hand", "faceDown": true,
	}), "p1")
	windowErr, ok := AsLibraryWindowError(invalid.Err)
	if !ok || windowErr.Code != LibraryWindowCodeInvalidFaceDown || invalid.Event.Type != "" || !reflect.DeepEqual(before.Zones, gameActor.Snapshot().Zones) {
		t.Fatalf("invalid face-down batch = %#v err=%#v", invalid, windowErr)
	}
}

func TestLibrarySelectedBatchRejectsStaleDuplicateAndForeignIDsWithoutMutation(t *testing.T) {
	tests := []struct {
		name string
		ids  []string
		code string
	}{
		{name: "duplicate", ids: []string{"l3", "l3"}, code: LibraryWindowCodeDuplicateInstance},
		{name: "foreign", ids: []string{"l3", "h1"}, code: LibraryWindowCodeInstanceMissing},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
			view := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "view", "library.view", map[string]any{"playerId": "p1", "count": 3}), "p1")
			windowID := view.Event.Payload["windowId"].(string)
			before := gameActor.Snapshot()
			result := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "bad", "library.selection.move", map[string]any{
				"playerId": "p1", "windowId": windowID, "expectedEpoch": 0, "orderedInstanceIds": tt.ids, "toZone": "exile",
			}), "p1")
			windowErr, ok := AsLibraryWindowError(result.Err)
			if !ok || windowErr.Code != tt.code || result.Event.Type != "" || len(result.Patches) != 0 {
				t.Fatalf("result = %#v err=%#v", result, windowErr)
			}
			after := gameActor.Snapshot()
			if before.Version != after.Version || !reflect.DeepEqual(before.Zones, after.Zones) {
				t.Fatal("rejected batch mutated state")
			}
		})
	}

	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	first := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "view-a", "library.view", map[string]any{"playerId": "p1", "count": 2}), "p1")
	firstID := first.Event.Payload["windowId"].(string)
	second := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "view-b", "library.view", map[string]any{"playerId": "p1", "count": 2}), "p1")
	if second.Err != nil {
		t.Fatal(second.Err)
	}
	stale := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "stale", "library.selection.move", map[string]any{
		"playerId": "p1", "windowId": firstID, "expectedEpoch": 0, "orderedInstanceIds": []string{"l3"}, "toZone": "graveyard",
	}), "p1")
	windowErr, ok := AsLibraryWindowError(stale.Err)
	if !ok || windowErr.Code != LibraryWindowCodeStale || gameActor.Snapshot().Version != 3 {
		t.Fatalf("stale result=%#v err=%#v", stale, windowErr)
	}
}

func TestLibrarySelectedTopBottomPreservesDocumentedSelectionOrder(t *testing.T) {
	tests := []struct {
		position string
		want     []string
	}{
		{position: "top", want: []string{"l2", "l1", "l3"}},
		{position: "bottom", want: []string{"l3", "l1", "l2"}},
	}
	for _, tt := range tests {
		t.Run(tt.position, func(t *testing.T) {
			gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
			view := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "view", "library.view", map[string]any{"playerId": "p1", "count": 3}), "p1")
			result := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "move", "library.selection.move", map[string]any{
				"playerId": "p1", "windowId": view.Event.Payload["windowId"], "expectedEpoch": 0,
				"orderedInstanceIds": []string{"l3", "l1"}, "toZone": "library", "position": tt.position,
			}), "p1")
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			if got := gameActor.Snapshot().Zones["p1"].Library; !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("internal bottom-to-top order = %v want %v", got, tt.want)
			}
		})
	}
}

func TestLibraryTopFaceDownIsOneIdempotentEventWithOpaquePublicPatches(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	initial := testState()
	initial.Players["p2"]["user"] = map[string]any{"preferences": map[string]any{"cardLanguage": "es"}}
	gameActor := NewGameActor("game-1", initial, store, 8, DefaultAppliers())
	view := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "top-view", "library.view", map[string]any{"playerId": "p1", "count": 3}), "p1")
	if view.Err != nil {
		t.Fatal(view.Err)
	}
	payload := map[string]any{"playerId": "p1", "windowId": view.Event.Payload["windowId"], "count": 2, "expectedEpoch": 0}
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "top-fd", "library.top.play_face_down", payload), "p1")
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	snapshot := gameActor.Snapshot()
	if got := snapshot.Zones["p1"].Battlefield; !reflect.DeepEqual(got, []string{"i1", "l3", "l2"}) {
		t.Fatalf("battlefield = %v", got)
	}
	for _, instanceID := range []string{"l3", "l2"} {
		card := snapshot.Instances[instanceID]
		if !card.FaceDown || !validBattlefieldPosition(card.Position) {
			t.Fatalf("face-down position %s = %#v", instanceID, card)
		}
	}
	publicJSON := patchJSONForVisibility(t, result.Patches, protocol.VisibilityPublic)
	for _, private := range []string{"l3", "l2", "library-3@1", "library-2@1"} {
		if strings.Contains(publicJSON, private) {
			t.Fatalf("public patch leaked %q: %s", private, publicJSON)
		}
	}
	if !strings.Contains(publicJSON, "p1-hidden-battlefield-1") || !strings.Contains(publicJSON, "p1-hidden-battlefield-2") {
		t.Fatalf("public shells missing: %s", publicJSON)
	}
	localizedOpponentJSON := patchJSONForVisibility(t, result.Patches, protocol.PlayerVisibility("p2"))
	for _, private := range []string{"l3", "l2", "library-3@1", "library-2@1"} {
		if strings.Contains(localizedOpponentJSON, private) {
			t.Fatalf("localized opponent patch leaked %q: %s", private, localizedOpponentJSON)
		}
	}
	entry := requireRuntimeLogEntry(t, result)
	if entry["i18nKey"] != "gameLog.library.playedTopFaceDown" {
		t.Fatalf("semantic log = %#v", entry)
	}
	for _, privateValue := range []string{"l3", "l2", "library-3@1", "library-2@1"} {
		assertPublicLogOmitsPrivateCard(t, entry, privateValue)
	}
	duplicate := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "top-fd", "library.top.play_face_down", payload), "p1")
	if duplicate.Err != nil || duplicate.Event.Version != result.Event.Version || gameActor.Snapshot().Version != 3 {
		t.Fatalf("idempotent retry = %#v", duplicate)
	}
	if events, err := store.EventsAfter(context.Background(), "game-1", 0); err != nil || len(events) != 2 {
		t.Fatalf("events=%d err=%v", len(events), err)
	}
}

func patchJSONForVisibility(t *testing.T, patches []protocol.PatchEnvelopeV2, visibility protocol.Visibility) string {
	t.Helper()
	parts := []string{}
	for _, patch := range patches {
		if patch.Visibility == visibility {
			bytes, err := json.Marshal(patch.Ops)
			if err != nil {
				t.Fatal(err)
			}
			parts = append(parts, string(bytes))
		}
	}
	return strings.Join(parts, "\n")
}
