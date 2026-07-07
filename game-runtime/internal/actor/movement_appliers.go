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
	visualPosition := movementVisualPosition(command.Payload)
	requestedFaceDown, hasRequestedFaceDown := boolField(command.Payload, "faceDown")
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
	moves, err := moveManyWithZoneTransitionRules(game, ops, instanceIDs, toPlayerID, toZone, position)
	if err != nil {
		return nil, err
	}

	applyMovementZoneState(game, moves, visualPosition, hasRequestedFaceDown, requestedFaceDown)
	commanderCastCounters := applyCommanderCastCounters(game, moves)
	emitMovementPatches(emitter, game, moves)
	emitCommanderCastCounterPatches(emitter, commanderCastCounters)
	emitPrunedRelationPatches(emitter, pruneRelationsForMoves(game, moves))
	emitTouchedZoneCounts(emitter, game, moves)
	payload := map[string]any{
		"playerId":              playerID,
		"fromZone":              string(moves[0].From.Zone),
		"instanceIds":           instanceIDs,
		"instanceId":            instanceIDs[0],
		"toZone":                string(toZone),
		"position":              visualPosition,
		"moves":                 movementEventMoves(game, moves),
		"commanderCastCounters": commanderCastCounters,
		"metrics":               movementMetrics(start, ops, len(moves), emitter),
	}
	if target := uniformMoveTargetPlayerID(moves); target != "" {
		payload["toPlayerId"] = target
		payload["targetPlayerId"] = target
	}
	if hasRequestedFaceDown {
		payload["faceDown"] = requestedFaceDown
	}
	return payload, nil
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
	ids := append([]string(nil), movementZoneIDs(game.Zones[playerID], fromZone)...)
	moves, err := moveManyWithZoneTransitionRules(game, ops, ids, toPlayerID, toZone, insertPosition(command.Payload))
	if err != nil {
		return nil, err
	}
	applyMovementZoneState(game, moves, nil, false, false)
	commanderCastCounters := applyCommanderCastCounters(game, moves)
	emitMovementPatches(emitter, game, moves)
	emitCommanderCastCounterPatches(emitter, commanderCastCounters)
	emitPrunedRelationPatches(emitter, pruneRelationsForMoves(game, moves))
	emitTouchedZoneCounts(emitter, game, moves)
	payload := map[string]any{"playerId": playerID, "fromZone": string(fromZone), "toZone": string(toZone), "count": len(moves), "moves": movementEventMoves(game, moves), "commanderCastCounters": commanderCastCounters, "metrics": movementMetrics(start, ops, len(moves), emitter)}
	if target := uniformMoveTargetPlayerID(moves); target != "" {
		payload["targetPlayerId"] = target
	}
	return payload, nil
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

func movementVisualPosition(payload map[string]any) map[string]any {
	position, ok := payload["position"].(map[string]any)
	if !ok {
		return nil
	}
	return normalizedPoint(position)
}

func moveManyWithZoneTransitionRules(game *state.GameState, ops *state.ZoneOps, instanceIDs []string, requestedToPlayerID string, toZone state.Zone, position state.ZoneInsertPosition) ([]state.ZoneMove, error) {
	type moveGroup struct {
		toPlayerID string
		ids        []string
	}
	groups := []moveGroup{}
	indexByPlayer := map[string]int{}
	for _, instanceID := range instanceIDs {
		from := game.Loc[instanceID]
		toPlayerID := requestedToPlayerID
		if from.Zone == state.ZoneBattlefield && toZone != state.ZoneBattlefield {
			if ownerID := ownerDestinationPlayerID(game, instanceID, requestedToPlayerID); ownerID != "" {
				toPlayerID = ownerID
			}
		}
		if index, ok := indexByPlayer[toPlayerID]; ok {
			groups[index].ids = append(groups[index].ids, instanceID)
			continue
		}
		indexByPlayer[toPlayerID] = len(groups)
		groups = append(groups, moveGroup{toPlayerID: toPlayerID, ids: []string{instanceID}})
	}

	moves := make([]state.ZoneMove, 0, len(instanceIDs))
	for _, group := range groups {
		groupMoves, err := ops.MoveMany(game, group.ids, group.toPlayerID, toZone, position)
		if err != nil {
			return nil, err
		}
		moves = append(moves, groupMoves...)
	}
	return moves, nil
}

