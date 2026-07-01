package state

import (
	"math/rand"
	"testing"
)

func TestLibraryOpsDrawPreservesTopTailOrder(t *testing.T) {
	game := libraryTestState()
	drawn, err := NewLibraryOps().DrawMany(&game, "p1", 2)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := join(drawn), "d,c"; got != want {
		t.Fatalf("drawn got %s want %s", got, want)
	}
	if got, want := join(game.Zones["p1"].Library), "a,b"; got != want {
		t.Fatalf("library got %s want %s", got, want)
	}
	if got, want := join(game.Zones["p1"].Hand), "d,c"; got != want {
		t.Fatalf("hand got %s want %s", got, want)
	}
}

func TestLibraryOpsPutTopAndBottom(t *testing.T) {
	game := libraryTestState()
	game.Instances["x"] = CardInstanceRuntime{InstanceID: "x", CardKey: "x@1", OwnerID: "p1", ControllerID: "p1"}
	if err := NewLibraryOps().PutOnTop(&game, "p1", "x"); err != nil {
		t.Fatal(err)
	}
	if got, want := game.Zones["p1"].Library[len(game.Zones["p1"].Library)-1], "x"; got != want {
		t.Fatalf("top got %s want %s", got, want)
	}
	game.Instances["y"] = CardInstanceRuntime{InstanceID: "y", CardKey: "y@1", OwnerID: "p1", ControllerID: "p1"}
	if err := NewLibraryOps().PutOnBottom(&game, "p1", "y"); err != nil {
		t.Fatal(err)
	}
	if got, want := game.Zones["p1"].Library[0], "y"; got != want {
		t.Fatalf("bottom got %s want %s", got, want)
	}
}

func TestLibraryOpsPeekAndReorderTop(t *testing.T) {
	game := libraryTestState()
	top, err := NewLibraryOps().PeekTop(&game, "p1", 3)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := join(top), "d,c,b"; got != want {
		t.Fatalf("peek top got %s want %s", got, want)
	}
	if err := NewLibraryOps().ReorderTop(&game, "p1", []string{"b", "c", "d"}); err != nil {
		t.Fatal(err)
	}
	top, _ = NewLibraryOps().PeekTop(&game, "p1", 3)
	if got, want := join(top), "b,c,d"; got != want {
		t.Fatalf("reordered top got %s want %s", got, want)
	}
}

func TestLibraryOpsShuffleBumpsEpochWithoutPerCardCleanup(t *testing.T) {
	game := libraryTestState()
	game.Visibility.InstanceMasks["d"] = 7
	game.Visibility.TopRevealWindows["p1"] = TopRevealWindow{OwnerID: "p1", Count: 2, Epoch: 1, Mask: 7}
	ops := NewLibraryOpsWithRand(rand.New(rand.NewSource(1)))
	if err := ops.Shuffle(&game, "p1"); err != nil {
		t.Fatal(err)
	}
	if got := game.Visibility.LibraryEpochByOwner["p1"]; got != 2 {
		t.Fatalf("epoch got %d want 2", got)
	}
	if _, ok := game.Visibility.TopRevealWindows["p1"]; ok {
		t.Fatal("top reveal window was not invalidated")
	}
	if got := game.Visibility.InstanceMasks["d"]; got != 7 {
		t.Fatalf("shuffle should not clean per-card masks, got %d", got)
	}
}

func TestLibraryOpsShuffleWithSeedIsDeterministic(t *testing.T) {
	game := libraryTestState()
	if err := NewLibraryOps().ShuffleWithSeed(&game, "p1", 123); err != nil {
		t.Fatal(err)
	}
	if got, want := join(game.Zones["p1"].Library), "b,d,a,c"; got != want {
		t.Fatalf("seeded shuffle got %s want %s", got, want)
	}
	if got := game.Visibility.LibraryEpochByOwner["p1"]; got != 2 {
		t.Fatalf("epoch got %d want 2", got)
	}
}

func TestLibraryOpsHotPathUpdatesLocWithoutGlobalReindex(t *testing.T) {
	game := libraryTestState()
	ops := NewLibraryOps()

	drawn, err := ops.DrawMany(&game, "p1", 1)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := drawn[0], "d"; got != want {
		t.Fatalf("drawn got %s want %s", got, want)
	}
	if got := ops.ReindexCount(); got != 0 {
		t.Fatalf("draw reindex count got %d want 0", got)
	}
	if got := ops.FullScanCount(); got != 0 {
		t.Fatalf("draw full scan count got %d want 0", got)
	}
	if err := ValidateInvariants(game); err != nil {
		t.Fatal(err)
	}

	if err := ops.ReorderTop(&game, "p1", []string{"b", "c"}); err != nil {
		t.Fatal(err)
	}
	if got := ops.ReindexCount(); got != 0 {
		t.Fatalf("reorder reindex count got %d want 0", got)
	}
	if err := ValidateInvariants(game); err != nil {
		t.Fatal(err)
	}
}

func TestLibraryOpsMoveTopToPlayerZone(t *testing.T) {
	game := libraryTestState()
	game.Players["p2"] = map[string]any{"life": 40}
	game.Zones["p2"] = PlayerZones{}

	moved, err := NewLibraryOps().MoveTopToPlayerZone(&game, "p1", 2, "p2", ZoneHand)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := join(moved), "d,c"; got != want {
		t.Fatalf("moved got %s want %s", got, want)
	}
	if got, want := join(game.Zones["p2"].Hand), "d,c"; got != want {
		t.Fatalf("target hand got %s want %s", got, want)
	}
	if err := ValidateInvariants(game); err != nil {
		t.Fatal(err)
	}
}

func libraryTestState() GameState {
	instances := map[string]CardInstanceRuntime{}
	loc := map[string]Location{}
	for index, id := range []string{"a", "b", "c", "d"} {
		instances[id] = CardInstanceRuntime{InstanceID: id, CardKey: id + "@1", OwnerID: "p1", ControllerID: "p1", Zone: ZoneLibrary}
		loc[id] = Location{PlayerID: "p1", Zone: ZoneLibrary, Index: index, ControllerID: "p1"}
	}
	return GameState{
		GameID:    "game-1",
		Version:   1,
		Players:   map[string]map[string]any{"p1": map[string]any{"life": 40}},
		Instances: instances,
		Zones:     map[string]PlayerZones{"p1": {Library: []string{"a", "b", "c", "d"}}},
		Loc:       loc,
		Visibility: VisibilityIndex{
			InstanceMasks:       map[string]uint64{},
			LibraryEpochByOwner: map[string]int64{"p1": 1},
			TopRevealWindows:    map[string]TopRevealWindow{},
		},
	}
}

func join(values []string) string {
	result := ""
	for index, value := range values {
		if index > 0 {
			result += ","
		}
		result += value
	}
	return result
}
