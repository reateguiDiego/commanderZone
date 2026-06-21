package actor

import (
	"context"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

type CardMovedApplier struct{}

func (CardMovedApplier) Type() string { return "card.moved" }

func (CardMovedApplier) Apply(ctx context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	command.Payload["instanceIds"] = []string{instanceID}
	return CardsMovedApplier{}.Apply(ctx, game, command, emitter)
}

type CardsMovedApplier struct{}

func (CardsMovedApplier) Type() string { return "cards.moved" }

func (CardsMovedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	toZone, err := zoneField(command.Payload, "toZone")
	if err != nil {
		return nil, err
	}
	toPlayerID := targetPlayerID(command.Payload, playerID)
	instanceIDs, err := stringSliceField(command.Payload, "instanceIds")
	if err != nil {
		return nil, err
	}
	fromLocations := make(map[string]state.Location, len(instanceIDs))
	for _, instanceID := range instanceIDs {
		location, ok := game.GetLocation(instanceID)
		if !ok {
			return nil, state.ErrMissingInstance
		}
		if expectedFrom, ok := command.Payload["fromZone"].(string); ok && expectedFrom != "" && location.Zone != state.Zone(expectedFrom) {
			return nil, ErrInvalidPayloadField
		}
		fromLocations[instanceID] = location
	}

	insertIndex := -1
	if toZone == state.ZoneLibrary {
		if position, _ := command.Payload["position"].(string); position == "bottom" {
			insertIndex = 0
		}
	}
	for offset, instanceID := range instanceIDs {
		index := insertIndex
		if insertIndex == 0 {
			index = offset
		}
		if _, err := state.MoveInstance(game, instanceID, toPlayerID, toZone, index); err != nil {
			return nil, err
		}
	}

	publicMoved := make([]map[string]any, 0, len(instanceIDs))
	privateByPlayer := map[string][]map[string]any{}
	for _, instanceID := range instanceIDs {
		location := game.Loc[instanceID]
		if location.Zone == state.ZoneHand || location.Zone == state.ZoneLibrary {
			privateByPlayer[location.PlayerID] = append(privateByPlayer[location.PlayerID], cardPatchData(game, location.PlayerID, instanceID))
			continue
		}
		publicMoved = append(publicMoved, cardPatchData(game, "", instanceID))
	}
	if len(publicMoved) > 0 {
		emitter.EmitPublic(protocol.PatchOp{Op: "zone.cards.batchMove", Data: map[string]any{"cards": publicMoved}})
	}
	for ownerID, cards := range privateByPlayer {
		emitter.EmitPrivate(ownerID, protocol.PatchOp{Op: "zone.cards.batchMove", Data: map[string]any{"cards": cards}})
	}
	touched := map[string]map[state.Zone]struct{}{}
	for _, location := range fromLocations {
		if touched[location.PlayerID] == nil {
			touched[location.PlayerID] = map[state.Zone]struct{}{}
		}
		touched[location.PlayerID][location.Zone] = struct{}{}
	}
	if touched[toPlayerID] == nil {
		touched[toPlayerID] = map[state.Zone]struct{}{}
	}
	touched[toPlayerID][toZone] = struct{}{}
	for touchedPlayerID, zones := range touched {
		for zone := range zones {
			emitZoneCount(emitter, game, touchedPlayerID, zone)
		}
	}
	return map[string]any{"instanceIds": instanceIDs, "toPlayerId": toPlayerID, "toZone": toZone}, nil
}

type ZoneReorderedByIDsApplier struct{}

func (ZoneReorderedByIDsApplier) Type() string { return "zone.reorderedByIds" }

func (ZoneReorderedByIDsApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	zone, err := zoneField(command.Payload, "zone")
	if err != nil {
		return nil, err
	}
	orderedIDs, err := stringSliceField(command.Payload, "instanceIds")
	if err != nil {
		return nil, err
	}
	zones := game.Zones[playerID]
	currentIDs := zoneIDsForApplier(zones, zone)
	if !sameIDs(currentIDs, orderedIDs) {
		return nil, ErrInvalidPayloadField
	}
	game.Zones[playerID] = setZoneIDsForApplier(zones, zone, append([]string(nil), orderedIDs...))
	for index, instanceID := range orderedIDs {
		location := game.Loc[instanceID]
		location.Index = index
		game.Loc[instanceID] = location
	}
	patch := protocol.PatchOp{
		Op: "zone.cards.reordered",
		Data: map[string]any{
			"playerId":    playerID,
			"zone":        zone,
			"instanceIds": orderedIDs,
		},
	}
	if zone == state.ZoneHand || zone == state.ZoneLibrary {
		emitter.EmitPrivate(playerID, patch)
		emitZoneCount(emitter, game, playerID, zone)
	} else {
		emitter.EmitPublic(patch)
	}
	return map[string]any{"playerId": playerID, "zone": zone, "instanceIds": orderedIDs}, nil
}

type ZoneMoveAllApplier struct{}

func (ZoneMoveAllApplier) Type() string { return "zone.move_all" }

func (ZoneMoveAllApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	fromZone, err := zoneField(command.Payload, "fromZone")
	if err != nil {
		return nil, err
	}
	toZone, err := zoneField(command.Payload, "toZone")
	if err != nil {
		return nil, err
	}
	zones := game.Zones[playerID]
	instanceIDs := append([]string(nil), zoneIDsForApplier(zones, fromZone)...)
	for _, instanceID := range instanceIDs {
		if _, err := state.MoveInstance(game, instanceID, playerID, toZone, -1); err != nil {
			return nil, err
		}
	}
	emitter.EmitPublic(protocol.PatchOp{
		Op: "zone.cards.batchMove",
		Data: map[string]any{
			"playerId":    playerID,
			"fromZone":    fromZone,
			"toZone":      toZone,
			"instanceIds": instanceIDs,
		},
	})
	emitZoneCount(emitter, game, playerID, fromZone)
	emitZoneCount(emitter, game, playerID, toZone)
	return map[string]any{"playerId": playerID, "fromZone": fromZone, "toZone": toZone, "count": len(instanceIDs)}, nil
}

type BattlefieldUntapAllApplier struct{}

func (BattlefieldUntapAllApplier) Type() string { return "battlefield.untap_all" }

func (BattlefieldUntapAllApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	ids := game.Zones[playerID].Battlefield
	untapped := make([]string, 0, len(ids))
	for _, instanceID := range ids {
		instance := game.Instances[instanceID]
		if !instance.Tapped && instance.Rotation == 0 {
			continue
		}
		instance.Tapped = false
		instance.Rotation = 0
		game.Instances[instanceID] = instance
		untapped = append(untapped, instanceID)
	}
	if len(untapped) > 0 {
		emitter.EmitPublic(protocol.PatchOp{
			Op: "card.field.set",
			Data: map[string]any{
				"instanceIds": untapped,
				"fields":      map[string]any{"tapped": false, "rotation": 0},
			},
		})
	}
	return map[string]any{"playerId": playerID, "instanceIds": untapped}, nil
}

func zoneIDsForApplier(zones state.PlayerZones, zone state.Zone) []string {
	switch zone {
	case state.ZoneLibrary:
		return zones.Library
	case state.ZoneHand:
		return zones.Hand
	case state.ZoneBattlefield:
		return zones.Battlefield
	case state.ZoneGraveyard:
		return zones.Graveyard
	case state.ZoneExile:
		return zones.Exile
	case state.ZoneCommand:
		return zones.Command
	default:
		return nil
	}
}

func setZoneIDsForApplier(zones state.PlayerZones, zone state.Zone, ids []string) state.PlayerZones {
	switch zone {
	case state.ZoneLibrary:
		zones.Library = ids
	case state.ZoneHand:
		zones.Hand = ids
	case state.ZoneBattlefield:
		zones.Battlefield = ids
	case state.ZoneGraveyard:
		zones.Graveyard = ids
	case state.ZoneExile:
		zones.Exile = ids
	case state.ZoneCommand:
		zones.Command = ids
	}
	return zones
}

func sameIDs(a []string, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	counts := map[string]int{}
	for _, value := range a {
		counts[value]++
	}
	for _, value := range b {
		counts[value]--
	}
	for _, count := range counts {
		if count != 0 {
			return false
		}
	}
	return true
}
