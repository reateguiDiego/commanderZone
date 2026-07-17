package state

import "testing"

func TestVisibilityIndexHidesOpponentHandAndFaceDown(t *testing.T) {
	game := libraryTestState()
	game.Players["p2"] = map[string]any{"life": 40}
	game.Instances["h"] = CardInstanceRuntime{InstanceID: "h", CardKey: "secret@1", OwnerID: "p1", ControllerID: "p1", Zone: ZoneHand}
	game.Zones["p1"] = PlayerZones{Hand: []string{"h"}}
	game.Loc["h"] = Location{PlayerID: "p1", Zone: ZoneHand, Index: 0, ControllerID: "p1"}
	if game.CanViewerSeeCardKey("p2", "h") {
		t.Fatal("opponent can see hand cardKey")
	}
	if !game.CanViewerSeeCardKey("p1", "h") {
		t.Fatal("owner cannot see own hand cardKey")
	}

	game.Instances["b"] = CardInstanceRuntime{InstanceID: "b", CardKey: "face-down@1", OwnerID: "p1", ControllerID: "p1", Zone: ZoneBattlefield, FaceDown: true}
	game.Zones["p1"] = PlayerZones{Battlefield: []string{"b"}}
	game.Loc["b"] = Location{PlayerID: "p1", Zone: ZoneBattlefield, Index: 0, ControllerID: "p1"}
	if game.CanViewerSeeCardKey("p2", "b") {
		t.Fatal("faceDown leaked cardKey")
	}
}

func TestVisibilityIndexUsesServerViewerBitsForTargetedAndPublicReveals(t *testing.T) {
	game := libraryTestState()
	game.Players["p2"] = map[string]any{"life": 40}
	game.Players["p3"] = map[string]any{"life": 40}
	game.EnsureVisibility()
	game.Instances["h"] = CardInstanceRuntime{InstanceID: "h", CardKey: "secret@1", OwnerID: "p1", ControllerID: "p1", Zone: ZoneHand, VisibleToMask: 2}
	game.Zones["p1"] = PlayerZones{Hand: []string{"h"}}
	game.Loc["h"] = Location{PlayerID: "p1", Zone: ZoneHand, Index: 0, ControllerID: "p1"}
	game.Visibility.InstanceMasks["h"] = 2
	if !game.CanViewerSeeCardKey("p2", "h") || game.CanViewerSeeCardKey("p3", "h") {
		t.Fatal("targeted hand reveal did not honor viewer bits")
	}

	game.Instances["l"] = CardInstanceRuntime{InstanceID: "l", CardKey: "top@1", OwnerID: "p1", ControllerID: "p1", Zone: ZoneLibrary}
	game.Zones["p1"] = PlayerZones{Library: []string{"l"}}
	game.Loc["l"] = Location{PlayerID: "p1", Zone: ZoneLibrary, Index: 0, ControllerID: "p1"}
	game.Visibility.TopRevealWindows["p1"] = TopRevealWindow{OwnerID: "p1", Count: 1, Epoch: game.Visibility.LibraryEpochByOwner["p1"], To: []string{"all"}, Mask: 7, InstanceIDs: []string{"l"}}
	if !game.CanViewerSeeCardKey("p2", "l") || !game.CanViewerSeeCardKey("p3", "l") {
		t.Fatal("public top reveal did not survive canonical window state")
	}
}

func TestFaceDownBattlefieldIdentityIsVisibleToOwnerAndControllerOnly(t *testing.T) {
	game := libraryTestState()
	game.Players["p2"] = map[string]any{"life": 40}
	game.Players["p3"] = map[string]any{"life": 40}
	game.Instances["b"] = CardInstanceRuntime{
		InstanceID: "b", CardKey: "face-down@1", OwnerID: "p1", ControllerID: "p2",
		Zone: ZoneBattlefield, FaceDown: true,
	}
	game.Zones["p1"] = PlayerZones{Battlefield: []string{"b"}}
	game.Loc["b"] = Location{PlayerID: "p1", Zone: ZoneBattlefield, Index: 0, ControllerID: "p2"}

	if !game.CanViewerSeeCardKey("p1", "b") || !game.CanViewerSeeCardKey("p2", "b") {
		t.Fatal("face-down battlefield identity must remain available to owner and controller")
	}
	if game.CanViewerSeeCardKey("p3", "b") {
		t.Fatal("face-down battlefield identity leaked to an unauthorized viewer")
	}
}
