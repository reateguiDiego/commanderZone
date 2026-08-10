package actor

import (
	"context"
	"errors"
	"testing"

	"commanderzone/game-runtime/internal/lifecycle"
	"commanderzone/game-runtime/internal/persistence"
)

type recordingLifecycleSink struct {
	handoffs []lifecycle.Handoff
}

func (s *recordingLifecycleSink) Deliver(_ context.Context, handoff lifecycle.Handoff) error {
	s.handoffs = append(s.handoffs, handoff)
	return nil
}

func TestLifecycleUsesOnlyActiveStatusAndEmitsAuthoritativeFinishHandoff(t *testing.T) {
	game := testState()
	game.Players["p2"]["life"] = -4
	game.Players["p2"]["commanderDamage"] = map[string]any{"commander": 21}
	game.Players["p3"] = map[string]any{
		"status":          "active",
		"life":            40,
		"commanderDamage": map[string]any{},
		"counters":        map[string]any{},
	}
	store := persistence.NewInMemoryEventStore()
	sink := &recordingLifecycleSink{}
	gameActor := NewGameActor("game-1", game, store, 8, DefaultAppliers())
	gameActor.SetLifecycleSink(sink, 1)

	first := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "concede-p3", "game.concede", map[string]any{"playerId": "p3"}), "p3")
	if first.Err != nil {
		t.Fatal(first.Err)
	}
	if gameActor.Snapshot().Status == "finished" {
		t.Fatal("life and commander damage incorrectly excluded an active player")
	}
	if len(sink.handoffs) != 1 || sink.handoffs[0].Type != lifecycle.PlayerConceded {
		t.Fatalf("first handoff = %#v", sink.handoffs)
	}

	second := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "concede-p2", "game.concede", map[string]any{"playerId": "p2"}), "p2")
	if second.Err != nil {
		t.Fatal(second.Err)
	}
	snapshot := gameActor.Snapshot()
	if snapshot.Status != "finished" || snapshot.WinnerPlayerID != "p1" || snapshot.FinishReason != "last_player_standing" || snapshot.FinishedAt == "" {
		t.Fatalf("finished state = %#v", snapshot)
	}
	if second.Event.Payload["winnerPlayerId"] != "p1" || second.Event.Payload["finishReason"] != "last_player_standing" {
		t.Fatalf("finish event contract = %#v", second.Event.Payload)
	}
	if len(sink.handoffs) != 2 {
		t.Fatalf("handoff count = %d", len(sink.handoffs))
	}
	finish := sink.handoffs[1]
	if finish.Type != lifecycle.GameFinished || finish.PlayerID != "p2" || finish.PlayerReason != "conceded" || finish.WinnerPlayerID != "p1" || finish.Version != 3 {
		t.Fatalf("finish handoff = %#v", finish)
	}

	duplicate := gameActor.ApplyDirect(context.Background(), command("game-1", second.Event.Version, "concede-p2", "game.concede", map[string]any{"playerId": "p2"}), "p2")
	if duplicate.Err != nil || duplicate.Event.Version != second.Event.Version || len(sink.handoffs) != 3 || sink.handoffs[2].EventID != finish.EventID {
		t.Fatalf("duplicate finish did not redeliver the same idempotent handoff: result=%#v handoffs=%#v", duplicate, sink.handoffs)
	}

	afterFinish := gameActor.ApplyDirect(context.Background(), command("game-1", second.Event.Version, "after-finish", "life.changed", map[string]any{"playerId": "p1", "life": 39}), "p1")
	if !errors.Is(afterFinish.Err, ErrGameFinished) || gameActor.Snapshot().Version != second.Event.Version {
		t.Fatalf("action after finish = %#v, snapshot=%#v", afterFinish, gameActor.Snapshot())
	}
}
