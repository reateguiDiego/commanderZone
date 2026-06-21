package gateway

import (
	"context"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"commanderzone/game-runtime/internal/protocol"
	runtimesvc "commanderzone/game-runtime/internal/runtime"
	"commanderzone/game-runtime/internal/state"

	"github.com/gorilla/websocket"
)

const testTicketSecret = "test-runtime-ticket-secret"

func TestWebSocketAcceptsValidTicketAndEmitsPatch(t *testing.T) {
	server, runtimeService := testWebSocketServer(t, "game-1", 128, 256)
	defer server.Close()

	conn := dialRuntime(t, server.URL, "game-1", 0, nil)
	defer conn.Close()

	writeCommand(t, conn, command("game-1", 1, "a-life", "life.changed", map[string]any{"playerId": "p1", "life": 37}, nil))
	message := readUntil(t, conn, "patch")
	if message.Patch == nil || message.Patch.Version != 2 {
		t.Fatalf("patch = %#v, want version 2", message.Patch)
	}
	if runtimeServiceActorVersion(t, runtimeService, "game-1") != 2 {
		t.Fatalf("actor version was not updated")
	}
}

func TestWebSocketRejectsInvalidTicket(t *testing.T) {
	server, _ := testWebSocketServer(t, "game-1", 128, 256)
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws?ticket=bad"
	_, response, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err == nil {
		t.Fatalf("expected dial to fail")
	}
	if response == nil || response.StatusCode != 401 {
		t.Fatalf("status = %#v, want 401", response)
	}
}

func TestWebSocketCommandsAreAppliedInOrder(t *testing.T) {
	server, _ := testWebSocketServer(t, "game-1", 128, 256)
	defer server.Close()

	conn := dialRuntime(t, server.URL, "game-1", 0, nil)
	defer conn.Close()

	writeCommand(t, conn, command("game-1", 1, "a-life", "life.changed", map[string]any{"playerId": "p1", "life": 35}, nil))
	first := readUntil(t, conn, "patch")
	writeCommand(t, conn, command("game-1", first.Patch.Version, "a-turn", "turn.changed", map[string]any{"activePlayerId": "p2", "phase": "combat"}, nil))
	second := readUntil(t, conn, "patch")

	if first.Patch.Version != 2 || second.Patch.Version != 3 {
		t.Fatalf("versions = %d/%d, want 2/3", first.Patch.Version, second.Patch.Version)
	}
}

func TestWebSocketEphemeralDragSpamDoesNotBlockGameplayCommand(t *testing.T) {
	server, _ := testWebSocketServer(t, "game-1", 128, 256)
	defer server.Close()

	conn := dialRuntime(t, server.URL, "game-1", 0, nil)
	defer conn.Close()

	for i := 0; i < 50; i++ {
		writeCommand(t, conn, command("game-1", 1, fmt.Sprintf("drag-%d", i), "card.position.changed", map[string]any{
			"instanceId": "i1",
			"position":   map[string]any{"x": i, "y": i},
		}, map[string]any{"ephemeral": true}))
	}
	writeCommand(t, conn, command("game-1", 1, "a-life", "life.changed", map[string]any{"playerId": "p1", "life": 33}, nil))
	message := readUntil(t, conn, "patch")
	if message.Patch == nil || message.Patch.Version != 2 {
		t.Fatalf("patch = %#v, want version 2", message.Patch)
	}
}

func TestWebSocketReconnectReplaysPatchesWithoutGap(t *testing.T) {
	server, _ := testWebSocketServer(t, "game-1", 128, 256)
	defer server.Close()

	conn := dialRuntime(t, server.URL, "game-1", 0, nil)
	writeCommand(t, conn, command("game-1", 1, "a-life", "life.changed", map[string]any{"playerId": "p1", "life": 36}, nil))
	readUntil(t, conn, "patch")
	_ = conn.Close()

	reconnected := dialRuntime(t, server.URL, "game-1", 1, nil)
	defer reconnected.Close()
	message := readUntil(t, reconnected, "patch")
	if message.Patch == nil || message.Patch.Version != 2 {
		t.Fatalf("replayed patch = %#v, want version 2", message.Patch)
	}
}

