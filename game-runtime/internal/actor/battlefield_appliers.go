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

	type validatedPosition struct {
		instanceID       string
		instance         state.CardInstanceRuntime
		location         state.Location
		previousPosition map[string]any
		position         map[string]any
	}
	validated := make([]validatedPosition, 0, len(positions))
	seen := make(map[string]struct{}, len(positions))
	for index, entry := range positions {
		instanceID, err := stringField(entry, "instanceId")
		if err != nil {
			return nil, err
		}
		if _, exists := seen[instanceID]; exists {
			return nil, duplicatePositionError(command.Type, instanceID, index)
		}
		seen[instanceID] = struct{}{}
		instance, location, err := instanceAt(game, instanceID, state.ZoneBattlefield)
		if err != nil {
			return nil, err
		}
		if _, stack, stacked := state.NewRelationsOps().BattlefieldStackForInstance(game, instanceID); stacked && stack.RootInstanceID != instanceID {
			return nil, &RelationValidationError{Code: RelationCodeMemberMoveAmbiguous, CommandType: command.Type, InstanceID: instanceID, Index: index}
		}
		if location.PlayerID != playerID {
			return nil, &AuthorizationError{
				Code:        AuthorizationCodeZoneMismatch,
				CommandType: command.Type,
				InstanceID:  instanceID,
				Index:       index,
			}
		}
		position, err := canonicalRatioPosition(entry["position"], command.Type, instanceID, index)
		if err != nil {
			return nil, err
		}
		validated = append(validated, validatedPosition{
			instanceID:       instanceID,
			instance:         instance,
			location:         location,
			previousPosition: cloneMap(instance.Position),
			position:         position,
		})
	}

	applied := make([]map[string]any, 0, len(validated))
	previousPositions := make([]map[string]any, 0, len(validated))
	patchPositions := make([]map[string]any, 0, len(validated))
	for _, entry := range validated {
		instanceID := entry.instanceID
		instance := entry.instance
		position := entry.position
		instance.Position = cloneMap(position)
		game.Instances[instanceID] = instance
		applied = append(applied, map[string]any{
			"instanceId": instanceID,
			"position":   cloneMap(position),
		})
		previousPositions = append(previousPositions, map[string]any{
			"instanceId": instanceID,
			"position":   cloneMap(entry.previousPosition),
		})
		patchPositions = append(patchPositions, map[string]any{
			"instanceId": instanceID,
			"position":   cloneMap(position),
		})
	}
	emitPositionPatchByViewer(emitter, game, playerID, "cards.position.set", patchPositions)

	return map[string]any{
		"effectVersion":     PositionContractEffectVersion,
		"playerId":          playerID,
		"zone":              state.ZoneBattlefield,
		"previousPositions": previousPositions,
		"positions":         applied,
		"metrics":           battlefieldMetrics(start, emitter),
	}, nil
}

