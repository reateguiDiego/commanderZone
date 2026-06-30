package runtime

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"time"

	"commanderzone/game-runtime/internal/actor"
	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

var ErrActorStateNotFound = errors.New("runtime actor state not found")

type Service struct {
	mu        sync.RWMutex
	actors    map[string]*actor.GameActor
	cancels   map[string]context.CancelFunc
	leases    map[string]OwnershipLease
	store     persistence.EventStore
	queueSize int
	appliers  []actor.Applier

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
		actors:      map[string]*actor.GameActor{},
		cancels:     map[string]context.CancelFunc{},
		leases:      map[string]OwnershipLease{},
		store:       store,
		queueSize:   queueSize,
		appliers:    appliers,
		instanceID:  DefaultRuntimeInstanceID(),
		ownership:   NewSingleNodeOwnershipManager(),
		logger:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		renewBefore: 5 * time.Second,
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

func (s *Service) RegisterActor(gameID string, actor *actor.GameActor) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.acquireOwnershipLocked(context.Background(), gameID); err != nil {
		return
	}
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
	s.actors[gameID] = gameActor
	s.cancels[gameID] = cancel
	gameActor.Start(actorCtx)
	return gameActor, true, nil
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

func (s *Service) StopActor(ctx context.Context, gameID string) error {
	s.mu.Lock()
	gameActor, ok := s.actors[gameID]
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
	if err := gameActor.Stop(ctx); err != nil {
		return err
	}
	s.releaseOwnership(ctx, gameID, lease)
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
