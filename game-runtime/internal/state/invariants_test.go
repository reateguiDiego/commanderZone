package state

import (
	"errors"
	"testing"
)

func TestValidateInvariantsDetectsLocDivergence(t *testing.T) {
	game := invariantState()
	game.Loc["i1"] = Location{PlayerID: "p1", Zone: ZoneHand, Index: 0, ControllerID: "p1"}
	if err := ValidateInvariants(game); !errors.Is(err, ErrInvariantViolation) {
		t.Fatalf("err = %v, want %v", err, ErrInvariantViolation)
	}
}

func TestRebuildLocIndexForRecoveryOnly(t *testing.T) {
	game := invariantState()
	game.Loc = map[string]Location{}
	RebuildLocIndexForRecoveryOnly(&game)
	if err := ValidateInvariants(game); err != nil {
		t.Fatalf("invariants: %v", err)
	}
	if game.Loc["i1"].Zone != ZoneBattlefield || game.Loc["i1"].Index != 0 {
		t.Fatalf("loc = %#v", game.Loc["i1"])
	}
}

func invariantState() GameState {
	return GameState{
		GameID:  "game-1",
		Version: 1,
		Status:  "playing",
		Players: map[string]map[string]any{
			"p1": map[string]any{"life": 40},
		},
		Turn: map[string]any{},
		Instances: map[string]CardInstanceRuntime{
			"i1": {InstanceID: "i1", OwnerID: "p1", ControllerID: "p1", Zone: ZoneBattlefield},
		},
		Zones: map[string]PlayerZones{
			"p1": {Battlefield: []string{"i1"}},
		},
		Loc: map[string]Location{
			"i1": {PlayerID: "p1", Zone: ZoneBattlefield, Index: 0, ControllerID: "p1"},
		},
		Visibility: VisibilityIndex{
			InstanceMasks:       map[string]uint64{},
			LibraryEpochByOwner: map[string]int64{},
			TopRevealWindows:    map[string]TopRevealWindow{},
		},
	}
}
