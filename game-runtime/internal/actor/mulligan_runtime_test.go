package actor

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

func TestRuntimeLondonMulliganCompletesWithoutStaticPayload(t *testing.T) {
	initial := mulliganGame("game-m", []string{"p1"}, 100)
	store := persistence.NewInMemoryEventStore()
	gameActor := NewGameActor("game-m", initial, store, 8, DefaultAppliers())

	take := gameActor.ApplyDirect(context.Background(), command("game-m", 1, "take-1", "mulligan.take", map[string]any{"playerId": "p1", "rule": mulliganRuleLondon}), "p1")
	if take.Err != nil {
		t.Fatalf("take failed: %v", take.Err)
	}
	if take.Event.Type != "mulligan.player_took" {
		t.Fatalf("event type got %q", take.Event.Type)
	}
	if got := len(gameActor.Snapshot().Zones["p1"].Hand); got != 7 {
		t.Fatalf("hand after take got %d want 7", got)
	}
	bottomID := gameActor.Snapshot().Zones["p1"].Hand[0]
	keep := gameActor.ApplyDirect(context.Background(), command("game-m", 2, "keep-1", "mulligan.keep", map[string]any{"playerId": "p1", "bottomCardIds": []string{bottomID}}), "p1")
	if keep.Err != nil {
		t.Fatalf("keep failed: %v", keep.Err)
	}
	snapshot := gameActor.Snapshot()
	if snapshot.Phase != state.PhasePlaying {
		t.Fatalf("phase got %q want PLAYING", snapshot.Phase)
	}
	if got := len(snapshot.Zones["p1"].Hand); got != 6 {
		t.Fatalf("hand got %d want 6", got)
	}
	if snapshot.Zones["p1"].Library[0] != bottomID {
		t.Fatalf("bottom card not placed at library bottom")
	}
	assertNoStaticPayload(t, take.Event.Payload)
	assertNoPrivateLeakToPublic(t, take.Patches, bottomID)
}

func TestRuntimeVancouverMulliganScryBottom(t *testing.T) {
	initial := mulliganGame("game-v", []string{"p1"}, 100)
	initial.Mulligan.Rule = mulliganRuleVancouver
	gameActor := NewGameActor("game-v", initial, nil, 8, DefaultAppliers())

	take := gameActor.ApplyDirect(context.Background(), command("game-v", 1, "take-1", "mulligan.take", map[string]any{"playerId": "p1"}), "p1")
	if take.Err != nil {
		t.Fatalf("take failed: %v", take.Err)
	}
	if got := len(gameActor.Snapshot().Zones["p1"].Hand); got != 6 {
		t.Fatalf("Vancouver hand got %d want 6", got)
	}
	beforeKeepTop := gameActor.Snapshot().Zones["p1"].Library[len(gameActor.Snapshot().Zones["p1"].Library)-1]
	keep := gameActor.ApplyDirect(context.Background(), command("game-v", 2, "keep-1", "mulligan.keep", map[string]any{"playerId": "p1"}), "p1")
	if keep.Err != nil {
		t.Fatalf("keep failed: %v", keep.Err)
	}
	if got := gameActor.Snapshot().Mulligan.PlayerStatus["p1"].Status; got != state.MulliganStatusScrying {
		t.Fatalf("status got %q want SCRYING", got)
	}
	scry := gameActor.ApplyDirect(context.Background(), command("game-v", 3, "scry-1", "mulligan.scry.confirm", map[string]any{"playerId": "p1", "choice": "bottom"}), "p1")
	if scry.Err != nil {
		t.Fatalf("scry failed: %v", scry.Err)
	}
	snapshot := gameActor.Snapshot()
	if snapshot.Phase != state.PhasePlaying {
		t.Fatalf("phase got %q want PLAYING", snapshot.Phase)
	}
	if snapshot.Zones["p1"].Library[0] != beforeKeepTop {
		t.Fatalf("scry bottom did not move top to bottom")
	}
}

