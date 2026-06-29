package perf

import (
	"fmt"

	"commanderzone/game-runtime/internal/state"
)

type commandSpec struct {
	name        string
	commandType string
	payload     func(game state.GameState, iteration int, gameIndex int) (map[string]any, string, bool)
}

func commandSequence() []commandSpec {
	return []commandSpec{
		{name: "life", commandType: "life.changed", payload: func(_ state.GameState, iteration int, _ int) (map[string]any, string, bool) {
			return map[string]any{"playerId": "p1", "delta": -1 - iteration}, "p1", false
		}},
		{name: "turn", commandType: "turn.changed", payload: func(_ state.GameState, iteration int, _ int) (map[string]any, string, bool) {
			return map[string]any{"activePlayerId": "p2", "phase": "combat", "number": 2 + iteration}, "p1", false
		}},
		{name: "tap", commandType: "card.tapped", payload: func(_ state.GameState, _ int, _ int) (map[string]any, string, bool) {
			return map[string]any{"playerId": "p1", "zone": "battlefield", "instanceId": "p1-bf-00", "tapped": true}, "p1", false
		}},
		{name: "move", commandType: "card.moved", payload: func(game state.GameState, _ int, _ int) (map[string]any, string, bool) {
			instanceID, ok := firstZoneID(game, "p1", state.ZoneHand)
			if !ok {
				return nil, "p1", true
			}
			return map[string]any{"playerId": "p1", "fromZone": "hand", "toZone": "battlefield", "instanceId": instanceID, "position": map[string]any{"x": 0.38, "y": 0.56, "unit": "ratio"}}, "p1", false
		}},
		{name: "draw-1", commandType: "library.draw", payload: func(_ state.GameState, _ int, _ int) (map[string]any, string, bool) {
			return map[string]any{"playerId": "p1"}, "p1", false
		}},
		{name: "draw-7", commandType: "library.draw_many", payload: func(_ state.GameState, _ int, _ int) (map[string]any, string, bool) {
			return map[string]any{"playerId": "p2", "count": 7}, "p2", false
		}},
		{name: "reveal-top-10", commandType: "library.reveal_top", payload: func(_ state.GameState, _ int, _ int) (map[string]any, string, bool) {
			return map[string]any{"playerId": "p3", "count": 10, "viewers": []string{"p1", "p2", "p3", "p4"}, "visibleToMask": 15}, "p3", false
		}},
		{name: "cards-moved", commandType: "cards.moved", payload: func(game state.GameState, _ int, _ int) (map[string]any, string, bool) {
			instanceIDs := firstZoneIDs(game, "p1", state.ZoneHand, 5)
			if len(instanceIDs) == 0 {
				return nil, "p1", true
			}
			return map[string]any{"playerId": "p1", "fromZone": "hand", "toZone": "graveyard", "instanceIds": instanceIDs}, "p1", false
		}},
		{name: "zone-move-all", commandType: "zone.move_all", payload: func(_ state.GameState, _ int, _ int) (map[string]any, string, bool) {
			return map[string]any{"playerId": "p1", "fromZone": "graveyard", "toZone": "exile"}, "p1", false
		}},
		{name: "token-create-20", commandType: "card.token.created", payload: func(_ state.GameState, iteration int, gameIndex int) (map[string]any, string, bool) {
			return map[string]any{
				"playerId": "p1",
				"quantity": 20,
				"card": map[string]any{
					"name":      fmt.Sprintf("Benchmark Beast %d %d", iteration, gameIndex),
					"typeLine":  "Token Creature - Beast",
					"power":     3,
					"toughness": 3,
				},
			}, "p1", false
		}},
		{name: "stack-add", commandType: "stack.card_added", payload: func(_ state.GameState, iteration int, gameIndex int) (map[string]any, string, bool) {
			return map[string]any{"playerId": "p1", "instanceId": "p1-bf-01", "stackId": fmt.Sprintf("stack-bench-%02d-%03d", iteration, gameIndex)}, "p1", false
		}},
		{name: "attachment-create", commandType: "attachment.created", payload: func(_ state.GameState, iteration int, gameIndex int) (map[string]any, string, bool) {
			return map[string]any{"playerId": "p1", "id": fmt.Sprintf("attachment-bench-%02d-%03d", iteration, gameIndex), "equipmentInstanceId": "p1-bf-02", "attachedToInstanceId": "p1-bf-03"}, "p1", false
		}},
		{name: "mulligan-take", commandType: "mulligan.take", payload: func(_ state.GameState, _ int, _ int) (map[string]any, string, bool) {
			return map[string]any{"playerId": "p4", "rule": "VANCOUVER"}, "p4", false
		}},
		{name: "mulligan-keep", commandType: "mulligan.keep", payload: func(_ state.GameState, _ int, _ int) (map[string]any, string, bool) {
			return map[string]any{"playerId": "p4"}, "p4", false
		}},
		{name: "mulligan-scry", commandType: "mulligan.scry.confirm", payload: func(_ state.GameState, _ int, _ int) (map[string]any, string, bool) {
			return map[string]any{"playerId": "p4", "choice": "bottom"}, "p4", false
		}},
	}
}

