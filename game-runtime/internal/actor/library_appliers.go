package actor

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

type LibraryDrawApplier struct{}

func (LibraryDrawApplier) Type() string { return "library.draw" }

func (LibraryDrawApplier) Apply(ctx context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	command.Payload["count"] = 1
	return LibraryDrawManyApplier{}.Apply(ctx, game, command, emitter)
}

type LibraryDrawManyApplier struct{}

func (LibraryDrawManyApplier) Type() string { return "library.draw_many" }

func (LibraryDrawManyApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	count, ok := intField(command.Payload, "count")
	if !ok {
		count = 1
	}
	ops := state.NewLibraryOps()
	drawn, err := ops.DrawMany(game, playerID, count)
	if err != nil {
		return nil, err
	}
	cards := make([]map[string]any, 0, len(drawn))
	for _, instanceID := range drawn {
		cards = append(cards, cardPatchData(game, playerID, instanceID))
	}
	emitter.EmitPrivate(playerID, protocol.PatchOp{
		Op: "zone.cards.remove",
		Data: map[string]any{
			"playerId":    playerID,
			"zone":        state.ZoneLibrary,
			"instanceIds": drawn,
		},
	})
	emitter.EmitPrivate(playerID, protocol.PatchOp{
		Op: "zone.cards.add",
		Data: map[string]any{
			"playerId": playerID,
			"zone":     state.ZoneHand,
			"cards":    cards,
		},
	})
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)
	emitZoneCount(emitter, game, playerID, state.ZoneHand)
	return map[string]any{
		"playerId":    playerID,
		"count":       len(drawn),
		"instanceIds": drawn,
		"metrics":     libraryMetrics(command.Type, start, ops),
	}, nil
}

type LibraryRevealTopApplier struct{}

func (LibraryRevealTopApplier) Type() string { return "library.reveal_top" }

func (LibraryRevealTopApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	count, ok := intField(command.Payload, "count")
	if !ok {
		count = 1
	}
	ops := state.NewLibraryOps()
	top, err := ops.PeekTop(game, playerID, count)
	if err != nil {
		return nil, err
	}
	mask := uint64(1)
	if value, ok := intField(command.Payload, "visibleToMask"); ok && value > 0 {
		mask = uint64(value)
	}
	viewers, _ := stringSliceField(command.Payload, "viewers")
	window := game.RevealTopWindow(playerID, count, viewers, mask)
	cards := make([]map[string]any, 0, len(top))
	for _, instanceID := range top {
		instance := game.Instances[instanceID]
		instance.VisibleToMask |= mask
		game.Instances[instanceID] = instance
		game.Visibility.InstanceMasks[instanceID] |= mask
		cards = append(cards, map[string]any{
			"instanceId": instanceID,
			"cardKey":    instance.CardKey,
		})
	}
	revealOp := protocol.PatchOp{
		Op: "library.top.revealed",
		Data: map[string]any{
			"playerId": playerID,
			"count":    count,
			"epoch":    window.Epoch,
			"cards":    cards,
		},
	}
	if len(viewers) == 1 {
		emitter.EmitPrivate(viewers[0], revealOp)
	} else {
		emitter.EmitGroup(strconv.FormatUint(mask, 10), revealOp)
	}
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)
	return map[string]any{
		"playerId":        playerID,
		"count":           count,
		"instanceIds":     top,
		"visibilityEpoch": window.Epoch,
		"metrics":         libraryMetrics(command.Type, start, ops),
	}, nil
}

type LibraryReorderTopApplier struct{}

func (LibraryReorderTopApplier) Type() string { return "library.reorder_top" }

