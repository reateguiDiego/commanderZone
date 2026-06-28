package persistence

import (
	"context"
	"errors"
	"testing"
	"time"

	"commanderzone/game-runtime/internal/protocol"
)

func TestInMemoryEventStoreRejectsDuplicateVersion(t *testing.T) {
	store := NewInMemoryEventStore()
	event := testEvent(2, "a1")
	if err := store.AppendEvent(context.Background(), event); err != nil {
		t.Fatalf("append failed: %v", err)
	}
	err := store.AppendEvent(context.Background(), testEvent(2, "a2"))
	if !errors.Is(err, ErrDuplicateVersion) {
		t.Fatalf("duplicate version got %v want %v", err, ErrDuplicateVersion)
	}
}

func TestInMemoryEventStoreRejectsDuplicateClientActionID(t *testing.T) {
	store := NewInMemoryEventStore()
	if err := store.AppendEvent(context.Background(), testEvent(2, "a1")); err != nil {
		t.Fatalf("append failed: %v", err)
	}
	err := store.AppendEvent(context.Background(), testEvent(3, "a1"))
	if !errors.Is(err, ErrDuplicateClientActionID) {
		t.Fatalf("duplicate action got %v want %v", err, ErrDuplicateClientActionID)
	}
}

func TestInMemoryEventStoreReturnsEventsAfterVersion(t *testing.T) {
	store := NewInMemoryEventStore()
	for version := int64(2); version <= 4; version++ {
		if err := store.AppendEvent(context.Background(), testEvent(version, "a"+time.Unix(version, 0).UTC().Format("150405"))); err != nil {
			t.Fatalf("append %d failed: %v", version, err)
		}
	}
	events, err := store.EventsAfter(context.Background(), "game-1", 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 {
		t.Fatalf("events got %d want 2", len(events))
	}
	if events[0].Version != 3 || events[1].Version != 4 {
		t.Fatalf("unexpected versions: %#v", events)
	}
}

func TestInMemoryEventStoreFindsEventByClientActionID(t *testing.T) {
	store := NewInMemoryEventStore()
	if err := store.AppendEvent(context.Background(), testEvent(2, "a1")); err != nil {
		t.Fatalf("append failed: %v", err)
	}
	event, ok, err := store.EventByClientActionID(context.Background(), "game-1", "a1")
	if err != nil {
		t.Fatal(err)
	}
	if !ok || event.Version != 2 {
		t.Fatalf("event = %#v ok=%v", event, ok)
	}
}

func testEvent(version int64, actionID string) protocol.EventPayloadV2 {
	return protocol.EventPayloadV2{
		GameID:         "game-1",
		Version:        version,
		Type:           "life.changed",
		Payload:        map[string]any{"playerId": "p1", "life": 40},
		CreatedBy:      "p1",
		ClientActionID: actionID,
		CreatedAt:      time.Unix(version, 0).UTC(),
	}
}
