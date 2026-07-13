package actor

import (
	"context"
	"fmt"
	"testing"
	"time"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

func TestDurableDisconnectVoteStrictMajorityMatrixTwoToSix(t *testing.T) {
	for playerCount := 2; playerCount <= 6; playerCount++ {
		t.Run(fmt.Sprintf("%d_players", playerCount), func(t *testing.T) {
			initial := disconnectMatrixState(playerCount)
			gameActor := NewGameActor("game-vote", initial, nil, 16, DefaultAppliers())
			at := time.Now().UTC()
			connected := append([]string(nil), initial.TurnOrder...)
			connected = append(connected[:1], connected[2:]...)
			open := gameActor.ApplyDirect(context.Background(), disconnectPresenceCommand(1, "open", "p2", "offline", connected, at, ""), "")
			if open.Err != nil {
				t.Fatalf("open: %v", open.Err)
			}
			for _, patch := range open.Patches {
				for _, op := range patch.Ops {
					if op.Op != "player.presence.set" {
						continue
					}
					presence, _ := op.Data["presence"].(map[string]any)
					if _, leaked := presence["connectionEpoch"]; leaked {
						t.Fatalf("connection epoch leaked in public presence patch: %#v", op)
					}
				}
			}
			vote := gameActor.Snapshot().DisconnectVote
			required := (playerCount-1)/2 + 1
			if vote["requiredVotes"] != required {
				t.Fatalf("requiredVotes=%v want %d", vote["requiredVotes"], required)
			}
			eligible := stringsFromAny(vote["eligibleVoterIds"])
			for index, voterID := range eligible[:required] {
				result := gameActor.ApplyDirect(context.Background(), disconnectCastCommand(gameActor.Version(), fmt.Sprintf("cast-%d", index), "p2", durableVoteID(gameActor.Snapshot().DisconnectVote), "expel"), voterID)
				if result.Err != nil {
					t.Fatalf("cast %s: %v", voterID, result.Err)
				}
			}
			snapshot := gameActor.Snapshot()
			if snapshot.DisconnectVote["status"] != "executed" || snapshot.Players["p2"]["eliminationReason"] != "expelled" {
				t.Fatalf("expel not atomic: vote=%#v player=%#v", snapshot.DisconnectVote, snapshot.Players["p2"])
			}
			if snapshot.Status == "finished" || snapshot.Status == "closed" {
				t.Fatalf("expel auto-closed game: %#v", snapshot)
			}
		})
	}
}

func TestDurableDisconnectVoteFrozenQuorumDuplicateRetryAndWaitResolution(t *testing.T) {
	initial := disconnectMatrixState(4)
	gameActor := NewGameActor("game-vote", initial, nil, 16, DefaultAppliers())
	at := time.Now().UTC()
	open := gameActor.ApplyDirect(context.Background(), disconnectPresenceCommand(1, "open", "p2", "offline", []string{"p1", "p3", "p4"}, at, ""), "")
	if open.Err != nil {
		t.Fatal(open.Err)
	}
	voteID := durableVoteID(gameActor.Snapshot().DisconnectVote)
	firstCommand := disconnectCastCommand(2, "p1-expel", "p2", voteID, "expel")
	first := gameActor.ApplyDirect(context.Background(), firstCommand, "p1")
	retry := gameActor.ApplyDirect(context.Background(), firstCommand, "p1")
	if first.Err != nil || retry.Err != nil || retry.Event.Version != first.Event.Version {
		t.Fatalf("retry mismatch: first=%#v retry=%#v", first, retry)
	}
	beforeDuplicate := gameActor.Version()
	duplicate := gameActor.ApplyDirect(context.Background(), disconnectCastCommand(beforeDuplicate, "p1-again", "p2", voteID, "wait"), "p1")
	control, ok := AsControlPlaneError(duplicate.Err)
	if !ok || control.Code != "DUPLICATE_VOTE" || gameActor.Version() != beforeDuplicate {
		t.Fatalf("duplicate rejection mutated state: err=%v version=%d", duplicate.Err, gameActor.Version())
	}
	// Presence changes after open do not alter the frozen voter set or majority.
	presence := gameActor.ApplyDirect(context.Background(), disconnectPresenceCommand(beforeDuplicate, "p4-offline", "p4", "offline", []string{"p1", "p3"}, at.Add(10*time.Second), ""), "")
	if presence.Err != nil {
		t.Fatal(presence.Err)
	}
	vote := gameActor.Snapshot().DisconnectVote
	if vote["requiredVotes"] != 2 || len(stringsFromAny(vote["eligibleVoterIds"])) != 3 {
		t.Fatalf("quorum changed after presence: %#v", vote)
	}
	reconnect := gameActor.ApplyDirect(context.Background(), disconnectPresenceCommand(gameActor.Version(), "p4-online", "p4", "online", []string{"p1", "p3", "p4"}, at.Add(11*time.Second), ""), "")
	if reconnect.Err != nil {
		t.Fatal(reconnect.Err)
	}
	wait := gameActor.ApplyDirect(context.Background(), disconnectCastCommand(gameActor.Version(), "p3-wait", "p2", voteID, "wait"), "p3")
	if wait.Err != nil {
		t.Fatal(wait.Err)
	}
	wait = gameActor.ApplyDirect(context.Background(), disconnectCastCommand(gameActor.Version(), "p4-wait", "p2", voteID, "wait"), "p4")
	if wait.Err != nil {
		t.Fatal(wait.Err)
	}
	if gameActor.Snapshot().DisconnectVote["status"] != "rejected" {
		t.Fatalf("vote did not resolve wait: %#v", gameActor.Snapshot().DisconnectVote)
	}
}

func TestDurableDisconnectVoteTimeoutCooldownReconnectAndReplay(t *testing.T) {
	initial := disconnectMatrixState(3)
	gameActor := NewGameActor("game-vote", initial, nil, 16, DefaultAppliers())
	at := time.Now().UTC()
	open := gameActor.ApplyDirect(context.Background(), disconnectPresenceCommand(1, "open", "p2", "offline", []string{"p1", "p3"}, at, ""), "")
	if open.Err != nil {
		t.Fatal(open.Err)
	}
	voteID := durableVoteID(gameActor.Snapshot().DisconnectVote)
	expired := gameActor.ApplyDirect(context.Background(), disconnectPresenceCommand(2, "timeout", "p2", "timeout", []string{"p1", "p3"}, at.Add(61*time.Second), voteID), "")
	if expired.Err != nil || expired.Event.Type != "disconnect.vote.expired" {
		t.Fatalf("timeout: %#v", expired)
	}
	snapshot := gameActor.Snapshot()
	if snapshot.DisconnectVote["status"] != "expired" || snapshot.DisconnectCooldowns["p2"]["cooldownUntil"] == nil {
		t.Fatalf("timeout/cooldown not durable: %#v", snapshot.DisconnectVote)
	}
	reopen := gameActor.ApplyDirect(context.Background(), disconnectOpenCommand(3, "reopen", "p2"), "p1")
	control, ok := AsControlPlaneError(reopen.Err)
	if !ok || control.Code != "COOLDOWN_ACTIVE" || gameActor.Version() != 3 {
		t.Fatalf("cooldown rejection=%v version=%d", reopen.Err, gameActor.Version())
	}
	replayed, err := ReplayEvents(disconnectMatrixState(3), []protocol.EventPayloadV2{open.Event, expired.Event}, DefaultAppliers())
	if err != nil || replayed.DisconnectVote["status"] != "expired" || replayed.DisconnectCooldowns["p2"]["cooldownUntil"] == nil {
		t.Fatalf("replay lost durable timeout: state=%#v err=%v", replayed, err)
	}

	second := NewGameActor("game-vote", disconnectMatrixState(3), nil, 16, DefaultAppliers())
	open = second.ApplyDirect(context.Background(), disconnectPresenceCommand(1, "open-reconnect", "p2", "offline", []string{"p1", "p3"}, at, ""), "")
	if open.Err != nil {
		t.Fatal(open.Err)
	}
	reconnected := second.ApplyDirect(context.Background(), disconnectPresenceCommand(2, "reconnect", "p2", "online", []string{"p1", "p2", "p3"}, at.Add(10*time.Second), ""), "")
	if reconnected.Err != nil || second.Snapshot().DisconnectVote["status"] != "cancelled" || second.Snapshot().Players["p2"]["status"] != "active" {
		t.Fatalf("reconnect cancellation: result=%#v snapshot=%#v", reconnected, second.Snapshot())
	}
}

func TestDurableDisconnectVoteIsCancelledByTargetConcedeOpenerEliminationAndGameClose(t *testing.T) {
	at := time.Now().UTC()
	tests := []struct {
		name       string
		command    func(version int64) protocol.CommandEnvelopeV2
		actorID    string
		resolution string
	}{
		{
			name: "target concede",
			command: func(version int64) protocol.CommandEnvelopeV2 {
				return protocol.CommandEnvelopeV2{GameID: "game-vote", BaseVersion: version, ClientActionID: "target-concede", Type: "game.concede", Payload: map[string]any{"playerId": "p2"}}
			},
			actorID: "p2", resolution: "player_eliminated",
		},
		{
			name: "opener life defeat",
			command: func(version int64) protocol.CommandEnvelopeV2 {
				return protocol.CommandEnvelopeV2{GameID: "game-vote", BaseVersion: version, ClientActionID: "opener-lethal", Type: "life.changed", Payload: map[string]any{"playerId": "p1", "life": 0}}
			},
			actorID: "p1", resolution: "player_eliminated",
		},
		{
			name: "game close",
			command: func(version int64) protocol.CommandEnvelopeV2 {
				return protocol.CommandEnvelopeV2{GameID: "game-vote", BaseVersion: version, ClientActionID: "close", Type: "game.close", Payload: map[string]any{}}
			},
			actorID: "p1", resolution: "game_closed",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			initial := disconnectMatrixState(4)
			initial.OwnerID = "p1"
			gameActor := NewGameActor("game-vote", initial, nil, 16, DefaultAppliers())
			opened := gameActor.ApplyDirect(context.Background(), disconnectPresenceCommand(1, "open-"+test.name, "p2", "offline", []string{"p1", "p3", "p4"}, at, ""), "")
			if opened.Err != nil {
				t.Fatal(opened.Err)
			}
			result := gameActor.ApplyDirect(context.Background(), test.command(gameActor.Version()), test.actorID)
			if result.Err != nil {
				t.Fatalf("transition: %v", result.Err)
			}
			vote := gameActor.Snapshot().DisconnectVote
			if vote["status"] != "cancelled" || vote["resolution"] != test.resolution {
				t.Fatalf("vote remained active: %#v", vote)
			}
		})
	}
}

