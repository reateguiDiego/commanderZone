package actor

import (
	"context"
	"encoding/json"
	"time"

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
	start := time.Now()
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
	position := insertPosition(command.Payload)
	for _, instanceID := range instanceIDs {
		location, ok := game.GetLocation(instanceID)
		if !ok {
			return nil, state.ErrMissingInstance
		}
		if expectedFrom, ok := command.Payload["fromZone"].(string); ok && expectedFrom != "" && location.Zone != state.Zone(expectedFrom) {
			return nil, ErrInvalidPayloadField
		}
	}

	ops := state.NewZoneOps()
	moves, err := ops.MoveMany(game, instanceIDs, toPlayerID, toZone, position)
	if err != nil {
		return nil, err
	}

	emitMovementPatches(emitter, game, moves)
	emitPrunedRelationPatches(emitter, pruneRelationsForMoves(game, moves))
	emitTouchedZoneCounts(emitter, game, moves)
	return map[string]any{
		"playerId":    playerID,
		"instanceIds": instanceIDs,
		"toPlayerId":  toPlayerID,
		"toZone":      string(toZone),
		"moves":       movementEventMoves(moves),
		"metrics":     movementMetrics(start, ops, len(moves), emitter),
	}, nil
}

type ZoneReorderedByIDsApplier struct{}

func (ZoneReorderedByIDsApplier) Type() string { return "zone.reorderedByIds" }

func (ZoneReorderedByIDsApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
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
	ops := state.NewZoneOps()
	if err := ops.ReorderByIDs(game, playerID, zone, orderedIDs); err != nil {
		return nil, err
	}
	patch := protocol.PatchOp{
		Op: "zone.reordered",
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
	return map[string]any{"playerId": playerID, "zone": string(zone), "instanceIds": orderedIDs, "metrics": movementMetrics(start, ops, len(orderedIDs), emitter)}, nil
}

type ZoneMoveAllApplier struct{}

func (ZoneMoveAllApplier) Type() string { return "zone.move_all" }

func (ZoneMoveAllApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
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
	toPlayerID := targetPlayerID(command.Payload, playerID)
	ops := state.NewZoneOps()
	moves, err := ops.MoveAll(game, playerID, fromZone, toPlayerID, toZone, insertPosition(command.Payload))
	if err != nil {
		return nil, err
	}
	emitMovementPatches(emitter, game, moves)
	emitPrunedRelationPatches(emitter, pruneRelationsForMoves(game, moves))
	emitTouchedZoneCounts(emitter, game, moves)
	return map[string]any{"playerId": playerID, "targetPlayerId": toPlayerID, "fromZone": string(fromZone), "toZone": string(toZone), "count": len(moves), "moves": movementEventMoves(moves), "metrics": movementMetrics(start, ops, len(moves), emitter)}, nil
}

type BattlefieldUntapAllApplier struct{}

func (BattlefieldUntapAllApplier) Type() string { return "battlefield.untap_all" }

func (BattlefieldUntapAllApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
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
		emitter.EmitPublic(protocol.PatchOp{
			Op: "card.field.set",
			Data: map[string]any{
				"instanceId": instanceID,
				"playerId":   playerID,
				"zone":       state.ZoneBattlefield,
				"tapped":     false,
				"rotation":   0,
			},
		})
	}
	return map[string]any{
		"playerId":    playerID,
		"instanceIds": untapped,
		"metrics":     battlefieldMetrics(start, emitter),
	}, nil
}

func insertPosition(payload map[string]any) state.ZoneInsertPosition {
	switch value, _ := payload["position"].(string); value {
	case "top":
		return state.ZoneInsertTop
	case "bottom":
		return state.ZoneInsertBottom
	default:
		return state.ZoneInsertAppend
	}
}

func emitMovementPatches(emitter *PatchEmitter, game *state.GameState, moves []state.ZoneMove) {
	publicMoves := []map[string]any{}
	publicAddsByZone := map[string][]map[string]any{}
	publicRemovesByZone := map[string][]string{}
	privateMovesByPlayer := map[string][]map[string]any{}

	for _, move := range moves {
		fromPrivate := privateZone(move.From.Zone)
		toPrivate := privateZone(move.To.Zone)
		moveData := movementPatchMove(game, "", move)
		if !fromPrivate && !toPrivate {
			publicMoves = append(publicMoves, moveData)
		} else {
			if !fromPrivate && toPrivate {
				key := zoneKey(move.From.PlayerID, move.From.Zone)
				publicRemovesByZone[key] = append(publicRemovesByZone[key], move.InstanceID)
			}
			if fromPrivate && !toPrivate {
				removeKey := zoneKey(move.From.PlayerID, move.From.Zone)
				publicRemovesByZone[removeKey] = append(publicRemovesByZone[removeKey], move.InstanceID)
				key := zoneKey(move.To.PlayerID, move.To.Zone)
				publicAddsByZone[key] = append(publicAddsByZone[key], cardPatchData(game, "", move.InstanceID))
			}
		}
		for _, playerID := range privatePatchPlayers(move) {
			privateMovesByPlayer[playerID] = append(privateMovesByPlayer[playerID], movementPatchMove(game, playerID, move))
		}
	}

	emitMoveBatch(emitter.EmitPublic, publicMoves)
	for key, ids := range publicRemovesByZone {
		playerID, zone := splitZoneKey(key)
		emitter.EmitPublic(protocol.PatchOp{Op: "zone.cards.remove", Data: map[string]any{"playerId": playerID, "zone": zone, "instanceIds": ids}})
	}
	for key, cards := range publicAddsByZone {
		playerID, zone := splitZoneKey(key)
		emitter.EmitPublic(protocol.PatchOp{Op: "zone.cards.add", Data: map[string]any{"playerId": playerID, "zone": zone, "cards": cards}})
	}
	for playerID, privateMoves := range privateMovesByPlayer {
		emitMoveBatch(func(op protocol.PatchOp) { emitter.EmitPrivate(playerID, op) }, privateMoves)
	}
}

