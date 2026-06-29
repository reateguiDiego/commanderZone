package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"commanderzone/game-runtime/internal/actor"
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
	ErrConnectionQueueFull = errors.New("websocket connection queue full")
	ErrPatchHistoryGap     = errors.New("patch history gap")
	ErrRateLimited         = errors.New("command rate limited")
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
}

type ServerErrorPayload struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

type WebSocketServer struct {
	validator TicketValidator
	runtime   *runtimesvc.Service
	upgrader  websocket.Upgrader

	mu        sync.RWMutex
	rooms     map[string]map[*wsClient]struct{}
	histories map[string]*patchHistory

	connectionQueueSize int
	commandTimeout      time.Duration
	patchHistoryLimit   int

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
	GameplayWSRoute         map[string]int64 `json:"gameplay.ws.route,omitempty"`
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

func NewWebSocketServer(validator TicketValidator, runtime *runtimesvc.Service, opts ...WebSocketOption) *WebSocketServer {
	server := &WebSocketServer{
		validator:           validator,
		runtime:             runtime,
		rooms:               map[string]map[*wsClient]struct{}{},
		histories:           map[string]*patchHistory{},
		connectionQueueSize: defaultConnectionQueueSize,
		commandTimeout:      defaultCommandTimeout,
		patchHistoryLimit:   defaultPatchHistoryLimit,
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
	s.register(client)
	defer s.unregister(client)

	s.sendJSON(client, ServerMessage{
		Kind:         "connection_state",
		GameID:       claims.GameID,
		ConnectionID: fmt.Sprintf("%p", client),
		Status:       "connected",
		ServerTime:   time.Now().UTC().Format(time.RFC3339Nano),
	})

	lastApplied := parseLastAppliedVersion(r)
	s.replayOrRequestResync(client, lastApplied)

	go client.writeLoop()
	client.readLoop()
}

func (s *WebSocketServer) register(client *wsClient) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rooms[client.claims.GameID] == nil {
		s.rooms[client.claims.GameID] = map[*wsClient]struct{}{}
	}
	s.rooms[client.claims.GameID][client] = struct{}{}
}

func (s *WebSocketServer) unregister(client *wsClient) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if room := s.rooms[client.claims.GameID]; room != nil {
		delete(room, client)
		if len(room) == 0 {
			delete(s.rooms, client.claims.GameID)
		}
	}
	close(client.done)
	_ = client.conn.Close()
}

func (s *WebSocketServer) replayOrRequestResync(client *wsClient, lastAppliedVersion int64) {
	if lastAppliedVersion <= 0 {
		return
	}
	gameActor, ok := s.runtime.Actor(client.claims.GameID)
	if !ok {
		s.sendJSON(client, resyncRequiredMessage(client.claims.GameID, 0, "version_gap"))
		s.incMetric(func(metrics *GatewayMetrics) { metrics.ReconnectsRequiringSync++ })
		return
	}
	currentVersion := gameActor.Version()
	if lastAppliedVersion >= currentVersion {
		s.incMetric(func(metrics *GatewayMetrics) { metrics.ReconnectsWithoutGap++ })
		return
	}
	patches, err := s.history(client.claims.GameID).Since(lastAppliedVersion)
	if err != nil {
		s.sendJSON(client, resyncRequiredMessage(client.claims.GameID, currentVersion, "version_gap"))
		s.incMetric(func(metrics *GatewayMetrics) { metrics.ReconnectsRequiringSync++ })
		return
	}
	for _, patch := range patches {
		s.sendPatchIfVisible(client, patch)
	}
	s.incMetric(func(metrics *GatewayMetrics) { metrics.ReconnectsWithoutGap++ })
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

	gameActor, _, err := s.runtime.LoadActorRecovered(ctx, command.GameID, nil)
	if err != nil {
		s.sendJSON(client, commandRejectedMessage(command, "ACTOR_RECOVERY_FAILED", err.Error(), true))
		return
	}
	commandCtx, cancel := context.WithTimeout(ctx, s.commandTimeout)
	defer cancel()
	result := gameActor.Submit(commandCtx, command, client.claims.UserID)
	if result.Err != nil {
		if errors.Is(result.Err, actor.ErrVersionConflict) {
			s.sendJSON(client, commandResyncRequiredMessage(command, gameActor.Version(), "BASE_VERSION_MISMATCH", result.Err.Error(), true))
			return
		}
		s.sendJSON(client, commandRejectedMessage(command, "COMMAND_FAILED", result.Err.Error(), false))
		return
	}
	s.history(command.GameID).Append(result.Patches)
	s.broadcast(command.GameID, result.Patches)
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
	case client.send <- payload:
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

func (c *wsClient) readLoop() {
	defer close(c.send)
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
		command := protocol.CommandEnvelopeV2{
			GameID:         message.GameID,
			BaseVersion:    message.BaseVersion,
			ClientActionID: message.ClientActionID,
			Type:           message.Type,
			Payload:        message.Payload,
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
	if h.limit > 0 && len(h.patches) > h.limit {
		h.patches = h.patches[len(h.patches)-h.limit:]
	}
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
	if out[0].Version != version+1 {
		return nil, ErrPatchHistoryGap
	}
	return out, nil
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
		return hasRole(claims, value) || hasRole(claims, "admin")
	}
	return false
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
