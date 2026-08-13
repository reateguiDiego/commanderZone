package runtime

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"time"

	"commanderzone/game-runtime/internal/actor"
	"commanderzone/game-runtime/internal/lifecycle"
	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

var ErrActorStateNotFound = errors.New("runtime actor state not found")
var ErrActorClosing = errors.New("runtime actor is closing")

type Service struct {
	mu                  sync.RWMutex
	actors              map[string]*actor.GameActor
	cancels             map[string]context.CancelFunc
	leases              map[string]OwnershipLease
	closing             map[string]struct{}
	connections         map[string]int
	actorStoppedHook    func(string)
	store               persistence.EventStore
	queueSize           int
	appliers            []actor.Applier
	lifecycleSink       lifecycle.Sink
	lifecycleGeneration int64

	instanceID  string
	ownership   OwnershipManager
	logger      *slog.Logger
	renewBefore time.Duration

	metricsMu sync.RWMutex
	metrics   RuntimeMetrics
}

type MetricsSnapshot struct {
	Actors  []actor.ActorMetrics `json:"actors"`
	Totals  actor.ActorMetrics   `json:"totals"`
	Runtime RuntimeMetrics       `json:"runtime"`
}

type RuntimeMetrics struct {
	InitialStatePerCommandCount int64   `json:"runtime.initial_state_per_command_count"`
	ActorLoadFromSnapshotCount  int64   `json:"runtime.actor_load_from_snapshot_count"`
	ActorLoadFromEventsCount    int64   `json:"runtime.actor_load_from_events_count"`
	ActorRecoveredEventCount    int64   `json:"runtime.actor_recovered_event_count"`
	ActorCacheHitCount          int64   `json:"runtime.actor_cache_hit_count"`
	ActorCacheMissCount         int64   `json:"runtime.actor_cache_miss_count"`
	CommandRuntimeCoveragePct   float64 `json:"command.runtime_coverage_percent"`
	CommandLegacyFallbackCount  int64   `json:"command.legacy_fallback_count"`
	RuntimeInstanceID           string  `json:"runtime.instance_id,omitempty"`
	RuntimeOwnershipMode        string  `json:"runtime.ownership_mode,omitempty"`
	OwnershipAcquireCount       int64   `json:"runtime.ownership_acquire_count"`
	OwnershipRenewCount         int64   `json:"runtime.ownership_renew_count"`
	OwnershipRejectCount        int64   `json:"runtime.ownership_reject_count"`
	OwnershipReleaseCount       int64   `json:"runtime.ownership_release_count"`
	OwnershipLostCount          int64   `json:"runtime.ownership_lost_count"`
	OwnershipStolenCount        int64   `json:"runtime.ownership_stolen_count"`
	OwnershipExpiredCount       int64   `json:"runtime.ownership_expired_count"`
}

type ServiceOption func(*Service)

func WithInstanceID(instanceID string) ServiceOption {
	return func(s *Service) {
		if instanceID != "" {
			s.instanceID = instanceID
		}
	}
}

func WithOwnershipManager(ownership OwnershipManager) ServiceOption {
	return func(s *Service) {
		if ownership != nil {
			s.ownership = ownership
		}
	}
}

func WithLogger(logger *slog.Logger) ServiceOption {
	return func(s *Service) {
		if logger != nil {
			s.logger = logger
		}
	}
}

func WithOwnershipRenewBefore(duration time.Duration) ServiceOption {
	return func(s *Service) {
		if duration > 0 {
			s.renewBefore = duration
		}
	}
}

func WithLifecycleSink(sink lifecycle.Sink, generation int64) ServiceOption {
	return func(s *Service) {
		s.lifecycleSink = sink
		if generation > 0 {
			s.lifecycleGeneration = generation
		}
	}
}

func NewService() *Service {
	return NewServiceWithStore(persistence.NewInMemoryEventStore(), 128, actor.DefaultAppliers())
}

func NewServiceWithStore(store persistence.EventStore, queueSize int, appliers []actor.Applier) *Service {
	return NewServiceWithStoreAndOptions(store, queueSize, appliers)
}

