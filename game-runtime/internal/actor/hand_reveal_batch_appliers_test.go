package actor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"

	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

func TestHandRevealBatchIsAtomicOrderedAndCumulative(t *testing.T) {
	initial := threePlayerHandRevealState()
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 16, DefaultAppliers())

	revealB := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "batch-b", "hand.cards.reveal", map[string]any{
		"playerId": "p1", "expectedZone": "hand", "orderedInstanceIds": []any{"h2", "h1"}, "to": "p2",
	}), "p1")
	if revealB.Err != nil {
		t.Fatalf("reveal to B failed: %v", revealB.Err)
	}
	if revealB.Event.Version != 2 || revealB.Event.Payload["count"] != 2 || !reflect.DeepEqual(revealB.Event.Payload["orderedInstanceIds"], []string{"h2", "h1"}) {
		t.Fatalf("batch event = %#v", revealB.Event)
	}
	if revealB.Event.Payload["zone"] != "hand" {
		t.Fatalf("batch event zone = %#v", revealB.Event.Payload)
	}
	firstEffect := revealB.Event.Payload["effects"].([]map[string]any)[0]
	if firstEffect["previousAudience"].(map[string]any)["scope"] != "hidden" || !reflect.DeepEqual(firstEffect["materializedViewerIds"], []string{"p2"}) {
		t.Fatalf("batch final effect = %#v", firstEffect)
	}
	activeState := gameActor.Snapshot().Visibility.HandRevealStates["h2"]
	if !activeState.Active || activeState.RevealedAtVersion != 2 || activeState.LastChangedVersion != 2 || activeState.SourceCommand != "hand.cards.reveal" {
		t.Fatalf("authoritative active reveal state = %#v", activeState)
	}
	materialize := patchForVisibility(revealB.Patches, protocol.PlayerVisibility("p2"), "private.cards.materialize")
	if materialize == nil {
		t.Fatalf("target batch materialization missing: %#v", revealB.Patches)
	}
	entries := materialize.Data["entries"].([]map[string]any)
	if got := []string{entries[0]["card"].(map[string]any)["instanceId"].(string), entries[1]["card"].(map[string]any)["instanceId"].(string)}; !reflect.DeepEqual(got, []string{"h2", "h1"}) {
		t.Fatalf("materialization order = %#v", got)
	}
	if got := gameActor.Snapshot().Visibility.InstanceMasks; got["h1"] != 2 || got["h2"] != 2 {
		t.Fatalf("first audience masks = %#v", got)
	}
	assertPublicHandLogSafe(t, revealB.Patches, "h1", "h2", "hand-1@1", "hand-2@1")

	revealC := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "batch-c", "hand.cards.reveal", map[string]any{
		"playerId": "p1", "expectedZone": "hand", "orderedInstanceIds": []any{"h2", "h1"}, "to": []any{"p3"},
	}), "p1")
	if revealC.Err != nil {
		t.Fatalf("cumulative reveal failed: %v", revealC.Err)
	}
	if got := gameActor.Snapshot().Visibility.InstanceMasks; got["h1"] != 6 || got["h2"] != 6 {
		t.Fatalf("cumulative masks = %#v", got)
	}
	if patchForVisibility(revealC.Patches, protocol.PlayerVisibility("p3"), "private.cards.materialize") == nil {
		t.Fatalf("only C should be materialized: %#v", revealC.Patches)
	}
	if patchForVisibility(revealC.Patches, protocol.PlayerVisibility("p3"), "card.field.set") != nil {
		t.Fatalf("newly authorized C received a real-id field update before materialization: %#v", revealC.Patches)
	}
	retainedMetadata := patchForVisibility(revealC.Patches, protocol.PlayerVisibility("p2"), "card.field.set")
	if retainedMetadata == nil || !reflect.DeepEqual(retainedMetadata.Data["revealedTo"], []string{"p2", "p3"}) {
		t.Fatalf("retained B metadata = %#v, want final cumulative audience", retainedMetadata)
	}
	materializedForC := patchForVisibility(revealC.Patches, protocol.PlayerVisibility("p3"), "private.cards.materialize")
	materializedEntries := materializedForC.Data["entries"].([]map[string]any)
	if !reflect.DeepEqual(materializedEntries[0]["card"].(map[string]any)["revealedTo"], []string{"p2", "p3"}) {
		t.Fatalf("new viewer materialization lost final audience metadata: %#v", materializedEntries[0])
	}

	revokeB := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "revoke-b", "hand.cards.revoke", map[string]any{
		"playerId": "p1", "expectedZone": "hand", "orderedInstanceIds": []any{"h2", "h1"}, "to": "p2",
	}), "p1")
	if revokeB.Err != nil {
		t.Fatalf("partial revoke failed: %v", revokeB.Err)
	}
	if got := gameActor.Snapshot().Visibility.InstanceMasks; got["h1"] != 4 || got["h2"] != 4 {
		t.Fatalf("partial revoke masks = %#v", got)
	}
	if patchForVisibility(revokeB.Patches, protocol.PlayerVisibility("p2"), "private.cards.conceal") == nil {
		t.Fatalf("B conceal missing: %#v", revokeB.Patches)
	}
	if patchForVisibility(revokeB.Patches, protocol.PlayerVisibility("p3"), "card.field.set") == nil {
		t.Fatalf("C retained metadata missing: %#v", revokeB.Patches)
	}

	revokeAll := gameActor.ApplyDirect(context.Background(), command("game-1", 4, "revoke-all", "hand.cards.revoke", map[string]any{
		"playerId": "p1", "expectedZone": "hand", "orderedInstanceIds": []any{"h2", "h1"}, "to": "all",
	}), "p1")
	if revokeAll.Err != nil {
		t.Fatalf("full revoke failed: %v", revokeAll.Err)
	}
	if len(gameActor.Snapshot().Visibility.InstanceMasks) != 0 {
		t.Fatalf("full revoke retained visibility: %#v", gameActor.Snapshot().Visibility.InstanceMasks)
	}
	if patchForVisibility(revokeAll.Patches, protocol.PlayerVisibility("p3"), "private.cards.conceal") == nil {
		t.Fatalf("remaining C conceal missing: %#v", revokeAll.Patches)
	}

	replayed, err := ReplayEvents(initial, []protocol.EventPayloadV2{revealB.Event, revealC.Event, revokeB.Event, revokeAll.Event}, DefaultAppliers())
	if err != nil {
		t.Fatalf("batch replay failed: %v", err)
	}
	if replayed.Version != 5 || len(replayed.Visibility.InstanceMasks) != 0 {
		t.Fatalf("replay parity failed: version=%d masks=%#v", replayed.Version, replayed.Visibility.InstanceMasks)
	}
}

