package actor

import (
	"context"
	"fmt"
	"testing"

	"commanderzone/game-runtime/internal/state"
)

func lifecycleMatrixState(count int) state.GameState {
	players := map[string]map[string]any{}
	order := make([]string, 0, count)
	for i := 1; i <= count; i++ {
		id := fmt.Sprintf("seat-%d", i)
		players[id] = map[string]any{"life": 40, "status": "active", "commanderDamage": map[string]any{}, "counters": map[string]any{}}
		order = append(order, id)
	}
	return state.GameState{GameID: "lifecycle", Version: 1, Status: "playing", Players: players, TurnOrder: order,
		Turn: map[string]any{"activePlayerId": order[0], "phase": "combat", "number": 7},
		Relations: state.Relations{Helpers: map[string]state.Relation{
			"monarch":    {ID: "monarch", Meta: map[string]any{"template": "monarch", "ownerPlayerId": order[0], "state": map[string]any{}}},
			"initiative": {ID: "initiative", Meta: map[string]any{"template": "initiative", "ownerPlayerId": order[0], "state": map[string]any{}}},
		}},
	}
}

func TestAuthoritativeLifecycleMatrixTwoToSixPlayers(t *testing.T) {
	for count := 2; count <= 6; count++ {
		t.Run(fmt.Sprintf("%d_players", count), func(t *testing.T) {
			initial := lifecycleMatrixState(count)
			gameActor := NewGameActor("lifecycle", initial, nil, 8, DefaultAppliers())
			version := int64(1)
			for seat := 1; seat < count; seat++ {
				target := fmt.Sprintf("seat-%d", seat)
				result := gameActor.ApplyDirect(context.Background(), command("lifecycle", version, fmt.Sprintf("lethal-%d", seat), "life.changed", map[string]any{"playerId": target, "life": 0}), target)
				if result.Err != nil {
					t.Fatalf("eliminate %s: %v", target, result.Err)
				}
				version = result.Event.Version
				snapshot := gameActor.Snapshot()
				if snapshot.Players[target]["eliminationReason"] != "life" || snapshot.Players[target]["eliminatedAtVersion"] != version {
					t.Fatalf("missing elimination metadata: %#v", snapshot.Players[target])
				}
				if snapshot.Turn["phase"] != "combat" || snapshot.Turn["number"] != 7 {
					t.Fatalf("turn phase/number changed: %#v", snapshot.Turn)
				}
				if len(snapshot.TurnOrder) != count {
					t.Fatalf("turn order changed: %#v", snapshot.TurnOrder)
				}
			}
			snapshot := gameActor.Snapshot()
			winner := fmt.Sprintf("seat-%d", count)
			if snapshot.WinnerPlayerID != winner || snapshot.ResultState != "survivor" || snapshot.FinishedReason != "last_active" || snapshot.Turn["activePlayerId"] != winner || snapshot.Status == "finished" {
				t.Fatalf("bad survivor result: %#v", snapshot)
			}
			for _, helper := range snapshot.Relations.Helpers {
				if helper.Meta["ownerPlayerId"] != winner {
					t.Fatalf("designation not reassigned: %#v", helper)
				}
			}
			blocked := gameActor.ApplyDirect(context.Background(), command("lifecycle", version, "blocked", "life.changed", map[string]any{"playerId": winner, "life": 39}), winner)
			if auth, ok := AsAuthorizationError(blocked.Err); !ok || auth.Code != AuthorizationCodeGameClosed || gameActor.Snapshot().Version != version {
				t.Fatalf("survivor gameplay guard failed: %#v", blocked)
			}
		})
	}
}

func TestLegacyTurnOrderUsesPersistedPlayerObjectOrder(t *testing.T) {
	var game state.GameState
	raw := []byte(`{"gameId":"legacy","version":1,"status":"playing","players":{"seat-z":{"status":"active"},"seat-a":{"status":"active"},"seat-m":{"status":"active"}},"turn":{"activePlayerId":"seat-z"}}`)
	if err := game.UnmarshalJSON(raw); err != nil {
		t.Fatal(err)
	}
	state.NormalizeForRecovery("legacy", &game)
	want := []string{"seat-z", "seat-a", "seat-m"}
	for i := range want {
		if game.TurnOrder[i] != want[i] {
			t.Fatalf("legacy order = %#v", game.TurnOrder)
		}
	}
}