func TestRuntimeParisAndGenerousRules(t *testing.T) {
	paris := mulliganGame("game-p", []string{"p1"}, 100)
	paris.Mulligan.Rule = mulliganRuleParis
	parisActor := NewGameActor("game-p", paris, nil, 8, DefaultAppliers())
	takeParis := parisActor.ApplyDirect(context.Background(), command("game-p", 1, "take-paris", "mulligan.take", map[string]any{"playerId": "p1"}), "p1")
	if takeParis.Err != nil {
		t.Fatalf("paris take failed: %v", takeParis.Err)
	}
	if got := len(parisActor.Snapshot().Zones["p1"].Hand); got != 6 {
		t.Fatalf("Paris hand got %d want 6", got)
	}

	generous := mulliganGame("game-g", []string{"p1"}, 100)
	generous.Mulligan.Rule = mulliganRuleGenerous
	generousActor := NewGameActor("game-g", generous, nil, 8, DefaultAppliers())
	takeGenerous := generousActor.ApplyDirect(context.Background(), command("game-g", 1, "take-generous", "mulligan.take", map[string]any{"playerId": "p1"}), "p1")
	if takeGenerous.Err != nil {
		t.Fatalf("generous take failed: %v", takeGenerous.Err)
	}
	snapshot := generousActor.Snapshot()
	if got := len(snapshot.Zones["p1"].Hand); got != 9 {
		t.Fatalf("Generous hand got %d want 9", got)
	}
	if got := snapshot.Mulligan.PlayerStatus["p1"].CardsToBottom; got != 2 {
		t.Fatalf("Generous bottom got %d want 2", got)
	}
}

func TestRuntimeMulliganRejectsForeignBottomAndDuplicateAction(t *testing.T) {
	initial := mulliganGame("game-d", []string{"p1", "p2"}, 100)
	store := persistence.NewInMemoryEventStore()
	gameActor := NewGameActor("game-d", initial, store, 8, DefaultAppliers())
	first := gameActor.ApplyDirect(context.Background(), command("game-d", 1, "take-1", "mulligan.take", map[string]any{"playerId": "p1"}), "p1")
	if first.Err != nil {
		t.Fatalf("take failed: %v", first.Err)
	}
	duplicate := gameActor.ApplyDirect(context.Background(), command("game-d", 1, "take-1", "mulligan.take", map[string]any{"playerId": "p1"}), "p1")
	if duplicate.Err != nil {
		t.Fatalf("duplicate failed: %v", duplicate.Err)
	}
	if duplicate.Event.Version != first.Event.Version {
		t.Fatalf("duplicate version got %d want %d", duplicate.Event.Version, first.Event.Version)
	}
	foreign := gameActor.ApplyDirect(context.Background(), command("game-d", 2, "keep-1", "mulligan.keep", map[string]any{"playerId": "p1", "bottomCardIds": []string{"p2-hand-0"}}), "p1")
	if foreign.Err == nil {
		t.Fatal("foreign bottom card accepted")
	}
	events, err := store.EventsAfter(context.Background(), "game-d", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("events got %d want 1", len(events))
	}
}

func TestRuntimeMulliganReplayAndBootstrapPrivacy(t *testing.T) {
	initial := mulliganGame("game-r", []string{"p1", "p2"}, 100)
	store := persistence.NewInMemoryEventStore()
	gameActor := NewGameActor("game-r", initial, store, 8, DefaultAppliers())

	result := gameActor.ApplyDirect(context.Background(), command("game-r", 1, "take-1", "mulligan.take", map[string]any{"playerId": "p1"}), "p1")
	if result.Err != nil {
		t.Fatalf("take failed: %v", result.Err)
	}
	ownerBootstrap := BootstrapV2ForViewer(gameActor.Snapshot(), "p1")
	opponentBootstrap := BootstrapV2ForViewer(gameActor.Snapshot(), "p2")
	ownerBytes, _ := json.Marshal(ownerBootstrap)
	opponentBytes, _ := json.Marshal(opponentBootstrap)
	if !containsString(string(ownerBytes), "p1-lib-") {
		t.Fatalf("owner bootstrap does not include own compact hand: %s", ownerBytes)
	}
	if containsString(string(opponentBytes), "p1-lib-") || containsString(string(opponentBytes), "p1-hand-") {
		t.Fatalf("opponent bootstrap leaked private hand: %s", opponentBytes)
	}

	events, err := store.EventsAfter(context.Background(), "game-r", 1)
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := ReplayEvents(initial, events, DefaultAppliers())
	if err != nil {
		t.Fatalf("replay failed: %v", err)
	}
	current := gameActor.Snapshot()
	if got, want := len(replayed.Zones["p1"].Hand), len(current.Zones["p1"].Hand); got != want {
		t.Fatalf("replayed hand got %d want %d", got, want)
	}
	if !equalStrings(replayed.Zones["p1"].Library, current.Zones["p1"].Library) {
		t.Fatalf("library order mismatch")
	}
}