func TestHandRevealBatchRejectsInvalidSelectionWithoutMutation(t *testing.T) {
	tests := []struct {
		name    string
		payload map[string]any
		actorID string
	}{
		{name: "empty", payload: map[string]any{"playerId": "p1", "expectedZone": "hand", "orderedInstanceIds": []any{}, "to": "p2"}, actorID: "p1"},
		{name: "missing audience", payload: map[string]any{"playerId": "p1", "expectedZone": "hand", "orderedInstanceIds": []any{"h1"}}, actorID: "p1"},
		{name: "duplicate", payload: map[string]any{"playerId": "p1", "expectedZone": "hand", "orderedInstanceIds": []any{"h1", "h1"}, "to": "p2"}, actorID: "p1"},
		{name: "stale zone", payload: map[string]any{"playerId": "p1", "expectedZone": "hand", "orderedInstanceIds": []any{"h1", "i1"}, "to": "p2"}, actorID: "p1"},
		{name: "wrong expected zone", payload: map[string]any{"playerId": "p1", "expectedZone": "battlefield", "orderedInstanceIds": []any{"h1", "h2"}, "to": "p2"}, actorID: "p1"},
		{name: "unauthorized", payload: map[string]any{"playerId": "p1", "expectedZone": "hand", "orderedInstanceIds": []any{"h1", "h2"}, "to": "p3"}, actorID: "p2"},
		{name: "unknown target", payload: map[string]any{"playerId": "p1", "expectedZone": "hand", "orderedInstanceIds": []any{"h1", "h2"}, "to": "missing"}, actorID: "p1"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := persistence.NewInMemoryEventStore()
			gameActor := NewGameActor("game-1", threePlayerHandRevealState(), store, 8, DefaultAppliers())
			before := gameActor.Snapshot()
			result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "invalid-"+test.name, "hand.cards.reveal", test.payload), test.actorID)
			if result.Err == nil {
				t.Fatal("invalid batch unexpectedly succeeded")
			}
			after := gameActor.Snapshot()
			if after.Version != before.Version || len(after.Visibility.InstanceMasks) != 0 || len(result.Patches) != 0 || result.Event.Type != "" {
				t.Fatalf("rejected batch mutated state/result: before=%d after=%d masks=%#v result=%#v", before.Version, after.Version, after.Visibility.InstanceMasks, result)
			}
			events, err := store.EventsAfter(context.Background(), "game-1", 0)
			if err != nil || len(events) != 0 {
				t.Fatalf("rejected batch persisted events: %#v err=%v", events, err)
			}
		})
	}
}

