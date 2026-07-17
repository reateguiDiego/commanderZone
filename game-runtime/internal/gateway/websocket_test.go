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

	"commanderzone/game-runtime/internal/actor"
	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	runtimesvc "commanderzone/game-runtime/internal/runtime"
	"commanderzone/game-runtime/internal/state"

	"github.com/gorilla/websocket"
)

const testTicketSecret = "test-runtime-ticket-secret"

func TestWebSocketConnectionStateDoesNotExposeInternalConnectionID(t *testing.T) {
	server, _ := testWebSocketServer(t, "game-1", 128, 256)
	defer server.Close()
	conn := dialRuntime(t, server.URL, "game-1", 0, nil)
	defer conn.Close()
	message := readUntil(t, conn, "connection_state")
	if message.ConnectionID != "" {
		t.Fatalf("connection_state leaked internal connection id %q", message.ConnectionID)
	}
}

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
	if !hasPatchOp(message.Ops, "player.life.set") || !hasPatchOp(message.Ops, "eventLog.append") {
		t.Fatalf("ops = %#v, want life patch and event log op", message.Ops)
	}
	if runtimeServiceActorVersion(t, runtimeService, "game-1") != 2 {
		t.Fatalf("actor version was not updated")
	}
}

func hasPatchOp(ops []map[string]any, op string) bool {
	for _, candidate := range ops {
		if candidate["op"] == op {
			return true
		}
	}
	return false
}

func TestWebSocketCommandTimeoutCanBeConfigured(t *testing.T) {
	runtimeService := runtimesvc.NewService()
	validator, err := NewHMACTicketValidator(testTicketSecret)
	if err != nil {
		t.Fatalf("validator: %v", err)
	}

	handler := NewWebSocketServer(validator, runtimeService, WithCommandTimeout(15*time.Second))
	if handler.commandTimeout != 15*time.Second {
		t.Fatalf("command timeout = %s, want 15s", handler.commandTimeout)
	}

	handler = NewWebSocketServer(validator, runtimeService, WithCommandTimeout(0))
	if handler.commandTimeout != defaultCommandTimeout {
		t.Fatalf("zero command timeout = %s, want default %s", handler.commandTimeout, defaultCommandTimeout)
	}
}

func TestWebSocketDisconnectOpensRuntimeDisconnectVote(t *testing.T) {
	initial := testInitialState("game-1")
	initial.Players["p3"] = map[string]any{"life": 40}
	server, runtimeService, handler := testWebSocketServerWithStateAndHandler(t, "game-1", initial, 128, 256)
	handler.disconnectVoteGrace = 20 * time.Millisecond
	defer server.Close()

	playerA := dialRuntimeWithClaims(t, server.URL, "game-1", 0, TicketClaims{
		UserID:      "p1",
		PlayerID:    "p1",
		GameID:      "game-1",
		Role:        "player",
		Permissions: []string{"view", "command"},
		Protocol:    "v2",
	})
	defer playerA.Close()
	playerB := dialRuntimeWithClaims(t, server.URL, "game-1", 0, TicketClaims{
		UserID:      "p2",
		PlayerID:    "p2",
		GameID:      "game-1",
		Role:        "player",
		Permissions: []string{"view", "command"},
		Protocol:    "v2",
	})
	playerC := dialRuntimeWithClaims(t, server.URL, "game-1", 0, TicketClaims{
		UserID:      "p3",
		PlayerID:    "p3",
		GameID:      "game-1",
		Role:        "player",
		Permissions: []string{"view", "command"},
		Protocol:    "v2",
	})
	defer playerC.Close()

	_ = playerB.Close()
	presence := readUntil(t, playerA, "player_presence_changed")
	if presence.PlayerID != "p2" || presence.Status != "offline" {
		t.Fatalf("presence = %#v, want p2 offline", presence)
	}
	patch := readPatchWithoutResync(t, playerA)
	if patch.Version != 2 {
		t.Fatalf("disconnect vote patch version = %d, want 2", patch.Version)
	}
	if !hasPatchOp(patch.Ops, "disconnect.vote.set") {
		t.Fatalf("ops = %#v, want disconnect.vote.set", patch.Ops)
	}
	var vote map[string]any
	for _, op := range patch.Ops {
		if op["op"] == "disconnect.vote.set" {
			vote, _ = op["disconnectVote"].(map[string]any)
		}
	}
	if vote["status"] != "open" || vote["targetPlayerId"] != "p2" {
		t.Fatalf("disconnect vote = %#v, want open for p2", vote)
	}
	if runtimeServiceActorVersion(t, runtimeService, "game-1") != 2 {
		t.Fatalf("actor version did not advance for disconnect vote")
	}
	if handler.Metrics().RuntimeDisconnects != 1 {
		t.Fatalf("runtime disconnect metric = %#v, want 1", handler.Metrics())
	}
}

