package gateway

import (
	"context"
	"errors"
	"fmt"
	"net"
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
	message := readUntil(t, conn, "patch.v2")
	if message.Version != 2 {
		t.Fatalf("patch = %#v, want version 2", message)
	}
	if len(message.Ops) != 1 || message.Ops[0]["op"] != "player.life.set" || message.Ops[0]["playerId"] != "p1" {
		t.Fatalf("ops = %#v, want flattened frontend patch op", message.Ops)
	}
	if runtimeServiceActorVersion(t, runtimeService, "game-1") != 2 {
		t.Fatalf("actor version was not updated")
	}
}

func TestWebSocketAcceptsLegacyTypeCommandThroughExplicitAdapter(t *testing.T) {
	server, _ := testWebSocketServer(t, "game-1", 128, 256)
	defer server.Close()

	conn := dialRuntime(t, server.URL, "game-1", 0, nil)
	defer conn.Close()

	legacyCommand := command("game-1", 1, "legacy-life", "life.changed", map[string]any{"playerId": "p1", "life": 34}, nil)
	if err := conn.WriteJSON(ClientMessage{Type: "command", Command: &legacyCommand}); err != nil {
		t.Fatalf("write legacy command: %v", err)
	}

	message := readUntil(t, conn, "patch.v2")
	if message.Version != 2 || message.AckClientActionID != "legacy-life" {
		t.Fatalf("message = %#v, want adapted patch.v2", message)
	}
}

func TestWebSocketTranslatesZoneChangedAliasToCanonicalRuntimeCommand(t *testing.T) {
	server, runtimeService := testWebSocketServerWithState(t, "game-1", testReorderState("game-1"), 128, 256)
	defer server.Close()

	conn := dialRuntime(t, server.URL, "game-1", 0, nil)
	defer conn.Close()

	writeCommand(t, conn, command("game-1", 1, "alias-zone", "zone.changed", map[string]any{
		"playerId":    "p1",
		"zone":        "hand",
		"instanceIds": []string{"h2", "h1"},
	}, nil))
	message := readUntil(t, conn, "patch.v2")
	if message.Version != 2 || message.AckClientActionID != "alias-zone" {
		t.Fatalf("message = %#v, want canonical alias patch", message)
	}
	if runtimeServiceActorVersion(t, runtimeService, "game-1") != 2 {
		t.Fatalf("actor version was not updated")
	}
	gameActor, _ := runtimeService.Actor("game-1")
	if gameActor.Metrics().AliasTranslationCount != 1 {
		t.Fatalf("command.alias_translation_count got %d want 1", gameActor.Metrics().AliasTranslationCount)
	}
}

func TestWebSocketPingReturnsKindPong(t *testing.T) {
	server, _ := testWebSocketServer(t, "game-1", 128, 256)
	defer server.Close()

	conn := dialRuntime(t, server.URL, "game-1", 0, nil)
	defer conn.Close()

	if err := conn.WriteJSON(ClientMessage{Kind: "ping", GameID: "game-1", MessageID: "ping-1"}); err != nil {
		t.Fatalf("write ping: %v", err)
	}

	message := readUntil(t, conn, "pong")
	if message.MessageID != "ping-1" || message.GameID != "game-1" {
		t.Fatalf("message = %#v, want pong for ping-1", message)
	}
}

func TestWebSocketRejectsCommandsWithoutCommandPermission(t *testing.T) {
	server, _ := testWebSocketServer(t, "game-1", 128, 256)
	defer server.Close()

	conn := dialRuntimeWithClaims(t, server.URL, "game-1", 0, TicketClaims{
		UserID:      "viewer-1",
		PlayerID:    "viewer-1",
		GameID:      "game-1",
		Role:        "viewer",
		Permissions: []string{"view"},
		Protocol:    "v2",
	})
	defer conn.Close()

	writeCommand(t, conn, command("game-1", 1, "viewer-life", "life.changed", map[string]any{"playerId": "p1", "life": 30}, nil))
	message := readUntil(t, conn, "command_ack")
	if message.Status != "rejected" || message.Error == nil || message.Error.Code != "PERMISSION_DENIED" {
		t.Fatalf("message = %#v, want permission denied command_ack", message)
	}
}

