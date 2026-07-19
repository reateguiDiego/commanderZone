package actor

import (
	"context"
	"fmt"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

const batchCardStateEffectVersion = 1

type CardsTappedSetApplier struct{}

func (CardsTappedSetApplier) Type() string { return "cards.tapped.set" }

func (CardsTappedSetApplier) Apply(ctx context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	instanceIDs, err := requiredBatchInstanceIDs(command)
	if err != nil {
		return nil, err
	}
	tapped, ok := boolField(command.Payload, "tapped")
	if !ok {
		return nil, fmt.Errorf("%w: tapped", ErrInvalidPayloadField)
	}

	for _, instanceID := range instanceIDs {
		single := command
		single.Type = "card.tapped"
		single.Payload = cloneMap(command.Payload)
		single.Payload["instanceId"] = instanceID
		if _, err := (CardTappedApplier{}).Apply(ctx, game, single, emitter); err != nil {
			return nil, err
		}
	}

	return map[string]any{
		"effectVersion": batchCardStateEffectVersion,
		"playerId":      optionalString(command.Payload, "playerId"),
		"zone":          "battlefield",
		"instanceIds":   append([]string(nil), instanceIDs...),
		"count":         len(instanceIDs),
		"tapped":        tapped,
		"actorPlayerId": actorPlayerID(command),
	}, nil
}

type CardsFaceDownSetApplier struct{}

func (CardsFaceDownSetApplier) Type() string { return "cards.face_down.set" }

func (CardsFaceDownSetApplier) Apply(ctx context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	instanceIDs, err := requiredBatchInstanceIDs(command)
	if err != nil {
		return nil, err
	}
	faceDown, ok := boolField(command.Payload, "faceDown")
	if !ok {
		return nil, fmt.Errorf("%w: faceDown", ErrInvalidPayloadField)
	}

	for _, instanceID := range instanceIDs {
		single := command
		single.Type = "card.face_down.changed"
		single.Payload = cloneMap(command.Payload)
		single.Payload["instanceId"] = instanceID
		if _, err := (CardFaceDownChangedApplier{}).Apply(ctx, game, single, emitter); err != nil {
			return nil, err
		}
	}

	return map[string]any{
		"effectVersion": batchCardStateEffectVersion,
		"playerId":      optionalString(command.Payload, "playerId"),
		"zone":          "battlefield",
		"instanceIds":   append([]string(nil), instanceIDs...),
		"count":         len(instanceIDs),
		"faceDown":      faceDown,
		"actorPlayerId": actorPlayerID(command),
	}, nil
}

func requiredBatchInstanceIDs(command protocol.CommandEnvelopeV2) ([]string, error) {
	instanceIDs, err := stringSliceField(command.Payload, "instanceIds")
	if err != nil {
		return nil, err
	}
	if len(instanceIDs) == 0 {
		return nil, fmt.Errorf("%w: instanceIds", ErrInvalidPayloadField)
	}
	return instanceIDs, nil
}