func emitPositionPatchByViewer(
	emitter *PatchEmitter,
	game *state.GameState,
	playerID string,
	opName string,
	positions []map[string]any,
) {
	hasFaceDown := false
	for _, entry := range positions {
		instanceID, _ := entry["instanceId"].(string)
		if game.Instances[instanceID].FaceDown {
			hasFaceDown = true
			break
		}
	}
	emit := func(visibilityPlayerID string, projected []map[string]any) {
		data := map[string]any{
			"effectVersion": PositionContractEffectVersion,
			"playerId":      playerID,
			"zone":          state.ZoneBattlefield,
		}
		if opName == "card.position.set" {
			data["instanceId"] = projected[0]["instanceId"]
			data["position"] = cloneMap(projected[0]["position"].(map[string]any))
			op := protocol.PatchOp{Op: "card.position.set", Data: data}
			if visibilityPlayerID == "" {
				emitter.EmitPublic(op)
			} else {
				emitter.EmitPrivate(visibilityPlayerID, op)
			}
			return
		}
		data["positions"] = projected
		op := protocol.PatchOp{Op: "cards.position.set", Data: data}
		if visibilityPlayerID == "" {
			emitter.EmitPublic(op)
		} else {
			emitter.EmitPrivate(visibilityPlayerID, op)
		}
	}
	if !hasFaceDown {
		emit("", positions)
		return
	}
	for viewerID := range game.Players {
		projected := make([]map[string]any, 0, len(positions))
		for _, entry := range positions {
			instanceID, _ := entry["instanceId"].(string)
			projectedID, visible := projectInstanceReferenceForViewer(game, instanceID, viewerID)
			if !visible {
				continue
			}
			position, _ := entry["position"].(map[string]any)
			projected = append(projected, map[string]any{
				"instanceId": projectedID,
				"position":   cloneMap(position),
			})
		}
		emit(viewerID, projected)
	}
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
	targetPlayerID, targetErr := stringField(command.Payload, "targetPlayerId")
	if targetErr != nil {
		return nil, &AuthorizationError{Code: AuthorizationCodeInvalidTarget, CommandType: command.Type}
	}
	sourcePlayerID, sourceErr := stringField(command.Payload, "sourcePlayerId")
	if sourceErr != nil || sourcePlayerID == targetPlayerID {
		return nil, &AuthorizationError{Code: AuthorizationCodeInvalidSource, CommandType: command.Type}
	}
	commanderInstanceID, commanderErr := stringField(command.Payload, "commanderInstanceId")
	if commanderErr != nil {
		return nil, &AuthorizationError{Code: AuthorizationCodeCommanderNotFound, CommandType: command.Type}
	}
	if err := playerMutationStatusError(game, targetPlayerID, AuthorizationCodeInvalidTarget, command.Type); err != nil {
		return nil, err
	}
	if err := playerMutationStatusError(game, sourcePlayerID, AuthorizationCodeInvalidSource, command.Type); err != nil {
		return nil, err
	}
	commander, ok := game.Instances[commanderInstanceID]
	if !ok {
		return nil, &AuthorizationError{Code: AuthorizationCodeCommanderNotFound, CommandType: command.Type, InstanceID: commanderInstanceID}
	}
	if !commander.IsCommander {
		return nil, &AuthorizationError{Code: AuthorizationCodeInvalidCommander, CommandType: command.Type, InstanceID: commanderInstanceID}
	}
	if commander.OwnerID != sourcePlayerID {
		return nil, &AuthorizationError{Code: AuthorizationCodeInvalidSource, CommandType: command.Type, InstanceID: commanderInstanceID}
	}
	damage, ok := intField(command.Payload, "damage")
	if !ok || damage < 0 {
		return nil, &AuthorizationError{Code: AuthorizationCodeInvalidTarget, CommandType: command.Type, InstanceID: commanderInstanceID}
	}
	player := game.Players[targetPlayerID]
	commanderDamage := intMapFromAny(player["commanderDamage"])
	previousDamage := commanderDamage[commanderInstanceID]
	delta := damage - previousDamage
	previousLife, hasLife := intFromAny(player["life"])
	if !hasLife {
		previousLife = 40
	}
	life := previousLife
	if delta > 0 {
		life -= delta
	}
	commanderDamage[commanderInstanceID] = damage
	player["commanderDamage"] = anyMapFromIntMap(commanderDamage)
	player["life"] = life
	game.Players[targetPlayerID] = player
	emitter.EmitPublic(protocol.PatchOp{
		Op: "player.commanderDamage.set",
		Data: map[string]any{
			"playerId":        targetPlayerID,
			"commanderDamage": cloneIntMapAny(commanderDamage),
		},
	})
	emitter.EmitPublic(protocol.PatchOp{
		Op:   "player.life.set",
		Data: map[string]any{"playerId": targetPlayerID, "value": life},
	})
	transition := defeatTransition{PreviousStatus: playerStatus(game, targetPlayerID), Status: playerStatus(game, targetPlayerID)}
	if damage >= 21 || life <= 0 {
		reason := "commander_damage"
		if damage < 21 {
			reason = "life"
		}
		transition, _ = eliminatePlayer(game, targetPlayerID, reason, eliminationContext{
			SourcePlayerID: sourcePlayerID, CommanderInstanceID: commanderInstanceID,
		}, emitter)
	}
	payload := map[string]any{
		"effectVersion":       atomicLifecycleEffectVersion,
		"targetPlayerId":      targetPlayerID,
		"sourcePlayerId":      sourcePlayerID,
		"commanderInstanceId": commanderInstanceID,
		"previousDamage":      previousDamage,
		"damage":              damage,
		"delta":               delta,
		"previousLife":        previousLife,
		"life":                life,
		"previousStatus":      transition.PreviousStatus,
		"status":              transition.Status,
		"statusChanged":       transition.StatusChanged,
		"metrics":             countersMetrics(start, emitter),
	}
	if transition.StatusChanged {
		payload["defeatReason"] = transition.EliminationReason
		addLifecycleEffects(payload, game, transition)
	}
	if transition.Turn != nil {
		payload["turn"] = cloneMap(transition.Turn)
	}
	return payload, nil
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
	emitInstancePatchByViewer(emitter, game, instanceID, "card.field.set", patch, false)
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
