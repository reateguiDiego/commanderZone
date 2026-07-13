package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"commanderzone/game-runtime/internal/actor"
	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	runtimesvc "commanderzone/game-runtime/internal/runtime"

	"github.com/gorilla/websocket"
)

const (
	defaultConnectionQueueSize = 64
	defaultPatchHistoryLimit   = 256
	defaultCommandTimeout      = 3 * time.Second
)

var (
	ErrConnectionQueueFull          = errors.New("websocket connection queue full")
	ErrPatchHistoryGap              = errors.New("patch history gap")
	ErrPatchReplayRetentionExceeded = errors.New("patch replay retention exceeded")
	ErrPatchReplayReceiptMismatch   = errors.New("patch replay receipt does not match event")
	ErrRateLimited                  = errors.New("command rate limited")
)

type ClientMessage struct {
	Kind           string                      `json:"kind,omitempty"`
	Type           string                      `json:"type,omitempty"`
	MessageID      string                      `json:"messageId,omitempty"`
	GameID         string                      `json:"gameId,omitempty"`
	BaseVersion    int64                       `json:"baseVersion,omitempty"`
	ClientActionID string                      `json:"clientActionId,omitempty"`
	Payload        map[string]any              `json:"payload,omitempty"`
	Client         map[string]any              `json:"client,omitempty"`
	Command        *protocol.CommandEnvelopeV2 `json:"command,omitempty"`
	SentAt         string                      `json:"sentAt,omitempty"`
	BottomCardIDs  []string                    `json:"bottomCardInstanceIds,omitempty"`
	Destination    string                      `json:"destination,omitempty"`
}

type ServerMessage struct {
	Kind               string              `json:"kind"`
	GameID             string              `json:"gameId,omitempty"`
	MessageID          string              `json:"messageId,omitempty"`
	ConnectionID       string              `json:"connectionId,omitempty"`
	Status             string              `json:"status,omitempty"`
	ServerTime         string              `json:"serverTime,omitempty"`
	Version            int64               `json:"version,omitempty"`
	CurrentVersion     int64               `json:"currentVersion,omitempty"`
	Reason             string              `json:"reason,omitempty"`
	Visibility         protocol.Visibility `json:"visibility,omitempty"`
	Ops                []map[string]any    `json:"ops,omitempty"`
	AckClientActionID  string              `json:"ackClientActionId,omitempty"`
	ClientActionID     string              `json:"clientActionId,omitempty"`
	Error              *ServerErrorPayload `json:"error,omitempty"`
	DroppedEphemeral   bool                `json:"droppedEphemeral,omitempty"`
	CoalescedEphemeral bool                `json:"coalescedEphemeral,omitempty"`
	SentAt             string              `json:"sentAt,omitempty"`
	PlayerID           string              `json:"playerId,omitempty"`
	DisplayName        string              `json:"displayName,omitempty"`
	ChangedAt          string              `json:"changedAt,omitempty"`
}

type ServerErrorPayload struct {
	Code             string `json:"code"`
	Message          string `json:"message"`
	Retryable        bool   `json:"retryable"`
	CommandType      string `json:"commandType,omitempty"`
	InstanceID       string `json:"instanceId,omitempty"`
	Index            *int   `json:"index,omitempty"`
	VoteID           string `json:"voteId,omitempty"`
	TargetPlayerID   string `json:"targetPlayerId,omitempty"`
	RemainingSeconds int    `json:"remainingSeconds,omitempty"`
}

type WebSocketServer struct {
	validator TicketValidator
	runtime   *runtimesvc.Service
	activity  ActivityStore
	upgrader  websocket.Upgrader

	mu           sync.RWMutex
	rooms        map[string]map[*wsClient]struct{}
	histories    map[string]*patchHistory
	offlineSince map[string]map[string]time.Time

	connectionQueueSize int
	commandTimeout      time.Duration
	patchHistoryLimit   int
	disconnectVoteGrace time.Duration

	metricsMu sync.Mutex
	metrics   GatewayMetrics
}

type GatewayMetrics struct {
	DroppedEphemeralEvents  int64
	CoalescedPositionEvents int64
	RateLimitedCommands     int64
	ConnectionBackpressure  int64
	ReconnectsWithoutGap    int64
	ReconnectsRequiringSync int64
	PatchReplayMemoryCount  int64
	PatchReplayDurableCount int64
	PatchReplayResyncCount  int64
	RuntimeDisconnects      int64
	DisconnectPresenceSkip  int64            `json:"disconnect.presence_skip_count"`
	GameplayWSRoute         map[string]int64 `json:"gameplay.ws.route,omitempty"`
	ChatMessageRoute        int64            `json:"chat.message_route"`
	ChatReactionRoute       int64            `json:"chat.reaction_route"`
	ChatSnapshotWriteCount  int64            `json:"chat.snapshot_write_count"`
	GameLogRuntimeRoute     int64            `json:"gamelog.runtime_route"`
	GameLogSnapshotWrites   int64            `json:"gamelog.snapshot_write_count"`
}

type WebSocketOption func(*WebSocketServer)

func WithConnectionQueueSize(size int) WebSocketOption {
	return func(s *WebSocketServer) {
		if size > 0 {
			s.connectionQueueSize = size
		}
	}
}

func WithPatchHistoryLimit(limit int) WebSocketOption {
	return func(s *WebSocketServer) {
		if limit > 0 {
			s.patchHistoryLimit = limit
		}
	}
}

func WithDisconnectVoteGrace(grace time.Duration) WebSocketOption {
	return func(s *WebSocketServer) {
		if grace > 0 {
			s.disconnectVoteGrace = grace
		}
	}
}

func WithCommandTimeout(timeout time.Duration) WebSocketOption {
	return func(s *WebSocketServer) {
		if timeout > 0 {
			s.commandTimeout = timeout
		}
	}
}

