package persistence

import (
	"context"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

type CompactSnapshot struct {
	GameID   string
	Version  int64
	State    state.GameState
	Checksum string
}

type EventStore interface {
	AppendEvent(ctx context.Context, event protocol.EventPayloadV2) error
	EventByClientActionID(ctx context.Context, gameID string, clientActionID string) (protocol.EventPayloadV2, bool, error)
	LatestSnapshot(ctx context.Context, gameID string) (CompactSnapshot, bool, error)
	EventsAfter(ctx context.Context, gameID string, version int64) ([]protocol.EventPayloadV2, error)
	SaveSnapshot(ctx context.Context, snapshot CompactSnapshot) error
}