func ownerDestinationPlayerID(game *state.GameState, instanceID string, fallback string) string {
	instance := game.Instances[instanceID]
	if instance.OwnerID == "" {
		return fallback
	}
	if _, ok := game.Players[instance.OwnerID]; ok {
		return instance.OwnerID
	}
	if _, ok := game.Zones[instance.OwnerID]; ok {
		return instance.OwnerID
	}
	return fallback
}

func applyMovementZoneState(game *state.GameState, moves []state.ZoneMove, requestedPosition map[string]any, hasRequestedFaceDown bool, requestedFaceDown bool) {
	for offset, move := range moves {
		instance := game.Instances[move.InstanceID]
		if move.To.Zone != state.ZoneBattlefield {
			if move.From.Zone == state.ZoneBattlefield {
				resetBattlefieldExitState(game, move.InstanceID)
			} else {
				instance.Position = nil
				game.Instances[move.InstanceID] = instance
			}
			continue
		}

		if hasRequestedFaceDown {
			instance.FaceDown = requestedFaceDown
			if requestedFaceDown {
				instance.VisibleToMask = 0
				game.EnsureVisibility()
				delete(game.Visibility.InstanceMasks, move.InstanceID)
			}
		}
		if requestedPosition != nil {
			instance.Position = offsetBattlefieldPosition(requestedPosition, offset)
		} else if !validBattlefieldPosition(instance.Position) {
			instance.Position = defaultBattlefieldPosition(move.To.Index)
		}
		game.Instances[move.InstanceID] = instance
	}
}

func resetBattlefieldExitState(game *state.GameState, instanceID string) {
	instance := game.Instances[instanceID]
	if instance.OwnerID != "" {
		instance.ControllerID = instance.OwnerID
	}
	instance.Tapped = false
	instance.Rotation = 0
	instance.Counters = map[string]int{}
	instance.MutableStats = nil
	instance.Position = nil
	instance.FaceDown = false
	instance.ActiveFace = 0
	instance.VisibleToMask = 0
	game.EnsureVisibility()
	delete(game.Visibility.InstanceMasks, instanceID)
	game.Instances[instanceID] = instance
	if location, ok := game.Loc[instanceID]; ok {
		location.ControllerID = instance.ControllerID
		game.Loc[instanceID] = location
	}
}

func uniformMoveTargetPlayerID(moves []state.ZoneMove) string {
	if len(moves) == 0 {
		return ""
	}
	target := moves[0].To.PlayerID
	for _, move := range moves[1:] {
		if move.To.PlayerID != target {
			return ""
		}
	}
	return target
}

