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
	Type    string                      `json:"type"`
	Command *protocol.CommandEnvelopeV2 `json:"command,omitempty"`
}

type ServerMessage struct {
	Type               string                    `json:"type"`
	Patch              *protocol.PatchEnvelopeV2 `json:"patch,omitempty"`
	Error              string                    `json:"error,omitempty"`
	Code               string                    `json:"code,omitempty"`
	ResyncRequired     bool                      `json:"resyncRequired,omitempty"`
	CurrentVersion     int64                     `json:"currentVersion,omitempty"`
	AckClientActionID  string                    `json:"ackClientActionId,omitempty"`
	DroppedEphemeral   bool                      `json:"droppedEphemeral,omitempty"`
	CoalescedEphemeral bool                      `json:"coalescedEphemeral,omitempty"`
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
		s.sendJSON(client, ServerMessage{Type: "resync.required", ResyncRequired: true, Code: "actor_not_loaded"})
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
		s.sendJSON(client, ServerMessage{Type: "resync.required", ResyncRequired: true, CurrentVersion: currentVersion, Code: "patch_gap"})
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
		s.sendJSON(client, ServerMessage{Type: "error", Error: ErrTicketGameMismatch.Error(), Code: "game_mismatch"})
		return
	}
	if isEphemeralPosition(command) {
		s.incMetric(func(metrics *GatewayMetrics) {
			metrics.DroppedEphemeralEvents++
			metrics.CoalescedPositionEvents++
		})
		s.sendJSON(client, ServerMessage{
			Type:               "ack",
			AckClientActionID:  command.ClientActionID,
			DroppedEphemeral:   true,
			CoalescedEphemeral: true,
		})
		return
	}
	if !client.limiter.Allow(command.Type) {
		s.incMetric(func(metrics *GatewayMetrics) { metrics.RateLimitedCommands++ })
		s.sendJSON(client, ServerMessage{Type: "error", Error: ErrRateLimited.Error(), Code: "rate_limited", AckClientActionID: command.ClientActionID})
		return
	}
	if err := command.Validate(); err != nil {
		s.sendJSON(client, ServerMessage{Type: "error", Error: err.Error(), Code: "invalid_command", AckClientActionID: command.ClientActionID})
		return
	}

	gameActor, _ := s.runtime.LoadActor(ctx, command.GameID, runtimesvc.EmptyInitialState(command.GameID))
	commandCtx, cancel := context.WithTimeout(ctx, s.commandTimeout)
	defer cancel()
	result := gameActor.Submit(commandCtx, command, client.claims.UserID)
	if result.Err != nil {
		s.sendJSON(client, ServerMessage{Type: "error", Error: result.Err.Error(), Code: "command_failed", AckClientActionID: command.ClientActionID})
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
	patchCopy := patch
	s.sendJSON(client, ServerMessage{Type: "patch", Patch: &patchCopy})
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
		if message.Type != "command" || message.Command == nil {
			c.server.sendJSON(c, ServerMessage{Type: "error", Error: "unsupported websocket message", Code: "unsupported_message"})
			continue
		}
		c.server.handleCommand(context.Background(), c, *message.Command)
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
	gameActor, _ := r.runtime.LoadActor(ctx, gameID, runtimesvc.EmptyInitialState(gameID))
	return gameActor.Enqueue(request)
}
