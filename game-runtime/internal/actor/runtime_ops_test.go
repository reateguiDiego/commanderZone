package actor

import (
	"context"
	"fmt"
	"testing"

	"commanderzone/game-runtime/internal/state"
)

func TestLibraryDrawEmitsPrivateCardKeyAndPublicCounts(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "draw-1", "library.draw", map[string]any{"playerId": "p1"}), "p1")
	if result.Err != nil {
		t.Fatalf("draw failed: %v", result.Err)
	}
	var privateCards int
	var publicCounts int
	for _, envelope := range result.Patches {
		for _, op := range envelope.Ops {
			if op.Op == "zone.cards.add" {
				if envelope.Visibility != "player:p1" {
					t.Fatalf("card payload leaked outside owner visibility: %s", envelope.Visibility)
				}
				cards := op.Data["cards"].([]map[string]any)
				if cards[0]["cardKey"] == nil {
					t.Fatal("owner did not receive cardKey")
				}
				privateCards++
			}
			if op.Op == "zone.count.set" {
				if _, leaked := op.Data["cardKey"]; leaked {
					t.Fatal("count patch leaked cardKey")
				}
				publicCounts++
			}
		}
	}
	if privateCards != 1 || publicCounts != 2 {
		t.Fatalf("patch counts private=%d public=%d", privateCards, publicCounts)
	}
}

func TestRevealTopEmitsGroupPatchWithCardKey(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "reveal", "library.reveal_top", map[string]any{"playerId": "p1", "count": 2, "visibleToMask": 3}), "p1")
	if result.Err != nil {
		t.Fatalf("reveal failed: %v", result.Err)
	}
	found := false
	for _, envelope := range result.Patches {
		if envelope.Visibility != "group:3" {
			continue
		}
		found = true
		cards := envelope.Ops[0].Data["cards"].([]map[string]any)
		if len(cards) != 2 || cards[0]["cardKey"] == nil {
			t.Fatalf("bad reveal cards: %#v", cards)
		}
	}
	if !found {
		t.Fatal("missing group reveal patch")
	}
}

func TestFaceDownPatchDoesNotExposeCardKey(t *testing.T) {
	game := testState()
	instance := game.Instances["i1"]
	instance.FaceDown = true
	game.Instances["i1"] = instance
	data := cardPatchData(&game, "p2", "i1")
	if _, leaked := data["cardKey"]; leaked {
		t.Fatal("faceDown patch leaked cardKey")
	}
	if data["hidden"] != true {
		t.Fatalf("faceDown patch should be hidden: %#v", data)
	}
}

func TestCardsMovedBatchUsesLocAndUpdatesZones(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move", "cards.moved", map[string]any{
		"playerId":    "p1",
		"fromZone":    "hand",
		"toZone":      "graveyard",
		"instanceIds": []string{"h1", "h2"},
	}), "p1")
	if result.Err != nil {
		t.Fatalf("move failed: %v", result.Err)
	}
	snapshot := gameActor.Snapshot()
	if len(snapshot.Zones["p1"].Hand) != 0 {
		t.Fatalf("hand not emptied: %#v", snapshot.Zones["p1"].Hand)
	}
	if got, want := len(snapshot.Zones["p1"].Graveyard), 2; got != want {
		t.Fatalf("graveyard got %d want %d", got, want)
	}
	if snapshot.Loc["h1"].Zone != state.ZoneGraveyard || snapshot.Loc["h2"].Index != 1 {
		t.Fatalf("loc not updated: %#v %#v", snapshot.Loc["h1"], snapshot.Loc["h2"])
	}
}

func TestZoneReorderedByIdsRejectsForeignOrDuplicateIDs(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "bad-reorder", "zone.reorderedByIds", map[string]any{
		"playerId":    "p1",
		"zone":        "hand",
		"instanceIds": []string{"h1", "h1"},
	}), "p1")
	if result.Err == nil {
		t.Fatal("expected invalid reorder to fail")
	}
}

func TestBattlefieldUntapAllPatchesOnlyAffectedCards(t *testing.T) {
	game := testState()
	instance := game.Instances["i1"]
	instance.Tapped = true
	instance.Rotation = 90
	game.Instances["i1"] = instance
	gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "untap", "battlefield.untap_all", map[string]any{"playerId": "p1"}), "p1")
	if result.Err != nil {
		t.Fatalf("untap failed: %v", result.Err)
	}
	ids := result.Patches[0].Ops[0].Data["instanceIds"].([]string)
	if len(ids) != 1 || ids[0] != "i1" {
		t.Fatalf("unexpected untap ids: %#v", ids)
	}
}