func (LibraryReorderTopApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	orderedTopIDs, err := stringSliceField(command.Payload, "instanceIds")
	if err != nil {
		return nil, err
	}
	ops := state.NewLibraryOps()
	if err := ops.ReorderTop(game, playerID, orderedTopIDs); err != nil {
		return nil, err
	}
	emitter.EmitPrivate(playerID, protocol.PatchOp{
		Op: "library.top.reordered",
		Data: map[string]any{
			"playerId":    playerID,
			"instanceIds": orderedTopIDs,
		},
	})
	return map[string]any{"playerId": playerID, "instanceIds": orderedTopIDs, "metrics": libraryMetrics(command.Type, start, ops)}, nil
}

type LibraryMoveTopApplier struct{}

func (LibraryMoveTopApplier) Type() string { return "library.move_top" }

func (LibraryMoveTopApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	count, ok := intField(command.Payload, "count")
	if !ok {
		count = 1
	}
	destination, err := zoneField(command.Payload, "toZone")
	if err != nil {
		if raw, ok := command.Payload["destination"].(string); ok && raw != "" {
			command.Payload["toZone"] = raw
			destination, err = zoneField(command.Payload, "toZone")
		}
		if err != nil {
			return nil, err
		}
	}
	toPlayerID := targetPlayerID(command.Payload, playerID)
	ops := state.NewLibraryOps()
	var moved []string
	if destination == state.ZoneLibrary {
		position, _ := command.Payload["position"].(string)
		if position != "bottom" {
			return nil, fmt.Errorf("%w: position", ErrInvalidPayloadField)
		}
		moved, err = ops.MoveTopToBottom(game, playerID, count)
		toPlayerID = playerID
	} else {
		moved, err = ops.MoveTopToPlayerZone(game, playerID, count, toPlayerID, destination)
	}
	if err != nil {
		return nil, err
	}
	if destination == state.ZoneLibrary && toPlayerID == playerID {
		emitter.EmitPrivate(playerID, protocol.PatchOp{
			Op: "library.top.moved",
			Data: map[string]any{
				"playerId":    playerID,
				"count":       len(moved),
				"instanceIds": moved,
				"position":    "bottom",
			},
		})
		emitZoneCount(emitter, game, playerID, state.ZoneLibrary)
		return map[string]any{"playerId": playerID, "targetPlayerId": toPlayerID, "count": len(moved), "destination": string(destination), "instanceIds": moved, "metrics": libraryMetrics(command.Type, start, ops)}, nil
	}
	cards := make([]map[string]any, 0, len(moved))
	for _, instanceID := range moved {
		cards = append(cards, cardPatchData(game, toPlayerID, instanceID))
	}
	emitter.EmitPrivate(playerID, protocol.PatchOp{Op: "zone.cards.remove", Data: map[string]any{"playerId": playerID, "zone": state.ZoneLibrary, "instanceIds": moved}})
	emitter.EmitPrivate(toPlayerID, protocol.PatchOp{Op: "zone.cards.add", Data: map[string]any{"playerId": toPlayerID, "zone": destination, "cards": cards}})
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)
	emitZoneCount(emitter, game, toPlayerID, destination)
	return map[string]any{"playerId": playerID, "targetPlayerId": toPlayerID, "count": len(moved), "destination": string(destination), "instanceIds": moved, "metrics": libraryMetrics(command.Type, start, ops)}, nil
}

type LibraryPutTopApplier struct{}

func (LibraryPutTopApplier) Type() string { return "library.put_top" }

func (LibraryPutTopApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	return applyLibraryPut(command, game, emitter, true)
}

type LibraryPutBottomApplier struct{}

func (LibraryPutBottomApplier) Type() string { return "library.put_bottom" }

func (LibraryPutBottomApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	return applyLibraryPut(command, game, emitter, false)
}

type LibraryViewApplier struct{}

func (LibraryViewApplier) Type() string { return "library.view" }