func movementZoneIDs(zones state.PlayerZones, zone state.Zone) []string {
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

func applyCommanderCastCounters(game *state.GameState, moves []state.ZoneMove) []map[string]any {
	applied := []map[string]any{}
	for _, move := range moves {
		if !isCommanderCastMove(game, move) {
			continue
		}
		instance := game.Instances[move.InstanceID]
		scope := "commander:" + move.InstanceID
		counters := cloneIntMap(game.SharedCounters[scope])
		counters["casts"] = counters["casts"] + 1
		if game.SharedCounters == nil {
			game.SharedCounters = map[string]map[string]int{}
		}
		game.SharedCounters[scope] = counters
		applied = append(applied, map[string]any{
			"scope":      scope,
			"instanceId": move.InstanceID,
			"playerId":   instance.OwnerID,
			"counters":   cloneIntMapAny(counters),
		})
	}
	return applied
}

func isCommanderCastMove(game *state.GameState, move state.ZoneMove) bool {
	if move.From.Zone != state.ZoneCommand {
		return false
	}
	if move.To.Zone != state.ZoneBattlefield && move.To.Zone != state.Zone("stack") {
		return false
	}
	instance := game.Instances[move.InstanceID]
	if !instance.IsCommander {
		return false
	}
	ownerID := instance.OwnerID
	if ownerID == "" {
		ownerID = move.From.PlayerID
	}
	return move.From.PlayerID == ownerID && move.To.PlayerID == ownerID
}

func emitCommanderCastCounterPatches(emitter *PatchEmitter, counters []map[string]any) {
	for _, counter := range counters {
		scope, _ := counter["scope"].(string)
		values, _ := counter["counters"].(map[string]any)
		if scope == "" || values == nil {
			continue
		}
		emitter.EmitPublic(protocol.PatchOp{
			Op: "game.counters.set",
			Data: map[string]any{
				"scope":    scope,
				"counters": cloneMap(values),
			},
		})
	}
}

func offsetBattlefieldPosition(position map[string]any, offset int) map[string]any {
	next := normalizedPoint(position)
	if offset == 0 {
		return next
	}
	next["x"] = clampFloat(toFloat(next["x"], 0.5)+(float64(offset)*0.035), 0.08, 0.92)
	next["y"] = clampFloat(toFloat(next["y"], 0.5)+(float64(offset)*0.045), 0.12, 0.88)
	return next
}

func defaultBattlefieldPosition(index int) map[string]any {
	if index < 0 {
		index = 0
	}
	column := index % 6
	row := index / 6
	return map[string]any{
		"x":    clampFloat(0.16+float64(column)*0.12, 0.08, 0.92),
		"y":    clampFloat(0.18+float64(row)*0.16, 0.12, 0.88),
		"unit": "ratio",
	}
}

func validBattlefieldPosition(position map[string]any) bool {
	if position == nil {
		return false
	}
	x := toFloat(position["x"], 0)
	y := toFloat(position["y"], 0)
	return x > 0 || y > 0
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
		privatePlayers := map[string]struct{}{}
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
			privatePlayers[playerID] = struct{}{}
		}
		for _, playerID := range localizedPublicIdentityPatchPlayers(game, move) {
			privatePlayers[playerID] = struct{}{}
		}
		for playerID := range privatePlayers {
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

func localizedPublicIdentityPatchPlayers(game *state.GameState, move state.ZoneMove) []string {
	if privateZone(move.To.Zone) {
		return nil
	}
	instance := game.Instances[move.InstanceID]
	seen := map[string]struct{}{}
	players := []string{}
	add := func(playerID string) {
		if playerID == "" {
			return
		}
		if _, ok := seen[playerID]; ok {
			return
		}
		seen[playerID] = struct{}{}
		players = append(players, playerID)
	}
	if instance.PrintID != "" || instance.CardVersion != "" || instance.Language != "" || localizedPlayerLanguage(game, instance.OwnerID) {
		add(instance.OwnerID)
	}
	for playerID := range game.Players {
		if localizedPlayerLanguage(game, playerID) {
			add(playerID)
		}
	}
	return players
}

func localizedPlayerLanguage(game *state.GameState, playerID string) bool {
	language := playerCardLanguage(game, playerID)
	return language != "" && language != "en"
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

func movementEventMoves(game *state.GameState, moves []state.ZoneMove) []map[string]any {
	out := make([]map[string]any, 0, len(moves))
	for _, move := range moves {
		out = append(out, map[string]any{
			"instanceId": move.InstanceID,
			"from":       map[string]any{"playerId": move.From.PlayerID, "zone": move.From.Zone, "index": move.From.Index},
			"to":         map[string]any{"playerId": move.To.PlayerID, "zone": move.To.Zone, "index": move.To.Index},
			"position":   cloneMap(game.Instances[move.InstanceID].Position),
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