func TestLibraryReplayReconstructsDrawAndShuffleOrder(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	draw := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "draw", "library.draw_many", map[string]any{"playerId": "p1", "count": 2}), "p1")
	if draw.Err != nil {
		t.Fatalf("draw failed: %v", draw.Err)
	}
	shuffle := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "shuffle", "library.shuffle", map[string]any{"playerId": "p1"}), "p1")
	if shuffle.Err != nil {
		t.Fatalf("shuffle failed: %v", shuffle.Err)
	}

	replayed := testState()
	if err := ReplayEvent(&replayed, draw.Event); err != nil {
		t.Fatalf("replay draw failed: %v", err)
	}
	if err := ReplayEvent(&replayed, shuffle.Event); err != nil {
		t.Fatalf("replay shuffle failed: %v", err)
	}
	if got, want := len(replayed.Zones["p1"].Hand), len(gameActor.Snapshot().Zones["p1"].Hand); got != want {
		t.Fatalf("hand count got %d want %d", got, want)
	}
	if got, want := len(replayed.Zones["p1"].Library), len(gameActor.Snapshot().Zones["p1"].Library); got != want {
		t.Fatalf("library count got %d want %d", got, want)
	}
	if !equalStrings(replayed.Zones["p1"].Library, gameActor.Snapshot().Zones["p1"].Library) {
		t.Fatalf("library order mismatch replayed=%#v current=%#v", replayed.Zones["p1"].Library, gameActor.Snapshot().Zones["p1"].Library)
	}
}

func TestCardsMovedBatchDoesNotTouchLargeLibraryOrder(t *testing.T) {
	game := benchmarkState(100)
	before := append([]string(nil), game.Zones["p1"].Library...)
	gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move", "cards.moved", map[string]any{
		"playerId":    "p1",
		"fromZone":    "hand",
		"toZone":      "graveyard",
		"instanceIds": []string{"h000", "h001", "h002"},
	}), "p1")
	if result.Err != nil {
		t.Fatalf("move failed: %v", result.Err)
	}
	after := gameActor.Snapshot().Zones["p1"].Library
	for index := range before {
		if before[index] != after[index] {
			t.Fatalf("library order changed at %d", index)
		}
	}
}

func BenchmarkLibraryDrawOne(b *testing.B) {
	for i := 0; i < b.N; i++ {
		game := benchmarkState(100)
		gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
		result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "draw", "library.draw", map[string]any{"playerId": "p1"}), "p1")
		if result.Err != nil {
			b.Fatal(result.Err)
		}
	}
}

func BenchmarkLibraryShuffle(b *testing.B) {
	for i := 0; i < b.N; i++ {
		game := benchmarkState(100)
		gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
		result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "shuffle", "library.shuffle", map[string]any{"playerId": "p1"}), "p1")
		if result.Err != nil {
			b.Fatal(result.Err)
		}
	}
}

func BenchmarkCardsMovedTen(b *testing.B) {
	for i := 0; i < b.N; i++ {
		game := benchmarkState(100)
		gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
		result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move", "cards.moved", map[string]any{
			"playerId":    "p1",
			"fromZone":    "hand",
			"toZone":      "graveyard",
			"instanceIds": []string{"h000", "h001", "h002", "h003", "h004", "h005", "h006", "h007", "h008", "h009"},
		}), "p1")
		if result.Err != nil {
			b.Fatal(result.Err)
		}
	}
}

func benchmarkState(size int) state.GameState {
	game := testState()
	game.Instances = map[string]state.CardInstanceRuntime{"i1": game.Instances["i1"]}
	game.Zones["p1"] = state.PlayerZones{Battlefield: []string{"i1"}}
	game.Loc = map[string]state.Location{"i1": game.Loc["i1"]}
	for index := 0; index < size; index++ {
		libraryID := fmt.Sprintf("l%03d", index)
		handID := fmt.Sprintf("h%03d", index)
		game.Instances[libraryID] = state.CardInstanceRuntime{InstanceID: libraryID, CardKey: libraryID + "@1", OwnerID: "p1", ControllerID: "p1", Zone: state.ZoneLibrary}
		game.Instances[handID] = state.CardInstanceRuntime{InstanceID: handID, CardKey: handID + "@1", OwnerID: "p1", ControllerID: "p1", Zone: state.ZoneHand}
		zones := game.Zones["p1"]
		zones.Library = append(zones.Library, libraryID)
		zones.Hand = append(zones.Hand, handID)
		game.Zones["p1"] = zones
		game.Loc[libraryID] = state.Location{PlayerID: "p1", Zone: state.ZoneLibrary, Index: index, ControllerID: "p1"}
		game.Loc[handID] = state.Location{PlayerID: "p1", Zone: state.ZoneHand, Index: index, ControllerID: "p1"}
	}
	return game
}

func equalStrings(a []string, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for index := range a {
		if a[index] != b[index] {
			return false
		}
	}
	return true
}