func TestWebSocketOwnerCanCloseGameWithClosePermission(t *testing.T) {
	server, runtimeService := testWebSocketServer(t, "game-1", 128, 256)
	defer server.Close()

	conn := dialRuntimeWithClaims(t, server.URL, "game-1", 0, TicketClaims{
		UserID:      "p1",
		PlayerID:    "p1",
		GameID:      "game-1",
		Role:        "player",
		Permissions: []string{"view", "command", "game.close"},
		Protocol:    "v2",
	})
	defer conn.Close()

	writeCommand(t, conn, command("game-1", 1, "owner-close", "game.close", map[string]any{}, nil))
	message := readUntil(t, conn, "patch.v2")
	if message.Version != 2 || message.AckClientActionID != "owner-close" {
		t.Fatalf("message = %#v, want owner close patch", message)
	}
	if len(message.Ops) == 0 || message.Ops[0]["op"] != "game.status.set" || message.Ops[0]["status"] != "finished" {
		t.Fatalf("ops = %#v, want game.status.set finished", message.Ops)
	}
	gameActor, ok := runtimeService.Actor("game-1")
	if !ok {
		t.Fatalf("actor missing")
	}
	snapshot := gameActor.Snapshot()
	if snapshot.Status != "finished" || snapshot.Phase != state.PhaseFinished {
		t.Fatalf("snapshot status = %s phase = %s, want finished", snapshot.Status, snapshot.Phase)
	}
}