func WithActivityStore(store ActivityStore) WebSocketOption {
	return func(s *WebSocketServer) {
		s.activity = store
	}
}

func NewWebSocketServer(validator TicketValidator, runtime *runtimesvc.Service, opts ...WebSocketOption) *WebSocketServer {
	server := &WebSocketServer{
		validator:           validator,
		runtime:             runtime,
		rooms:               map[string]map[*wsClient]struct{}{},
		histories:           map[string]*patchHistory{},
		offlineSince:        map[string]map[string]time.Time{},
		connectionQueueSize: defaultConnectionQueueSize,
		commandTimeout:      defaultCommandTimeout,
		patchHistoryLimit:   defaultPatchHistoryLimit,
		disconnectVoteGrace: 5 * time.Second,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(_ *http.Request) bool { return true },
		},
	}
	for _, opt := range opts {
		opt(server)
	}
	return server
}

func (s *WebSocketServer) Metrics() GatewayMetrics {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	return s.metrics
}

func (s *WebSocketServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ticket := r.URL.Query().Get("ticket")
	claims, err := s.validator.ValidateTicket(r.Context(), ticket)
	if err != nil {
		http.Error(w, "invalid ticket", http.StatusUnauthorized)
		return
	}
	if strings.TrimSpace(claims.PlayerID) == "" {
		claims.PlayerID = claims.UserID
	}
	if strings.TrimSpace(claims.GameID) == "" {
		http.Error(w, "ticket missing gameId", http.StatusUnauthorized)
		return
	}
	s.incMetric(func(metrics *GatewayMetrics) {
		if metrics.GameplayWSRoute == nil {
			metrics.GameplayWSRoute = map[string]int64{}
		}
		metrics.GameplayWSRoute["runtime_ws"]++
	})

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	client := &wsClient{
		server:  s,
		conn:    conn,
		claims:  claims,
		send:    make(chan []byte, s.connectionQueueSize),
		limiter: newCommandRateLimiter(),
		done:    make(chan struct{}),
	}
	registered := s.register(client)
	if registered.WasOfflineBeyondGrace {
		s.broadcastPresence(client.claims.GameID, client.playerID(), "online")
		go s.submitDisconnectPresence(context.Background(), client.claims.GameID, client.playerID(), "online", registered.ConnectedPlayerIDs, "")
	}
	go s.resolveExpiredDisconnectVoteOnWake(client.claims.GameID)
	defer func() {
		left := s.unregister(client)
		if left.PlayerID == "" {
			return
		}
		if left.UserConnections == 0 {
			s.broadcastPresence(left.GameID, left.PlayerID, "offline")
			s.scheduleDisconnectVoteOpen(left.GameID, left.PlayerID)
		}
	}()

	s.sendJSON(client, ServerMessage{
		Kind:       "connection_state",
		GameID:     claims.GameID,
		Status:     "connected",
		ServerTime: time.Now().UTC().Format(time.RFC3339Nano),
	})

	lastApplied := parseLastAppliedVersion(r)
	s.replayOrRequestResync(r.Context(), client, lastApplied)

	go client.writeLoop()
	client.readLoop()
}

type presenceRegistration struct {
	ConnectedPlayerIDs    []string
	WasOfflineBeyondGrace bool
	UserConnections       int
}

type presenceUnregistration struct {
	GameID          string
	PlayerID        string
	UserConnections int
}

func (s *WebSocketServer) register(client *wsClient) presenceRegistration {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rooms[client.claims.GameID] == nil {
		s.rooms[client.claims.GameID] = map[*wsClient]struct{}{}
	}
	playerID := client.playerID()
	wasOfflineBeyondGrace := false
	if offlineAt, ok := s.offlineSince[client.claims.GameID][playerID]; ok {
		wasOfflineBeyondGrace = time.Since(offlineAt) >= s.disconnectVoteGrace
		delete(s.offlineSince[client.claims.GameID], playerID)
	}
	s.rooms[client.claims.GameID][client] = struct{}{}
	return presenceRegistration{
		ConnectedPlayerIDs:    s.connectedPlayerIDsForGameLocked(client.claims.GameID),
		WasOfflineBeyondGrace: wasOfflineBeyondGrace,
		UserConnections:       s.countConnectionsForPlayerInGameLocked(client.claims.GameID, playerID),
	}
}

func (s *WebSocketServer) unregister(client *wsClient) presenceUnregistration {
	s.mu.Lock()
	defer s.mu.Unlock()
	playerID := client.playerID()
	if room := s.rooms[client.claims.GameID]; room != nil {
		delete(room, client)
		if len(room) == 0 {
			delete(s.rooms, client.claims.GameID)
		}
	}
	userConnections := s.countConnectionsForPlayerInGameLocked(client.claims.GameID, playerID)
	if userConnections == 0 {
		if s.offlineSince[client.claims.GameID] == nil {
			s.offlineSince[client.claims.GameID] = map[string]time.Time{}
		}
		if _, ok := s.offlineSince[client.claims.GameID][playerID]; !ok {
			s.offlineSince[client.claims.GameID][playerID] = time.Now()
		}
		s.incMetric(func(metrics *GatewayMetrics) { metrics.RuntimeDisconnects++ })
	}
	close(client.done)
	_ = client.conn.Close()
	return presenceUnregistration{GameID: client.claims.GameID, PlayerID: playerID, UserConnections: userConnections}
}

func (s *WebSocketServer) broadcastPresence(gameID string, playerID string, status string) {
	s.broadcastServerMessage(gameID, ServerMessage{
		Kind:        "player_presence_changed",
		GameID:      gameID,
		PlayerID:    playerID,
		DisplayName: playerID,
		Status:      status,
		ChangedAt:   time.Now().UTC().Format(time.RFC3339Nano),
	})
}

