package actor

import (
	"context"
	"fmt"
	"strconv"

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
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	count, ok := intField(command.Payload, "count")
	if !ok {
		count = 1
	}
	drawn, err := state.NewLibraryOps().DrawMany(game, playerID, count)
	if err != nil {
		return nil, err
	}
	cards := make([]map[string]any, 0, len(drawn))
	for _, instanceID := range drawn {
		cards = append(cards, cardPatchData(game, playerID, instanceID))
	}
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
	return map[string]any{"playerId": playerID, "count": len(drawn), "instanceIds": drawn}, nil
}

type LibraryRevealTopApplier struct{}

func (LibraryRevealTopApplier) Type() string { return "library.reveal_top" }

func (LibraryRevealTopApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	count, ok := intField(command.Payload, "count")
	if !ok {
		count = 1
	}
	top, err := state.NewLibraryOps().PeekTop(game, playerID, count)
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
	emitter.EmitGroup(strconv.FormatUint(mask, 10), protocol.PatchOp{
		Op: "library.top.revealed",
		Data: map[string]any{
			"playerId": playerID,
			"count":    count,
			"epoch":    window.Epoch,
			"cards":    cards,
		},
	})
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)
	return map[string]any{"playerId": playerID, "count": count, "instanceIds": top, "visibilityEpoch": window.Epoch}, nil
}

type LibraryReorderTopApplier struct{}

func (LibraryReorderTopApplier) Type() string { return "library.reorder_top" }

func (LibraryReorderTopApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	orderedTopIDs, err := stringSliceField(command.Payload, "instanceIds")
	if err != nil {
		return nil, err
	}
	if err := state.NewLibraryOps().ReorderTop(game, playerID, orderedTopIDs); err != nil {
		return nil, err
	}
	emitter.EmitPrivate(playerID, protocol.PatchOp{
		Op: "library.top.reordered",
		Data: map[string]any{
			"playerId":    playerID,
			"instanceIds": orderedTopIDs,
		},
	})
	return map[string]any{"playerId": playerID, "instanceIds": orderedTopIDs}, nil
}

type LibraryShuffleApplier struct{}

func (LibraryShuffleApplier) Type() string { return "library.shuffle" }

func (LibraryShuffleApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	before := game.Visibility.LibraryEpochByOwner[playerID]
	if err := state.NewLibraryOps().Shuffle(game, playerID); err != nil {
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
	return map[string]any{"playerId": playerID, "visibilityEpoch": after, "libraryOrder": append([]string(nil), game.Zones[playerID].Library...)}, nil
}