func BenchmarkRuntimeMulliganFourPlayersHundredCards(b *testing.B) {
	for i := 0; i < b.N; i++ {
		initial := mulliganGame("game-bench", []string{"p1", "p2", "p3", "p4"}, 100)
		gameActor := NewGameActor("game-bench", initial, nil, 64, DefaultAppliers())
		version := int64(1)
		for _, playerID := range []string{"p1", "p2", "p3", "p4"} {
			result := gameActor.ApplyDirect(context.Background(), command("game-bench", version, "take-"+playerID, "mulligan.take", map[string]any{"playerId": playerID}), playerID)
			if result.Err != nil {
				b.Fatalf("take failed: %v", result.Err)
			}
			version++
		}
		for _, playerID := range []string{"p1", "p2", "p3", "p4"} {
			hand := gameActor.Snapshot().Zones[playerID].Hand
			result := gameActor.ApplyDirect(context.Background(), command("game-bench", version, "keep-"+playerID, "mulligan.keep", map[string]any{"playerId": playerID, "bottomCardIds": []string{hand[0]}}), playerID)
			if result.Err != nil {
				b.Fatalf("keep failed: %v", result.Err)
			}
			version++
		}
	}
}

func mulliganGame(gameID string, playerIDs []string, cardsPerPlayer int) state.GameState {
	game := state.GameState{
		GameID:    gameID,
		Version:   1,
		Status:    "mulligan",
		Phase:     state.PhaseMulligan,
		Players:   map[string]map[string]any{},
		Turn:      map[string]any{},
		Instances: map[string]state.CardInstanceRuntime{},
		Zones:     map[string]state.PlayerZones{},
		Loc:       map[string]state.Location{},
		Visibility: state.VisibilityIndex{
			InstanceMasks:       map[string]uint64{},
			LibraryEpochByOwner: map[string]int64{},
			TopRevealWindows:    map[string]state.TopRevealWindow{},
		},
		Mulligan: state.MulliganState{
			Rule:         mulliganRuleLondon,
			PlayerStatus: map[string]state.MulliganPlayerState{},
			ReadyPlayers: map[string]bool{},
			ScryMode:     scryModeNone,
		},
	}
	for _, playerID := range playerIDs {
		game.Players[playerID] = map[string]any{"life": 40}
		zones := state.PlayerZones{}
		handCount := 7
		libraryCount := cardsPerPlayer - handCount
		for i := 0; i < libraryCount; i++ {
			instanceID := fmt.Sprintf("%s-lib-%d", playerID, i)
			game.Instances[instanceID] = state.CardInstanceRuntime{InstanceID: instanceID, CardKey: instanceID + "@1", OwnerID: playerID, ControllerID: playerID, Zone: state.ZoneLibrary}
			zones.Library = append(zones.Library, instanceID)
		}
		for i := 0; i < handCount; i++ {
			instanceID := fmt.Sprintf("%s-hand-%d", playerID, i)
			game.Instances[instanceID] = state.CardInstanceRuntime{InstanceID: instanceID, CardKey: instanceID + "@1", OwnerID: playerID, ControllerID: playerID, Zone: state.ZoneHand}
			zones.Hand = append(zones.Hand, instanceID)
		}
		game.Zones[playerID] = zones
	}
	state.RebuildLocIndexForRecoveryOnly(&game)
	return game
}

func assertNoStaticPayload(t *testing.T, payload map[string]any) {
	t.Helper()
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"imageUris", "oracleText", "cardFaces", "typeLine"} {
		if containsString(string(encoded), forbidden) {
			t.Fatalf("static payload leaked %s in %s", forbidden, encoded)
		}
	}
}

func assertNoPrivateLeakToPublic(t *testing.T, patches []protocol.PatchEnvelopeV2, privateInstanceID string) {
	t.Helper()
	for _, patch := range patches {
		if patch.Visibility != protocol.VisibilityPublic {
			continue
		}
		encoded, _ := json.Marshal(patch)
		if containsString(string(encoded), privateInstanceID) {
			t.Fatalf("public patch leaked private instance id: %s", encoded)
		}
		if containsString(string(encoded), "cardKey") {
			t.Fatalf("public patch leaked cardKey: %s", encoded)
		}
	}
}

func containsString(haystack string, needle string) bool {
	return len(needle) == 0 || (len(haystack) >= len(needle) && indexString(haystack, needle) >= 0)
}

func indexString(haystack string, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}
