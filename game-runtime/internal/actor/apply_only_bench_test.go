package actor

import (
	"context"
	"testing"

	"commanderzone/game-runtime/internal/state"
)

func BenchmarkApplyOnlyRuntimeCommands4Players100(b *testing.B) {
	for _, scenario := range []struct {
		name    string
		command string
		payload map[string]any
	}{
		{name: "tap_1", command: "card.tapped", payload: map[string]any{"instanceId": "bf00", "tapped": true}},
		{name: "life", command: "life.changed", payload: map[string]any{"playerId": "p1", "delta": -1}},
		{name: "turn", command: "turn.changed", payload: map[string]any{"activePlayerId": "p2", "phase": "combat", "number": 3}},
		{name: "counter_1", command: "card.counter.changed", payload: map[string]any{"instanceId": "bf00", "counter": "charge", "value": 2}},
		{name: "position_1", command: "card.position.changed", payload: map[string]any{"instanceId": "bf00", "position": map[string]any{"x": 0.4, "y": 0.2, "unit": "ratio"}}},
		{name: "draw_1", command: "library.draw", payload: map[string]any{"playerId": "p1"}},
		{name: "move_1", command: "card.moved", payload: map[string]any{"playerId": "p1", "fromZone": "hand", "toZone": "graveyard", "instanceId": "h000"}},
	} {
		b.Run(scenario.name, func(b *testing.B) {
			initial := benchmarkMovementState(100, 20)
			gameActor := NewGameActorWithSnapshotPolicy("game-1", initial.Clone(), nil, 8, DefaultAppliers(), SnapshotPolicy{})
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				b.StopTimer()
				resetActorForApplyOnlyBenchmark(gameActor, initial)
				cmd := command("game-1", 1, "bench-action", scenario.command, cloneMap(scenario.payload))
				b.StartTimer()
				result := gameActor.ApplyDirect(context.Background(), cmd, "p1")
				if result.Err != nil {
					b.Fatal(result.Err)
				}
			}
		})
	}
}

func resetActorForApplyOnlyBenchmark(gameActor *GameActor, initial state.GameState) {
	gameActor.stateMu.Lock()
	defer gameActor.stateMu.Unlock()
	game := initial.Clone()
	gameActor.state = &game
	gameActor.seenActions = map[string]CommandResult{}
	gameActor.eventsSinceSnapshot = 0
}
