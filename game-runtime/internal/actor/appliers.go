package actor

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"

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
		CardFaceDownInspectedApplier{},
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
		LibraryPlayTopFaceDownApplier{},
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
		DisconnectVoteApplier{},
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
		previousLife, _ := intFromAny(player["life"])
		life = previousLife + delta
	}
	previousLife, _ := intFromAny(player["life"])
	player["life"] = life
	emitter.EmitPublic(protocol.PatchOp{
		Op:   "player.life.set",
		Data: map[string]any{"playerId": playerID, "value": life},
	})
	return map[string]any{
		"playerId":     playerID,
		"life":         life,
		"previousLife": previousLife,
		"delta":        life - previousLife,
		"metrics":      simpleMetrics("simple.runtime_route", start, emitter),
	}, nil
}

type TurnChangedApplier struct{}

func (TurnChangedApplier) Type() string { return "turn.changed" }

func (TurnChangedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	if game.Turn == nil {
		game.Turn = map[string]any{}
	}
	previousTurn := cloneMap(game.Turn)
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
	return map[string]any{"turn": turn, "previousTurn": previousTurn, "metrics": simpleMetrics("simple.runtime_route", start, emitter)}, nil
}

type DiceRolledApplier struct{}

func (DiceRolledApplier) Type() string { return "dice.rolled" }

func (DiceRolledApplier) Apply(_ context.Context, _ *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	kind, err := stringField(command.Payload, "kind")
	if err != nil {
		return nil, err
	}
	result, err := rollDice(kind)
	if err != nil {
		return nil, err
	}
	payload := map[string]any{
		"kind":      kind,
		"result":    result,
		"value":     result,
		"createdAt": nowUTC().Format("2006-01-02T15:04:05Z07:00"),
	}
	if playerID, ok := command.Payload["playerId"].(string); ok && strings.TrimSpace(playerID) != "" {
		payload["playerId"] = strings.TrimSpace(playerID)
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
	counter, err := cardCounterName(command.Payload)
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
	previousValue := instance.Counters[counter]
	remove, _ := boolField(command.Payload, "remove")
	value, ok := intField(command.Payload, "value")
	if remove {
		value = 0
	} else if !ok {
		delta, hasDelta := intField(command.Payload, "delta")
		if !hasDelta {
			return nil, fmt.Errorf("%w: value", ErrMissingPayloadField)
		}
		value = instance.Counters[counter] + delta
	}
	if remove {
		delete(instance.Counters, counter)
		value = 0
	} else {
		instance.Counters[counter] = value
	}
	statPatch, hasStatPatch := applyPowerToughnessCounterDelta(&instance, counter, value-previousValue)
	game.Instances[instanceID] = instance
	patch := map[string]any{
		"instanceId": instanceID,
		"playerId":   location.PlayerID,
		"zone":       location.Zone,
		"counter":    counter,
		"value":      value,
		"counters":   cloneIntMapAny(instance.Counters),
	}
	if hasStatPatch {
		for key, value := range statPatch {
			patch[key] = value
		}
	}
	patchData := map[string]any{
		"instanceId": instanceID,
		"playerId":   location.PlayerID,
		"zone":       location.Zone,
		"counters":   cloneIntMapAny(instance.Counters),
	}
	if hasStatPatch {
		for key, value := range statPatch {
			patchData[key] = value
		}
	}
	emitter.EmitPublic(protocol.PatchOp{
		Op:   "card.counters.patch",
		Data: patchData,
	})
	patch["metrics"] = countersMetrics(start, emitter)
	return patch, nil
}

func rollDice(kind string) (any, error) {
	switch kind {
	case "coin":
		value, err := randomIntInclusive(1, 2)
		if err != nil {
			return nil, err
		}
		if value == 1 {
			return "cara", nil
		}
		return "cruz", nil
	case "d4":
		return randomIntInclusive(1, 4)
	case "d6":
		return randomIntInclusive(1, 6)
	case "d10":
		return randomIntInclusive(1, 10)
	case "d20":
		return randomIntInclusive(1, 20)
	default:
		return nil, fmt.Errorf("%w: kind", ErrInvalidPayloadField)
	}
}

func randomIntInclusive(minimum int, maximum int) (int, error) {
	if maximum < minimum {
		return 0, fmt.Errorf("%w: range", ErrInvalidPayloadField)
	}
	span := big.NewInt(int64(maximum - minimum + 1))
	value, err := rand.Int(rand.Reader, span)
	if err != nil {
		return 0, err
	}
	return minimum + int(value.Int64()), nil
}

func applyPowerToughnessCounterDelta(instance *state.CardInstanceRuntime, counter string, delta int) (map[string]any, bool) {
	modifier := 0
	switch counter {
	case "+1/+1":
		modifier = 1
	case "-1/-1":
		modifier = -1
	default:
		return nil, false
	}
	if delta == 0 {
		return nil, false
	}
	if instance.MutableStats == nil {
		instance.MutableStats = map[string]any{}
	}
	power := numericMutableStat(instance.MutableStats["power"]) + (delta * modifier)
	toughness := numericMutableStat(instance.MutableStats["toughness"]) + (delta * modifier)
	instance.MutableStats["power"] = power
	instance.MutableStats["toughness"] = toughness
	return map[string]any{"power": power, "toughness": toughness}, true
}

func numericMutableStat(value any) int {
	if parsed, ok := intFromAny(value); ok {
		return parsed
	}
	return 0
}

func cardCounterName(payload map[string]any) (string, error) {
	counter, counterErr := stringField(payload, "counter")
	legacyKey, keyErr := stringField(payload, "key")
	if counterErr == nil && keyErr == nil && counter != legacyKey {
		return "", fmt.Errorf("conflicting payload fields: counter and key")
	}
	if counterErr == nil {
		return counter, nil
	}
	if keyErr == nil {
		return legacyKey, nil
	}
	return "", fmt.Errorf("%w: counter", ErrMissingPayloadField)
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
		"isCommander":  instance.IsCommander,
	}
	for _, key := range []string{"power", "toughness", "loyalty", "defense", "saga"} {
		if value, ok := instance.MutableStats[key]; ok {
			data[key] = value
		}
	}
	if game.CanViewerSeeCardKey(viewerID, instanceID) {
		data["cardKey"] = instance.CardKey
		data["printId"] = printIDForViewer(instance, viewerID)
		data["cardVersion"] = cardVersionForViewer(instance, viewerID)
		data["language"] = languageForViewer(game, instance, viewerID)
		data["viewerVisibility"] = viewerVisibilityForZone(location.Zone)
	} else {
		data["hidden"] = true
	}
	return data
}

