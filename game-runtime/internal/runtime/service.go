package runtime

import (
	"context"
	"sync"

	"commanderzone/game-runtime/internal/actor"
	"commanderzone/game-runtime/internal/state"
)

type Service struct {
	mu     sync.RWMutex
	actors map[string]*actor.GameActor
}

func NewService() *Service {
	return &Service{actors: map[string]*actor.GameActor{}}
}

func (s *Service) RegisterActor(gameID string, actor *actor.GameActor) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.actors[gameID] = actor
}

func (s *Service) Actor(gameID string) (*actor.GameActor, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	gameActor, ok := s.actors[gameID]
	return gameActor, ok
}

func EmptyInitialState(gameID string) state.GameState {
	return state.GameState{
		GameID:     gameID,
		Version:    1,
		Status:     "playing",
		Players:    map[string]map[string]any{},
		Turn:       map[string]any{},
		Instances: map[string]state.CardInstanceRuntime{},
		Zones:      map[string]state.PlayerZones{},
		Loc:        map[string]state.Location{},
		Visibility: state.VisibilityIndex{
			InstanceMasks:       map[string]uint64{},
			LibraryEpochByOwner: map[string]int64{},
			TopRevealWindows:    map[string]state.TopRevealWindow{},
		},
	}
}

func (s *Service) Shutdown(_ context.Context) error {
	return nil
}