func (s *WebSocketServer) broadcastServerMessage(gameID string, message ServerMessage) {
	s.mu.RLock()
	clients := make([]*wsClient, 0, len(s.rooms[gameID]))
	for client := range s.rooms[gameID] {
		clients = append(clients, client)
	}
	s.mu.RUnlock()
	for _, client := range clients {
		s.sendJSON(client, message)
	}
}

func (s *WebSocketServer) scheduleDisconnectVoteOpen(gameID string, playerID string) {
	grace := s.disconnectVoteGrace
	time.AfterFunc(grace, func() {
		if !s.isPlayerOfflineBeyondGrace(gameID, playerID, grace) {
			return
		}
		s.submitDisconnectPresence(context.Background(), gameID, playerID, "offline", s.connectedPlayerIDsForGame(gameID), "")
	})
}

func (s *WebSocketServer) submitDisconnectPresence(ctx context.Context, gameID string, playerID string, status string, connectedPlayerIDs []string, voteID string) {
	gameActor, _, err := s.runtime.LoadActorRecovered(ctx, gameID, nil)
	if err != nil {
		slog.Warn("runtime websocket disconnect vote actor load failed", "gameId", gameID, "playerId", playerID, "status", status, "error", err)
		return
	}
	baseVersion := gameActor.Version()
	if baseVersion < 1 {
		baseVersion = 1
	}
	command := protocol.CommandEnvelopeV2{
		GameID:         gameID,
		BaseVersion:    baseVersion,
		ClientActionID: fmt.Sprintf("runtime-presence-%s-%s-%d", status, playerID, time.Now().UnixNano()),
		Type:           "disconnect.vote",
		Payload: map[string]any{
			"targetPlayerId":        playerID,
			"status":                status,
			"connectedUserIds":      connectedPlayerIDs,
			"activeConnectionCount": s.countConnectionsForPlayerInGame(gameID, playerID),
			"occurredAt":            time.Now().UTC().Format(time.RFC3339Nano),
		},
		Client: map[string]any{"source": "runtime_ws_presence"},
	}
	if voteID != "" {
		command.Payload["voteId"] = voteID
		command.ClientActionID = "runtime-disconnect-timeout-" + voteID
	}
	commandCtx, cancel := context.WithTimeout(ctx, s.commandTimeout)
	defer cancel()
	result := gameActor.Submit(commandCtx, command, "")
	if result.Err != nil {
		if isBenignDisconnectPresenceError(result.Err) {
			s.incMetric(func(metrics *GatewayMetrics) { metrics.DisconnectPresenceSkip++ })
			slog.Info("runtime websocket disconnect vote skipped stale presence update", "gameId", gameID, "playerId", playerID, "status", status, "error", result.Err)
			return
		}
		slog.Warn("runtime websocket disconnect vote command failed", "gameId", gameID, "playerId", playerID, "status", status, "error", result.Err)
		return
	}
	s.history(gameID).Append(result.Patches)
	s.broadcast(gameID, result.Patches)
	if result.Event.Type == "disconnect.vote.opened" {
		s.scheduleDurableDisconnectVoteTimeout(gameID, result.Event.Payload)
	}
}

func (s *WebSocketServer) scheduleDurableDisconnectVoteTimeout(gameID string, payload map[string]any) {
	vote, _ := payload["disconnectVote"].(map[string]any)
	targetID, _ := vote["targetPlayerId"].(string)
	voteID, _ := vote["voteId"].(string)
	expiresText, _ := vote["expiresAt"].(string)
	expiresAt, err := time.Parse(time.RFC3339Nano, expiresText)
	if err != nil || targetID == "" || voteID == "" {
		return
	}
	delay := time.Until(expiresAt)
	if delay < 0 {
		delay = 0
	}
	// Never submit the durable timeout on the expiry boundary: scheduler and
	// RFC3339Nano timestamps can otherwise observe the command a few ticks early.
	delay += 25 * time.Millisecond
	time.AfterFunc(delay, func() {
		s.submitDisconnectPresence(context.Background(), gameID, targetID, "timeout", s.connectedPlayerIDsForGame(gameID), voteID)
	})
}

func (s *WebSocketServer) resolveExpiredDisconnectVoteOnWake(gameID string) {
	gameActor, ok := s.runtime.Actor(gameID)
	if !ok {
		return
	}
	snapshot := gameActor.Snapshot()
	if snapshot.DisconnectVote["status"] != "open" {
		return
	}
	payload := map[string]any{"disconnectVote": snapshot.DisconnectVote}
	s.scheduleDurableDisconnectVoteTimeout(gameID, payload)
}

func isBenignDisconnectPresenceError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, persistence.ErrDuplicateVersion) || errors.Is(err, persistence.ErrGameNotFound) {
		return true
	}
	if controlError, ok := actor.AsControlPlaneError(err); ok {
		return controlError.Code == "VOTE_NOT_OPEN" || controlError.Code == "VOTE_NOT_FOUND" || controlError.Code == "GAME_CLOSED"
	}
	return false
}

func (s *WebSocketServer) isPlayerOfflineBeyondGrace(gameID string, playerID string, grace time.Duration) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.countConnectionsForPlayerInGameLocked(gameID, playerID) > 0 {
		return false
	}
	offlineAt, ok := s.offlineSince[gameID][playerID]
	return ok && time.Since(offlineAt) >= grace
}

func (s *WebSocketServer) connectedPlayerIDsForGame(gameID string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.connectedPlayerIDsForGameLocked(gameID)
}

func (s *WebSocketServer) connectedPlayerIDsForGameLocked(gameID string) []string {
	seen := map[string]struct{}{}
	for client := range s.rooms[gameID] {
		playerID := client.playerID()
		if playerID != "" {
			seen[playerID] = struct{}{}
		}
	}
	playerIDs := make([]string, 0, len(seen))
	for playerID := range seen {
		playerIDs = append(playerIDs, playerID)
	}
	sort.Strings(playerIDs)
	return playerIDs
}

