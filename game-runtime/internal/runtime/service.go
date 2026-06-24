package runtime

import (
	"context"
	"sync"

	"commanderzone/game-runtime/internal/actor"
	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/state"
)

type Service struct {
	mu        sync.RWMutex
	actors    map[string]*actor.GameActor
	cancels   map[string]context.CancelFunc
	store     persistence.EventStore
	queueSize int
	appliers  []actor.Applier
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

func (s *Service) LoadActor(ctx context.Context, gameID string, initial state.GameState) (*actor.GameActor, bool) {
	gameActor, created, _ := s.LoadActorRecovered(ctx, gameID, initial)
	return gameActor, created
}

func (s *Service) LoadActorRecovered(ctx context.Context, gameID string, initial state.GameState) (*actor.GameActor, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if gameActor, ok := s.actors[gameID]; ok {
		return gameActor, false, nil
	}
	recovered, err := s.recoverState(ctx, gameID, initial)
	if err != nil {
		return nil, false, err
	}
	initial = recovered
	// Actor lifetime must outlive the HTTP request that created it; request
	// contexts are only used for recovery/loading and are canceled after the
	// response is written.
	actorCtx, cancel := context.WithCancel(context.Background())
	gameActor := actor.NewGameActor(gameID, initial, s.store, s.queueSize, s.appliers)
	s.actors[gameID] = gameActor
	s.cancels[gameID] = cancel
	gameActor.Start(actorCtx)
	return gameActor, true, nil
}

func (s *Service) recoverState(ctx context.Context, gameID string, initial state.GameState) (state.GameState, error) {
	if s.store == nil {
		return initial, nil
	}
	base := initial
	snapshot, ok, err := s.store.LatestSnapshot(ctx, gameID)
	if err != nil {
		return state.GameState{}, err
	}
	if ok {
		base = snapshot.State
	}
	events, err := s.store.EventsAfter(ctx, gameID, base.Version)
	if err != nil {
		return state.GameState{}, err
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
