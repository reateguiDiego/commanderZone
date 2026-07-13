package actor

import (
	"context"
	"reflect"
	"testing"
	"time"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

func TestCommanderDamageAtomicDeltaAndNoLifeRefund(t *testing.T) {
	gameActor := NewGameActor("game-1", commanderDamageAtomicState(), nil, 8, DefaultAppliers())

	assertCommanderDamageApplied(t, gameActor, 1, "damage-3", 3, 3, 37)
	assertCommanderDamageApplied(t, gameActor, 2, "damage-7", 7, 4, 33)
	assertCommanderDamageApplied(t, gameActor, 3, "damage-4", 4, -3, 33)
}

func TestCommanderDamageRejectsInvalidPayloadWithoutMutation(t *testing.T) {
	tests := []struct {
		name    string
		actorID string
		mutate  func(*state.GameState)
		payload map[string]any
		code    string
	}{
		{name: "invalid target", actorID: "p1", payload: commanderDamagePayload("missing", "p2", "commander-p2", 3), code: AuthorizationCodeInvalidTarget},
		{name: "permission denied", actorID: "p1", payload: commanderDamagePayload("p2", "p1", "commander-p2", 3), code: AuthorizationCodePermissionDenied},
		{name: "invalid source", actorID: "p1", payload: commanderDamagePayload("p1", "missing", "commander-p2", 3), code: AuthorizationCodeInvalidSource},
		{name: "commander missing", actorID: "p1", payload: commanderDamagePayload("p1", "p2", "missing", 3), code: AuthorizationCodeCommanderNotFound},
		{name: "not commander", actorID: "p1", payload: commanderDamagePayload("p1", "p2", "i1", 3), code: AuthorizationCodeInvalidCommander},
		{
			name:    "defeated target",
			actorID: "p1",
			mutate:  func(game *state.GameState) { game.Players["p1"]["status"] = "defeated" },
			payload: commanderDamagePayload("p1", "p2", "commander-p2", 3),
			code:    AuthorizationCodePlayerDefeated,
		},
		{
			name:    "conceded source",
			actorID: "p1",
			mutate:  func(game *state.GameState) { game.Players["p2"]["status"] = "conceded" },
			payload: commanderDamagePayload("p1", "p2", "commander-p2", 3),
			code:    AuthorizationCodePlayerConceded,
		},
		{
			name:    "wrong commander owner",
			actorID: "p1",
			mutate: func(game *state.GameState) {
				commander := game.Instances["commander-p2"]
				commander.OwnerID = "p1"
				game.Instances["commander-p2"] = commander
			},
			payload: commanderDamagePayload("p1", "p2", "commander-p2", 3),
			code:    AuthorizationCodeInvalidSource,
		},
		{name: "negative damage", actorID: "p1", payload: commanderDamagePayload("p1", "p2", "commander-p2", -1), code: AuthorizationCodeInvalidTarget},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			initial := commanderDamageAtomicState()
			if tt.mutate != nil {
				tt.mutate(&initial)
			}
			before := initial.Clone()
			gameActor := NewGameActor("game-1", initial, nil, 8, DefaultAppliers())
			result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "reject-"+tt.name, "commander.damage.changed", tt.payload), tt.actorID)
			authorizationError, ok := AsAuthorizationError(result.Err)
			if !ok || authorizationError.Code != tt.code {
				t.Fatalf("error = %#v, want authorization code %s", result.Err, tt.code)
			}
			if result.Event.Version != 0 || len(result.Patches) != 0 {
				t.Fatalf("rejection produced event or patches: %#v %#v", result.Event, result.Patches)
			}
			if after := gameActor.Snapshot(); !reflect.DeepEqual(before, after) {
				t.Fatalf("rejection mutated state\nbefore=%#v\nafter=%#v", before, after)
			}
		})
	}
}