func (s *WebSocketServer) countConnectionsForPlayerInGameLocked(gameID string, playerID string) int {
	count := 0
	for client := range s.rooms[gameID] {
		if client.playerID() == playerID {
			count++
		}
	}
	return count
}

func (s *WebSocketServer) countConnectionsForPlayerInGame(gameID string, playerID string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.countConnectionsForPlayerInGameLocked(gameID, playerID)
}

func (s *WebSocketServer) replayOrRequestResync(ctx context.Context, client *wsClient, lastAppliedVersion int64) {
	if lastAppliedVersion <= 0 {
		return
	}
	gameID := client.claims.GameID
	currentVersion := int64(0)
	gameActor, ok := s.runtime.Actor(client.claims.GameID)
	if ok {
		currentVersion = gameActor.Version()
		if lastAppliedVersion >= currentVersion {
			s.incMetric(func(metrics *GatewayMetrics) { metrics.ReconnectsWithoutGap++ })
			slog.Debug("runtime websocket reconnect already current", "gameId", gameID, "lastAppliedVersion", lastAppliedVersion, "currentVersion", currentVersion)
			return
		}
	}

	if patches, err := s.history(gameID).Since(lastAppliedVersion); err == nil {
		s.sendReplayPatches(client, patches)
		s.incMetric(func(metrics *GatewayMetrics) {
			metrics.ReconnectsWithoutGap++
			metrics.PatchReplayMemoryCount++
		})
		slog.Debug("runtime websocket reconnect replayed patches", "gameId", gameID, "source", "memory", "lastAppliedVersion", lastAppliedVersion, "patches", len(patches))
		return
	}

	patches, durableCurrentVersion, err := s.durablePatchesSince(ctx, gameID, lastAppliedVersion)
	if durableCurrentVersion > currentVersion {
		currentVersion = durableCurrentVersion
	}
	if err != nil {
		reason := replayResyncReason(err)
		s.sendJSON(client, resyncRequiredMessage(gameID, currentVersion, reason))
		s.incMetric(func(metrics *GatewayMetrics) {
			metrics.ReconnectsRequiringSync++
			metrics.PatchReplayResyncCount++
		})
		slog.Warn("runtime websocket reconnect requires resync", "gameId", gameID, "lastAppliedVersion", lastAppliedVersion, "currentVersion", currentVersion, "reason", reason, "error", err)
		return
	}
	if len(patches) == 0 {
		if currentVersion > 0 && lastAppliedVersion < currentVersion {
			s.sendJSON(client, resyncRequiredMessage(gameID, currentVersion, "version_gap"))
			s.incMetric(func(metrics *GatewayMetrics) {
				metrics.ReconnectsRequiringSync++
				metrics.PatchReplayResyncCount++
			})
			slog.Warn("runtime websocket reconnect requires resync", "gameId", gameID, "lastAppliedVersion", lastAppliedVersion, "currentVersion", currentVersion, "reason", "version_gap")
			return
		}
		s.incMetric(func(metrics *GatewayMetrics) { metrics.ReconnectsWithoutGap++ })
		slog.Debug("runtime websocket reconnect found no missing patches", "gameId", gameID, "lastAppliedVersion", lastAppliedVersion)
		return
	}
	s.sendReplayPatches(client, patches)
	s.incMetric(func(metrics *GatewayMetrics) {
		metrics.ReconnectsWithoutGap++
		metrics.PatchReplayDurableCount++
	})
	slog.Debug("runtime websocket reconnect replayed patches", "gameId", gameID, "source", "durable", "lastAppliedVersion", lastAppliedVersion, "currentVersion", currentVersion, "patches", len(patches))
}

func (s *WebSocketServer) sendReplayPatches(client *wsClient, patches []protocol.PatchEnvelopeV2) {
	for _, patch := range patches {
		s.sendPatchIfVisible(client, patch)
	}
}

func (s *WebSocketServer) durablePatchesSince(ctx context.Context, gameID string, lastAppliedVersion int64) ([]protocol.PatchEnvelopeV2, int64, error) {
	events, err := s.runtime.EventsAfter(ctx, gameID, lastAppliedVersion)
	if err != nil {
		return nil, 0, err
	}
	if len(events) == 0 {
		return nil, lastAppliedVersion, nil
	}
	currentVersion := events[len(events)-1].Version
	if s.patchHistoryLimit > 0 && len(events) > s.patchHistoryLimit {
		return nil, currentVersion, ErrPatchReplayRetentionExceeded
	}

	expectedVersion := lastAppliedVersion + 1
	patches := make([]protocol.PatchEnvelopeV2, 0, len(events))
	for _, event := range events {
		if event.Version != expectedVersion {
			return nil, event.Version, ErrPatchHistoryGap
		}
		receiptPatches, ok, err := actor.RuntimePatchReceiptFromEvent(event)
		if err != nil {
			return nil, event.Version, err
		}
		if !ok {
			return nil, event.Version, actor.ErrRuntimePatchReceiptMissing
		}
		for _, patch := range receiptPatches {
			if patch.GameID != event.GameID || patch.Version != event.Version {
				return nil, event.Version, ErrPatchReplayReceiptMismatch
			}
		}
		patches = append(patches, receiptPatches...)
		expectedVersion++
	}
	return patches, currentVersion, nil
}

func replayResyncReason(err error) string {
	switch {
	case errors.Is(err, ErrPatchReplayRetentionExceeded):
		return "retention_exceeded"
	case errors.Is(err, actor.ErrRuntimePatchReceiptMissing):
		return "patch_receipt_missing"
	default:
		return "version_gap"
	}
}