func printIDForViewer(instance state.CardInstanceRuntime, viewerID string) string {
	if viewerID != "" && viewerID == instance.OwnerID && instance.PrintID != "" {
		return instance.PrintID
	}
	return printIDFromCardKey(instance.CardKey)
}

func printIDFromCardKey(cardKey string) string {
	if strings.HasSuffix(cardKey, ":card") {
		return strings.TrimSuffix(cardKey, ":card")
	}
	return cardKey
}

func cardVersionForViewer(instance state.CardInstanceRuntime, viewerID string) string {
	if viewerID != "" && viewerID == instance.OwnerID && instance.CardVersion != "" {
		return instance.CardVersion
	}
	return "runtime-identity-v1"
}

func languageForViewer(game *state.GameState, instance state.CardInstanceRuntime, viewerID string) string {
	if viewerID != "" && viewerID == instance.OwnerID && instance.Language != "" {
		return instance.Language
	}
	if language := playerCardLanguage(game, viewerID); language != "" {
		return language
	}
	return "en"
}

func viewerVisibilityForZone(zone state.Zone) string {
	if privateZone(zone) {
		return "private"
	}
	return "public"
}

func playerCardLanguage(game *state.GameState, playerID string) string {
	if game == nil || playerID == "" {
		return ""
	}
	player := game.Players[playerID]
	if player == nil {
		return ""
	}
	user, _ := player["user"].(map[string]any)
	preferences, _ := user["preferences"].(map[string]any)
	language, _ := preferences["cardLanguage"].(string)
	language = strings.TrimSpace(language)
	if language == "" {
		return ""
	}
	return language
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