func fixtureState(gameID string) state.GameState {
	game := state.GameState{
		GameID:         gameID,
		Version:        1,
		Status:         "mulligan",
		Phase:          state.PhaseMulligan,
		Players:        map[string]map[string]any{},
		SharedCounters: map[string]map[string]int{},
		Turn:           map[string]any{"activePlayerId": "p1", "phase": "main-1", "number": 1},
		Instances:      map[string]state.CardInstanceRuntime{},
		Zones:          map[string]state.PlayerZones{},
		Loc:            map[string]state.Location{},
		Visibility: state.VisibilityIndex{
			InstanceMasks:       map[string]uint64{},
			LibraryEpochByOwner: map[string]int64{},
			TopRevealWindows:    map[string]state.TopRevealWindow{},
		},
		Relations: state.Relations{
			Attachments: map[string]state.Relation{},
			Arrows:      map[string]state.Relation{},
			Helpers:     map[string]state.Relation{},
			Indexes: state.RelationIndexes{
				BySource: map[string][]string{},
				ByTarget: map[string][]string{},
			},
		},
		Stack: []state.StackItem{},
		Mulligan: state.MulliganState{
			Rule:              "VANCOUVER",
			FirstMulliganFree: false,
			PlayerStatus:      map[string]state.MulliganPlayerState{},
			ReadyPlayers:      map[string]bool{},
			ScryMode:          "VANCOUVER",
		},
	}
	for player := 1; player <= 4; player++ {
		playerID := fmt.Sprintf("p%d", player)
		game.Players[playerID] = map[string]any{"life": 40, "displayName": fmt.Sprintf("Player %d", player)}
		game.Zones[playerID] = state.PlayerZones{}
		for index := 0; index < 20; index++ {
			addCard(&game, playerID, state.ZoneBattlefield, fmt.Sprintf("%s-bf-%02d", playerID, index), index)
		}
		for index := 0; index < 7; index++ {
			addCard(&game, playerID, state.ZoneHand, fmt.Sprintf("%s-hand-%02d", playerID, index), index)
		}
		for index := 0; index < 73; index++ {
			addCard(&game, playerID, state.ZoneLibrary, fmt.Sprintf("%s-lib-%02d", playerID, index), index)
		}
		game.Mulligan.PlayerStatus[playerID] = state.MulliganPlayerState{
			Status:          state.MulliganStatusDeciding,
			CurrentHandSize: len(game.Zones[playerID].Hand),
			ScryMode:        "VANCOUVER",
		}
	}
	game.Stack = []state.StackItem{{
		StackID:          "stack-existing",
		SourceInstanceID: "p1-bf-00",
		CardKey:          "card:p1-bf-00",
		ControllerID:     "p1",
		Text:             "Seeded stack item",
	}}
	game.Relations.Attachments["attachment-existing"] = state.Relation{
		ID:       "attachment-existing",
		SourceID: "p1-bf-04",
		TargetID: "p1-bf-05",
		Meta:     map[string]any{"ownerId": "p1"},
	}
	game.Relations.Indexes.BySource["p1-bf-04"] = []string{"attachment-existing"}
	game.Relations.Indexes.ByTarget["p1-bf-05"] = []string{"attachment-existing"}
	return game
}

func addCard(game *state.GameState, playerID string, zone state.Zone, instanceID string, index int) {
	card := state.CardInstanceRuntime{
		InstanceID:    instanceID,
		CardKey:       "card:" + instanceID,
		OwnerID:       playerID,
		ControllerID:  playerID,
		Zone:          zone,
		Counters:      map[string]int{},
		MutableStats:  map[string]any{},
		VisibleToMask: 1,
	}
	if zone == state.ZoneBattlefield {
		card.Position = map[string]any{
			"x":    0.08 + float64(index%5)*0.17,
			"y":    0.12 + float64(index/5)*0.13,
			"unit": "ratio",
		}
		if index >= 18 {
			card.IsToken = true
			card.TokenMeta = map[string]any{"isCopy": false}
		}
	}
	game.Instances[instanceID] = card
	zones := game.Zones[playerID]
	switch zone {
	case state.ZoneLibrary:
		zones.Library = append(zones.Library, instanceID)
	case state.ZoneHand:
		zones.Hand = append(zones.Hand, instanceID)
	case state.ZoneBattlefield:
		zones.Battlefield = append(zones.Battlefield, instanceID)
	case state.ZoneGraveyard:
		zones.Graveyard = append(zones.Graveyard, instanceID)
	case state.ZoneExile:
		zones.Exile = append(zones.Exile, instanceID)
	case state.ZoneCommand:
		zones.Command = append(zones.Command, instanceID)
	}
	game.Zones[playerID] = zones
	game.Loc[instanceID] = state.Location{PlayerID: playerID, Zone: zone, Index: index, ControllerID: playerID}
}

func firstZoneID(game state.GameState, playerID string, zone state.Zone) (string, bool) {
	ids := firstZoneIDs(game, playerID, zone, 1)
	if len(ids) == 0 {
		return "", false
	}
	return ids[0], true
}

func firstZoneIDs(game state.GameState, playerID string, zone state.Zone, count int) []string {
	var source []string
	zones := game.Zones[playerID]
	switch zone {
	case state.ZoneLibrary:
		source = zones.Library
	case state.ZoneHand:
		source = zones.Hand
	case state.ZoneBattlefield:
		source = zones.Battlefield
	case state.ZoneGraveyard:
		source = zones.Graveyard
	case state.ZoneExile:
		source = zones.Exile
	case state.ZoneCommand:
		source = zones.Command
	}
	if count > len(source) {
		count = len(source)
	}
	return append([]string(nil), source[:count]...)
}