func (s *WebSocketServer) handleCommand(ctx context.Context, client *wsClient, command protocol.CommandEnvelopeV2) {
	if command.GameID != client.claims.GameID {
		s.sendJSON(client, errorMessage(client.claims.GameID, "", command.ClientActionID, "GAME_ID_MISMATCH", ErrTicketGameMismatch.Error(), false))
		return
	}
	if !hasPermission(client.claims, "command") {
		s.sendJSON(client, commandRejectedMessage(command, "PERMISSION_DENIED", "runtime ticket does not allow gameplay commands", false))
		return
	}
	if command.Type == "game.close" && !hasPermission(client.claims, "game.close") {
		s.sendJSON(client, commandRejectedMessage(command, "PERMISSION_DENIED", "runtime ticket does not allow closing this game", false))
		return
	}
	if isInternalOnlyWebSocketCommand(command.Type) {
		s.sendJSON(client, commandRejectedMessage(command, "PERMISSION_DENIED", "runtime command is internal-only over websocket", false))
		return
	}
	if command.Type == "chat.message" || command.Type == "chat.reaction.toggled" {
		s.handleActivityCommand(ctx, client, command)
		return
	}
	if isEphemeralPosition(command) {
		s.incMetric(func(metrics *GatewayMetrics) {
			metrics.DroppedEphemeralEvents++
			metrics.CoalescedPositionEvents++
		})
		s.sendJSON(client, ServerMessage{
			Kind:               "command_ack",
			GameID:             command.GameID,
			ClientActionID:     command.ClientActionID,
			Status:             "duplicate",
			Version:            command.BaseVersion,
			DroppedEphemeral:   true,
			CoalescedEphemeral: true,
		})
		return
	}
	if !client.limiter.Allow(command.Type) {
		s.incMetric(func(metrics *GatewayMetrics) { metrics.RateLimitedCommands++ })
		s.sendJSON(client, commandRejectedMessage(command, "RATE_LIMITED", ErrRateLimited.Error(), true))
		return
	}
	if err := command.Validate(); err != nil {
		s.sendJSON(client, commandRejectedMessage(command, "INVALID_COMMAND", err.Error(), false))
		return
	}
	if command.Type == "disconnect.vote" {
		command.Payload = clonePayload(command.Payload)
		command.Payload["playerId"] = client.playerID()
		command.Payload["connectedUserIds"] = s.connectedPlayerIDsForGame(command.GameID)
		if command.Client == nil {
			command.Client = map[string]any{}
		}
		command.Client["playerId"] = client.playerID()
	}

	gameActor, _, err := s.runtime.LoadActorRecovered(ctx, command.GameID, nil)
	if err != nil {
		if errors.Is(err, runtimesvc.ErrOwnershipNotHeld) {
			s.sendJSON(client, commandRejectedMessage(command, "OWNERSHIP_NOT_HELD", err.Error(), false))
			return
		}
		s.sendJSON(client, commandRejectedMessage(command, "ACTOR_RECOVERY_FAILED", err.Error(), true))
		return
	}
	if vote := gameActor.Snapshot().DisconnectVote; vote["status"] == "open" {
		expiresAt, parseErr := time.Parse(time.RFC3339Nano, firstGatewayString(vote["expiresAt"], vote["deadlineAt"]))
		if parseErr == nil && !time.Now().Before(expiresAt) {
			s.submitDisconnectPresence(ctx, command.GameID, firstGatewayString(vote["targetPlayerId"]), "timeout", s.connectedPlayerIDsForGame(command.GameID), firstGatewayString(vote["voteId"]))
		} else {
			s.scheduleDurableDisconnectVoteTimeout(command.GameID, map[string]any{"disconnectVote": vote})
		}
	}
	commandCtx, cancel := context.WithTimeout(ctx, s.commandTimeout)
	defer cancel()
	result := gameActor.Submit(commandCtx, command, client.claims.PlayerID)
	if result.Err != nil {
		if errors.Is(result.Err, actor.ErrVersionConflict) {
			s.sendJSON(client, commandResyncRequiredMessage(command, gameActor.Version(), "BASE_VERSION_MISMATCH", result.Err.Error(), true))
			return
		}
		if errors.Is(result.Err, actor.ErrRuntimePatchReceiptMissing) {
			s.sendJSON(client, commandResyncRequiredMessage(command, gameActor.Version(), "PATCH_RECEIPT_MISSING", result.Err.Error(), false))
			return
		}
		if errors.Is(result.Err, runtimesvc.ErrOwnershipNotHeld) {
			s.sendJSON(client, commandRejectedMessage(command, "OWNERSHIP_NOT_HELD", result.Err.Error(), false))
			return
		}
		if authorizationError, ok := actor.AsAuthorizationError(result.Err); ok {
			s.sendJSON(client, commandAuthorizationRejectedMessage(command, authorizationError))
			return
		}
		if errors.Is(result.Err, actor.ErrActorPermission) {
			s.sendJSON(client, commandAuthorizationRejectedMessage(command, &actor.AuthorizationError{
				Code:        actor.AuthorizationCodePermissionDenied,
				CommandType: command.Type,
			}))
			return
		}
		if controlError, ok := actor.AsControlPlaneError(result.Err); ok {
			s.sendJSON(client, commandControlPlaneRejectedMessage(command, controlError))
			return
		}
		s.sendJSON(client, commandRejectedMessage(command, "COMMAND_FAILED", result.Err.Error(), false))
		return
	}
	if s.activity != nil {
		if entries := eventLogEntriesFromPayload(result.Event.Payload); len(entries) > 0 {
			if err := s.activity.AppendLogEntries(ctx, command.GameID, entries); err != nil {
				slog.Warn("runtime activity log persist failed", "gameId", command.GameID, "clientActionId", command.ClientActionID, "error", err)
			} else {
				s.incMetric(func(metrics *GatewayMetrics) { metrics.GameLogRuntimeRoute += int64(len(entries)) })
			}
		}
	}
	s.history(command.GameID).Append(result.Patches)
	s.broadcast(command.GameID, result.Patches)
}

