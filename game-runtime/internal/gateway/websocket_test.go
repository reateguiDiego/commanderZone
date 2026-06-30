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

	"commanderzone/game-runtime/internal/persistence"
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
	if message.Status != "rejected" || message.Error == nil || message.Error.Code != "COMMAND_FAILED" {
		t.Fatalf("message = %#v, want rejected command failure", message)
	}
	if runtimeServiceActorVersion(t, runtimeService, "game-1") != 1 {
		t.Fatalf("rejected player-scoped command changed actor version")
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

func runtimeServiceActorVersion(t *testing.T, runtimeService *runtimesvc.Service, gameID string) int64 {
	t.Helper()
	gameActor, ok := runtimeService.Actor(gameID)
	if !ok {
		t.Fatalf("actor missing")
	}
	return gameActor.Version()
}
