package persistence

import (
	"context"
	"errors"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

var ErrOwnershipNotHeld = errors.New("runtime ownership not held")

type CompactSnapshot struct {
	GameID   string
	Version  int64
	State    state.GameState
	Checksum string
}

type FencingToken struct {
	GameID          string
	OwnerInstanceID string
	Token           uint64
	Required        bool
}

type EventStore interface {
	AppendEvent(ctx context.Context, event protocol.EventPayloadV2) error
	EventByClientActionID(ctx context.Context, gameID string, clientActionID string) (protocol.EventPayloadV2, bool, error)
	LatestSnapshot(ctx context.Context, gameID string) (CompactSnapshot, bool, error)
	EventsAfter(ctx context.Context, gameID string, version int64) ([]protocol.EventPayloadV2, error)
	SaveSnapshot(ctx context.Context, snapshot CompactSnapshot) error
}

type FencedEventStore interface {
	AppendEventWithFence(ctx context.Context, event protocol.EventPayloadV2, fence FencingToken) error
}