func (LibraryViewApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	count, ok := intField(command.Payload, "count")
	if !ok {
		count = 1
	}
	ops := state.NewLibraryOps()
	top, err := ops.PeekTop(game, playerID, count)
	if err != nil {
		return nil, err
	}
	cards := make([]map[string]any, 0, len(top))
	for _, instanceID := range top {
		cards = append(cards, cardPatchData(game, playerID, instanceID))
	}
	emitter.EmitPrivate(playerID, protocol.PatchOp{
		Op: "library.top.viewed",
		Data: map[string]any{
			"playerId": playerID,
			"count":    len(cards),
			"cards":    cards,
		},
	})
	return map[string]any{"playerId": playerID, "count": len(cards), "instanceIds": top, "metrics": libraryMetrics(command.Type, start, ops)}, nil
}

type LibraryShuffleApplier struct{}

func (LibraryShuffleApplier) Type() string { return "library.shuffle" }

func (LibraryShuffleApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	before := game.Visibility.LibraryEpochByOwner[playerID]
	ops := state.NewLibraryOps()
	if err := ops.Shuffle(game, playerID); err != nil {
		return nil, err
	}
	after := game.Visibility.LibraryEpochByOwner[playerID]
	if after <= before {
		return nil, fmt.Errorf("%w: visibilityEpoch", ErrInvalidPayloadField)
	}
	emitter.EmitPrivate(playerID, protocol.PatchOp{
		Op: "library.shuffled",
		Data: map[string]any{
			"playerId":        playerID,
			"visibilityEpoch": after,
		},
	})
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)
	return map[string]any{"playerId": playerID, "visibilityEpoch": after, "libraryOrder": append([]string(nil), game.Zones[playerID].Library...), "metrics": libraryMetrics(command.Type, start, ops)}, nil
}

func applyLibraryPut(command protocol.CommandEnvelopeV2, game *state.GameState, emitter *PatchEmitter, top bool) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	from, ok := game.GetLocation(instanceID)
	if !ok {
		return nil, state.ErrMissingInstance
	}
	instance, ok := game.Instances[instanceID]
	if !ok {
		return nil, state.ErrMissingInstance
	}
	_, err = state.RemoveFromCurrentZone(game, instanceID)
	if err != nil {
		return nil, err
	}
	ops := state.NewLibraryOps()
	if top {
		err = ops.PutOnTop(game, playerID, instanceID)
	} else {
		err = ops.PutOnBottom(game, playerID, instanceID)
	}
	if err != nil {
		return nil, err
	}
	card := cardPatchData(game, playerID, instanceID)
	emitter.EmitPrivate(playerID, protocol.PatchOp{Op: "zone.cards.remove", Data: map[string]any{"playerId": from.PlayerID, "zone": from.Zone, "instanceIds": []string{instanceID}}})
	emitter.EmitPrivate(playerID, protocol.PatchOp{Op: "zone.cards.add", Data: map[string]any{"playerId": playerID, "zone": state.ZoneLibrary, "cards": []map[string]any{card}}})
	emitZoneCount(emitter, game, from.PlayerID, from.Zone)
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)
	position := "bottom"
	if top {
		position = "top"
	}
	return map[string]any{"playerId": playerID, "instanceId": instanceID, "fromPlayerId": from.PlayerID, "fromZone": from.Zone, "position": position, "cardKey": instance.CardKey, "metrics": libraryMetrics(command.Type, start, ops)}, nil
}

func libraryMetrics(commandType string, start time.Time, ops *state.LibraryOps) map[string]any {
	durationKey := "library.draw_ms"
	switch commandType {
	case "library.draw_many":
		durationKey = "library.draw_many_ms"
	case "library.reveal_top", "library.view":
		durationKey = "library.reveal_top_ms"
	case "library.reorder_top":
		durationKey = "library.reorder_top_ms"
	}
	return map[string]any{
		"library.runtime_route":   1,
		"library.full_scan_count": ops.FullScanCount(),
		"library.reindex_count":   ops.ReindexCount(),
		durationKey:               float64(time.Since(start).Microseconds()) / 1000,
	}
}