func commandControlPlaneRejectedMessage(command protocol.CommandEnvelopeV2, controlError *actor.ControlPlaneError) ServerMessage {
	return ServerMessage{
		Kind: "command_ack", GameID: command.GameID, ClientActionID: command.ClientActionID,
		Status: "rejected", Version: command.BaseVersion,
		Error: &ServerErrorPayload{
			Code: controlError.Code, Message: controlError.Error(), CommandType: controlError.CommandType,
			VoteID: controlError.VoteID, TargetPlayerID: controlError.TargetPlayerID,
			RemainingSeconds: controlError.RemainingSeconds,
		},
	}
}

func (s *WebSocketServer) handleActivityCommand(ctx context.Context, client *wsClient, command protocol.CommandEnvelopeV2) {
	if s.activity == nil {
		s.sendJSON(client, commandRejectedMessage(command, "ACTIVITY_STREAM_UNAVAILABLE", errActivityUnavailable.Error(), true))
		return
	}
	if err := command.Validate(); err != nil {
		s.sendJSON(client, commandRejectedMessage(command, "INVALID_COMMAND", err.Error(), false))
		return
	}
	version := s.currentActorVersion(command.GameID)
	var (
		patches []protocol.PatchEnvelopeV2
		err     error
	)
	switch command.Type {
	case "chat.message":
		patches, err = s.activity.AppendChatMessage(ctx, command.GameID, client.claims, command, version)
	case "chat.reaction.toggled":
		patches, err = s.activity.ToggleChatReaction(ctx, command.GameID, client.claims, command, version)
	default:
		err = errActivityUnavailable
	}
	if err != nil {
		s.sendJSON(client, commandRejectedMessage(command, "COMMAND_FAILED", err.Error(), false))
		return
	}
	s.incMetric(func(metrics *GatewayMetrics) {
		if command.Type == "chat.message" {
			metrics.ChatMessageRoute++
		}
		if command.Type == "chat.reaction.toggled" {
			metrics.ChatReactionRoute++
		}
	})
	s.history(command.GameID).Append(patches)
	s.broadcast(command.GameID, patches)
}

func (s *WebSocketServer) broadcast(gameID string, patches []protocol.PatchEnvelopeV2) {
	s.mu.RLock()
	clients := make([]*wsClient, 0, len(s.rooms[gameID]))
	for client := range s.rooms[gameID] {
		clients = append(clients, client)
	}
	s.mu.RUnlock()
	for _, patch := range patches {
		for _, client := range clients {
			s.sendPatchIfVisible(client, patch)
		}
	}
}

func eventLogEntriesFromPayload(payload map[string]any) []map[string]any {
	raw, ok := payload["eventLogEntries"]
	if !ok {
		return nil
	}
	switch typed := raw.(type) {
	case []map[string]any:
		return typed
	case []any:
		entries := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if entry, ok := item.(map[string]any); ok {
				entries = append(entries, entry)
			}
		}
		return entries
	default:
		return nil
	}
}

func (s *WebSocketServer) sendPatchIfVisible(client *wsClient, patch protocol.PatchEnvelopeV2) {
	if !canReceive(client.claims, patch.Visibility) {
		return
	}
	s.sendJSON(client, patchMessage(patch))
}

func (s *WebSocketServer) sendJSON(client *wsClient, message ServerMessage) {
	payload, err := json.Marshal(message)
	if err != nil {
		return
	}
	select {
	case <-client.done:
		return
	case client.send <- payload:
	case <-client.done:
		return
	default:
		s.incMetric(func(metrics *GatewayMetrics) { metrics.ConnectionBackpressure++ })
		_ = client.conn.Close()
	}
}

func (s *WebSocketServer) history(gameID string) *patchHistory {
	s.mu.Lock()
	defer s.mu.Unlock()
	history := s.histories[gameID]
	if history == nil {
		history = &patchHistory{limit: s.patchHistoryLimit}
		s.histories[gameID] = history
	}
	return history
}

func (s *WebSocketServer) incMetric(update func(*GatewayMetrics)) {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	update(&s.metrics)
}

type wsClient struct {
	server  *WebSocketServer
	conn    *websocket.Conn
	claims  TicketClaims
	send    chan []byte
	limiter *commandRateLimiter
	done    chan struct{}
}

func (c *wsClient) playerID() string {
	if strings.TrimSpace(c.claims.PlayerID) != "" {
		return strings.TrimSpace(c.claims.PlayerID)
	}
	return strings.TrimSpace(c.claims.UserID)
}

func (c *wsClient) readLoop() {
	for {
		var message ClientMessage
		if err := c.conn.ReadJSON(&message); err != nil {
			return
		}
		if message.isPing() {
			c.server.sendJSON(c, ServerMessage{
				Kind:       "pong",
				GameID:     c.claims.GameID,
				MessageID:  message.MessageID,
				ServerTime: time.Now().UTC().Format(time.RFC3339Nano),
			})
			continue
		}
		command, ok, err := c.server.commandFromMessage(c.claims, message)
		if err != nil {
			c.server.sendJSON(c, errorMessage(c.claims.GameID, message.MessageID, "", "INVALID_MESSAGE", err.Error(), false))
			continue
		}
		if !ok {
			c.server.sendJSON(c, errorMessage(c.claims.GameID, message.MessageID, "", "UNSUPPORTED_MESSAGE", "unsupported websocket message", false))
			continue
		}
		c.server.handleCommand(context.Background(), c, command)
	}
}

func (c *wsClient) writeLoop() {
	for {
		select {
		case payload, ok := <-c.send:
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, payload); err != nil {
				return
			}
		case <-c.done:
			return
		}
	}
}

func (m ClientMessage) isPing() bool {
	kind := strings.TrimSpace(m.Kind)
	if kind == "" {
		kind = strings.TrimSpace(m.Type)
	}
	return kind == "ping"
}

