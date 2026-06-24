package actor

import (
	"context"
	"fmt"
	"strings"
	"time"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

type CardsPositionChangedApplier struct{}

func (CardsPositionChangedApplier) Type() string { return "cards.position.changed" }

func (CardsPositionChangedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	rawPositions, ok := command.Payload["positions"]
	if !ok {
		return nil, fmt.Errorf("%w: positions", ErrMissingPayloadField)
	}
	positions := []map[string]any{}
	switch typed := rawPositions.(type) {
	case []map[string]any:
		positions = append(positions, typed...)
	case []any:
		for _, raw := range typed {
			entry, ok := raw.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("%w: positions", ErrInvalidPayloadField)
			}
			positions = append(positions, entry)
		}
	default:
		return nil, fmt.Errorf("%w: positions", ErrInvalidPayloadField)
	}
	if len(positions) == 0 {
		return nil, fmt.Errorf("%w: positions", ErrMissingPayloadField)
	}

	applied := make([]map[string]any, 0, len(positions))
	for _, entry := range positions {
		instanceID, err := stringField(entry, "instanceId")
		if err != nil {
			return nil, err
		}
		position, ok := entry["position"].(map[string]any)
		if !ok || position == nil {
			return nil, fmt.Errorf("%w: position", ErrMissingPayloadField)
		}
		instance, location, err := instanceAt(game, instanceID, state.ZoneBattlefield)
		if err != nil {
			return nil, err
		}
		instance.Position = cloneMap(position)
		game.Instances[instanceID] = instance
		emitter.EmitPublic(protocol.PatchOp{
			Op: "card.field.set",
			Data: map[string]any{
				"instanceId": instanceID,
				"playerId":   location.PlayerID,
				"zone":       location.Zone,
				"position":   cloneMap(position),
			},
		})
		applied = append(applied, map[string]any{
			"instanceId": instanceID,
			"position":   cloneMap(position),
		})
	}

	return map[string]any{
		"playerId":  playerID,
		"zone":      state.ZoneBattlefield,
		"positions": applied,
		"metrics":   battlefieldMetrics(start, emitter),
	}, nil
}

type CounterChangedApplier struct{}

func (CounterChangedApplier) Type() string { return "counter.changed" }

func (CounterChangedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	scope, err := stringField(command.Payload, "scope")
	if err != nil {
		return nil, err
	}
	key, err := stringField(command.Payload, "key")
	if err != nil {
		return nil, err
	}

	if strings.HasPrefix(scope, "player:") {
		playerID := strings.TrimPrefix(scope, "player:")
		player, ok := game.Players[playerID]
		if !ok {
			return nil, fmt.Errorf("%w: playerId", ErrInvalidPayloadField)
		}
		counters := intMapFromAny(player["counters"])
		nextValue, err := nextCounterValue(counters[key], command.Payload, true)
		if err != nil {
			return nil, err
		}
		counters[key] = nextValue
		player["counters"] = anyMapFromIntMap(counters)
		game.Players[playerID] = player
		emitter.EmitPublic(protocol.PatchOp{
			Op: "player.counters.set",
			Data: map[string]any{
				"playerId": playerID,
				"counters": cloneIntMapAny(counters),
			},
		})
		return map[string]any{
			"scope":   scope,
			"key":     key,
			"value":   nextValue,
			"metrics": countersMetrics(start, emitter),
		}, nil
	}

	counters := cloneIntMap(game.SharedCounters[scope])
	nextValue, err := nextCounterValue(counters[key], command.Payload, strings.HasPrefix(scope, "commander:") && key == "casts")
	if err != nil {
		return nil, err
	}
	if game.SharedCounters == nil {
		game.SharedCounters = map[string]map[string]int{}
	}
	if counters == nil {
		counters = map[string]int{}
	}
	counters[key] = nextValue
	game.SharedCounters[scope] = counters
	emitter.EmitPublic(protocol.PatchOp{
		Op: "game.counters.set",
		Data: map[string]any{
			"scope":    scope,
			"counters": cloneIntMapAny(counters),
		},
	})
	return map[string]any{
		"scope":   scope,
		"key":     key,
		"value":   nextValue,
		"metrics": countersMetrics(start, emitter),
	}, nil
}

type CommanderDamageChangedApplier struct{}

func (CommanderDamageChangedApplier) Type() string { return "commander.damage.changed" }

