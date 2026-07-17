package persistence

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"commanderzone/game-runtime/internal/state"
)

func TestCompactSnapshotPreservesCanonicalPositionPrecisionWithoutLocalGeometry(t *testing.T) {
	game := compactState()
	position := map[string]any{"x": 0.42123456789, "y": 0.68123456789, "unit": "ratio"}
	game.Instances["i1"] = state.CardInstanceRuntime{
		InstanceID: "i1", OwnerID: "p1", ControllerID: "p1", Zone: state.ZoneBattlefield, Position: position,
	}
	game.Zones["p1"] = state.PlayerZones{Battlefield: []string{"i1"}}
	game.Loc["i1"] = state.Location{PlayerID: "p1", Zone: state.ZoneBattlefield, Index: 0, ControllerID: "p1"}

	snapshot, err := NewCompactSnapshot(game)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	payload, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var recovered CompactSnapshot
	if err := json.Unmarshal(payload, &recovered); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got := recovered.State.Instances["i1"].Position; !reflect.DeepEqual(got, position) {
		t.Fatalf("position = %#v want %#v", got, position)
	}
	for _, forbidden := range []string{"viewport", "devicePixelRatio", "battlefieldZoom", "browserZoom"} {
		if json.Valid(payload) && containsJSONKey(payload, forbidden) {
			t.Fatalf("snapshot persisted local geometry key %q", forbidden)
		}
	}
}

func containsJSONKey(payload []byte, key string) bool {
	var decoded any
	if json.Unmarshal(payload, &decoded) != nil {
		return false
	}
	var visit func(any) bool
	visit = func(value any) bool {
		switch typed := value.(type) {
		case map[string]any:
			if _, ok := typed[key]; ok {
				return true
			}
			for _, child := range typed {
				if visit(child) {
					return true
				}
			}
		case []any:
			for _, child := range typed {
				if visit(child) {
					return true
				}
			}
		}
		return false
	}
	return visit(decoded)
}

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

func TestCompactSnapshotPreservesExactTopRevealWindowIDs(t *testing.T) {
	game := compactState()
	game.Visibility.LibraryEpochByOwner["p1"] = 4
	game.Visibility.TopRevealWindows["p1"] = state.TopRevealWindow{
		OwnerID: "p1", Count: 2, Epoch: 4, To: []string{"p2"}, Mask: 2, InstanceIDs: []string{"d", "c"},
	}
	snapshot, err := NewCompactSnapshot(game)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	payload, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var recovered CompactSnapshot
	if err := json.Unmarshal(payload, &recovered); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got, want := recovered.State.Visibility.TopRevealWindows["p1"].InstanceIDs, []string{"d", "c"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("top reveal IDs = %#v want %#v", got, want)
	}
}

func TestCompactSnapshotPreservesAuthoritativeLibraryActionWindow(t *testing.T) {
	game := compactState()
	game.EnsureVisibility()
	game.Visibility.LibraryEpochByOwner["p1"] = 7
	game.Visibility.LibraryWindows["p1"] = state.LibraryWindow{
		WindowID: "lw-compact", OwnerID: "p1", InstanceIDs: []string{"d", "c"},
		ExpectedEpoch: 7, OpenedAtVersion: 2, CreatedByPlayerID: "p1", CreatedBySession: "tab-a", Status: "active",
	}
	snapshot, err := NewCompactSnapshot(game)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	var recovered CompactSnapshot
	if err := json.Unmarshal(payload, &recovered); err != nil {
		t.Fatal(err)
	}
	window := recovered.State.Visibility.LibraryWindows["p1"]
	if window.WindowID != "lw-compact" || window.ExpectedEpoch != 7 || window.Status != "active" || !reflect.DeepEqual(window.InstanceIDs, []string{"d", "c"}) {
		t.Fatalf("recovered library window = %#v", window)
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