func (s *WebSocketServer) commandFromMessage(claims TicketClaims, message ClientMessage) (protocol.CommandEnvelopeV2, bool, error) {
	kind := strings.TrimSpace(message.Kind)
	if kind == "" && strings.TrimSpace(message.Type) == "command" && message.Command != nil {
		kind = "command"
	}

	switch kind {
	case "command":
		if message.Command == nil {
			return protocol.CommandEnvelopeV2{}, false, errors.New("command message requires command")
		}
		command := *message.Command
		if strings.TrimSpace(command.GameID) == "" {
			command.GameID = claims.GameID
		}
		if command.Client == nil {
			command.Client = map[string]any{}
		}
		return command, true, nil
	case "command.v2":
		payload := message.Payload
		if payload == nil {
			payload = map[string]any{}
		}
		command := protocol.CommandEnvelopeV2{
			GameID:         message.GameID,
			BaseVersion:    message.BaseVersion,
			ClientActionID: message.ClientActionID,
			Type:           message.Type,
			Payload:        payload,
			Client:         message.Client,
		}
		if strings.TrimSpace(command.GameID) == "" {
			command.GameID = claims.GameID
		}
		if command.Client == nil {
			command.Client = map[string]any{}
		}
		return command, true, nil
	case "mulligan.take", "mulligan.keep", "mulligan.scry.confirm":
		playerID := strings.TrimSpace(claims.PlayerID)
		if playerID == "" {
			playerID = claims.UserID
		}
		baseVersion := message.BaseVersion
		if baseVersion < 1 {
			baseVersion = s.currentActorVersion(claims.GameID)
		}
		return protocol.CommandEnvelopeV2{
			GameID:         claims.GameID,
			BaseVersion:    baseVersion,
			ClientActionID: clientActionIDForMessage(message),
			Type:           kind,
			Payload:        runtimeMulliganPayload(kind, playerID, message),
			Client:         map[string]any{"source": "runtime_ws_mulligan"},
		}, true, nil
	default:
		return protocol.CommandEnvelopeV2{}, false, nil
	}
}

func (s *WebSocketServer) currentActorVersion(gameID string) int64 {
	gameActor, ok := s.runtime.Actor(gameID)
	if !ok {
		return 1
	}
	version := gameActor.Version()
	if version < 1 {
		return 1
	}
	return version
}

func clientActionIDForMessage(message ClientMessage) string {
	if strings.TrimSpace(message.ClientActionID) != "" {
		return strings.TrimSpace(message.ClientActionID)
	}
	if strings.TrimSpace(message.MessageID) != "" {
		return strings.TrimSpace(message.MessageID)
	}
	return fmt.Sprintf("ws-action-%d", time.Now().UnixNano())
}

func runtimeMulliganPayload(kind string, playerID string, message ClientMessage) map[string]any {
	switch kind {
	case "mulligan.keep":
		return map[string]any{
			"playerId":      playerID,
			"bottomCardIds": append([]string(nil), message.BottomCardIDs...),
		}
	case "mulligan.scry.confirm":
		choice := "top"
		if strings.EqualFold(strings.TrimSpace(message.Destination), "bottom") {
			choice = "bottom"
		}
		return map[string]any{
			"playerId": playerID,
			"choice":   choice,
		}
	default:
		return map[string]any{"playerId": playerID}
	}
}

func patchMessage(patch protocol.PatchEnvelopeV2) ServerMessage {
	return ServerMessage{
		Kind:              "patch.v2",
		GameID:            patch.GameID,
		Version:           patch.Version,
		Visibility:        patch.Visibility,
		Ops:               frontendPatchOps(patch.Ops),
		AckClientActionID: patch.AckClientActionID,
	}
}

func frontendPatchOps(ops []protocol.PatchOp) []map[string]any {
	out := make([]map[string]any, 0, len(ops))
	for _, op := range ops {
		item := map[string]any{"op": op.Op}
		for key, value := range op.Data {
			if key == "op" {
				continue
			}
			item[key] = value
		}
		out = append(out, item)
	}
	return out
}

func resyncRequiredMessage(gameID string, currentVersion int64, reason string) ServerMessage {
	return ServerMessage{
		Kind:           "resync_required",
		GameID:         gameID,
		CurrentVersion: currentVersion,
		Reason:         reason,
	}
}

func errorMessage(gameID string, messageID string, clientActionID string, code string, message string, retryable bool) ServerMessage {
	return ServerMessage{
		Kind:           "error",
		GameID:         gameID,
		MessageID:      messageID,
		ClientActionID: clientActionID,
		Error: &ServerErrorPayload{
			Code:      code,
			Message:   message,
			Retryable: retryable,
		},
	}
}

func commandRejectedMessage(command protocol.CommandEnvelopeV2, code string, message string, retryable bool) ServerMessage {
	return ServerMessage{
		Kind:           "command_ack",
		GameID:         command.GameID,
		ClientActionID: command.ClientActionID,
		Status:         "rejected",
		Version:        command.BaseVersion,
		Error: &ServerErrorPayload{
			Code:      code,
			Message:   message,
			Retryable: retryable,
		},
	}
}

func commandAuthorizationRejectedMessage(command protocol.CommandEnvelopeV2, authorizationError *actor.AuthorizationError) ServerMessage {
	errorPayload := &ServerErrorPayload{
		Code:        authorizationError.Code,
		Message:     authorizationError.Error(),
		Retryable:   false,
		CommandType: authorizationError.CommandType,
		InstanceID:  authorizationError.InstanceID,
	}
	switch command.Type {
	case "cards.moved", "cards.position.changed", "zone.reorderedByIds", "library.reorder_top", "zone.move_all":
		index := authorizationError.Index
		errorPayload.Index = &index
	}
	return ServerMessage{
		Kind:           "command_ack",
		GameID:         command.GameID,
		ClientActionID: command.ClientActionID,
		Status:         "rejected",
		Version:        command.BaseVersion,
		Error:          errorPayload,
	}
}

