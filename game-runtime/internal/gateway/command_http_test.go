package gateway

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"commanderzone/game-runtime/internal/protocol"
	runtimesvc "commanderzone/game-runtime/internal/runtime"
	"commanderzone/game-runtime/internal/state"
)

func TestCommandHTTPServerProcessesRuntimeMulligan(t *testing.T) {
	server := NewCommandHTTPServer(runtimesvc.NewService())
	initial := runtimeMulliganState("game-1", "player-1")
	body, err := json.Marshal(CommandHTTPRequest{
		ActorID:      "player-1",
		InitialState: &initial,
		Command: protocol.CommandEnvelopeV2{
			GameID:         "game-1",
			BaseVersion:    1,
			ClientActionID: "action-1",
			Type:           "mulligan.take",
			Payload:        map[string]any{"playerId": "player-1"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/commands", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response CommandHTTPResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Event.Type != "mulligan.player_took" {
		t.Fatalf("unexpected event type: %s", response.Event.Type)
	}
	if response.Event.Version != 2 {
		t.Fatalf("unexpected event version: %d", response.Event.Version)
	}
	if len(response.Patches) == 0 {
		t.Fatal("expected runtime patches")
	}
	if response.Metrics["mulligan.take_ms"] == nil {
		t.Fatal("expected mulligan.take_ms metric")
	}
}

func runtimeMulliganState(gameID string, playerID string) state.GameState {
	game := runtimesvc.EmptyInitialState(gameID)
	game.Phase = state.PhaseMulligan
	game.Players[playerID] = map[string]any{"life": 40}
	zones := state.PlayerZones{Library: []string{}, Hand: []string{}}
	for i := 1; i <= 10; i++ {
		zones.Library = append(zones.Library, fmt.Sprintf("library-%d", i))
	}
	for i := 1; i <= 7; i++ {
		zones.Hand = append(zones.Hand, fmt.Sprintf("hand-%d", i))
	}
	game.Zones[playerID] = zones
	for index, id := range game.Zones[playerID].Library {
		game.Instances[id] = state.CardInstanceRuntime{
			InstanceID:   id,
			CardKey:      id + "@1",
			OwnerID:      playerID,
			ControllerID: playerID,
			Zone:         state.ZoneLibrary,
		}
		game.Loc[id] = state.Location{PlayerID: playerID, Zone: state.ZoneLibrary, Index: index, ControllerID: playerID}
	}
	for index, id := range game.Zones[playerID].Hand {
		game.Instances[id] = state.CardInstanceRuntime{
			InstanceID:   id,
			CardKey:      id + "@1",
			OwnerID:      playerID,
			ControllerID: playerID,
			Zone:         state.ZoneHand,
		}
		game.Loc[id] = state.Location{PlayerID: playerID, Zone: state.ZoneHand, Index: index, ControllerID: playerID}
	}
	game.Mulligan = state.MulliganState{
		Rule:              "LONDON",
		FirstMulliganFree: true,
		PlayerStatus: map[string]state.MulliganPlayerState{
			playerID: {
				Status:          state.MulliganStatusDeciding,
				CurrentHandSize: 2,
			},
		},
		ReadyPlayers:    map[string]bool{},
		BottomOrderMode: "PLAYER_CHOSEN_ORDER",
		ScryMode:        "NONE",
	}
	return game
}
