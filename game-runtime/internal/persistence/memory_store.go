package persistence

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"commanderzone/game-runtime/internal/protocol"
)

var (
	ErrDuplicateVersion        = errors.New("duplicate game event version")
	ErrDuplicateClientActionID = errors.New("duplicate client action id")
)

type InMemoryEventStore struct {
	mu              sync.RWMutex
	eventsByGame    map[string][]protocol.EventPayloadV2
	actionIDsByGame map[string]map[string]struct{}
	snapshotsByGame map[string][]CompactSnapshot
}

func NewInMemoryEventStore() *InMemoryEventStore {
	return &InMemoryEventStore{
		eventsByGame:    map[string][]protocol.EventPayloadV2{},
		actionIDsByGame: map[string]map[string]struct{}{},
		snapshotsByGame: map[string][]CompactSnapshot{},
	}
}

func (s *InMemoryEventStore) AppendEvent(_ context.Context, event protocol.EventPayloadV2) error {
	if err := event.Validate(); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for _, existing := range s.eventsByGame[event.GameID] {
		if existing.Version == event.Version {
			return fmt.Errorf("%w: %s/%d", ErrDuplicateVersion, event.GameID, event.Version)
		}
	}
	if event.ClientActionID != "" {
		if s.actionIDsByGame[event.GameID] == nil {
			s.actionIDsByGame[event.GameID] = map[string]struct{}{}
		}
		if _, exists := s.actionIDsByGame[event.GameID][event.ClientActionID]; exists {
			return fmt.Errorf("%w: %s/%s", ErrDuplicateClientActionID, event.GameID, event.ClientActionID)
		}
		s.actionIDsByGame[event.GameID][event.ClientActionID] = struct{}{}
	}
	s.eventsByGame[event.GameID] = append(s.eventsByGame[event.GameID], event)
	return nil
}

func (s *InMemoryEventStore) LatestSnapshot(_ context.Context, gameID string) (CompactSnapshot, bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	snapshots := s.snapshotsByGame[gameID]
	if len(snapshots) == 0 {
		return CompactSnapshot{}, false, nil
	}
	return snapshots[len(snapshots)-1], true, nil
}

func (s *InMemoryEventStore) EventsAfter(_ context.Context, gameID string, version int64) ([]protocol.EventPayloadV2, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	events := s.eventsByGame[gameID]
	result := make([]protocol.EventPayloadV2, 0, len(events))
	for _, event := range events {
		if event.Version > version {
			result = append(result, event)
		}
	}
	return result, nil
}

func (s *InMemoryEventStore) SaveSnapshot(_ context.Context, snapshot CompactSnapshot) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.snapshotsByGame[snapshot.GameID] = append(s.snapshotsByGame[snapshot.GameID], snapshot)
	return nil
}