func TestCommanderDamageLethalTransitionAndRetryAreAtomic(t *testing.T) {
	for _, damage := range []int{21, 22} {
		t.Run(string(rune('A'+damage-21)), func(t *testing.T) {
			initial := commanderDamageAtomicState()
			initial.Players["p1"]["commanderDamage"] = map[string]any{"commander-p2": 20}
			initial.Players["p1"]["life"] = 20
			gameActor := NewGameActor("game-1", initial, nil, 8, DefaultAppliers())
			cmd := command("game-1", 1, "lethal", "commander.damage.changed", commanderDamagePayload("p1", "p2", "commander-p2", damage))

			result := gameActor.ApplyDirect(context.Background(), cmd, "p1")
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			snapshot := gameActor.Snapshot()
			if snapshot.Players["p1"]["status"] != "defeated" || snapshot.Turn["activePlayerId"] != "p2" {
				t.Fatalf("lethal lifecycle missing: players=%#v turn=%#v", snapshot.Players, snapshot.Turn)
			}
			wantLife := 20 - (damage - 20)
			if snapshot.Players["p1"]["life"] != wantLife {
				t.Fatalf("life = %v, want %d", snapshot.Players["p1"]["life"], wantLife)
			}
			assertPublicOps(t, result, "player.commanderDamage.set", "player.life.set", "player.status.set", "turn.set", "eventLog.append")
			entries := result.Event.Payload["eventLogEntries"].([]map[string]any)
			if len(entries) < 2 || entries[0]["i18nKey"] != "gameLog.commanderDamage.changed" || entries[1]["i18nKey"] != "gameLog.player.defeatedByCommanderDamage" {
				t.Fatalf("unexpected lethal logs: %#v", entries)
			}

			beforeRetry := gameActor.Snapshot()
			retry := gameActor.ApplyDirect(context.Background(), cmd, "p1")
			if retry.Err != nil || retry.Event.Version != result.Event.Version || !reflect.DeepEqual(beforeRetry, gameActor.Snapshot()) {
				t.Fatalf("retry duplicated lethal effects: result=%#v", retry)
			}
		})
	}
}

func TestCommanderDamageCanDefeatByLifeBelowTwentyOne(t *testing.T) {
	initial := commanderDamageAtomicState()
	initial.Players["p1"]["life"] = 2
	gameActor := NewGameActor("game-1", initial, nil, 8, DefaultAppliers())

	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "life-lethal", "commander.damage.changed", commanderDamagePayload("p1", "p2", "commander-p2", 3)), "p1")
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	snapshot := gameActor.Snapshot()
	if snapshot.Players["p1"]["life"] != -1 || snapshot.Players["p1"]["status"] != "defeated" {
		t.Fatalf("life lethal transition missing: %#v", snapshot.Players["p1"])
	}
}

func TestLifeChangedDefeatIsAtomicAndModernReplayCopiesPersistedLifecycle(t *testing.T) {
	gameActor := NewGameActor("game-1", commanderDamageAtomicState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "life-zero", "life.changed", map[string]any{"playerId": "p1", "life": 0}), "p1")
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	if result.Event.Payload["effectVersion"] != authoritativeLifecycleEffectVersion || result.Event.Payload["status"] != "defeated" {
		t.Fatalf("life event missing atomic lifecycle schema: %#v", result.Event.Payload)
	}
	assertPublicOps(t, result, "player.life.set", "player.status.set", "turn.set", "eventLog.append")

	modernState, err := ReplayEvents(commanderDamageAtomicState(), []protocol.EventPayloadV2{result.Event}, DefaultAppliers())
	if err != nil {
		t.Fatal(err)
	}
	if modernState.Players["p1"]["life"] != 0 || playerStatus(&modernState, "p1") != "defeated" || modernState.Turn["activePlayerId"] != "p2" {
		t.Fatalf("modern life replay mismatch: players=%#v turn=%#v", modernState.Players, modernState.Turn)
	}

	legacy := protocol.EventPayloadV2{GameID: "game-1", Version: 2, Type: "life.changed", CreatedAt: time.Now().UTC(), Payload: map[string]any{"playerId": "p1", "life": 0}}
	legacyState, err := ReplayEvents(commanderDamageAtomicState(), []protocol.EventPayloadV2{legacy}, DefaultAppliers())
	if err != nil {
		t.Fatal(err)
	}
	if legacyState.Players["p1"]["life"] != 0 || playerStatus(&legacyState, "p1") != "active" || legacyState.Turn["activePlayerId"] != "p1" {
		t.Fatalf("legacy life replay gained lifecycle effects: players=%#v turn=%#v", legacyState.Players, legacyState.Turn)
	}
}