func commandResyncRequiredMessage(command protocol.CommandEnvelopeV2, currentVersion int64, code string, message string, retryable bool) ServerMessage {
	return ServerMessage{
		Kind:           "command_ack",
		GameID:         command.GameID,
		ClientActionID: command.ClientActionID,
		Status:         "resync_required",
		Version:        currentVersion,
		Error: &ServerErrorPayload{
			Code:      code,
			Message:   message,
			Retryable: retryable,
		},
	}
}

type patchHistory struct {
	mu      sync.RWMutex
	limit   int
	patches []protocol.PatchEnvelopeV2
}

func (h *patchHistory) Append(patches []protocol.PatchEnvelopeV2) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.patches = append(h.patches, patches...)
	h.trimLocked()
}

func (h *patchHistory) Since(version int64) ([]protocol.PatchEnvelopeV2, error) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	var out []protocol.PatchEnvelopeV2
	for _, patch := range h.patches {
		if patch.Version > version {
			out = append(out, patch)
		}
	}
	if len(out) == 0 {
		return nil, ErrPatchHistoryGap
	}
	if !patchesAreContiguousSince(out, version) {
		return nil, ErrPatchHistoryGap
	}
	return out, nil
}

func (h *patchHistory) trimLocked() {
	if h.limit <= 0 {
		return
	}
	seen := map[int64]struct{}{}
	cutoffVersion := int64(0)
	for i := len(h.patches) - 1; i >= 0; i-- {
		version := h.patches[i].Version
		if _, ok := seen[version]; ok {
			continue
		}
		seen[version] = struct{}{}
		if len(seen) == h.limit {
			cutoffVersion = version
			break
		}
	}
	if len(seen) < h.limit || cutoffVersion == 0 {
		return
	}
	index := 0
	for index < len(h.patches) && h.patches[index].Version < cutoffVersion {
		index++
	}
	if index > 0 {
		h.patches = h.patches[index:]
	}
}

func patchesAreContiguousSince(patches []protocol.PatchEnvelopeV2, version int64) bool {
	expected := version + 1
	current := int64(0)
	for _, patch := range patches {
		if current == 0 {
			if patch.Version != expected {
				return false
			}
			current = patch.Version
			continue
		}
		if patch.Version == current {
			continue
		}
		if patch.Version != current+1 {
			return false
		}
		current = patch.Version
	}
	return current != 0
}

type commandRateLimiter struct {
	mu      sync.Mutex
	records map[string][]time.Time
	now     func() time.Time
}

func newCommandRateLimiter() *commandRateLimiter {
	return &commandRateLimiter{
		records: map[string][]time.Time{},
		now:     time.Now,
	}
}

func (l *commandRateLimiter) Allow(commandType string) bool {
	limit := 60
	window := time.Second
	if strings.Contains(commandType, "position") {
		limit = 20
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	cutoff := now.Add(-window)
	records := l.records[commandType]
	kept := records[:0]
	for _, record := range records {
		if record.After(cutoff) {
			kept = append(kept, record)
		}
	}
	if len(kept) >= limit {
		l.records[commandType] = kept
		return false
	}
	kept = append(kept, now)
	l.records[commandType] = kept
	return true
}

func canReceive(claims TicketClaims, visibility protocol.Visibility) bool {
	value := string(visibility)
	if value == string(protocol.VisibilityPublic) {
		return true
	}
	if strings.HasPrefix(value, "player:") {
		playerID := strings.TrimPrefix(value, "player:")
		return playerID != "" && (claims.PlayerID == playerID || claims.UserID == playerID || hasRole(claims, "admin"))
	}
	if strings.HasPrefix(value, "group:") {
		mask, err := strconv.ParseUint(strings.TrimPrefix(value, "group:"), 10, 64)
		return hasRole(claims, "admin") || (err == nil && mask > 0 && claims.ViewerMask > 0 && mask&claims.ViewerMask != 0)
	}
	return false
}

func isInternalOnlyWebSocketCommand(commandType string) bool {
	return actor.IsInternalOnlyCommandType(commandType)
}

func hasRole(claims TicketClaims, role string) bool {
	for _, candidate := range claims.Roles {
		if candidate == role {
			return true
		}
	}
	return false
}

func hasPermission(claims TicketClaims, permission string) bool {
	for _, candidate := range claims.Permissions {
		if candidate == permission {
			return true
		}
	}
	return false
}

func isEphemeralPosition(command protocol.CommandEnvelopeV2) bool {
	ephemeral, _ := command.Client["ephemeral"].(bool)
	return ephemeral && strings.Contains(command.Type, "position")
}

func clonePayload(payload map[string]any) map[string]any {
	out := make(map[string]any, len(payload))
	for key, value := range payload {
		out[key] = value
	}
	return out
}

func firstGatewayString(values ...any) string {
	for _, value := range values {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

func parseLastAppliedVersion(r *http.Request) int64 {
	value := r.URL.Query().Get("lastAppliedVersion")
	if value == "" {
		return 0
	}
	version, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0
	}
	return version
}

func URLWithTicket(baseURL string, ticket string, lastAppliedVersion int64) string {
	separator := "?"
	if strings.Contains(baseURL, "?") {
		separator = "&"
	}
	url := fmt.Sprintf("%s%sticket=%s", baseURL, separator, ticket)
	if lastAppliedVersion > 0 {
		url += fmt.Sprintf("&lastAppliedVersion=%d", lastAppliedVersion)
	}
	return url
}

var _ Router = (*webSocketRouter)(nil)

type webSocketRouter struct {
	runtime *runtimesvc.Service
}

func (r *webSocketRouter) Route(ctx context.Context, gameID string, request actor.CommandRequest) error {
	gameActor, _, err := r.runtime.LoadActorRecovered(ctx, gameID, nil)
	if err != nil {
		return err
	}
	return gameActor.Enqueue(request)
}