func disconnectMatrixState(playerCount int) state.GameState {
	game := testState()
	game.GameID = "game-vote"
	game.Players = map[string]map[string]any{}
	game.TurnOrder = []string{}
	for i := 1; i <= playerCount; i++ {
		playerID := fmt.Sprintf("p%d", i)
		game.Players[playerID] = map[string]any{
			"status": "active", "life": 40,
			"user": map[string]any{"id": playerID, "displayName": playerID},
		}
		game.TurnOrder = append(game.TurnOrder, playerID)
	}
	game.Turn = map[string]any{"activePlayerId": "p2", "phase": "combat", "number": 3}
	game.Presence = map[string]map[string]any{}
	game.DisconnectVote = map[string]any{}
	game.DisconnectCooldowns = map[string]map[string]any{}
	game.Rematch = map[string]any{}
	return game
}

func disconnectPresenceCommand(version int64, actionID, targetID, status string, connected []string, at time.Time, voteID string) protocol.CommandEnvelopeV2 {
	payload := map[string]any{
		"targetPlayerId": targetID, "status": status, "connectedUserIds": connected,
		"occurredAt": at.UTC().Format(time.RFC3339Nano),
	}
	if voteID != "" {
		payload["voteId"] = voteID
	}
	return protocol.CommandEnvelopeV2{
		GameID: "game-vote", BaseVersion: version, ClientActionID: actionID, Type: "disconnect.vote",
		Payload: payload, Client: map[string]any{"source": "runtime_ws_presence"},
	}
}

func disconnectCastCommand(version int64, actionID, targetID, voteID, decision string) protocol.CommandEnvelopeV2 {
	return protocol.CommandEnvelopeV2{
		GameID: "game-vote", BaseVersion: version, ClientActionID: actionID, Type: "disconnect.vote",
		Payload: map[string]any{"targetPlayerId": targetID, "voteId": voteID, "decision": decision},
	}
}

func disconnectOpenCommand(version int64, actionID, targetID string) protocol.CommandEnvelopeV2 {
	return protocol.CommandEnvelopeV2{
		GameID: "game-vote", BaseVersion: version, ClientActionID: actionID, Type: "disconnect.vote",
		Payload: map[string]any{"targetPlayerId": targetID, "action": "open"},
	}
}