func TestCommanderDamageReplayKeepsLegacyAndNewEffectsSeparate(t *testing.T) {
	createdAt := time.Now().UTC()
	legacy := protocol.EventPayloadV2{
		GameID: "game-1", Version: 2, Type: "commander.damage.changed", CreatedAt: createdAt,
		Payload: map[string]any{"targetPlayerId": "p1", "commanderInstanceId": "legacy-commander", "damage": 21},
	}
	legacyState, err := ReplayEvents(commanderDamageAtomicState(), []protocol.EventPayloadV2{legacy}, DefaultAppliers())
	if err != nil {
		t.Fatal(err)
	}
	if legacyState.Players["p1"]["life"] != 40 || playerStatus(&legacyState, "p1") != "active" || legacyState.Turn["activePlayerId"] != "p1" {
		t.Fatalf("legacy replay gained new effects: players=%#v turn=%#v", legacyState.Players, legacyState.Turn)
	}

	modern := protocol.EventPayloadV2{
		GameID: "game-1", Version: 2, Type: "commander.damage.changed", CreatedAt: createdAt,
		Payload: map[string]any{
			"effectVersion": 2, "targetPlayerId": "p1", "sourcePlayerId": "p2", "commanderInstanceId": "commander-p2",
			"previousDamage": 0, "damage": 21, "delta": 21, "previousLife": 40, "life": 35,
			"previousStatus": "active", "status": "defeated", "statusChanged": true,
			"turn": map[string]any{"activePlayerId": "p2", "phase": "main-1", "number": 1},
		},
	}
	modernState, err := ReplayEvents(commanderDamageAtomicState(), []protocol.EventPayloadV2{modern}, DefaultAppliers())
	if err != nil {
		t.Fatal(err)
	}
	if modernState.Players["p1"]["life"] != 35 || playerStatus(&modernState, "p1") != "defeated" || modernState.Turn["activePlayerId"] != "p2" {
		t.Fatalf("modern replay recalculated instead of copying persisted values: players=%#v turn=%#v", modernState.Players, modernState.Turn)
	}
}

func TestDefeatedAndConcededPlayersCannotMutateGameplay(t *testing.T) {
	for _, status := range []string{"defeated", "conceded"} {
		t.Run(status, func(t *testing.T) {
			initial := commanderDamageAtomicState()
			initial.Players["p1"]["status"] = status
			gameActor := NewGameActor("game-1", initial, nil, 8, DefaultAppliers())
			result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "blocked-"+status, "card.tapped", map[string]any{"playerId": "p1", "instanceId": "i1", "tapped": true}), "p1")
			authorizationError, ok := AsAuthorizationError(result.Err)
			want := AuthorizationCodePlayerDefeated
			if status == "conceded" {
				want = AuthorizationCodePlayerConceded
			}
			if !ok || authorizationError.Code != want || gameActor.Version() != 1 || len(result.Patches) != 0 {
				t.Fatalf("blocked gameplay result = %#v, want %s", result, want)
			}
		})
	}
}

func assertCommanderDamageApplied(t *testing.T, gameActor *GameActor, baseVersion int64, actionID string, damage int, delta int, life int) {
	t.Helper()
	result := gameActor.ApplyDirect(context.Background(), command("game-1", baseVersion, actionID, "commander.damage.changed", commanderDamagePayload("p1", "p2", "commander-p2", damage)), "p1")
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	snapshot := gameActor.Snapshot()
	if snapshot.Players["p1"]["life"] != life || snapshot.Players["p1"]["commanderDamage"].(map[string]any)["commander-p2"] != damage {
		t.Fatalf("atomic damage mismatch: %#v", snapshot.Players["p1"])
	}
	if result.Event.Payload["delta"] != delta || result.Event.Payload["effectVersion"] != atomicLifecycleEffectVersion {
		t.Fatalf("event schema mismatch: %#v", result.Event.Payload)
	}
	assertPublicOps(t, result, "player.commanderDamage.set", "player.life.set", "eventLog.append")
}

func assertPublicOps(t *testing.T, result CommandResult, expected ...string) {
	t.Helper()
	if len(result.Patches) != 1 || result.Patches[0].Visibility != protocol.VisibilityPublic {
		t.Fatalf("expected one public patch: %#v", result.Patches)
	}
	seen := map[string]bool{}
	for _, op := range result.Patches[0].Ops {
		seen[op.Op] = true
	}
	for _, op := range expected {
		if !seen[op] {
			t.Fatalf("missing op %s in %#v", op, result.Patches[0].Ops)
		}
	}
}

func commanderDamagePayload(targetPlayerID string, sourcePlayerID string, commanderInstanceID string, damage int) map[string]any {
	return map[string]any{
		"targetPlayerId": targetPlayerID, "sourcePlayerId": sourcePlayerID,
		"commanderInstanceId": commanderInstanceID, "damage": damage,
	}
}

func commanderDamageAtomicState() state.GameState {
	game := testState()
	game.Players["p1"]["status"] = "active"
	game.Players["p2"]["status"] = "active"
	game.Instances["commander-p2"] = state.CardInstanceRuntime{
		InstanceID: "commander-p2", CardKey: "commander-p2@1", OwnerID: "p2", ControllerID: "p2", Zone: state.ZoneCommand, IsCommander: true,
	}
	game.Zones["p2"] = state.PlayerZones{Command: []string{"commander-p2"}}
	game.Loc["commander-p2"] = state.Location{PlayerID: "p2", Zone: state.ZoneCommand, Index: 0, ControllerID: "p2"}
	return game
}
