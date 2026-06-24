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
		CardFaceDownChangedApplier{},
		CardRevealedApplier{},
		CardControllerChangedApplier{},
		CardsPositionChangedApplier{},
		CardCounterChangedApplier{},
		CounterChangedApplier{},
		CommanderDamageChangedApplier{},
		CardPowerToughnessChangedApplier{},
		CardPositionChangedApplier{},
		LibraryDrawApplier{},
		LibraryDrawManyApplier{},
		LibraryRevealTopApplier{},
		LibraryRevealApplier{},
		LibraryPlayTopRevealedApplier{},
		LibraryReorderTopApplier{},
		LibraryMoveTopApplier{},
		LibraryPutTopApplier{},
		LibraryPutBottomApplier{},
		LibraryViewApplier{},
		LibraryShuffleApplier{},
		CardTokenCreatedApplier{},
		CardTokenCopyCreatedApplier{},
		ZoneRandomCardSelectedApplier{},
		CardDungeonMarkerChangedApplier{},
		CardFaceChangedApplier{},
		CardMovedApplier{},
		CardsMovedApplier{},
		ZoneReorderedByIDsApplier{},
		ZoneMoveAllApplier{},
		BattlefieldUntapAllApplier{},
		StackCardAddedApplier{},
		StackItemRemovedApplier{},
		ArrowCreatedApplier{},
		ArrowRemovedApplier{},
		AttachmentCreatedApplier{},
		AttachmentRemovedApplier{},
		HelperCreatedApplier{},
		HelperUpdatedApplier{},
		HelperRemovedApplier{},
		GameConcedeApplier{},
		GameCloseApplier{},
		MulliganTakeApplier{},
		MulliganKeepApplier{},
		MulliganCardsBottomedApplier{},
		MulliganScryConfirmApplier{},
		MulliganReadyApplier{},
		MulliganCompletedApplier{},
		GamePhaseSetApplier{},
	}
}

type LifeChangedApplier struct{}

func (LifeChangedApplier) Type() string { return "life.changed" }

func (LifeChangedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
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
		Data: map[string]any{"playerId": playerID, "value": life},
	})
	return map[string]any{"playerId": playerID, "life": life, "metrics": simpleMetrics("simple.runtime_route", start, emitter)}, nil
}

type TurnChangedApplier struct{}

func (TurnChangedApplier) Type() string { return "turn.changed" }

func (TurnChangedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
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
	return map[string]any{"turn": turn, "metrics": simpleMetrics("simple.runtime_route", start, emitter)}, nil
}

type DiceRolledApplier struct{}

func (DiceRolledApplier) Type() string { return "dice.rolled" }

func (DiceRolledApplier) Apply(_ context.Context, _ *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	payload := cloneMap(command.Payload)
	if _, ok := payload["result"]; !ok {
		payload["result"] = 1
	}
	emitter.EmitPublic(protocol.PatchOp{Op: "dice.result", Data: payload})
	payload["metrics"] = simpleMetrics("simple.runtime_route", start, emitter)
	return payload, nil
}

type CardTappedApplier struct{}

func (CardTappedApplier) Type() string { return "card.tapped" }

func (CardTappedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
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
		"tapped":     instance.Tapped,
		"rotation":   instance.Rotation,
	}
	emitter.EmitPublic(protocol.PatchOp{Op: "card.field.set", Data: patch})
	patch["metrics"] = battlefieldMetrics(start, emitter)
	return patch, nil
}

type CardCounterChangedApplier struct{}

func (CardCounterChangedApplier) Type() string { return "card.counter.changed" }

func (CardCounterChangedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
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
		"counters":   cloneIntMapAny(instance.Counters),
	}
	emitter.EmitPublic(protocol.PatchOp{
		Op: "card.counters.patch",
		Data: map[string]any{
			"instanceId": instanceID,
			"playerId":   location.PlayerID,
			"zone":       location.Zone,
			"counters":   cloneIntMapAny(instance.Counters),
		},
	})
	patch["metrics"] = countersMetrics(start, emitter)
	return patch, nil
}

type CardPositionChangedApplier struct{}

func (CardPositionChangedApplier) Type() string { return "card.position.changed" }

func (CardPositionChangedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
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
		"position":   cloneMap(position),
	}
	emitter.EmitPublic(protocol.PatchOp{Op: "card.field.set", Data: patch})
	patch["metrics"] = battlefieldMetrics(start, emitter)
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
	case uint:
		return int(typed), true
	case uint64:
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

func zoneField(payload map[string]any, key string) (state.Zone, error) {
	value, err := stringField(payload, key)
	if err != nil {
		return "", err
	}
	switch state.Zone(value) {
	case state.ZoneLibrary, state.ZoneHand, state.ZoneBattlefield, state.ZoneGraveyard, state.ZoneExile, state.ZoneCommand:
		return state.Zone(value), nil
	default:
		return "", fmt.Errorf("%w: %s", ErrInvalidPayloadField, key)
	}
}

func stringSliceField(payload map[string]any, key string) ([]string, error) {
	raw, ok := payload[key]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrMissingPayloadField, key)
	}
	switch typed := raw.(type) {
	case []string:
		return append([]string(nil), typed...), nil
	case []any:
		values := make([]string, 0, len(typed))
		for _, item := range typed {
			value, ok := item.(string)
			if !ok || value == "" {
				return nil, fmt.Errorf("%w: %s", ErrInvalidPayloadField, key)
			}
			values = append(values, value)
		}
		return values, nil
	default:
		return nil, fmt.Errorf("%w: %s", ErrInvalidPayloadField, key)
	}
}

func targetPlayerID(payload map[string]any, fallback string) string {
	if value, ok := payload["targetPlayerId"].(string); ok && value != "" {
		return value
	}
	return fallback
}

func emitZoneCount(emitter *PatchEmitter, game *state.GameState, playerID string, zone state.Zone) {
	emitter.EmitPublic(protocol.PatchOp{
		Op: "zone.count.set",
		Data: map[string]any{
			"playerId": playerID,
			"zone":     zone,
			"count":    state.ZoneCount(game, playerID, zone),
		},
	})
}

func cardPatchData(game *state.GameState, viewerID string, instanceID string) map[string]any {
	instance := game.Instances[instanceID]
	location := game.Loc[instanceID]
	data := map[string]any{
		"instanceId":   instanceID,
		"ownerId":      instance.OwnerID,
		"controllerId": instance.ControllerID,
		"zone":         location.Zone,
		"playerId":     location.PlayerID,
		"tapped":       instance.Tapped,
		"rotation":     instance.Rotation,
		"counters":     instance.Counters,
		"position":     instance.Position,
		"faceDown":     instance.FaceDown,
	}
	for _, key := range []string{"power", "toughness", "loyalty", "defense", "saga"} {
		if value, ok := instance.MutableStats[key]; ok {
			data[key] = value
		}
	}
	if game.CanViewerSeeCardKey(viewerID, instanceID) {
		data["cardKey"] = instance.CardKey
	} else {
		data["hidden"] = true
	}
	return data
}

func cloneIntMapAny(values map[string]int) map[string]any {
	if values == nil {
		return map[string]any{}
	}
	clone := make(map[string]any, len(values))
	for key, value := range values {
		clone[key] = value
	}
	return clone
}

func allPlayerIDs(game *state.GameState) []string {
	playerIDs := make([]string, 0, len(game.Players))
	for playerID := range game.Players {
		playerIDs = append(playerIDs, playerID)
	}
	return playerIDs
}
