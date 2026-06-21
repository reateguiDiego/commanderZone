package runtime

import (
	"context"
	"testing"
	"time"
)

func TestServiceLoadActorIsIdempotentByGameID(t *testing.T) {
	service := NewService()
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := service.Shutdown(ctx); err != nil {
			t.Fatalf("shutdown failed: %v", err)
		}
	}()

	first, created := service.LoadActor(context.Background(), "game-1", EmptyInitialState("game-1"))
	if !created {
		t.Fatal("expected first load to create actor")
	}
	second, created := service.LoadActor(context.Background(), "game-1", EmptyInitialState("game-1"))
	if created {
		t.Fatal("expected second load to reuse actor")
	}
	if first != second {
		t.Fatal("expected same actor for same gameId")
	}
}

func TestServiceShutdownStopsActors(t *testing.T) {
	service := NewService()
	gameActor, _ := service.LoadActor(context.Background(), "game-1", EmptyInitialState("game-1"))
	before := gameActor.Heartbeat()
	gameActor.TouchHeartbeat()
	if !gameActor.Heartbeat().After(before) && !gameActor.Heartbeat().Equal(before) {
		t.Fatal("heartbeat moved backwards")
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := service.Shutdown(ctx); err != nil {
		t.Fatalf("shutdown failed: %v", err)
	}
	if _, ok := service.Actor("game-1"); ok {
		t.Fatal("actor still registered after shutdown")
	}
}
