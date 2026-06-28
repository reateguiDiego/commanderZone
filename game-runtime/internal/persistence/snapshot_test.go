package persistence

import (
	"errors"
	"testing"

	"commanderzone/game-runtime/internal/state"
)

func TestCompactSnapshotChecksumRoundTrip(t *testing.T) {
	game := compactState()
	snapshot, err := NewCompactSnapshot(game)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if err := VerifySnapshot(snapshot); err != nil {
		t.Fatalf("verify: %v", err)
	}
}

func TestCompactSnapshotRejectsCorruptChecksum(t *testing.T) {
	snapshot, err := NewCompactSnapshot(compactState())
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	snapshot.Checksum = "bad"
	if err := VerifySnapshot(snapshot); !errors.Is(err, ErrSnapshotChecksumMismatch) {
		t.Fatalf("err = %v, want %v", err, ErrSnapshotChecksumMismatch)
	}
}

func TestCompactSnapshotRejectsStaticPayload(t *testing.T) {
	game := compactState()
	game.Instances["i1"] = state.CardInstanceRuntime{
		InstanceID:   "i1",
		OwnerID:      "p1",
		ControllerID: "p1",
		Zone:         state.ZoneBattlefield,
		TokenMeta:    map[string]any{"oracleText": "static text should not be in runtime"},
	}
	game.Zones["p1"] = state.PlayerZones{Battlefield: []string{"i1"}}
	game.Loc["i1"] = state.Location{PlayerID: "p1", Zone: state.ZoneBattlefield, Index: 0, ControllerID: "p1"}
	if _, err := NewCompactSnapshot(game); !errors.Is(err, ErrSnapshotContainsStatic) {
		t.Fatalf("err = %v, want %v", err, ErrSnapshotContainsStatic)
	}
}

func compactState() state.GameState {
	return state.GameState{
		GameID:  "game-1",
		Version: 2,
		Status:  "playing",
		Players: map[string]map[string]any{
			"p1": map[string]any{"life": 40},
		},
		Turn:      map[string]any{"activePlayerId": "p1"},
		Instances: map[string]state.CardInstanceRuntime{},
		Zones:     map[string]state.PlayerZones{"p1": state.PlayerZones{}},
		Loc:       map[string]state.Location{},
		Visibility: state.VisibilityIndex{
			InstanceMasks:       map[string]uint64{},
			LibraryEpochByOwner: map[string]int64{},
			TopRevealWindows:    map[string]state.TopRevealWindow{},
		},
	}
}
