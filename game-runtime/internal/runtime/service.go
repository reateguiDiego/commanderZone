package runtime

import (
	"context"
	"errors"
	"sync"

	"commanderzone/game-runtime/internal/actor"
	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/state"
)

var ErrActorStateNotFound = errors.New("runtime actor state not found")

type Service struct {
	mu        sync.RWMutex
	actors    map[string]*actor.GameActor
	cancels   map[string]context.CancelFunc
	store     persistence.EventStore
	queueSize int
	appliers  []actor.Applier

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
	ActorCacheHitCount          int64   `json:"runtime.actor_cache_hit_count"`
	ActorCacheMissCount         int64   `json:"runtime.actor_cache_miss_count"`
	CommandRuntimeCoveragePct   float64 `json:"command.runtime_coverage_percent"`
	CommandLegacyFallbackCount  int64   `json:"command.legacy_fallback_count"`
}

func NewService() *Service {
	return NewServiceWithStore(persistence.NewInMemoryEventStore(), 128, actor.DefaultAppliers())
}

func NewServiceWithStore(store persistence.EventStore, queueSize int, appliers []actor.Applier) *Service {
	if queueSize < 1 {
		queueSize = 1
	}
	if len(appliers) == 0 {
		appliers = actor.DefaultAppliers()
	}
	return &Service{
		actors:    map[string]*actor.GameActor{},
		cancels:   map[string]context.CancelFunc{},
		store:     store,
		queueSize: queueSize,
		appliers:  appliers,
	}
}

func (s *Service) RegisterActor(gameID string, actor *actor.GameActor) {
	s.mu.Lock()
	defer s.mu.Unlock()
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
		s.recordActorCacheHit()
		return gameActor, false, nil
	}
	s.recordActorCacheMiss()
	recovered, err := s.recoverState(ctx, gameID, initial)
	if err != nil {
		return nil, false, err
	}
	// Actor lifetime must outlive the HTTP request that created it; request
	// contexts are only used for recovery/loading and are canceled after the
	// response is written.
	actorCtx, cancel := context.WithCancel(context.Background())
	gameActor := actor.NewGameActor(gameID, recovered, s.store, s.queueSize, s.appliers)
	s.actors[gameID] = gameActor
	s.cancels[gameID] = cancel
	gameActor.Start(actorCtx)
	return gameActor, true, nil
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
	delete(s.actors, gameID)
	delete(s.cancels, gameID)
	s.mu.Unlock()
	if !ok {
		return nil
	}
	if cancel != nil {
		cancel()
	}
	return gameActor.Stop(ctx)
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
