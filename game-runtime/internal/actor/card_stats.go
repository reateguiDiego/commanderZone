package actor

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

const cardStatsOverrideEffectVersion = 1

type PrintedStatKind string

const (
	PrintedStatNumeric  PrintedStatKind = "NUMERIC"
	PrintedStatFormula  PrintedStatKind = "FORMULA"
	PrintedStatSymbolic PrintedStatKind = "UNKNOWN_SYMBOLIC"
	PrintedStatAbsent   PrintedStatKind = "ABSENT"
)

var numericPrintedStatPattern = regexp.MustCompile(`^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$`)

func NormalizePrintedStat(value any) (string, PrintedStatKind) {
	if value == nil {
		return "", PrintedStatAbsent
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" {
		return "", PrintedStatAbsent
	}
	text = strings.ReplaceAll(text, "x", "X")
	if numericPrintedStatPattern.MatchString(text) {
		return text, PrintedStatNumeric
	}
	if strings.Contains(text, "*") || strings.Contains(text, "X") {
		return text, PrintedStatFormula
	}
	return text, PrintedStatSymbolic
}

type CardStatsOverrideSetApplier struct{}

func (CardStatsOverrideSetApplier) Type() string { return "card.stats.override.set" }

func (CardStatsOverrideSetApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	instance, location, err := instanceAt(game, instanceID, "")
	if err != nil {
		return nil, &AuthorizationError{Code: AuthorizationCodeInstanceNotFound, CommandType: command.Type, InstanceID: instanceID}
	}
	faceKey, faceIndex, err := statsFace(command, instance)
	if err != nil {
		return nil, err
	}
	power, hasPower, powerErr := manualOverrideAxis(command.Payload, "power", AuthorizationCodeInvalidPowerOverride, command.Type, instanceID)
	if powerErr != nil {
		return nil, powerErr
	}
	toughness, hasToughness, toughnessErr := manualOverrideAxis(command.Payload, "toughness", AuthorizationCodeInvalidToughnessOverride, command.Type, instanceID)
	if toughnessErr != nil {
		return nil, toughnessErr
	}
	if !hasPower && !hasToughness {
		return nil, &AuthorizationError{Code: AuthorizationCodeNoStatsAxisProvided, CommandType: command.Type, InstanceID: instanceID}
	}

	if instance.ManualOverrides == nil {
		instance.ManualOverrides = map[string]map[string]any{}
	}
	previous := cloneMap(instance.ManualOverrides[faceKey])
	next := cloneMap(previous)
	if hasPower {
		if power == nil {
			delete(next, "power")
		} else {
			next["power"] = power
		}
	}
	if hasToughness {
		if toughness == nil {
			delete(next, "toughness")
		} else {
			next["toughness"] = toughness
		}
	}
	actorID := strings.TrimSpace(firstString(command.Client["playerId"]))
	if _, ok := next["power"]; ok || hasMapKey(next, "toughness") {
		next["faceKey"] = faceKey
		next["faceIndex"] = faceIndex
		next["provenance"] = "manual"
		next["updatedByPlayerId"] = actorID
		next["updatedAtVersion"] = game.Version + 1
		instance.ManualOverrides[faceKey] = next
	} else {
		delete(instance.ManualOverrides, faceKey)
		next = nil
	}
	game.Instances[instanceID] = instance
	emitCardStatsOverridePatch(game, instance, location, "card.stats.override.set", instanceID, faceKey, faceIndex, previous, next, emitter)

	return statsOverridePayload(game, command, instanceID, location, faceKey, faceIndex, previous, next, providedStatsAxes(hasPower, hasToughness)), nil
}

type CardStatsOverrideClearApplier struct{}

func (CardStatsOverrideClearApplier) Type() string { return "card.stats.override.clear" }

func (CardStatsOverrideClearApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	instance, location, err := instanceAt(game, instanceID, "")
	if err != nil {
		return nil, &AuthorizationError{Code: AuthorizationCodeInstanceNotFound, CommandType: command.Type, InstanceID: instanceID}
	}
	faceKey, faceIndex, err := statsFace(command, instance)
	if err != nil {
		return nil, err
	}
	axes := clearStatsAxes(command.Payload)
	if len(axes) == 0 {
		return nil, &AuthorizationError{Code: AuthorizationCodeNoStatsAxisProvided, CommandType: command.Type, InstanceID: instanceID}
	}
	if instance.ManualOverrides == nil {
		instance.ManualOverrides = map[string]map[string]any{}
	}
	previous := cloneMap(instance.ManualOverrides[faceKey])
	next := cloneMap(previous)
	for _, axis := range axes {
		delete(next, axis)
	}
	if _, power := next["power"]; !power {
		if _, toughness := next["toughness"]; !toughness {
			delete(instance.ManualOverrides, faceKey)
			next = nil
		}
	}
	if next != nil {
		next["updatedByPlayerId"] = strings.TrimSpace(firstString(command.Client["playerId"]))
		next["updatedAtVersion"] = game.Version + 1
		instance.ManualOverrides[faceKey] = next
	}
	game.Instances[instanceID] = instance
	emitCardStatsOverridePatch(game, instance, location, "card.stats.override.clear", instanceID, faceKey, faceIndex, previous, next, emitter)

	payload := statsOverridePayload(game, command, instanceID, location, faceKey, faceIndex, previous, next, axes)
	payload["_eventType"] = "card.stats.override.cleared"
	return payload, nil
}