func TestWebSocketPlayerCannotCloseGameWithoutClosePermission(t *testing.T) {
	server, runtimeService, handler := testWebSocketServerWithStateAndHandler(t, "game-1", testInitialState("game-1"), 128, 256)
	defer server.Close()

	conn := dialRuntimeWithClaims(t, server.URL, "game-1", 0, TicketClaims{
		UserID:      "p2",
		PlayerID:    "p2",
		GameID:      "game-1",
		Role:        "player",
		Permissions: []string{"view", "command"},
		Protocol:    "v2",
	})
	defer conn.Close()

	writeCommand(t, conn, command("game-1", 1, "player-close", "game.close", map[string]any{}, nil))
	message := readUntil(t, conn, "command_ack")
	if message.Status != "rejected" || message.Error == nil || message.Error.Code != "PERMISSION_DENIED" {
		t.Fatalf("message = %#v, want rejected permission denied command_ack", message)
	}
	if runtimeServiceActorVersion(t, runtimeService, "game-1") != 1 {
		t.Fatalf("rejected close changed actor version")
	}
	gameActor, ok := runtimeService.Actor("game-1")
	if !ok {
		t.Fatalf("actor missing")
	}
	snapshot := gameActor.Snapshot()
	if snapshot.Status != "playing" || snapshot.Phase == state.PhaseFinished {
		t.Fatalf("rejected close mutated state: status=%s phase=%s", snapshot.Status, snapshot.Phase)
	}
	if _, err := handler.history("game-1").Since(1); !errors.Is(err, ErrPatchHistoryGap) {
		t.Fatalf("rejected close emitted patch history, err=%v", err)
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
	first := readUntil(t, conn, "patch.v2")
	writeCommand(t, conn, command("game-1", first.Version, "a-turn", "turn.changed", map[string]any{"activePlayerId": "p2", "phase": "combat"}, nil))
	second := readUntil(t, conn, "patch.v2")

	if first.Version != 2 || second.Version != 3 {
		t.Fatalf("versions = %d/%d, want 2/3", first.Version, second.Version)
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
	message := readUntil(t, conn, "patch.v2")
	if message.Version != 2 {
		t.Fatalf("patch = %#v, want version 2", message)
	}
}

func TestWebSocketReconnectReplaysPatchesWithoutGap(t *testing.T) {
	server, _ := testWebSocketServer(t, "game-1", 128, 256)
	defer server.Close()

	conn := dialRuntime(t, server.URL, "game-1", 0, nil)
	writeCommand(t, conn, command("game-1", 1, "a-life", "life.changed", map[string]any{"playerId": "p1", "life": 36}, nil))
	readUntil(t, conn, "patch.v2")
	_ = conn.Close()

	reconnected := dialRuntime(t, server.URL, "game-1", 1, nil)
	defer reconnected.Close()
	message := readUntil(t, reconnected, "patch.v2")
	if message.Version != 2 {
		t.Fatalf("replayed patch = %#v, want version 2", message)
	}
}

func TestWebSocketReconnectRequestsResyncOnGap(t *testing.T) {
	server, _ := testWebSocketServer(t, "game-1", 128, 1)
	defer server.Close()

	conn := dialRuntime(t, server.URL, "game-1", 0, nil)
	writeCommand(t, conn, command("game-1", 1, "a-life", "life.changed", map[string]any{"playerId": "p1", "life": 36}, nil))
	first := readUntil(t, conn, "patch.v2")
	writeCommand(t, conn, command("game-1", first.Version, "a-turn", "turn.changed", map[string]any{"activePlayerId": "p2"}, nil))
	readUntil(t, conn, "patch.v2")
	_ = conn.Close()

	reconnected := dialRuntime(t, server.URL, "game-1", 1, nil)
	defer reconnected.Close()
	message := readUntil(t, reconnected, "resync_required")
	if message.Reason != "version_gap" {
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
	actorB, _, err := runtimeService.LoadActorFromInitialState(context.Background(), "game-1", testInitialState("game-1"))
	if err != nil {
		t.Fatalf("load actor: %v", err)
	}
	if actorA != actorB {
		t.Fatalf("runtime created two actors for the same game")
	}
}

func testWebSocketServer(t *testing.T, gameID string, queueSize int, historyLimit int) (*httptest.Server, *runtimesvc.Service) {
	t.Helper()
	return testWebSocketServerWithState(t, gameID, testInitialState(gameID), queueSize, historyLimit)
}

func testWebSocketServerWithState(t *testing.T, gameID string, initial state.GameState, queueSize int, historyLimit int) (*httptest.Server, *runtimesvc.Service) {
	t.Helper()
	server, runtimeService, _ := testWebSocketServerWithStateAndHandler(t, gameID, initial, queueSize, historyLimit)
	return server, runtimeService
}

func testWebSocketServerWithStateAndHandler(t *testing.T, gameID string, initial state.GameState, queueSize int, historyLimit int) (*httptest.Server, *runtimesvc.Service, *WebSocketServer) {
	t.Helper()
	runtimeService := runtimesvc.NewService()
	if _, _, err := runtimeService.LoadActorFromInitialState(context.Background(), gameID, initial); err != nil {
		t.Fatalf("load actor: %v", err)
	}
	validator, err := NewHMACTicketValidator(testTicketSecret)
	if err != nil {
		t.Fatalf("validator: %v", err)
	}
	handler := NewWebSocketServer(validator, runtimeService, WithConnectionQueueSize(queueSize), WithPatchHistoryLimit(historyLimit))
	return httptest.NewServer(handler), runtimeService, handler
}

func dialRuntime(t *testing.T, serverURL string, gameID string, lastAppliedVersion int64, roles []string) *websocket.Conn {
	t.Helper()
	return dialRuntimeWithClaims(t, serverURL, gameID, lastAppliedVersion, TicketClaims{
		UserID:      "u1",
		PlayerID:    "p1",
		GameID:      gameID,
		Role:        "player",
		Permissions: []string{"view", "command"},
		Roles:       roles,
		Protocol:    "v2",
	})
}

func dialRuntimeWithClaims(t *testing.T, serverURL string, gameID string, lastAppliedVersion int64, claims TicketClaims) *websocket.Conn {
	t.Helper()
	if claims.GameID == "" {
		claims.GameID = gameID
	}
	ticket, err := SignTicket(testTicketSecret, claims, time.Minute)
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
	if err := conn.WriteJSON(ClientMessage{
		Kind:           "command.v2",
		GameID:         command.GameID,
		BaseVersion:    command.BaseVersion,
		ClientActionID: command.ClientActionID,
		Type:           command.Type,
		Payload:        command.Payload,
		Client:         command.Client,
	}); err != nil {
		t.Fatalf("write command: %v", err)
	}
}

func readUntil(t *testing.T, conn *websocket.Conn, messageType string) ServerMessage {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	if err := conn.SetReadDeadline(deadline); err != nil {
		t.Fatalf("set deadline: %v", err)
	}
	seen := []string{}
	var last ServerMessage
	for {
		var message ServerMessage
		err := conn.ReadJSON(&message)
		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				lastError := "<nil>"
				if last.Error != nil {
					lastError = fmt.Sprintf("%+v", *last.Error)
				}
				t.Fatalf("timed out waiting for message type %q; seen=%v last=%#v lastError=%s", messageType, seen, last, lastError)
			}
			t.Fatalf("read websocket message: %v", err)
			return ServerMessage{}
		}
		if message.Kind == messageType {
			return message
		}
		seen = append(seen, message.Kind)
		last = message
	}
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

func testReorderState(gameID string) state.GameState {
	gameState := testInitialState(gameID)
	gameState.Instances["h1"] = state.CardInstanceRuntime{InstanceID: "h1", OwnerID: "p1", ControllerID: "p1", CardKey: "card:h1"}
	gameState.Instances["h2"] = state.CardInstanceRuntime{InstanceID: "h2", OwnerID: "p1", ControllerID: "p1", CardKey: "card:h2"}
	gameState.Zones["p1"] = state.PlayerZones{Hand: []string{"h1", "h2"}}
	gameState.Loc["h1"] = state.Location{PlayerID: "p1", Zone: state.ZoneHand, Index: 0, ControllerID: "p1"}
	gameState.Loc["h2"] = state.Location{PlayerID: "p1", Zone: state.ZoneHand, Index: 1, ControllerID: "p1"}
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