func NewServiceWithStoreAndOptions(store persistence.EventStore, queueSize int, appliers []actor.Applier, opts ...ServiceOption) *Service {
	if queueSize < 1 {
		queueSize = 1
	}
	if len(appliers) == 0 {
		appliers = actor.DefaultAppliers()
	}
	service := &Service{
		actors:              map[string]*actor.GameActor{},
		cancels:             map[string]context.CancelFunc{},
		leases:              map[string]OwnershipLease{},
		closing:             map[string]struct{}{},
		connections:         map[string]int{},
		store:               store,
		queueSize:           queueSize,
		appliers:            appliers,
		instanceID:          DefaultRuntimeInstanceID(),
		ownership:           NewSingleNodeOwnershipManager(),
		logger:              slog.New(slog.NewTextHandler(io.Discard, nil)),
		renewBefore:         5 * time.Second,
		lifecycleGeneration: 1,
	}
	for _, opt := range opts {
		opt(service)
	}
	if service.instanceID == "" {
		service.instanceID = DefaultRuntimeInstanceID()
	}
	if service.ownership == nil {
		service.ownership = NewSingleNodeOwnershipManager()
	}
	if service.logger == nil {
		service.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	if service.renewBefore <= 0 {
		service.renewBefore = 5 * time.Second
	}
	return service
}

// SetActorStoppedHook lets the WS gateway release game-scoped peers and
// histories only after the actor has stopped and the lease was released.
func (s *Service) SetActorStoppedHook(hook func(string)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.actorStoppedHook = hook
}

func (s *Service) RegisterActor(gameID string, actor *actor.GameActor) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.acquireOwnershipLocked(context.Background(), gameID); err != nil {
		return
	}
	actor.SetLifecycleSink(s.lifecycleSink, s.lifecycleGeneration)
	s.actors[gameID] = actor
}

func (s *Service) LoadActor(ctx context.Context, gameID string) (*actor.GameActor, bool) {
	gameActor, created, _ := s.LoadActorRecovered(ctx, gameID, nil)
	return gameActor, created
}

func (s *Service) LoadActorFromInitialState(ctx context.Context, gameID string, initial state.GameState) (*actor.GameActor, bool, error) {
	return s.LoadActorRecovered(ctx, gameID, &initial)
}

func (s *Service) LoadActorRecovered(ctx context.Context, gameID string, initial *state.GameState) (*actor.GameActor, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, closing := s.closing[gameID]; closing {
		return nil, false, ErrActorClosing
	}

	if gameActor, ok := s.actors[gameID]; ok {
		if err := s.ensureOwnershipLocked(ctx, gameID); err != nil {
			return nil, false, err
		}
		s.recordActorCacheHit()
		return gameActor, false, nil
	}
	s.recordActorCacheMiss()
	if err := s.acquireOwnershipLocked(ctx, gameID); err != nil {
		return nil, false, err
	}
	recovered, err := s.recoverState(ctx, gameID, initial)
	if err != nil {
		s.releaseOwnershipLocked(context.Background(), gameID)
		return nil, false, err
	}
	// Actor lifetime must outlive the HTTP request that created it; request
	// contexts are only used for recovery/loading and are canceled after the
	// response is written.
	actorCtx, cancel := context.WithCancel(context.Background())
	gameActor := actor.NewGameActorWithCommandGuard(gameID, recovered, s.store, s.queueSize, s.appliers, s.commandOwnershipGuard(gameID))
	gameActor.SetLifecycleSink(s.lifecycleSink, s.lifecycleGeneration)
	gameActor.SetLifecycleConfirmedHook(func(handoff lifecycle.Handoff) {
		if handoff.Type != lifecycle.GameFinished {
			return
		}
		go s.stopFinishedActor(gameID, gameActor)
	})
	s.actors[gameID] = gameActor
	s.cancels[gameID] = cancel
	gameActor.Start(actorCtx)
	return gameActor, true, nil
}

// ReleaseClosingTombstone is called only after Symfony has committed deletion
// of the game. Until then the tombstone prevents a valid but stale ticket from
// recreating an actor between stop and delete.
func (s *Service) ReleaseClosingTombstone(gameID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.closing, gameID)
}