func manualOverrideAxis(payload map[string]any, axis, code, commandType, instanceID string) (any, bool, error) {
	raw, present := payload[axis]
	if !present {
		return nil, false, nil
	}
	if raw == nil {
		return nil, true, nil
	}
	switch value := raw.(type) {
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return value, true, nil
	case float32:
		if math.IsInf(float64(value), 0) || math.IsNaN(float64(value)) {
			return nil, false, &AuthorizationError{Code: code, CommandType: commandType, InstanceID: instanceID}
		}
		return value, true, nil
	case float64:
		if math.IsInf(value, 0) || math.IsNaN(value) {
			return nil, false, &AuthorizationError{Code: code, CommandType: commandType, InstanceID: instanceID}
		}
		return value, true, nil
	case string:
		normalized, kind := NormalizePrintedStat(value)
		if kind == PrintedStatAbsent {
			return nil, false, &AuthorizationError{Code: code, CommandType: commandType, InstanceID: instanceID}
		}
		return normalized, true, nil
	default:
		return nil, false, &AuthorizationError{Code: code, CommandType: commandType, InstanceID: instanceID}
	}
}

func statsFace(command protocol.CommandEnvelopeV2, instance state.CardInstanceRuntime) (string, int, error) {
	faceKey := strings.TrimSpace(firstString(command.Payload["faceKey"]))
	faceIndex, hasFaceIndex := intField(command.Payload, "faceIndex")
	if !hasFaceIndex && faceKey != "" {
		parsed, err := strconv.Atoi(faceKey)
		if err == nil {
			faceIndex = parsed
			hasFaceIndex = true
		}
	}
	if faceKey == "" && hasFaceIndex {
		faceKey = strconv.Itoa(faceIndex)
	}
	if faceKey == "" || faceIndex < 0 {
		return "", 0, &AuthorizationError{Code: AuthorizationCodeInvalidFace, CommandType: command.Type, InstanceID: instance.InstanceID}
	}
	if len(instance.PrintedStats) > 0 {
		if _, exists := instance.PrintedStats[faceKey]; !exists {
			return "", 0, &AuthorizationError{Code: AuthorizationCodeInvalidFace, CommandType: command.Type, InstanceID: instance.InstanceID}
		}
	}
	return faceKey, faceIndex, nil
}

func clearStatsAxes(payload map[string]any) []string {
	axes := []string{}
	if values, err := stringSliceField(payload, "axes"); err == nil {
		for _, value := range values {
			if (value == "power" || value == "toughness") && !stringSliceContains(axes, value) {
				axes = append(axes, value)
			}
		}
	}
	for _, axis := range []string{"power", "toughness"} {
		if value, ok := payload[axis].(bool); ok && value && !stringSliceContains(axes, axis) {
			axes = append(axes, axis)
		}
	}
	return axes
}

func providedStatsAxes(power, toughness bool) []string {
	axes := []string{}
	if power {
		axes = append(axes, "power")
	}
	if toughness {
		axes = append(axes, "toughness")
	}
	return axes
}

func statsOverridePayload(game *state.GameState, command protocol.CommandEnvelopeV2, instanceID string, location state.Location, faceKey string, faceIndex int, previous, next map[string]any, axes []string) map[string]any {
	return map[string]any{
		"effectVersion":    cardStatsOverrideEffectVersion,
		"instanceId":       instanceID,
		"playerId":         location.PlayerID,
		"zone":             string(location.Zone),
		"faceKey":          faceKey,
		"faceIndex":        faceIndex,
		"previousOverride": cloneMap(previous),
		"override":         cloneMap(next),
		"provenance":       "manual",
		"actorPlayerId":    strings.TrimSpace(firstString(command.Client["playerId"])),
		"updatedAtVersion": game.Version + 1,
		"axes":             axes,
	}
}

func emitCardStatsOverridePatch(game *state.GameState, instance state.CardInstanceRuntime, location state.Location, opName, instanceID, faceKey string, faceIndex int, previous, next map[string]any, emitter *PatchEmitter) {
	op := protocol.PatchOp{Op: opName, Data: map[string]any{
		"instanceId":       instanceID,
		"faceKey":          faceKey,
		"faceIndex":        faceIndex,
		"previousOverride": cloneMap(previous),
		"override":         cloneMap(next),
	}}
	if location.Zone != state.ZoneHand && location.Zone != state.ZoneLibrary {
		emitter.EmitPublic(op)
		return
	}
	emitter.EmitPrivate(location.PlayerID, op)
	if instance.VisibleToMask > 0 {
		if audience, err := visibilityAudienceFromMask(game, instance.VisibleToMask); err == nil {
			emitVisibilityAudiencePatch(emitter, audience, op)
		}
	}
}

func hasMapKey(values map[string]any, key string) bool {
	_, ok := values[key]
	return ok
}
