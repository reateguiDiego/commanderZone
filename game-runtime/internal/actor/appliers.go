package actor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

var (
	ErrMissingPayloadField = errors.New("missing payload field")
	ErrInvalidPayloadField = errors.New("invalid payload field")
	ErrMissingInstance     = errors.New("missing instance")
)

func DefaultAppliers() []Applier {
	return []Applier{
		LifeChangedApplier{},
		TurnChangedApplier{},
		DiceRolledApplier{},
		CardTappedApplier{},
		CardCounterChangedApplier{},
		CardPositionChangedApplier{},
	}
}

type LifeChangedApplier struct{}

func (LifeChangedApplier) Type() string { return "life.changed" }

func (LifeChangedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	player, ok := game.Players[playerID]
	if !ok {
		return nil, fmt.Errorf("%w: playerId", ErrInvalidPayloadField)
	}
	life, ok := intField(command.Payload, "life")
	if !ok {
		delta, hasDelta := intField(command.Payload, "delta")
		if !hasDelta {
			return nil, fmt.Errorf("%w: life", ErrMissingPayloadField)
		}
		current, _ := intFromAny(player["life"])
		life = current + delta
	}
	player["life"] = life
	emitter.EmitPublic(protocol.PatchOp{
		Op:   "player.life.set",
		Data: map[string]any{"playerId": playerID, "life": life},
	})
	return map[string]any{"playerId": playerID, "life": life}, nil
}

type TurnChangedApplier struct{}

func (TurnChangedApplier) Type() string { return "turn.changed" }

func (TurnChangedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	if game.Turn == nil {
		game.Turn = map[string]any{}
	}
	for _, key := range []string{"activePlayerId", "phase", "step"} {
		if value, ok := command.Payload[key]; ok {
			game.Turn[key] = value
		}
	}
	if number, ok := intField(command.Payload, "number"); ok {
		game.Turn["number"] = number
	}
	turn := cloneMap(game.Turn)
	emitter.EmitPublic(protocol.PatchOp{Op: "turn.set", Data: map[string]any{"turn": turn}})
	return turn, nil
}

type DiceRolledApplier struct{}

func (DiceRolledApplier) Type() string { return "dice.rolled" }

func (DiceRolledApplier) Apply(_ context.Context, _ *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	payload := cloneMap(command.Payload)
	if _, ok := payload["result"]; !ok {
		payload["result"] = 1
	}
	emitter.EmitPublic(protocol.PatchOp{Op: "dice.result", Data: payload})
	return payload, nil
}

type CardTappedApplier struct{}

func (CardTappedApplier) Type() string { return "card.tapped" }

func (CardTappedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	instance, location, err := instanceAt(game, instanceID, state.ZoneBattlefield)
	if err != nil {
		return nil, err
	}
	tapped, ok := boolField(command.Payload, "tapped")
	if !ok {
		tapped = !instance.Tapped
	}
	instance.Tapped = tapped
	if rotation, ok := intField(command.Payload, "rotation"); ok {
		instance.Rotation = rotation
	} else if tapped {
		instance.Rotation = 90
	} else {
		instance.Rotation = 0
	}
	game.Instances[instanceID] = instance
	patch := map[string]any{
		"instanceId": instanceID,
		"playerId":   location.PlayerID,
		"zone":       location.Zone,
		"fields": map[string]any{
			"tapped":   instance.Tapped,
			"rotation": instance.Rotation,
		},
	}
	emitter.EmitPublic(protocol.PatchOp{Op: "card.field.set", Data: patch})
	return patch, nil
}

type CardCounterChangedApplier struct{}

func (CardCounterChangedApplier) Type() string { return "card.counter.changed" }

func (CardCounterChangedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	counter, err := stringField(command.Payload, "counter")
	if err != nil {
		return nil, err
	}
	instance, location, err := instanceAt(game, instanceID, "")
	if err != nil {
		return nil, err
	}
	if instance.Counters == nil {
		instance.Counters = map[string]int{}
	}
	value, ok := intField(command.Payload, "value")
	if !ok {
		delta, hasDelta := intField(command.Payload, "delta")
		if !hasDelta {
			return nil, fmt.Errorf("%w: value", ErrMissingPayloadField)
		}
		value = instance.Counters[counter] + delta
	}
	if value <= 0 {
		delete(instance.Counters, counter)
		value = 0
	} else {
		instance.Counters[counter] = value
	}
	game.Instances[instanceID] = instance
	patch := map[string]any{
		"instanceId": instanceID,
		"playerId":   location.PlayerID,
		"zone":       location.Zone,
		"counter":    counter,
		"value":      value,
	}
	emitter.EmitPublic(protocol.PatchOp{Op: "card.counters.patch", Data: patch})
	return patch, nil
}

type CardPositionChangedApplier struct{}

func (CardPositionChangedApplier) Type() string { return "card.position.changed" }

func (CardPositionChangedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	position, ok := command.Payload["position"].(map[string]any)
	if !ok || position == nil {
		return nil, fmt.Errorf("%w: position", ErrMissingPayloadField)
	}
	instance, location, err := instanceAt(game, instanceID, state.ZoneBattlefield)
	if err != nil {
		return nil, err
	}
	instance.Position = cloneMap(position)
	game.Instances[instanceID] = instance
	patch := map[string]any{
		"instanceId": instanceID,
		"playerId":   location.PlayerID,
		"zone":       location.Zone,
		"fields":     map[string]any{"position": cloneMap(position)},
	}
	emitter.EmitPublic(protocol.PatchOp{Op: "card.field.set", Data: patch})
	return patch, nil
}

func instanceAt(game *state.GameState, instanceID string, expectedZone state.Zone) (state.CardInstanceRuntime, state.Location, error) {
	if game == nil {
		return state.CardInstanceRuntime{}, state.Location{}, ErrMissingInstance
	}
	location, ok := game.GetLocation(instanceID)
	if !ok {
		return state.CardInstanceRuntime{}, state.Location{}, ErrMissingInstance
	}
	if expectedZone != "" && location.Zone != expectedZone {
		return state.CardInstanceRuntime{}, state.Location{}, ErrMissingInstance
	}
	instance, ok := game.Instances[instanceID]
	if !ok {
		return state.CardInstanceRuntime{}, state.Location{}, ErrMissingInstance
	}
	return instance, location, nil
}

func stringField(payload map[string]any, key string) (string, error) {
	value, ok := payload[key].(string)
	if !ok || value == "" {
		return "", fmt.Errorf("%w: %s", ErrMissingPayloadField, key)
	}
	return value, nil
}

func boolField(payload map[string]any, key string) (bool, bool) {
	value, ok := payload[key].(bool)
	return value, ok
}

func intField(payload map[string]any, key string) (int, bool) {
	return intFromAny(payload[key])
}

func intFromAny(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case float64:
		return int(typed), true
	case json.Number:
		parsed, err := strconv.Atoi(typed.String())
		return parsed, err == nil
	case string:
		parsed, err := strconv.Atoi(typed)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func cloneMap(values map[string]any) map[string]any {
	clone := make(map[string]any, len(values))
	for key, value := range values {
		clone[key] = value
	}
	return clone
}