func (s *Service) DeliverPresenceLifecycle(ctx context.Context, gameID string, handoffType string, occurredAt time.Time) error {
	if s.lifecycleSink == nil {
		return nil
	}
	s.mu.RLock()
	gameActor, actorExists := s.actors[gameID]
	lease, leaseExists := s.leases[gameID]
	generation := s.lifecycleGeneration
	s.mu.RUnlock()
	if !actorExists || !leaseExists {
		return ErrActorStateNotFound
	}
	version := gameActor.Version()
	if version < 1 {
		version = 1
	}
	if occurredAt.IsZero() {
		occurredAt = time.Now().UTC()
	}
	handoff := lifecycle.Handoff{
		EventID:    fmt.Sprintf("%s:presence:%d", gameID, occurredAt.UnixNano()),
		GameID:     gameID,
		Type:       handoffType,
		Version:    version,
		Generation: generation,
		Fencing:    lease.Token,
		OccurredAt: occurredAt,
	}
	return s.lifecycleSink.Deliver(ctx, handoff)
}

// ClearDisconnectVotesForAllOffline persists only the compact actor snapshot;
// it deliberately cannot append game_event because zero connected players
// cannot open or resolve a disconnect vote. It also records every player as
// offline so the durable grace lifecycle can recover exact presence.
func (s *Service) ClearDisconnectVotesForAllOffline(ctx context.Context, gameID string) error {
	s.mu.RLock()
	gameActor := s.actors[gameID]
	s.mu.RUnlock()
	if gameActor == nil {
		return ErrActorStateNotFound
	}
	if !gameActor.ClearDisconnectVotesForAllOffline() {
		return nil
	}
	return gameActor.SaveCompactSnapshot(ctx)
}

func (s *Service) InstanceID() string {
	return s.instanceID
}

func (s *Service) OwnershipMode() string {
	if s.ownership == nil {
		return ""
	}
	return s.ownership.Mode()
}

func (s *Service) recoverState(ctx context.Context, gameID string, initial *state.GameState) (state.GameState, error) {
	if s.store == nil {
		if initial == nil {
			return state.GameState{}, ErrActorStateNotFound
		}
		base := initial.Clone()
		state.NormalizeForRecovery(gameID, &base)
		state.RebuildLocIndexForRecoveryOnly(&base)
		if err := state.ValidateInvariants(base); err != nil {
			return state.GameState{}, err
		}
		return base, nil
	}
	var base state.GameState
	hasBase := false
	snapshot, ok, err := s.store.LatestSnapshot(ctx, gameID)
	if err != nil {
		return state.GameState{}, err
	}
	if ok {
		base = snapshot.State
		hasBase = true
		s.recordActorLoadFromSnapshot()
	} else if initial != nil {
		base = initial.Clone()
		hasBase = true
	}
	if !hasBase {
		return state.GameState{}, ErrActorStateNotFound
	}
	state.NormalizeForRecovery(gameID, &base)
	events, err := s.store.EventsAfter(ctx, gameID, base.Version)
	if err != nil {
		return state.GameState{}, err
	}
	if len(events) > 0 {
		s.recordActorLoadFromEvents()
		s.recordRecoveredEvents(len(events))
	}
	if len(events) == 0 {
		state.RebuildLocIndexForRecoveryOnly(&base)
		if err := state.ValidateInvariants(base); err != nil {
			return state.GameState{}, err
		}
		return base, nil
	}
	return actor.ReplayEvents(base, events, s.appliers)
}

func (s *Service) Actor(gameID string) (*actor.GameActor, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	gameActor, ok := s.actors[gameID]
	return gameActor, ok
}

// AcquireConnection reserves an actor for a WebSocket before the handshake is
// accepted. The reservation closes the hibernate/reconnect race: a hibernate
// request can only detach an actor when no live handshake or socket owns it.
func (s *Service) AcquireConnection(ctx context.Context, gameID string) (*actor.GameActor, bool, func(), error) {
	for {
		gameActor, _, err := s.LoadActorRecovered(ctx, gameID, nil)
		if err != nil {
			return nil, false, nil, err
		}

		s.mu.Lock()
		if s.actors[gameID] == gameActor {
			firstConnection := s.connections[gameID] == 0
			s.connections[gameID]++
			s.mu.Unlock()
			return gameActor, firstConnection, func() { s.releaseConnection(gameID) }, nil
		}
		s.mu.Unlock()
	}
}

