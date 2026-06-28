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