func TestWebSocketReconnectRequestsResyncOnGap(t *testing.T) {
	server, _ := testWebSocketServer(t, "game-1", 128, 1)
	defer server.Close()

	conn := dialRuntime(t, server.URL, "game-1", 0, nil)
	writeCommand(t, conn, command("game-1", 1, "a-life", "life.changed", map[string]any{"playerId": "p1", "life": 36}, nil))
	first := readUntil(t, conn, "patch")
	writeCommand(t, conn, command("game-1", first.Patch.Version, "a-turn", "turn.changed", map[string]any{"activePlayerId": "p2"}, nil))
	readUntil(t, conn, "patch")
	_ = conn.Close()

	reconnected := dialRuntime(t, server.URL, "game-1", 1, nil)
	defer reconnected.Close()
	message := readUntil(t, reconnected, "resync.required")
	if !message.ResyncRequired {
		t.Fatalf("message = %#v, want resync", message)
	}
}

func TestRuntimeServiceKeepsSingleActorPerGameID(t *testing.T) {
	server, runtimeService := testWebSocketServer(t, "game-1", 128, 256)
	defer server.Close()

	first := dialRuntime(t, server.URL, "game-1", 0, nil)
	defer first.Close()
	second := dialRuntime(t, server.URL, "game-1", 0, nil)
	defer second.Close()

	actorA, ok := runtimeService.Actor("game-1")
	if !ok {
		t.Fatalf("actor missing")
	}
	actorB, _ := runtimeService.LoadActor(context.Background(), "game-1", testInitialState("game-1"))
	if actorA != actorB {
		t.Fatalf("runtime created two actors for the same game")
	}
}

func testWebSocketServer(t *testing.T, gameID string, queueSize int, historyLimit int) (*httptest.Server, *runtimesvc.Service) {
	t.Helper()
	runtimeService := runtimesvc.NewService()
	runtimeService.LoadActor(context.Background(), gameID, testInitialState(gameID))
	validator, err := NewHMACTicketValidator(testTicketSecret)
	if err != nil {
		t.Fatalf("validator: %v", err)
	}
	handler := NewWebSocketServer(validator, runtimeService, WithConnectionQueueSize(queueSize), WithPatchHistoryLimit(historyLimit))
	return httptest.NewServer(handler), runtimeService
}

func dialRuntime(t *testing.T, serverURL string, gameID string, lastAppliedVersion int64, roles []string) *websocket.Conn {
	t.Helper()
	ticket, err := SignTicket(testTicketSecret, TicketClaims{
		UserID:   "u1",
		PlayerID: "p1",
		GameID:   gameID,
		Roles:    roles,
		Protocol: "v2",
	}, time.Minute)
	if err != nil {
		t.Fatalf("sign ticket: %v", err)
	}
	wsURL := URLWithTicket("ws"+strings.TrimPrefix(serverURL, "http")+"/ws", ticket, lastAppliedVersion)
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	return conn
}

func writeCommand(t *testing.T, conn *websocket.Conn, command protocol.CommandEnvelopeV2) {
	t.Helper()
	if err := conn.WriteJSON(ClientMessage{Type: "command", Command: &command}); err != nil {
		t.Fatalf("write command: %v", err)
	}
}

func readUntil(t *testing.T, conn *websocket.Conn, messageType string) ServerMessage {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if err := conn.SetReadDeadline(time.Now().Add(250 * time.Millisecond)); err != nil {
			t.Fatalf("set deadline: %v", err)
		}
		var message ServerMessage
		err := conn.ReadJSON(&message)
		if err != nil {
			continue
		}
		if message.Type == messageType {
			return message
		}
	}
	t.Fatalf("timed out waiting for message type %q", messageType)
	return ServerMessage{}
}

func command(gameID string, baseVersion int64, actionID string, commandType string, payload map[string]any, client map[string]any) protocol.CommandEnvelopeV2 {
	if client == nil {
		client = map[string]any{}
	}
	return protocol.CommandEnvelopeV2{
		GameID:         gameID,
		BaseVersion:    baseVersion,
		ClientActionID: actionID,
		Type:           commandType,
		Payload:        payload,
		Client:         client,
	}
}

func testInitialState(gameID string) state.GameState {
	gameState := runtimesvc.EmptyInitialState(gameID)
	gameState.Players["p1"] = map[string]any{"life": 40}
	gameState.Players["p2"] = map[string]any{"life": 40}
	return gameState
}

func runtimeServiceActorVersion(t *testing.T, runtimeService *runtimesvc.Service, gameID string) int64 {
	t.Helper()
	gameActor, ok := runtimeService.Actor(gameID)
	if !ok {
		t.Fatalf("actor missing")
	}
	return gameActor.Version()
}