func (s *Service) releaseConnection(gameID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.connections[gameID] <= 1 {
		delete(s.connections, gameID)
		return
	}
	s.connections[gameID]--
}

func (s *Service) EventsAfter(ctx context.Context, gameID string, version int64) ([]protocol.EventPayloadV2, error) {
	if s.store == nil {
		return nil, ErrActorStateNotFound
	}
	return s.store.EventsAfter(ctx, gameID, version)
}

func (s *Service) MetricsSnapshot() MetricsSnapshot {
	s.mu.RLock()
	actors := make([]*actor.GameActor, 0, len(s.actors))
	for _, gameActor := range s.actors {
		actors = append(actors, gameActor)
	}
	s.mu.RUnlock()

	snapshot := MetricsSnapshot{
		Actors: make([]actor.ActorMetrics, 0, len(actors)),
		Totals: actor.ActorMetrics{
			GameID: "all",
		},
		Runtime: s.RuntimeMetrics(),
	}
	for _, gameActor := range actors {
		metrics := gameActor.Metrics()
		snapshot.Actors = append(snapshot.Actors, metrics)
		snapshot.Totals.QueueDepth += metrics.QueueDepth
		snapshot.Totals.QueueCapacity += metrics.QueueCapacity
		snapshot.Totals.QueueFullCount += metrics.QueueFullCount
		snapshot.Totals.CommandEnqueuedCount += metrics.CommandEnqueuedCount
		snapshot.Totals.CommandRejectedCount += metrics.CommandRejectedCount
		snapshot.Totals.CommandAppliedCount += metrics.CommandAppliedCount
		if metrics.CommandLatencyMs > snapshot.Totals.CommandLatencyMs {
			snapshot.Totals.CommandLatencyMs = metrics.CommandLatencyMs
		}
		if metrics.QueueWaitMs > snapshot.Totals.QueueWaitMs {
			snapshot.Totals.QueueWaitMs = metrics.QueueWaitMs
		}
		if metrics.RuntimeCoveragePct > snapshot.Totals.RuntimeCoveragePct {
			snapshot.Totals.RuntimeCoveragePct = metrics.RuntimeCoveragePct
		}
		snapshot.Totals.AliasTranslationCount += metrics.AliasTranslationCount
		snapshot.Totals.UnsupportedCount += metrics.UnsupportedCount
		snapshot.Totals.LegacyFallbackCount += metrics.LegacyFallbackCount
		snapshot.Totals.DuplicateActionCount += metrics.DuplicateActionCount
		snapshot.Totals.DuplicateMemoryCount += metrics.DuplicateMemoryCount
		snapshot.Totals.DuplicateDurableCount += metrics.DuplicateDurableCount
		snapshot.Totals.DuplicateReceiptMissingCount += metrics.DuplicateReceiptMissingCount
		snapshot.Totals.VersionConflictCount += metrics.VersionConflictCount
		snapshot.Totals.SnapshotPostAppendFailureCount += metrics.SnapshotPostAppendFailureCount
		snapshot.Totals.SeenActionCacheSize += metrics.SeenActionCacheSize
		snapshot.Totals.SeenActionCacheCapacity += metrics.SeenActionCacheCapacity
	}
	return snapshot
}

func (s *Service) RecordInitialStatePerCommand() {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	s.metrics.InitialStatePerCommandCount++
}

func (s *Service) RuntimeMetrics() RuntimeMetrics {
	s.metricsMu.RLock()
	defer s.metricsMu.RUnlock()
	metrics := s.metrics
	metrics.CommandRuntimeCoveragePct = actor.CommandRuntimeCoveragePercent(s.appliers, actor.FinalGameplayCommandTypes())
	metrics.CommandLegacyFallbackCount = 0
	metrics.RuntimeInstanceID = s.instanceID
	metrics.RuntimeOwnershipMode = s.OwnershipMode()
	return metrics
}