func (CommanderDamageChangedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	targetPlayerID, err := stringField(command.Payload, "targetPlayerId")
	if err != nil {
		return nil, err
	}
	commanderInstanceID, err := stringField(command.Payload, "commanderInstanceId")
	if err != nil {
		return nil, err
	}
	player, ok := game.Players[targetPlayerID]
	if !ok {
		return nil, fmt.Errorf("%w: targetPlayerId", ErrInvalidPayloadField)
	}
	damage, ok := intField(command.Payload, "damage")
	if !ok {
		return nil, fmt.Errorf("%w: damage", ErrMissingPayloadField)
	}
	if damage < 0 {
		damage = 0
	}
	commanderDamage := intMapFromAny(player["commanderDamage"])
	commanderDamage[commanderInstanceID] = damage
	player["commanderDamage"] = anyMapFromIntMap(commanderDamage)
	game.Players[targetPlayerID] = player
	emitter.EmitPublic(protocol.PatchOp{
		Op: "player.commanderDamage.set",
		Data: map[string]any{
			"playerId":        targetPlayerID,
			"commanderDamage": cloneIntMapAny(commanderDamage),
		},
	})
	return map[string]any{
		"targetPlayerId":      targetPlayerID,
		"commanderInstanceId": commanderInstanceID,
		"damage":              damage,
		"metrics":             countersMetrics(start, emitter),
	}, nil
}

type CardPowerToughnessChangedApplier struct{}

func (CardPowerToughnessChangedApplier) Type() string { return "card.power_toughness.changed" }

func (CardPowerToughnessChangedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	instance, location, err := instanceAt(game, instanceID, state.ZoneBattlefield)
	if err != nil {
		return nil, err
	}
	if instance.MutableStats == nil {
		instance.MutableStats = map[string]any{}
	}
	patch := map[string]any{
		"instanceId": instanceID,
		"playerId":   location.PlayerID,
		"zone":       location.Zone,
	}
	for _, key := range []string{"power", "toughness", "loyalty", "defense", "saga"} {
		if !hasPayloadKey(command.Payload, key) {
			continue
		}
		instance.MutableStats[key] = command.Payload[key]
		patch[key] = command.Payload[key]
	}
	game.Instances[instanceID] = instance
	emitter.EmitPublic(protocol.PatchOp{Op: "card.field.set", Data: patch})
	patch["metrics"] = battlefieldMetrics(start, emitter)
	return patch, nil
}

func intMapFromAny(value any) map[string]int {
	switch typed := value.(type) {
	case map[string]int:
		return cloneIntMap(typed)
	case map[string]any:
		out := map[string]int{}
		for key, raw := range typed {
			number, ok := intFromAny(raw)
			if ok {
				out[key] = number
			}
		}
		return out
	default:
		return map[string]int{}
	}
}

func anyMapFromIntMap(values map[string]int) map[string]any {
	out := map[string]any{}
	for key, value := range values {
		out[key] = value
	}
	return out
}

func nextCounterValue(current int, payload map[string]any, clampToZero bool) (int, error) {
	if value, ok := intField(payload, "value"); ok {
		if clampToZero && value < 0 {
			return 0, nil
		}
		return value, nil
	}
	delta, ok := intField(payload, "delta")
	if !ok {
		return 0, fmt.Errorf("%w: value", ErrMissingPayloadField)
	}
	value := current + delta
	if clampToZero && value < 0 {
		value = 0
	}
	return value, nil
}

func hasPayloadKey(payload map[string]any, key string) bool {
	_, ok := payload[key]
	return ok
}

func cloneIntMap(values map[string]int) map[string]int {
	if values == nil {
		return map[string]int{}
	}
	out := make(map[string]int, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}

func nowUTC() time.Time {
	return time.Now().UTC()
}

func simpleMetrics(routeKey string, start time.Time, emitter *PatchEmitter) map[string]any {
	return map[string]any{
		routeKey:             1,
		"simple.patch_bytes": patchBytes(emitter),
		"simple.apply_ms":    float64(time.Since(start).Microseconds()) / 1000,
	}
}

func battlefieldMetrics(start time.Time, emitter *PatchEmitter) map[string]any {
	return map[string]any{
		"battlefield.runtime_route":   1,
		"battlefield.full_scan_count": 0,
		"battlefield.patch_bytes":     patchBytes(emitter),
		"battlefield.apply_ms":        float64(time.Since(start).Microseconds()) / 1000,
	}
}

func countersMetrics(start time.Time, emitter *PatchEmitter) map[string]any {
	return map[string]any{
		"counters.runtime_route":   1,
		"counters.full_scan_count": 0,
		"counters.patch_bytes":     patchBytes(emitter),
		"counters.apply_ms":        float64(time.Since(start).Microseconds()) / 1000,
	}
}