func TestHandRevealBatchRetryReturnsSingleDurableEvent(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	gameActor := NewGameActor("game-1", threePlayerHandRevealState(), store, 8, DefaultAppliers())
	cmd := command("game-1", 1, "same-action", "hand.cards.reveal", map[string]any{"playerId": "p1", "expectedZone": "hand", "orderedInstanceIds": []any{"h1", "h2"}, "to": []any{"p2", "p3"}})
	first := gameActor.ApplyDirect(context.Background(), cmd, "p1")
	second := gameActor.ApplyDirect(context.Background(), cmd, "p1")
	if first.Err != nil || second.Err != nil || first.Event.Version != second.Event.Version || gameActor.Version() != 2 {
		t.Fatalf("idempotent retry mismatch: first=%#v second=%#v", first, second)
	}
	events, err := store.EventsAfter(context.Background(), "game-1", 0)
	if err != nil || len(events) != 1 {
		t.Fatalf("durable events = %#v err=%v", events, err)
	}
}

func TestHandRevokeAbsentAudienceIsSafeNoOpEvent(t *testing.T) {
	gameActor := NewGameActor("game-1", threePlayerHandRevealState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "noop-revoke", "hand.cards.revoke", map[string]any{
		"playerId": "p1", "expectedZone": "hand", "orderedInstanceIds": []any{"h1", "h2"}, "to": "p2",
	}), "p1")
	if result.Err != nil || result.Event.Version != 2 || len(gameActor.Snapshot().Visibility.InstanceMasks) != 0 {
		t.Fatalf("safe no-op revoke = %#v masks=%#v", result, gameActor.Snapshot().Visibility.InstanceMasks)
	}
	if patchForVisibility(result.Patches, protocol.PlayerVisibility("p2"), "private.cards.conceal") != nil {
		t.Fatalf("no-op revoke concealed non-materialized cards: %#v", result.Patches)
	}
}

func TestHandRevealBatchPublicBoundaryIncludesAndThenConcealsSpectators(t *testing.T) {
	gameActor := NewGameActor("game-1", threePlayerHandRevealState(), nil, 8, DefaultAppliers())
	partial := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "partial", "hand.cards.reveal", map[string]any{
		"playerId": "p1", "expectedZone": "hand", "orderedInstanceIds": []any{"h1", "h2"}, "to": "p2",
	}), "p1")
	if partial.Err != nil {
		t.Fatal(partial.Err)
	}
	public := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "public", "hand.cards.reveal", map[string]any{
		"playerId": "p1", "expectedZone": "hand", "orderedInstanceIds": []any{"h1", "h2"}, "to": "all",
	}), "p1")
	if public.Err != nil {
		t.Fatal(public.Err)
	}
	if patchForVisibility(public.Patches, protocol.VisibilityPublic, "private.cards.materialize") == nil {
		t.Fatalf("partial-to-public transition did not materialize spectators: %#v", public.Patches)
	}

	partialRevoke := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "public-revoke-p2", "hand.cards.revoke", map[string]any{
		"playerId": "p1", "expectedZone": "hand", "orderedInstanceIds": []any{"h1", "h2"}, "to": "p2",
	}), "p1")
	if partialRevoke.Err != nil {
		t.Fatal(partialRevoke.Err)
	}
	if patchForVisibility(partialRevoke.Patches, protocol.VisibilityPublic, "private.cards.conceal") == nil {
		t.Fatalf("public-to-partial transition did not conceal spectators: %#v", partialRevoke.Patches)
	}
	remainingMask := gameActor.Snapshot().Visibility.ViewerBits["p1"] | gameActor.Snapshot().Visibility.ViewerBits["p3"]
	if patchForVisibility(partialRevoke.Patches, protocol.GroupVisibility(fmt.Sprintf("%d", remainingMask)), "private.cards.materialize") == nil {
		t.Fatalf("remaining authorized viewers were not rematerialized: %#v", partialRevoke.Patches)
	}
	if got := gameActor.Snapshot().Visibility.InstanceMasks; got["h1"] != remainingMask || got["h2"] != remainingMask {
		t.Fatalf("public partial-revoke masks = %#v want=%d", got, remainingMask)
	}
}