func (s *Service) recordActorLoadFromSnapshot() {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	s.metrics.ActorLoadFromSnapshotCount++
}

func (s *Service) recordActorLoadFromEvents() {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	s.metrics.ActorLoadFromEventsCount++
}

func (s *Service) recordRecoveredEvents(count int) {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	s.metrics.ActorRecoveredEventCount += int64(count)
}

func (s *Service) recordActorCacheHit() {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	s.metrics.ActorCacheHitCount++
}

func (s *Service) recordActorCacheMiss() {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	s.metrics.ActorCacheMissCount++
}

// StopActor is an internal/system lifecycle operation. It is deliberately not
// exposed as a gameplay command and never appends a game event.
func (s *Service) StopActor(ctx context.Context, gameID string) error {
	// A durable runtime-closing claim may be delivered to any node. Revoking
	// the shared lease first prevents a remote owner from appending while its
	// local actor is being stopped or until it observes the closing fence.
	if revoker, ok := s.ownership.(OwnershipRevoker); ok {
		if err := revoker.Revoke(ctx, gameID); err != nil {
			return err
		}
	}
	s.mu.Lock()
	s.closing[gameID] = struct{}{}
	gameActor := s.actors[gameID]
	s.mu.Unlock()
	if gameActor != nil {
		gameActor.BeginClosing()
	}
	return s.stopActorIfCurrent(ctx, gameID, nil)
}

// HibernateActor releases an idle runtime after all players disconnect. It is
// intentionally not closing: a reconnect may recover the actor from its
// compact snapshot and cancel the persisted control-plane deadline. A false
// result means a handshake or live WebSocket won the race and owns the actor.
func (s *Service) HibernateActor(ctx context.Context, gameID string) (bool, error) {
	s.mu.Lock()
	if s.connections[gameID] > 0 {
		s.mu.Unlock()
		return false, nil
	}
	gameActor, ok := s.actors[gameID]
	cancel := s.cancels[gameID]
	lease := s.leases[gameID]
	delete(s.actors, gameID)
	delete(s.cancels, gameID)
	s.mu.Unlock()

	if !ok {
		s.releaseOwnership(ctx, gameID, lease)
		return true, nil
	}
	if cancel != nil {
		cancel()
	}
	if err := gameActor.Stop(ctx); err != nil && !errors.Is(err, persistence.ErrGameClosing) {
		return false, err
	}
	s.releaseOwnership(ctx, gameID, lease)
	s.mu.RLock()
	hook := s.actorStoppedHook
	s.mu.RUnlock()
	if hook != nil {
		hook(gameID)
	}
	return true, nil
}

func (s *Service) stopFinishedActor(gameID string, expected *actor.GameActor) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	s.mu.Lock()
	if current := s.actors[gameID]; current == expected {
		s.closing[gameID] = struct{}{}
		expected.BeginClosing()
	}
	s.mu.Unlock()
	if err := s.stopActorIfCurrent(ctx, gameID, expected); err != nil {
		s.logger.Warn("runtime actor stop failed after lifecycle finish confirmation", "gameId", gameID, "error", err)
	}
}

func (s *Service) stopActorIfCurrent(ctx context.Context, gameID string, expected *actor.GameActor) error {
	s.mu.Lock()
	gameActor, ok := s.actors[gameID]
	if expected != nil && (!ok || gameActor != expected) {
		s.mu.Unlock()
		return nil
	}
	cancel := s.cancels[gameID]
	lease := s.leases[gameID]
	delete(s.actors, gameID)
	delete(s.cancels, gameID)
	s.mu.Unlock()
	if !ok {
		s.releaseOwnership(ctx, gameID, lease)
		return nil
	}
	if cancel != nil {
		cancel()
	}
	if err := gameActor.Stop(ctx); err != nil && !errors.Is(err, persistence.ErrGameClosing) {
		return err
	}
	s.releaseOwnership(ctx, gameID, lease)
	s.mu.RLock()
	hook := s.actorStoppedHook
	s.mu.RUnlock()
	if hook != nil {
		hook(gameID)
	}
	return nil
}