func TestWebSocketClosingOneOfMultiplePlayerSessionsDoesNotMarkPlayerDisconnected(t *testing.T) {
	initial := testInitialState("game-1")
	initial.Players["p3"] = map[string]any{"life": 40}
	server, runtimeService, handler := testWebSocketServerWithStateAndHandler(t, "game-1", initial, 128, 256)
	handler.disconnectVoteGrace = 20 * time.Millisecond
	defer server.Close()

	observer := dialRuntimeWithClaims(t, server.URL, "game-1", 0, TicketClaims{
		UserID: "p1", PlayerID: "p1", GameID: "game-1", Role: "player",
		Permissions: []string{"view", "command"}, Protocol: "v2",
	})
	defer observer.Close()
	firstTab := dialRuntimeWithClaims(t, server.URL, "game-1", 0, TicketClaims{
		UserID: "p2", PlayerID: "p2", GameID: "game-1", Role: "player",
		Permissions: []string{"view", "command"}, Protocol: "v2",
	})
	secondTab := dialRuntimeWithClaims(t, server.URL, "game-1", 0, TicketClaims{
		UserID: "p2", PlayerID: "p2", GameID: "game-1", Role: "player",
		Permissions: []string{"view", "command"}, Protocol: "v2",
	})
	defer secondTab.Close()

	if got := handler.countConnectionsForPlayerInGame("game-1", "p2"); got != 2 {
		t.Fatalf("p2 connections=%d want 2", got)
	}
	_ = firstTab.Close()
	deadline := time.Now().Add(time.Second)
	for handler.countConnectionsForPlayerInGame("game-1", "p2") != 1 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	time.Sleep(2 * handler.disconnectVoteGrace)
	if got := handler.countConnectionsForPlayerInGame("game-1", "p2"); got != 1 {
		t.Fatalf("p2 connections=%d want 1", got)
	}
	if version := runtimeServiceActorVersion(t, runtimeService, "game-1"); version != 1 {
		t.Fatalf("closing one tab mutated durable state to version %d", version)
	}
	if handler.Metrics().RuntimeDisconnects != 0 {
		t.Fatalf("single-tab close counted as disconnect: %#v", handler.Metrics())
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

func TestWebSocketRoutesChatMessageThroughActivityStore(t *testing.T) {
	gameID := "game-chat"
	runtimeService := runtimesvc.NewService()
	if _, _, err := runtimeService.LoadActorFromInitialState(context.Background(), gameID, testInitialState(gameID)); err != nil {
		t.Fatalf("load actor: %v", err)
	}
	validator, err := NewHMACTicketValidator(testTicketSecret)
	if err != nil {
		t.Fatalf("validator: %v", err)
	}
	store := &fakeActivityStore{}
	handler := NewWebSocketServer(validator, runtimeService, WithActivityStore(store))
	server := httptest.NewServer(handler)
	defer server.Close()

	playerA := dialRuntime(t, server.URL, gameID, 0, nil)
	defer playerA.Close()
	playerB := dialRuntimeWithClaims(t, server.URL, gameID, 0, TicketClaims{
		UserID:      "p2",
		PlayerID:    "p2",
		GameID:      gameID,
		Role:        "player",
		Permissions: []string{"view", "command"},
		Protocol:    "v2",
	})
	defer playerB.Close()

	writeCommand(t, playerA, command(gameID, 1, "chat-action", "chat.message", map[string]any{"message": "hello table"}, nil))
	for label, conn := range map[string]*websocket.Conn{"A": playerA, "B": playerB} {
		message := readUntil(t, conn, "patch.v2")
		if message.Version != 1 || message.AckClientActionID != "chat-action" {
			t.Fatalf("%s message = %#v, want same-version chat patch", label, message)
		}
		if len(message.Ops) != 1 || message.Ops[0]["op"] != "chat.message.add" {
			t.Fatalf("%s ops = %#v, want chat.message.add", label, message.Ops)
		}
		chat := message.Ops[0]["message"].(map[string]any)
		if chat["message"] != "hello table" || chat["userId"] != "p1" {
			t.Fatalf("%s chat payload = %#v", label, chat)
		}
	}
	if store.chatCommands != 1 {
		t.Fatalf("activity store chatCommands = %d, want 1", store.chatCommands)
	}
	if runtimeServiceActorVersion(t, runtimeService, gameID) != 1 {
		t.Fatalf("chat command advanced actor version")
	}
	metrics := handler.Metrics()
	if metrics.ChatMessageRoute != 1 || metrics.ChatSnapshotWriteCount != 0 {
		t.Fatalf("activity metrics = %#v, want chat route without snapshot write", metrics)
	}
}

func TestWebSocketTokenCreatePatchCarriesRenderableStaticCards(t *testing.T) {
	server, _ := testWebSocketServer(t, "game-1", 128, 256)
	defer server.Close()

	owner := dialRuntime(t, server.URL, "game-1", 0, nil)
	defer owner.Close()
	rival := dialRuntimeWithClaims(t, server.URL, "game-1", 0, TicketClaims{
		UserID:      "p2",
		PlayerID:    "p2",
		GameID:      "game-1",
		Role:        "player",
		Permissions: []string{"view"},
		Protocol:    "v2",
	})
	defer rival.Close()

	writeCommand(t, owner, command("game-1", 1, "ws-token-static", "card.token.created", map[string]any{
		"playerId": "p1",
		"quantity": 1,
		"card": map[string]any{
			"scryfallId": "token-scryfall",
			"name":       "Goblin",
			"imageUris":  map[string]any{"normal": "https://example.test/token.jpg"},
			"oracleText": "rules text must not be broadcast",
			"cardFaces":  []any{map[string]any{"name": "Goblin", "imageUris": map[string]any{"normal": "https://example.test/token-face.jpg"}, "oracleText": "face rules"}},
		},
	}, nil))

	ownerPatch := readPatchWithoutResync(t, owner)
	rivalPatch := readPatchWithoutResync(t, rival)
	for label, message := range map[string]ServerMessage{"owner": ownerPatch, "rival": rivalPatch} {
		if message.Version != 2 || message.AckClientActionID != "ws-token-static" {
			t.Fatalf("%s patch = %#v, want token create ack", label, message)
		}
		addOp := map[string]any(nil)
		for _, op := range message.Ops {
			if op["op"] == "zone.cards.add" {
				addOp = op
				break
			}
		}
		if addOp == nil {
			t.Fatalf("%s ops = %#v, want zone.cards.add", label, message.Ops)
		}
		cards := addOp["cards"].([]any)
		card := cards[0].(map[string]any)
		if card["cardKey"] != "token-scryfall:token" || card["printId"] != "token-scryfall" || card["viewerVisibility"] != "public" {
			t.Fatalf("%s token card identity = %#v", label, card)
		}
		staticCards := addOp["staticCards"].(map[string]any)
		staticCard := staticCards["token-scryfall:token"].(map[string]any)
		imageUris := staticCard["imageUris"].(map[string]any)
		if staticCard["name"] != "Goblin" || staticCard["printId"] != "token-scryfall" || imageUris["normal"] != "https://example.test/token.jpg" {
			t.Fatalf("%s static card = %#v, want renderable token identity", label, staticCard)
		}
		if strings.Contains(fmt.Sprint(message.Ops), "oracleText") {
			t.Fatalf("%s patch leaked oracle text: %#v", label, message.Ops)
		}
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

func TestLibraryWindowRejectionPayloadIsStructuredAndIdentityFree(t *testing.T) {
	command := command("game-1", 7, "stale-window", "library.selection.move", map[string]any{
		"playerId": "p1", "windowId": "lw-safe", "expectedEpoch": 3,
		"orderedInstanceIds": []string{"private-card-id"}, "toZone": "hand",
	}, nil)
	message := commandLibraryWindowRejectedMessage(command, &actor.LibraryWindowError{
		Code: actor.LibraryWindowCodeInstanceMissing, CommandType: command.Type,
		WindowID: "lw-safe", ExpectedEpoch: 3, CurrentEpoch: 4, Count: 1, Index: 0,
	})

	if message.Status != "rejected" || message.Version != 7 || message.Error == nil {
		t.Fatalf("message = %#v", message)
	}
	if message.Error.Code != actor.LibraryWindowCodeInstanceMissing || message.Error.WindowID != "lw-safe" ||
		message.Error.ExpectedEpoch == nil || *message.Error.ExpectedEpoch != 3 ||
		message.Error.CurrentEpoch == nil || *message.Error.CurrentEpoch != 4 ||
		message.Error.Count == nil || *message.Error.Count != 1 ||
		message.Error.Index == nil || *message.Error.Index != 0 {
		t.Fatalf("structured window error = %#v", message.Error)
	}
	if message.Error.InstanceID != "" || strings.Contains(fmt.Sprintf("%#v", message.Error), "private-card-id") {
		t.Fatalf("window error leaked submitted private identity: %#v", message.Error)
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

func TestWebSocketRejectsPlayerScopedCommandForDifferentSignedPlayer(t *testing.T) {
	server, runtimeService := testWebSocketServer(t, "game-1", 128, 256)
	defer server.Close()

	conn := dialRuntimeWithClaims(t, server.URL, "game-1", 0, TicketClaims{
		UserID:      "user-p1",
		PlayerID:    "p1",
		GameID:      "game-1",
		Role:        "player",
		Permissions: []string{"view", "command"},
		Protocol:    "v2",
	})
	defer conn.Close()

	writeCommand(t, conn, command("game-1", 1, "life-other", "life.changed", map[string]any{"playerId": "p2", "life": 1}, nil))
	message := readUntil(t, conn, "command_ack")
	if message.Status != "rejected" || message.Error == nil || message.Error.Code != "PERMISSION_DENIED" || message.Error.CommandType != "life.changed" {
		t.Fatalf("message = %#v, want structured permission denial", message)
	}
	if runtimeServiceActorVersion(t, runtimeService, "game-1") != 1 {
		t.Fatalf("rejected player-scoped command changed actor version")
	}
}

func TestWebSocketRejectsMixedAuthorityBatchWithoutPatchVersionOrLegacyFallback(t *testing.T) {
	initial := testInitialState("game-1")
	initial.Players["p3"] = map[string]any{"life": 40}
	initial.Instances["a1"] = state.CardInstanceRuntime{InstanceID: "a1", CardKey: "private-a@1", OwnerID: "p1", ControllerID: "p1", Zone: state.ZoneBattlefield, Position: map[string]any{"x": 0.1, "y": 0.1, "unit": "ratio"}}
	initial.Instances["c1"] = state.CardInstanceRuntime{InstanceID: "c1", CardKey: "private-c@1", OwnerID: "p3", ControllerID: "p3", Zone: state.ZoneBattlefield, Position: map[string]any{"x": 0.8, "y": 0.8, "unit": "ratio"}}
	initial.Zones["p1"] = state.PlayerZones{Battlefield: []string{"a1"}}
	initial.Zones["p3"] = state.PlayerZones{Battlefield: []string{"c1"}}
	initial.Loc["a1"] = state.Location{PlayerID: "p1", Zone: state.ZoneBattlefield, Index: 0, ControllerID: "p1"}
	initial.Loc["c1"] = state.Location{PlayerID: "p3", Zone: state.ZoneBattlefield, Index: 0, ControllerID: "p3"}

	server, runtimeService, handler := testWebSocketServerWithStateAndHandler(t, "game-1", initial, 128, 256)
	defer server.Close()
	conn := dialRuntimeWithClaims(t, server.URL, "game-1", 0, TicketClaims{
		UserID: "p1", PlayerID: "p1", GameID: "game-1", Role: "player",
		Permissions: []string{"view", "command"}, Protocol: "v2",
	})
	defer conn.Close()

	writeCommand(t, conn, command("game-1", 1, "mixed-move", "cards.moved", map[string]any{
		"playerId": "p1", "fromZone": "battlefield", "toZone": "graveyard", "instanceIds": []string{"a1", "c1"},
	}, nil))
	message := readUntil(t, conn, "command_ack")
	if message.Status != "rejected" || message.Error == nil {
		t.Fatalf("message=%#v want rejected structured ack", message)
	}
	if message.Error.Code != actor.AuthorizationCodeMixedAuthorityBatch || message.Error.CommandType != "cards.moved" || message.Error.InstanceID != "c1" || message.Error.Index == nil || *message.Error.Index != 1 {
		t.Fatalf("authorization error=%#v", message.Error)
	}
	if strings.Contains(message.Error.Message, "private-c@1") {
		t.Fatalf("authorization error leaked identity: %#v", message.Error)
	}
	gameActor, ok := runtimeService.Actor("game-1")
	if !ok {
		t.Fatal("actor missing")
	}
	snapshot := gameActor.Snapshot()
	if snapshot.Version != 1 || snapshot.Loc["a1"].Zone != state.ZoneBattlefield || snapshot.Loc["c1"].Zone != state.ZoneBattlefield {
		t.Fatalf("rejected batch mutated actor: %#v", snapshot)
	}
	if gameActor.Metrics().LegacyFallbackCount != 0 {
		t.Fatalf("rejected batch incremented legacy fallback: %#v", gameActor.Metrics())
	}
	if _, err := handler.history("game-1").Since(1); !errors.Is(err, ErrPatchHistoryGap) {
		t.Fatalf("rejected batch emitted patch history, err=%v", err)
	}
}

func TestWebSocketRejectsUnsupportedCommandWithoutLegacyFallback(t *testing.T) {
	server, runtimeService := testWebSocketServer(t, "game-1", 128, 256)
	defer server.Close()

	conn := dialRuntime(t, server.URL, "game-1", 0, nil)
	defer conn.Close()

	writeCommand(t, conn, command("game-1", 1, "unsupported-1", "legacy.only.command", map[string]any{}, nil))
	message := readUntil(t, conn, "command_ack")
	if message.Status != "rejected" || message.Error == nil || message.Error.Code != "COMMAND_FAILED" {
		t.Fatalf("message = %#v, want rejected command failure", message)
	}
	if runtimeServiceActorVersion(t, runtimeService, "game-1") != 1 {
		t.Fatalf("rejected unsupported command changed actor version")
	}
	gameActor, ok := runtimeService.Actor("game-1")
	if !ok {
		t.Fatalf("actor missing")
	}
	metrics := gameActor.Metrics()
	if metrics.LegacyFallbackCount != 0 {
		t.Fatalf("legacy fallback count got %d want 0", metrics.LegacyFallbackCount)
	}
	if metrics.UnsupportedCount != 1 {
		t.Fatalf("unsupported count got %d want 1", metrics.UnsupportedCount)
	}
}

func TestWebSocketRejectsInternalOnlyRuntimeCommands(t *testing.T) {
	server, runtimeService := testWebSocketServer(t, "game-1", 128, 256)
	defer server.Close()

	conn := dialRuntime(t, server.URL, "game-1", 0, nil)
	defer conn.Close()

	cases := []struct {
		name        string
		commandType string
		payload     map[string]any
	}{
		{name: "phase", commandType: "game.phase.set", payload: map[string]any{"phase": "FINISHED"}},
		{name: "bottomed", commandType: "mulligan.cards_bottomed", payload: map[string]any{"playerId": "p1", "bottomCardIds": []string{"h1"}}},
		{name: "ready", commandType: "mulligan.ready", payload: map[string]any{"playerId": "p1"}},
		{name: "completed", commandType: "mulligan.completed", payload: map[string]any{}},
	}
	for _, tt := range cases {
		writeCommand(t, conn, command("game-1", 1, "internal-"+tt.name, tt.commandType, tt.payload, nil))
		message := readUntil(t, conn, "command_ack")
		if message.Status != "rejected" || message.Error == nil || message.Error.Code != "PERMISSION_DENIED" {
			t.Fatalf("%s message = %#v, want permission denied", tt.commandType, message)
		}
		if runtimeServiceActorVersion(t, runtimeService, "game-1") != 1 {
			t.Fatalf("rejected internal-only command %s changed actor version", tt.commandType)
		}
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
	server, _, handler := testWebSocketServerWithStateAndHandler(t, "game-1", testInitialState("game-1"), 128, 256)
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
	metrics := handler.Metrics()
	if metrics.PatchReplayMemoryCount != 1 || metrics.PatchReplayDurableCount != 0 || metrics.PatchReplayResyncCount != 0 {
		t.Fatalf("gateway replay metrics = %#v, want memory replay only", metrics)
	}
}

func TestWebSocketPrivateOnlyPatchSendsPublicVersionCarrier(t *testing.T) {
	server, _ := testWebSocketServerWithState(t, "game-1", testReorderState("game-1"), 128, 256)
	defer server.Close()

	owner := dialRuntimeWithClaims(t, server.URL, "game-1", 0, TicketClaims{
		UserID:      "p1",
		PlayerID:    "p1",
		GameID:      "game-1",
		Role:        "player",
		Permissions: []string{"view", "command"},
		Protocol:    "v2",
	})
	defer owner.Close()
	nonOwner := dialRuntimeWithClaims(t, server.URL, "game-1", 0, TicketClaims{
		UserID:      "p2",
		PlayerID:    "p2",
		GameID:      "game-1",
		Role:        "player",
		Permissions: []string{"view", "command"},
		Protocol:    "v2",
	})
	defer nonOwner.Close()

	writeCommand(t, owner, command("game-1", 1, "face-private", "card.face.changed", map[string]any{
		"playerId":        "p1",
		"instanceId":      "h1",
		"activeFaceIndex": 1,
	}, nil))
	ownerPatch := readUntil(t, owner, "patch.v2")
	if ownerPatch.Visibility != protocol.PlayerVisibility("p1") || len(ownerPatch.Ops) == 0 || ownerPatch.Ops[0]["op"] != "card.field.set" {
		t.Fatalf("owner patch = %#v, want private card.field.set", ownerPatch)
	}
	carrier := readUntil(t, nonOwner, "patch.v2")
	if carrier.Version != 2 || carrier.Visibility != protocol.VisibilityPublic {
		t.Fatalf("carrier = %#v, want public version 2", carrier)
	}
	if len(carrier.Ops) != 1 || carrier.Ops[0]["op"] != "version.advance" {
		t.Fatalf("carrier ops = %#v, want version.advance only", carrier.Ops)
	}
	for _, key := range []string{"instanceId", "cardKey", "playerId", "zone"} {
		if _, leaked := carrier.Ops[0][key]; leaked {
			t.Fatalf("carrier leaked %s: %#v", key, carrier.Ops[0])
		}
	}

	_ = nonOwner.Close()
	reconnected := dialRuntimeWithClaims(t, server.URL, "game-1", 1, TicketClaims{
		UserID:      "p2",
		PlayerID:    "p2",
		GameID:      "game-1",
		Role:        "player",
		Permissions: []string{"view"},
		Protocol:    "v2",
	})
	defer reconnected.Close()
	replayed := readUntil(t, reconnected, "patch.v2")
	if replayed.Version != 2 || len(replayed.Ops) != 1 || replayed.Ops[0]["op"] != "version.advance" {
		t.Fatalf("replayed carrier = %#v, want version.advance without resync", replayed)
	}
}

func TestWebSocketGroupPatchRoutesBySignedViewerMask(t *testing.T) {
	game := testReorderState("game-group-audience")
	game.Players["p3"] = map[string]any{"life": 40}
	server, _ := testWebSocketServerWithState(t, "game-group-audience", game, 128, 256)
	defer server.Close()

	player := func(playerID string, mask uint64) *websocket.Conn {
		return dialRuntimeWithClaims(t, server.URL, "game-group-audience", 0, TicketClaims{
			UserID:      playerID,
			PlayerID:    playerID,
			GameID:      "game-group-audience",
			Role:        "player",
			Permissions: []string{"view", "command"},
			Protocol:    "v2",
			ViewerMask:  mask,
		})
	}
	p1 := player("p1", 1)
	defer p1.Close()
	p2 := player("p2", 2)
	defer p2.Close()
	p3 := player("p3", 4)
	defer p3.Close()

	writeCommand(t, p1, command("game-group-audience", 1, "group-reveal", "card.revealed", map[string]any{
		"playerId":   "p1",
		"instanceId": "h1",
		"to":         []any{"p2", "p1"},
	}, nil))

	for viewer, conn := range map[string]*websocket.Conn{"p1": p1, "p2": p2} {
		patch := readPatchWithoutResync(t, conn)
		entries, ok := patch.Ops[0]["entries"].([]any)
		if patch.Visibility != protocol.GroupVisibility("3") || !ok || len(entries) != 1 {
			t.Fatalf("%s patch = %#v, want authorized group identity", viewer, patch)
		}
		entry, _ := entries[0].(map[string]any)
		card, _ := entry["card"].(map[string]any)
		if patch.Ops[0]["op"] != "private.cards.materialize" || card["cardKey"] != "card:h1" {
			t.Fatalf("%s patch = %#v, want materialized group identity", viewer, patch)
		}
	}
	carrier := readPatchWithoutResync(t, p3)
	if carrier.Visibility != protocol.VisibilityPublic {
		t.Fatalf("unauthorized viewer patch = %#v, want public envelope", carrier)
	}
	for _, op := range carrier.Ops {
		if _, leaked := op["cardKey"]; leaked || op["op"] == "card.field.set" {
			t.Fatalf("unauthorized viewer received identity operation: %#v", carrier)
		}
	}
}

func TestCanReceiveGroupRequiresIntersectingServerViewerMask(t *testing.T) {
	visibility := protocol.GroupVisibility("6")
	if !canReceive(TicketClaims{ViewerMask: 2}, visibility) || !canReceive(TicketClaims{ViewerMask: 4}, visibility) {
		t.Fatal("authorized viewer mask did not receive group")
	}
	if canReceive(TicketClaims{ViewerMask: 1, Roles: []string{"group:6"}}, visibility) {
		t.Fatal("legacy client role must not authorize a non-member viewer")
	}
}

func TestWebSocketReconnectRequestsResyncOnGap(t *testing.T) {
	server, _, handler := testWebSocketServerWithStateAndHandler(t, "game-1", testInitialState("game-1"), 128, 1)
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
	if message.Reason != "retention_exceeded" {
		t.Fatalf("message = %#v, want retention resync", message)
	}
	metrics := handler.Metrics()
	if metrics.PatchReplayMemoryCount != 0 || metrics.PatchReplayDurableCount != 0 || metrics.PatchReplayResyncCount != 1 || metrics.ReconnectsRequiringSync != 1 {
		t.Fatalf("gateway replay metrics = %#v, want one explicit resync", metrics)
	}
}

func TestPatchHistoryRetentionKeepsAllEnvelopesForRetainedVersion(t *testing.T) {
	history := &patchHistory{limit: 1}
	history.Append([]protocol.PatchEnvelopeV2{
		{
			GameID:     "game-1",
			Version:    2,
			Visibility: protocol.PlayerVisibility("p1"),
			Ops:        []protocol.PatchOp{{Op: "card.field.set", Data: map[string]any{"instanceId": "h1"}}},
		},
		{
			GameID:     "game-1",
			Version:    2,
			Visibility: protocol.VisibilityPublic,
			Ops:        []protocol.PatchOp{{Op: "version.advance"}},
		},
	})
	patches, err := history.Since(1)
	if err != nil {
		t.Fatalf("history since version 1 failed: %v", err)
	}
	if len(patches) != 2 {
		t.Fatalf("patches got %d want both private and public envelopes", len(patches))
	}

	history.Append([]protocol.PatchEnvelopeV2{{
		GameID:     "game-1",
		Version:    3,
		Visibility: protocol.VisibilityPublic,
		Ops:        []protocol.PatchOp{{Op: "player.life.set", Data: map[string]any{"playerId": "p1", "value": 39}}},
	}})
	if _, err := history.Since(1); !errors.Is(err, ErrPatchHistoryGap) {
		t.Fatalf("history since evicted version err = %v, want gap", err)
	}
	patches, err = history.Since(2)
	if err != nil {
		t.Fatalf("history since version 2 failed: %v", err)
	}
	if len(patches) != 1 || patches[0].Version != 3 {
		t.Fatalf("patches = %#v, want retained version 3 only", patches)
	}
}

func TestWebSocketFirstCommandRecoversActorFromCompactSnapshotWithoutInitialState(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	saveGatewayRuntimeSnapshot(t, store, testInitialState("game-final"))
	server, runtimeService, _ := testWebSocketServerWithStoreAndHandler(t, store, 128, 256)
	defer server.Close()

	conn := dialRuntime(t, server.URL, "game-final", 0, nil)
	defer conn.Close()

	writeCommand(t, conn, command("game-final", 1, "final-life", "life.changed", map[string]any{"playerId": "p1", "life": 37}, nil))
	message := readUntil(t, conn, "patch.v2")
	if message.Version != 2 || message.AckClientActionID != "final-life" {
		t.Fatalf("message = %#v, want recovered runtime patch v2", message)
	}

	metrics := runtimeService.RuntimeMetrics()
	if metrics.InitialStatePerCommandCount != 0 {
		t.Fatalf("initial state count got %d want 0", metrics.InitialStatePerCommandCount)
	}
	if metrics.ActorCacheMissCount != 1 || metrics.ActorLoadFromSnapshotCount != 1 {
		t.Fatalf("runtime metrics = %#v, want one cache miss and one compact snapshot load", metrics)
	}
}

func TestWebSocketCacheMissRecoversCompactSnapshotAndEventLog(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	saveGatewayRuntimeSnapshot(t, store, testInitialState("game-replay"))
	if err := store.AppendEvent(context.Background(), protocol.EventPayloadV2{
		GameID:         "game-replay",
		Version:        2,
		Type:           "life.changed",
		Payload:        map[string]any{"playerId": "p1", "life": 36},
		CreatedBy:      "p1",
		ClientActionID: "seed-life",
		CreatedAt:      time.Now().UTC(),
	}); err != nil {
		t.Fatalf("append seed event: %v", err)
	}
	server, runtimeService, _ := testWebSocketServerWithStoreAndHandler(t, store, 128, 256)
	defer server.Close()

	conn := dialRuntime(t, server.URL, "game-replay", 0, nil)
	defer conn.Close()

	writeCommand(t, conn, command("game-replay", 2, "replayed-turn", "turn.changed", map[string]any{"activePlayerId": "p2"}, nil))
	message := readUntil(t, conn, "patch.v2")
	if message.Version != 3 {
		t.Fatalf("message = %#v, want version 3 after event replay", message)
	}
	gameActor, ok := runtimeService.Actor("game-replay")
	if !ok {
		t.Fatal("actor missing after recovery")
	}
	snapshot := gameActor.Snapshot()
	if snapshot.Players["p1"]["life"] != 36 || snapshot.Turn["activePlayerId"] != "p2" {
		t.Fatalf("snapshot = %#v, want event log and command applied", snapshot)
	}
	metrics := runtimeService.RuntimeMetrics()
	if metrics.ActorLoadFromSnapshotCount != 1 || metrics.ActorLoadFromEventsCount != 1 || metrics.ActorRecoveredEventCount != 1 {
		t.Fatalf("runtime metrics = %#v, want compact snapshot plus one recovered event", metrics)
	}
}

func TestWebSocketDuplicateLegacyEventMissingReceiptRequestsExplicitResync(t *testing.T) {
	gameID := "game-ws-legacy-receipt"
	store := persistence.NewInMemoryEventStore()
	saveGatewayRuntimeSnapshot(t, store, testInitialState(gameID))
	if err := store.AppendEvent(context.Background(), protocol.EventPayloadV2{
		GameID:         gameID,
		Version:        2,
		Type:           "life.changed",
		Payload:        map[string]any{"playerId": "p1", "life": 36},
		CreatedBy:      "p1",
		ClientActionID: "legacy-life",
		CreatedAt:      time.Now().UTC(),
	}); err != nil {
		t.Fatalf("append legacy event: %v", err)
	}
	server, runtimeService, _ := testWebSocketServerWithStoreAndHandler(t, store, 128, 256)
	defer server.Close()

	conn := dialRuntime(t, server.URL, gameID, 0, nil)
	defer conn.Close()

	writeCommand(t, conn, command(gameID, 1, "legacy-life", "life.changed", map[string]any{"playerId": "p1", "life": 36}, nil))
	message := readUntil(t, conn, "command_ack")
	if message.Status != "resync_required" || message.Error == nil || message.Error.Code != "PATCH_RECEIPT_MISSING" {
		t.Fatalf("message = %#v, want explicit receipt-missing resync", message)
	}
	events, err := store.EventsAfter(context.Background(), gameID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("events got %d want 1", len(events))
	}
	gameActor, ok := runtimeService.Actor(gameID)
	if !ok {
		t.Fatal("actor missing")
	}
	metrics := gameActor.Metrics()
	if metrics.DuplicateDurableCount != 1 || metrics.DuplicateReceiptMissingCount != 1 || metrics.CommandRejectedCount != 1 || metrics.CommandAppliedCount != 0 {
		t.Fatalf("receipt-missing metrics mismatch: %#v", metrics)
	}
}

func TestWebSocketReconnectReplaysPatchHistoryWithoutSnapshotReloadAfterActorEviction(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	saveGatewayRuntimeSnapshot(t, store, testInitialState("game-history"))
	server, runtimeService, handler := testWebSocketServerWithStoreAndHandler(t, store, 128, 256)
	defer server.Close()

	conn := dialRuntime(t, server.URL, "game-history", 0, nil)
	writeCommand(t, conn, command("game-history", 1, "history-life", "life.changed", map[string]any{"playerId": "p1", "life": 35}, nil))
	readUntil(t, conn, "patch.v2")
	_ = conn.Close()

	before := runtimeService.RuntimeMetrics()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := runtimeService.StopActor(ctx, "game-history"); err != nil {
		t.Fatalf("stop actor: %v", err)
	}

	reconnected := dialRuntime(t, server.URL, "game-history", 1, nil)
	defer reconnected.Close()
	message := readUntil(t, reconnected, "patch.v2")
	if message.Version != 2 || message.AckClientActionID != "history-life" {
		t.Fatalf("replayed patch = %#v, want history patch without actor reload", message)
	}
	after := runtimeService.RuntimeMetrics()
	if after.ActorLoadFromSnapshotCount != before.ActorLoadFromSnapshotCount || after.ActorCacheMissCount != before.ActorCacheMissCount {
		t.Fatalf("reconnect reloaded actor unexpectedly: before=%#v after=%#v", before, after)
	}
	gatewayMetrics := handler.Metrics()
	if gatewayMetrics.ReconnectsWithoutGap != 1 ||
		gatewayMetrics.ReconnectsRequiringSync != 0 ||
		gatewayMetrics.PatchReplayMemoryCount != 1 ||
		gatewayMetrics.PatchReplayDurableCount != 0 ||
		gatewayMetrics.PatchReplayResyncCount != 0 {
		t.Fatalf("gateway metrics = %#v, want reconnect without gap", gatewayMetrics)
	}
}

func TestWebSocketReconnectAfterRuntimeRestartReplaysDurableReceiptHistory(t *testing.T) {
	gameID := "game-durable-replay"
	store := persistence.NewInMemoryEventStore()
	saveGatewayRuntimeSnapshot(t, store, testInitialState(gameID))
	server, runtimeService, _ := testWebSocketServerWithStoreAndHandler(t, store, 128, 256)

	conn := dialRuntime(t, server.URL, gameID, 0, nil)
	writeCommand(t, conn, command(gameID, 1, "durable-life", "life.changed", map[string]any{"playerId": "p1", "life": 35}, nil))
	first := readUntil(t, conn, "patch.v2")
	if first.Version != 2 || first.AckClientActionID != "durable-life" {
		t.Fatalf("first patch = %#v, want version 2 durable-life", first)
	}
	_ = conn.Close()
	shutdownRuntimeService(t, runtimeService)
	server.Close()

	restartedServer, restartedRuntime, handler := testWebSocketServerWithStoreAndHandler(t, store, 128, 256)
	defer restartedServer.Close()
	defer shutdownRuntimeService(t, restartedRuntime)

	reconnected := dialRuntime(t, restartedServer.URL, gameID, 1, nil)
	defer reconnected.Close()
	replayed := readUntil(t, reconnected, "patch.v2")
	if replayed.Version != 2 || replayed.AckClientActionID != "durable-life" {
		t.Fatalf("durable replayed patch = %#v, want persisted version 2 patch", replayed)
	}
	metrics := handler.Metrics()
	if metrics.PatchReplayMemoryCount != 0 || metrics.PatchReplayDurableCount != 1 || metrics.PatchReplayResyncCount != 0 || metrics.ReconnectsWithoutGap != 1 {
		t.Fatalf("gateway replay metrics = %#v, want durable replay only", metrics)
	}
	if runtimeMetrics := restartedRuntime.RuntimeMetrics(); runtimeMetrics.ActorCacheMissCount != 0 || runtimeMetrics.ActorLoadFromSnapshotCount != 0 {
		t.Fatalf("durable replay should not recover actor: %#v", runtimeMetrics)
	}
}

func TestWebSocketReconnectDurableLegacyEventMissingReceiptRequestsResync(t *testing.T) {
	gameID := "game-durable-legacy"
	store := persistence.NewInMemoryEventStore()
	saveGatewayRuntimeSnapshot(t, store, testInitialState(gameID))
	if err := store.AppendEvent(context.Background(), protocol.EventPayloadV2{
		GameID:         gameID,
		Version:        2,
		Type:           "life.changed",
		Payload:        map[string]any{"playerId": "p1", "life": 36},
		CreatedBy:      "p1",
		ClientActionID: "legacy-no-receipt",
		CreatedAt:      time.Now().UTC(),
	}); err != nil {
		t.Fatalf("append legacy event: %v", err)
	}
	server, runtimeService, handler := testWebSocketServerWithStoreAndHandler(t, store, 128, 256)
	defer server.Close()
	defer shutdownRuntimeService(t, runtimeService)

	conn := dialRuntime(t, server.URL, gameID, 1, nil)
	defer conn.Close()
	message := readUntil(t, conn, "resync_required")
	if message.Reason != "patch_receipt_missing" || message.CurrentVersion != 2 {
		t.Fatalf("message = %#v, want explicit receipt-missing resync at version 2", message)
	}
	metrics := handler.Metrics()
	if metrics.PatchReplayMemoryCount != 0 || metrics.PatchReplayDurableCount != 0 || metrics.PatchReplayResyncCount != 1 || metrics.ReconnectsRequiringSync != 1 {
		t.Fatalf("gateway replay metrics = %#v, want explicit durable receipt resync", metrics)
	}
	if _, ok := runtimeService.Actor(gameID); ok {
		t.Fatal("reconnect resync should not recover actor for legacy receipt miss")
	}
}

func TestWebSocketDurableReconnectFiltersPrivatePatchForNonOwner(t *testing.T) {
	gameID := "game-durable-private"
	store := persistence.NewInMemoryEventStore()
	saveGatewayRuntimeSnapshot(t, store, testReorderState(gameID))
	server, runtimeService, _ := testWebSocketServerWithStoreAndHandler(t, store, 128, 256)

	owner := dialRuntimeWithClaims(t, server.URL, gameID, 0, TicketClaims{
		UserID:      "p1",
		PlayerID:    "p1",
		GameID:      gameID,
		Role:        "player",
		Permissions: []string{"view", "command"},
		Protocol:    "v2",
	})
	writeCommand(t, owner, command(gameID, 1, "durable-face", "card.face.changed", map[string]any{
		"instanceId": "h1",
		"faceIndex":  1,
	}, nil))
	privatePatch := readPatchWithoutResync(t, owner)
	publicCarrier := readPatchWithoutResync(t, owner)
	if privatePatch.Visibility != protocol.PlayerVisibility("p1") || publicCarrier.Visibility != protocol.VisibilityPublic {
		t.Fatalf("initial patches = %#v / %#v, want private patch plus public carrier", privatePatch, publicCarrier)
	}
	_ = owner.Close()
	shutdownRuntimeService(t, runtimeService)
	server.Close()

	restartedServer, restartedRuntime, handler := testWebSocketServerWithStoreAndHandler(t, store, 128, 256)
	defer restartedServer.Close()
	defer shutdownRuntimeService(t, restartedRuntime)
	nonOwner := dialRuntimeWithClaims(t, restartedServer.URL, gameID, 1, TicketClaims{
		UserID:      "p2",
		PlayerID:    "p2",
		GameID:      gameID,
		Role:        "player",
		Permissions: []string{"view"},
		Protocol:    "v2",
	})
	defer nonOwner.Close()

	replayed := readUntil(t, nonOwner, "patch.v2")
	if replayed.Version != 2 || replayed.Visibility != protocol.VisibilityPublic {
		t.Fatalf("durable replayed patch = %#v, want public carrier only", replayed)
	}
	if len(replayed.Ops) != 1 || replayed.Ops[0]["op"] != "version.advance" {
		t.Fatalf("durable replay carrier ops = %#v, want version.advance only", replayed.Ops)
	}
	for _, key := range []string{"instanceId", "cardKey", "playerId", "zone"} {
		if _, leaked := replayed.Ops[0][key]; leaked {
			t.Fatalf("durable replay carrier leaked %s: %#v", key, replayed.Ops[0])
		}
	}
	metrics := handler.Metrics()
	if metrics.PatchReplayDurableCount != 1 || metrics.PatchReplayResyncCount != 0 {
		t.Fatalf("gateway replay metrics = %#v, want durable replay without resync", metrics)
	}
}

func TestWebSocketRetryAfterActorEvictionRebuildsPatchReceiptWithoutDuplicateEvent(t *testing.T) {
	gameID := "game-ws-retry"
	store := persistence.NewInMemoryEventStore()
	saveGatewayRuntimeSnapshot(t, store, testReorderState(gameID))
	server, runtimeService, _ := testWebSocketServerWithStoreAndHandler(t, store, 128, 256)
	defer server.Close()

	conn := dialRuntimeWithClaims(t, server.URL, gameID, 0, TicketClaims{
		UserID:      "p1",
		PlayerID:    "p1",
		GameID:      gameID,
		Role:        "player",
		Permissions: []string{"view", "command"},
		Protocol:    "v2",
	})
	defer conn.Close()

	command := command(gameID, 1, "ws-retry-face", "card.face.changed", map[string]any{
		"playerId":   "p1",
		"instanceId": "h1",
		"faceIndex":  1,
	}, nil)
	writeCommand(t, conn, command)
	firstPrivate := readPatchWithoutResync(t, conn)
	firstCarrier := readPatchWithoutResync(t, conn)
	if firstPrivate.Version != 2 || firstPrivate.AckClientActionID != command.ClientActionID || firstPrivate.Visibility != protocol.PlayerVisibility("p1") {
		t.Fatalf("first private patch = %#v, want private version 2 ack", firstPrivate)
	}
	if firstCarrier.Version != 2 || firstCarrier.Visibility != protocol.VisibilityPublic || len(firstCarrier.Ops) != 1 || firstCarrier.Ops[0]["op"] != "version.advance" {
		t.Fatalf("first carrier = %#v, want public version.advance carrier", firstCarrier)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := runtimeService.StopActor(ctx, gameID); err != nil {
		t.Fatalf("stop actor: %v", err)
	}

	writeCommand(t, conn, command)
	retryPrivate := readPatchWithoutResync(t, conn)
	retryCarrier := readPatchWithoutResync(t, conn)
	if retryPrivate.Version != firstPrivate.Version ||
		retryPrivate.AckClientActionID != command.ClientActionID ||
		retryPrivate.Visibility != firstPrivate.Visibility ||
		fmt.Sprint(retryPrivate.Ops) != fmt.Sprint(firstPrivate.Ops) {
		t.Fatalf("retry private patch mismatch:\nretry=%#v\nfirst=%#v", retryPrivate, firstPrivate)
	}
	if retryCarrier.Version != firstCarrier.Version ||
		retryCarrier.AckClientActionID != command.ClientActionID ||
		retryCarrier.Visibility != firstCarrier.Visibility ||
		fmt.Sprint(retryCarrier.Ops) != fmt.Sprint(firstCarrier.Ops) {
		t.Fatalf("retry carrier patch mismatch:\nretry=%#v\nfirst=%#v", retryCarrier, firstCarrier)
	}
	events, err := store.EventsAfter(context.Background(), gameID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Version != 2 || events[0].ClientActionID != command.ClientActionID {
		t.Fatalf("events = %#v, want one original event only", events)
	}
	gameActor, ok := runtimeService.Actor(gameID)
	if !ok {
		t.Fatal("actor missing after retry recovery")
	}
	metrics := gameActor.Metrics()
	if metrics.DuplicateDurableCount != 1 ||
		metrics.DuplicateMemoryCount != 0 ||
		metrics.DuplicateReceiptMissingCount != 0 ||
		metrics.CommandAppliedCount != 0 ||
		metrics.LegacyFallbackCount != 0 {
		t.Fatalf("retry actor metrics mismatch: %#v", metrics)
	}
	if runtimeService.RuntimeMetrics().CommandLegacyFallbackCount != 0 {
		t.Fatalf("runtime legacy fallback metric is nonzero: %#v", runtimeService.RuntimeMetrics())
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

func testWebSocketServerWithStoreAndHandler(t *testing.T, store persistence.EventStore, queueSize int, historyLimit int) (*httptest.Server, *runtimesvc.Service, *WebSocketServer) {
	t.Helper()
	runtimeService := runtimesvc.NewServiceWithStore(store, queueSize, nil)
	validator, err := NewHMACTicketValidator(testTicketSecret)
	if err != nil {
		t.Fatalf("validator: %v", err)
	}
	handler := NewWebSocketServer(validator, runtimeService, WithConnectionQueueSize(queueSize), WithPatchHistoryLimit(historyLimit))
	return httptest.NewServer(handler), runtimeService, handler
}

func shutdownRuntimeService(t *testing.T, runtimeService *runtimesvc.Service) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := runtimeService.Shutdown(ctx); err != nil {
		t.Fatalf("shutdown runtime service: %v", err)
	}
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

func readPatchWithoutResync(t *testing.T, conn *websocket.Conn) ServerMessage {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	if err := conn.SetReadDeadline(deadline); err != nil {
		t.Fatalf("set deadline: %v", err)
	}
	seen := []string{}
	for {
		var message ServerMessage
		err := conn.ReadJSON(&message)
		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				t.Fatalf("timed out waiting for patch.v2 without resync; seen=%v", seen)
			}
			t.Fatalf("read websocket message: %v", err)
		}
		switch message.Kind {
		case "patch.v2":
			return message
		case "resync_required":
			t.Fatalf("unexpected resync_required while waiting for patch: %#v", message)
		case "command_ack":
			if message.Status == "resync_required" || message.Status == "rejected" {
				t.Fatalf("unexpected command_ack while waiting for patch: %#v", message)
			}
		case "error":
			t.Fatalf("unexpected websocket error while waiting for patch: %#v", message)
		}
		seen = append(seen, message.Kind)
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

func saveGatewayRuntimeSnapshot(t *testing.T, store persistence.EventStore, gameState state.GameState) {
	t.Helper()
	snapshot, err := persistence.NewCompactSnapshot(gameState)
	if err != nil {
		t.Fatalf("compact snapshot: %v", err)
	}
	if err := store.SaveSnapshot(context.Background(), snapshot); err != nil {
		t.Fatalf("save snapshot: %v", err)
	}
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

type fakeActivityStore struct {
	chatCommands int
}

func (s *fakeActivityStore) AppendChatMessage(_ context.Context, gameID string, claims TicketClaims, command protocol.CommandEnvelopeV2, version int64) ([]protocol.PatchEnvelopeV2, error) {
	s.chatCommands++
	return []protocol.PatchEnvelopeV2{{
		GameID:            gameID,
		Version:           version,
		Visibility:        protocol.VisibilityPublic,
		AckClientActionID: command.ClientActionID,
		Ops: []protocol.PatchOp{{
			Op: "chat.message.add",
			Data: map[string]any{
				"message": map[string]any{
					"id":          "chat-test",
					"userId":      claims.PlayerID,
					"displayName": claims.PlayerID,
					"message":     command.Payload["message"],
					"createdAt":   "2026-01-01T00:00:00Z",
					"reactions":   map[string]any{},
				},
			},
		}},
	}}, nil
}

func (s *fakeActivityStore) ToggleChatReaction(context.Context, string, TicketClaims, protocol.CommandEnvelopeV2, int64) ([]protocol.PatchEnvelopeV2, error) {
	return nil, errors.New("unexpected reaction")
}

func (s *fakeActivityStore) AppendLogEntries(context.Context, string, []map[string]any) error {
	return nil
}

func (s *fakeActivityStore) Close() error {
	return nil
}

func runtimeServiceActorVersion(t *testing.T, runtimeService *runtimesvc.Service, gameID string) int64 {
	t.Helper()
	gameActor, ok := runtimeService.Actor(gameID)
	if !ok {
		t.Fatalf("actor missing")
	}
	return gameActor.Version()
}