func TestHandRevealBatchZoneTransitionInvalidatesAndMakesAStaleBatchAtomic(t *testing.T) {
	gameActor := NewGameActor("game-1", threePlayerHandRevealState(), nil, 8, DefaultAppliers())
	reveal := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "reveal-before-move", "hand.cards.reveal", map[string]any{
		"playerId": "p1", "expectedZone": "hand", "orderedInstanceIds": []any{"h1", "h2"}, "to": "p2",
	}), "p1")
	if reveal.Err != nil {
		t.Fatal(reveal.Err)
	}
	move := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "move-revealed", "card.moved", map[string]any{
		"playerId": "p1", "fromZone": "hand", "toZone": "graveyard", "instanceId": "h1",
	}), "p1")
	if move.Err != nil {
		t.Fatal(move.Err)
	}
	snapshot := gameActor.Snapshot()
	if snapshot.Instances["h1"].VisibleToMask != 0 || snapshot.Visibility.InstanceMasks["h1"] != 0 || snapshot.Visibility.HandRevealStates["h1"].Active {
		t.Fatalf("zone transition retained hand reveal: instance=%#v visibility=%#v", snapshot.Instances["h1"], snapshot.Visibility)
	}
	stale := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "stale-after-move", "hand.cards.reveal", map[string]any{
		"playerId": "p1", "expectedZone": "hand", "orderedInstanceIds": []any{"h1", "h2"}, "to": "p3",
	}), "p1")
	if stale.Err == nil || gameActor.Version() != 3 || gameActor.Snapshot().Visibility.InstanceMasks["h2"] != gameActor.Snapshot().Visibility.ViewerBits["p2"] {
		t.Fatalf("stale mixed-zone batch was not atomic: result=%#v masks=%#v", stale, gameActor.Snapshot().Visibility.InstanceMasks)
	}
	if revealError, ok := AsHandRevealError(stale.Err); !ok || revealError.Code != HandRevealCodeNotInHand {
		t.Fatalf("stale mixed-zone batch returned unsafe error: %#v", stale.Err)
	}
}

func threePlayerHandRevealState() state.GameState {
	game := testState()
	game.Players["p3"] = map[string]any{"life": 40, "counters": map[string]any{}, "commanderDamage": map[string]any{}}
	game.Zones["p2"] = state.PlayerZones{}
	game.Zones["p3"] = state.PlayerZones{}
	game.EnsureVisibility()
	return game
}

func assertPublicHandLogSafe(t *testing.T, patches []protocol.PatchEnvelopeV2, forbidden ...string) {
	t.Helper()
	for _, patch := range patches {
		if patch.Visibility != protocol.VisibilityPublic {
			continue
		}
		encoded, err := json.Marshal(patch)
		if err != nil {
			t.Fatal(err)
		}
		for _, secret := range forbidden {
			if secret != "" && containsBytes(encoded, []byte(secret)) {
				t.Fatalf("public patch leaked %q: %s", secret, string(encoded))
			}
		}
	}
}

func containsBytes(haystack []byte, needle []byte) bool {
	if len(needle) == 0 || len(haystack) < len(needle) {
		return false
	}
	for index := 0; index <= len(haystack)-len(needle); index++ {
		if string(haystack[index:index+len(needle)]) == string(needle) {
			return true
		}
	}
	return false
}

func TestHandRevealErrorIsStableAndSafe(t *testing.T) {
	err := &HandRevealError{Code: HandRevealCodeNotInHand, CommandType: "hand.cards.reveal", Count: 2, Index: 1}
	resolved, ok := AsHandRevealError(err)
	if !ok || resolved.Code != HandRevealCodeNotInHand || !errors.Is(err, err) {
		t.Fatalf("stable error = %#v ok=%v", resolved, ok)
	}
}