func EmptyInitialState(gameID string) state.GameState {
	return state.GameState{
		GameID:    gameID,
		Version:   1,
		Status:    "playing",
		Players:   map[string]map[string]any{},
		Turn:      map[string]any{},
		Instances: map[string]state.CardInstanceRuntime{},
		Zones:     map[string]state.PlayerZones{},
		Loc:       map[string]state.Location{},
		Visibility: state.VisibilityIndex{
			InstanceMasks:       map[string]uint64{},
			LibraryEpochByOwner: map[string]int64{},
			TopRevealWindows:    map[string]state.TopRevealWindow{},
		},
	}
}

func (s *Service) Shutdown(ctx context.Context) error {
	s.mu.RLock()
	gameIDs := make([]string, 0, len(s.actors))
	for gameID := range s.actors {
		gameIDs = append(gameIDs, gameID)
	}
	s.mu.RUnlock()

	for _, gameID := range gameIDs {
		if err := s.StopActor(ctx, gameID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) acquireOwnershipLocked(ctx context.Context, gameID string) error {
	result, err := s.ownership.Acquire(ctx, gameID, s.instanceID)
	if err != nil {
		s.recordOwnershipRejected()
		s.logger.Warn("runtime ownership acquire rejected", "gameId", gameID, "instanceId", s.instanceID, "mode", s.OwnershipMode(), "error", err)
		if errors.Is(err, ErrGameClosing) {
			return errors.Join(ErrActorClosing, err)
		}
		return err
	}
	s.leases[gameID] = result.Lease
	s.recordOwnershipAcquired()
	if result.Stolen {
		s.recordOwnershipStolen()
	}
	if result.Renewed {
		s.recordOwnershipRenewed()
	}
	if result.Expired {
		s.recordOwnershipExpired()
	}
	s.logger.Info("runtime ownership acquired", "gameId", gameID, "instanceId", s.instanceID, "mode", s.OwnershipMode(), "token", result.Lease.Token, "reacquired", result.Reacquired, "stolen", result.Stolen, "expired", result.Expired)
	return nil
}

func (s *Service) ensureOwnershipLocked(ctx context.Context, gameID string) error {
	lease, ok := s.leases[gameID]
	if !ok {
		err := errors.New("runtime actor has no ownership lease")
		wrapped := errors.Join(ErrOwnershipNotHeld, err)
		s.recordOwnershipRejected()
		s.recordOwnershipLost()
		s.logger.Warn("runtime ownership missing for registered actor", "gameId", gameID, "instanceId", s.instanceID, "mode", s.OwnershipMode(), "error", err)
		return wrapped
	}
	if err := s.ownership.EnsureHeld(ctx, lease); err != nil {
		if errors.Is(err, ErrGameClosing) {
			return errors.Join(ErrActorClosing, err)
		}
		s.recordOwnershipRejected()
		if errors.Is(err, ErrOwnershipNotHeld) {
			s.recordOwnershipLost()
		}
		s.logger.Warn("runtime ownership not held", "gameId", gameID, "instanceId", s.instanceID, "mode", s.OwnershipMode(), "token", lease.Token, "error", err)
		return err
	}
	return nil
}

func (s *Service) commandOwnershipGuard(gameID string) func(context.Context) (persistence.FencingToken, error) {
	return func(ctx context.Context) (persistence.FencingToken, error) {
		s.mu.RLock()
		lease, ok := s.leases[gameID]
		s.mu.RUnlock()
		if !ok {
			err := errors.Join(ErrOwnershipNotHeld, errors.New("runtime actor has no ownership lease"))
			s.recordOwnershipRejected()
			s.recordOwnershipLost()
			s.logger.Warn("runtime ownership missing before command", "gameId", gameID, "instanceId", s.instanceID, "mode", s.OwnershipMode(), "error", err)
			return persistence.FencingToken{}, err
		}
		if err := s.ownership.EnsureHeld(ctx, lease); err != nil {
			if errors.Is(err, ErrGameClosing) {
				return persistence.FencingToken{}, errors.Join(ErrActorClosing, err)
			}
			s.recordOwnershipRejected()
			if errors.Is(err, ErrOwnershipNotHeld) {
				s.recordOwnershipLost()
			}
			s.logger.Warn("runtime ownership not held before command", "gameId", gameID, "instanceId", s.instanceID, "mode", s.OwnershipMode(), "token", lease.Token, "error", err)
			return persistence.FencingToken{}, err
		}
		if s.shouldRenewLease(lease) {
			renewed, err := s.ownership.Renew(ctx, lease)
			if err != nil {
				s.recordOwnershipRejected()
				if errors.Is(err, ErrOwnershipNotHeld) {
					s.recordOwnershipLost()
				}
				s.logger.Warn("runtime ownership renew failed before command", "gameId", gameID, "instanceId", s.instanceID, "mode", s.OwnershipMode(), "token", lease.Token, "error", err)
				return persistence.FencingToken{}, err
			}
			s.mu.Lock()
			if current, ok := s.leases[gameID]; ok && current.Token == lease.Token {
				s.leases[gameID] = renewed
				lease = renewed
			}
			s.mu.Unlock()
			s.recordOwnershipRenewed()
			s.logger.Debug("runtime ownership renewed before command", "gameId", gameID, "instanceId", s.instanceID, "mode", s.OwnershipMode(), "token", lease.Token, "expiresAt", lease.ExpiresAt)
		}
		return persistence.FencingToken{
			GameID:          lease.GameID,
			OwnerInstanceID: lease.OwnerID,
			Token:           lease.Token,
			Required:        s.OwnershipMode() == "postgres-lease",
		}, nil
	}
}

func (s *Service) shouldRenewLease(lease OwnershipLease) bool {
	if lease.ExpiresAt.IsZero() {
		return false
	}
	return time.Until(lease.ExpiresAt) <= s.renewBefore
}

func (s *Service) releaseOwnershipLocked(ctx context.Context, gameID string) {
	lease := s.leases[gameID]
	delete(s.leases, gameID)
	if lease.GameID == "" {
		return
	}
	if err := s.ownership.Release(ctx, lease); err != nil {
		if errors.Is(err, ErrOwnershipNotHeld) {
			s.recordOwnershipLost()
		}
		s.logger.Warn("runtime ownership release failed", "gameId", gameID, "instanceId", s.instanceID, "mode", s.OwnershipMode(), "token", lease.Token, "error", err)
		return
	}
	s.recordOwnershipReleased()
	s.logger.Info("runtime ownership released", "gameId", gameID, "instanceId", s.instanceID, "mode", s.OwnershipMode(), "token", lease.Token)
}

func (s *Service) releaseOwnership(ctx context.Context, gameID string, lease OwnershipLease) {
	if lease.GameID == "" {
		return
	}
	if err := s.ownership.Release(ctx, lease); err != nil {
		if errors.Is(err, ErrOwnershipNotHeld) {
			s.recordOwnershipLost()
		}
		s.logger.Warn("runtime ownership release failed", "gameId", gameID, "instanceId", s.instanceID, "mode", s.OwnershipMode(), "token", lease.Token, "error", err)
	} else {
		s.recordOwnershipReleased()
		s.logger.Info("runtime ownership released", "gameId", gameID, "instanceId", s.instanceID, "mode", s.OwnershipMode(), "token", lease.Token)
	}
	s.mu.Lock()
	if current, ok := s.leases[gameID]; ok && current.Token == lease.Token {
		delete(s.leases, gameID)
	}
	s.mu.Unlock()
}

func (s *Service) recordOwnershipAcquired() {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	s.metrics.OwnershipAcquireCount++
}

func (s *Service) recordOwnershipRejected() {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	s.metrics.OwnershipRejectCount++
}

func (s *Service) recordOwnershipRenewed() {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	s.metrics.OwnershipRenewCount++
}

func (s *Service) recordOwnershipReleased() {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	s.metrics.OwnershipReleaseCount++
}

func (s *Service) recordOwnershipLost() {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	s.metrics.OwnershipLostCount++
}

func (s *Service) recordOwnershipStolen() {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	s.metrics.OwnershipStolenCount++
}

func (s *Service) recordOwnershipExpired() {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	s.metrics.OwnershipExpiredCount++
}