func emitMoveBatch(emit func(protocol.PatchOp), moves []map[string]any) {
	if len(moves) == 0 {
		return
	}
	if len(moves) == 1 {
		emit(protocol.PatchOp{Op: "zone.cards.move", Data: moves[0]})
		return
	}
	emit(protocol.PatchOp{Op: "zone.cards.batchMove", Data: map[string]any{"moves": moves}})
}

func movementPatchMove(game *state.GameState, viewerID string, move state.ZoneMove) map[string]any {
	data := map[string]any{
		"instanceId": move.InstanceID,
		"from": map[string]any{
			"playerId": move.From.PlayerID,
			"zone":     move.From.Zone,
			"index":    move.From.Index,
		},
		"to": map[string]any{
			"playerId": move.To.PlayerID,
			"zone":     move.To.Zone,
			"index":    move.To.Index,
		},
	}
	if !privateZone(move.To.Zone) || viewerID == move.To.PlayerID {
		data["card"] = cardPatchData(game, viewerID, move.InstanceID)
	}
	return data
}

func privatePatchPlayers(move state.ZoneMove) []string {
	seen := map[string]struct{}{}
	players := []string{}
	for _, location := range []state.Location{move.From, move.To} {
		if !privateZone(location.Zone) {
			continue
		}
		if _, ok := seen[location.PlayerID]; ok {
			continue
		}
		seen[location.PlayerID] = struct{}{}
		players = append(players, location.PlayerID)
	}
	return players
}

func privateZone(zone state.Zone) bool {
	return zone == state.ZoneHand || zone == state.ZoneLibrary
}

func emitTouchedZoneCounts(emitter *PatchEmitter, game *state.GameState, moves []state.ZoneMove) {
	touched := map[string]map[state.Zone]struct{}{}
	for _, move := range moves {
		if touched[move.From.PlayerID] == nil {
			touched[move.From.PlayerID] = map[state.Zone]struct{}{}
		}
		touched[move.From.PlayerID][move.From.Zone] = struct{}{}
		if touched[move.To.PlayerID] == nil {
			touched[move.To.PlayerID] = map[state.Zone]struct{}{}
		}
		touched[move.To.PlayerID][move.To.Zone] = struct{}{}
	}
	for playerID, zones := range touched {
		for zone := range zones {
			emitZoneCount(emitter, game, playerID, zone)
		}
	}
}

func movementEventMoves(moves []state.ZoneMove) []map[string]any {
	out := make([]map[string]any, 0, len(moves))
	for _, move := range moves {
		out = append(out, map[string]any{
			"instanceId": move.InstanceID,
			"from":       map[string]any{"playerId": move.From.PlayerID, "zone": move.From.Zone, "index": move.From.Index},
			"to":         map[string]any{"playerId": move.To.PlayerID, "zone": move.To.Zone, "index": move.To.Index},
		})
	}
	return out
}

func pruneRelationsForMoves(game *state.GameState, moves []state.ZoneMove) []state.RemovedRelation {
	ops := state.NewRelationsOps()
	removed := []state.RemovedRelation{}
	for _, move := range moves {
		if move.From.Zone != state.ZoneBattlefield || move.To.Zone == state.ZoneBattlefield {
			continue
		}
		removed = append(removed, ops.PruneForMovedInstance(game, move.InstanceID)...)
	}
	return removed
}

func emitPrunedRelationPatches(emitter *PatchEmitter, removed []state.RemovedRelation) {
	for _, relation := range removed {
		switch relation.Kind {
		case "arrow":
			emitter.EmitPublic(protocol.PatchOp{Op: "arrow.remove", Data: map[string]any{"id": relation.ID}})
			emitter.EmitPublic(protocol.PatchOp{Op: "relation.remove", Data: map[string]any{"kind": "arrow", "id": relation.ID}})
		case "attachment":
			emitter.EmitPublic(protocol.PatchOp{Op: "attachment.remove", Data: map[string]any{"id": relation.ID}})
			emitter.EmitPublic(protocol.PatchOp{Op: "relation.remove", Data: map[string]any{"kind": "attachment", "id": relation.ID}})
		}
	}
}

func movementMetrics(start time.Time, ops *state.ZoneOps, movedCount int, emitter *PatchEmitter) map[string]any {
	return map[string]any{
		"movement.runtime_route":     1,
		"movement.full_scan_count":   ops.FullScanCount(),
		"movement.reindex_count":     ops.ReindexCount(),
		"movement.cards_moved_count": movedCount,
		"movement.patch_bytes":       patchBytes(emitter),
		"movement.apply_ms":          float64(time.Since(start).Microseconds()) / 1000,
	}
}

func patchBytes(emitter *PatchEmitter) int {
	if emitter == nil {
		return 0
	}
	bytes, err := json.Marshal(emitter.opsByVisibility)
	if err != nil {
		return 0
	}
	return len(bytes)
}

func zoneKey(playerID string, zone state.Zone) string {
	return playerID + "\x00" + string(zone)
}

func splitZoneKey(key string) (string, state.Zone) {
	for index, char := range key {
		if char == '\x00' {
			return key[:index], state.Zone(key[index+1:])
		}
	}
	return key, ""
}
