package actor

import (
	"context"
	"fmt"
	"hash/fnv"
	"math"
	"strconv"
	"strings"
	"time"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

const maxRuntimeTokenCreateQuantity = 20

type CardTokenCreatedApplier struct{}

func (CardTokenCreatedApplier) Type() string { return "card.token.created" }

func (CardTokenCreatedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	if _, ok := game.Players[playerID]; !ok {
		return nil, fmt.Errorf("%w: playerId", ErrInvalidPayloadField)
	}
	quantity := 1
	if value, ok := intField(command.Payload, "quantity"); ok {
		quantity = max(1, min(value, maxRuntimeTokenCreateQuantity))
	}
	card := mapField(command.Payload, "card")
	name := cleanString(card["name"])
	if name == "" {
		name = cleanString(command.Payload["name"])
	}
	if name == "" {
		name = "Token"
	}
	cardKey := runtimeTokenCardKey(card, name)
	tokenMeta := map[string]any{
		"isCopy":              false,
		"templateCardKey":     compactOptionalString(card["cardKey"]),
		"templateCardVersion": compactOptionalString(card["cardVersion"]),
		"templateScryfallId":  compactOptionalString(card["scryfallId"]),
		"mutableOverrides": map[string]any{
			"power":     compactStat(card["power"], fallbackTokenStat(card, "power", 1)),
			"toughness": compactStat(card["toughness"], fallbackTokenStat(card, "toughness", 1)),
			"loyalty":   compactStat(card["loyalty"], nil),
		},
		"flags": map[string]any{
			"isDungeon": strings.Contains(strings.ToLower(cleanString(card["typeLine"])), "dungeon"),
			"isEmblem":  strings.Contains(strings.ToLower(cleanString(card["typeLine"])), "emblem"),
		},
	}
	ids := make([]string, 0, quantity)
	for index := 0; index < quantity; index++ {
		instanceID := deterministicRuntimeID("token", command.ClientActionID, index)
		ids = append(ids, instanceID)
		game.Instances[instanceID] = state.CardInstanceRuntime{
			InstanceID:    instanceID,
			CardKey:       cardKey,
			OwnerID:       playerID,
			ControllerID:  playerID,
			Zone:          state.ZoneBattlefield,
			IsToken:       true,
			TokenMeta:     cloneMap(tokenMeta),
			Position:      tokenPosition(index, quantity, command.Payload),
			Counters:      map[string]int{},
			MutableStats:  tokenMutableStats(card),
			VisibleToMask: 1,
		}
	}
	ops := state.NewZoneOps()
	insertIndex, err := ops.AddMany(game, playerID, state.ZoneBattlefield, ids, state.ZoneInsertAppend)
	if err != nil {
		return nil, err
	}
	cards := make([]map[string]any, 0, len(ids))
	for _, instanceID := range ids {
		cards = append(cards, tokenPatchData(game.Instances[instanceID], name, false))
	}
	emitter.EmitPublic(protocol.PatchOp{
		Op: "zone.cards.add",
		Data: map[string]any{
			"playerId": playerID,
			"zone":     state.ZoneBattlefield,
			"index":    insertIndex,
			"cards":    cards,
		},
	})
	emitZoneCount(emitter, game, playerID, state.ZoneBattlefield)
	return map[string]any{
		"playerId":    playerID,
		"instanceIds": ids,
		"count":       quantity,
		"cardKey":     cardKey,
		"tokenMeta":   tokenMeta,
		"metrics":     edgeMetrics("edge.token_create_ms", start, emitter),
	}, nil
}

type CardTokenCopyCreatedApplier struct{}

func (CardTokenCopyCreatedApplier) Type() string { return "card.token_copy.created" }

func (CardTokenCopyCreatedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	sourceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	source, sourceLocation, err := instanceAt(game, sourceID, "")
	if err != nil {
		return nil, err
	}
	targetPlayerID := targetPlayerID(command.Payload, sourceLocation.PlayerID)
	if _, ok := game.Players[targetPlayerID]; !ok {
		return nil, fmt.Errorf("%w: targetPlayerId", ErrInvalidPayloadField)
	}
	instanceID := deterministicRuntimeID("token-copy", command.ClientActionID, 0)
	tokenMeta := map[string]any{
		"isCopy":               true,
		"copiedFromInstanceId": sourceID,
		"copiedFromCardKey":    source.CardKey,
		"copiedValues": map[string]any{
			"power":     source.MutableStats["power"],
			"toughness": source.MutableStats["toughness"],
			"loyalty":   source.MutableStats["loyalty"],
		},
	}
	copy := state.CardInstanceRuntime{
		InstanceID:    instanceID,
		CardKey:       source.CardKey,
		OwnerID:       targetPlayerID,
		ControllerID:  targetPlayerID,
		Zone:          state.ZoneBattlefield,
		IsToken:       true,
		TokenMeta:     tokenMeta,
		Position:      offsetTokenCopyPosition(source.Position),
		Counters:      map[string]int{},
		MutableStats:  cloneMap(source.MutableStats),
		ActiveFace:    source.ActiveFace,
		VisibleToMask: 1,
	}
	game.Instances[instanceID] = copy
	ops := state.NewZoneOps()
	insertIndex, err := ops.AddMany(game, targetPlayerID, state.ZoneBattlefield, []string{instanceID}, state.ZoneInsertAppend)
	if err != nil {
		return nil, err
	}
	emitter.EmitPublic(protocol.PatchOp{
		Op: "zone.cards.add",
		Data: map[string]any{
			"playerId": targetPlayerID,
			"zone":     state.ZoneBattlefield,
			"index":    insertIndex,
			"cards":    []map[string]any{tokenPatchData(copy, "Token Copy", true)},
		},
	})
	emitZoneCount(emitter, game, targetPlayerID, state.ZoneBattlefield)
	return map[string]any{
		"playerId":          sourceLocation.PlayerID,
		"targetPlayerId":    targetPlayerID,
		"instanceId":        instanceID,
		"sourceInstanceId":  sourceID,
		"copiedFromCardKey": source.CardKey,
		"metrics":           edgeMetrics("edge.token_copy_ms", start, emitter),
	}, nil
}

type ZoneRandomCardSelectedApplier struct{}

func (ZoneRandomCardSelectedApplier) Type() string { return "zone.random_card.selected" }

func (ZoneRandomCardSelectedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	zone, err := zoneField(command.Payload, "zone")
	if err != nil {
		return nil, err
	}
	ids := zoneIDsForRandom(game, playerID, zone)
	if len(ids) == 0 {
		return map[string]any{"playerId": playerID, "zone": string(zone), "instanceId": "", "metrics": edgeMetrics("edge.random_select_ms", start, emitter)}, nil
	}
	instanceID := cleanString(command.Payload["instanceId"])
	if instanceID == "" {
		instanceID = ids[hashIndex(command.ClientActionID, len(ids))]
	} else if !stringInSlice(ids, instanceID) {
		return nil, state.ErrMissingInstance
	}
	instance := game.Instances[instanceID]
	selected := map[string]any{
		"playerId": playerID,
		"zone":     zone,
		"count":    len(ids),
	}
	if privateZone(zone) {
		emitter.EmitPublic(protocol.PatchOp{Op: "zone.random_card.selected", Data: selected})
		private := cloneMap(selected)
		private["instanceId"] = instanceID
		private["cardKey"] = instance.CardKey
		emitter.EmitPrivate(playerID, protocol.PatchOp{Op: "zone.random_card.selected", Data: private})
	} else {
		selected["instanceId"] = instanceID
		selected["cardKey"] = instance.CardKey
		emitter.EmitPublic(protocol.PatchOp{Op: "zone.random_card.selected", Data: selected})
	}
	return map[string]any{
		"playerId":   playerID,
		"zone":       string(zone),
		"instanceId": instanceID,
		"metrics":    edgeMetrics("edge.random_select_ms", start, emitter),
	}, nil
}

type CardDungeonMarkerChangedApplier struct{}

func (CardDungeonMarkerChangedApplier) Type() string { return "card.dungeon_marker.changed" }

func (CardDungeonMarkerChangedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	instance, location, err := instanceAt(game, instanceID, state.ZoneBattlefield)
	if err != nil {
		return nil, err
	}
	position := normalizedPoint(mapField(command.Payload, "position"))
	if instance.MutableStats == nil {
		instance.MutableStats = map[string]any{}
	}
	instance.MutableStats["dungeonMarker"] = position
	game.Instances[instanceID] = instance
	emitter.EmitPublic(protocol.PatchOp{
		Op:   "card.field.set",
		Data: cardFieldData(instanceID, location, map[string]any{"dungeonMarker": position}),
	})
	return map[string]any{
		"instanceId":    instanceID,
		"playerId":      location.PlayerID,
		"dungeonMarker": position,
		"metrics":       edgeMetrics("edge.dungeon_marker_ms", start, emitter),
	}, nil
}

type CardFaceChangedApplier struct{}

func (CardFaceChangedApplier) Type() string { return "card.face.changed" }

func (CardFaceChangedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	faceIndex, ok := intField(command.Payload, "faceIndex")
	if !ok {
		if faceIndex, ok = intField(command.Payload, "activeFaceIndex"); !ok {
			faceIndex = 0
		}
	}
	if faceIndex < 0 {
		return nil, fmt.Errorf("%w: faceIndex", ErrInvalidPayloadField)
	}
	instance, location, err := instanceAt(game, instanceID, "")
	if err != nil {
		return nil, err
	}
	instance.ActiveFace = faceIndex
	game.Instances[instanceID] = instance
	data := cardFieldData(instanceID, location, map[string]any{"activeFaceIndex": faceIndex})
	if privateZone(location.Zone) || instance.FaceDown {
		emitter.EmitPrivate(location.PlayerID, protocol.PatchOp{Op: "card.field.set", Data: data})
		if !privateZone(location.Zone) {
			emitter.EmitPublic(protocol.PatchOp{Op: "card.field.set", Data: cardFieldData(instanceID, location, map[string]any{})})
		}
	} else {
		emitter.EmitPublic(protocol.PatchOp{Op: "card.field.set", Data: data})
	}
	return map[string]any{
		"instanceId":      instanceID,
		"playerId":        location.PlayerID,
		"zone":            location.Zone,
		"activeFaceIndex": faceIndex,
		"metrics":         edgeMetrics("edge.face_change_ms", start, emitter),
	}, nil
}

func mapField(payload map[string]any, key string) map[string]any {
	if value, ok := payload[key].(map[string]any); ok {
		return value
	}
	return map[string]any{}
}

func tokenPatchData(instance state.CardInstanceRuntime, name string, isCopy bool) map[string]any {
	data := map[string]any{
		"instanceId":   instance.InstanceID,
		"ownerId":      instance.OwnerID,
		"controllerId": instance.ControllerID,
		"name":         name,
		"cardKey":      instance.CardKey,
		"zone":         state.ZoneBattlefield,
		"isToken":      true,
		"isTokenCopy":  isCopy,
		"tokenMeta":    cloneMap(instance.TokenMeta),
		"position":     cloneMap(instance.Position),
		"counters":     cloneIntMap(instance.Counters),
	}
	for key, value := range instance.MutableStats {
		data[key] = value
	}
	return data
}

func deterministicRuntimeID(prefix string, actionID string, index int) string {
	actionID = strings.TrimSpace(actionID)
	if actionID == "" {
		actionID = strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return fmt.Sprintf("%s-%s-%d", prefix, sanitizeID(actionID), index)
}

func sanitizeID(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '-' || char == '_' {
			builder.WriteRune(char)
		}
	}
	if builder.Len() == 0 {
		return "action"
	}
	return builder.String()
}

func runtimeTokenCardKey(card map[string]any, name string) string {
	if value := compactOptionalString(card["cardKey"]); value != "" {
		return value
	}
	if value := compactOptionalString(card["scryfallId"]); value != "" {
		return value + ":token"
	}
	return "token:" + sanitizeID(name)
}

func tokenMutableStats(card map[string]any) map[string]any {
	stats := map[string]any{}
	if value := compactStat(card["power"], fallbackTokenStat(card, "power", 1)); value != nil {
		stats["power"] = value
	}
	if value := compactStat(card["toughness"], fallbackTokenStat(card, "toughness", 1)); value != nil {
		stats["toughness"] = value
	}
	if value := compactStat(card["loyalty"], nil); value != nil {
		stats["loyalty"] = value
	}
	return stats
}

func fallbackTokenStat(card map[string]any, key string, fallback any) any {
	if len(card) == 0 {
		return fallback
	}
	return nil
}

func compactStat(value any, fallback any) any {
	switch typed := value.(type) {
	case string:
		if strings.TrimSpace(typed) != "" {
			return typed
		}
	case float64:
		if math.Trunc(typed) == typed {
			return int(typed)
		}
		return typed
	case int:
		return typed
	case nil:
	default:
		return typed
	}
	return fallback
}

func compactOptionalString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	default:
		return ""
	}
}

func cleanString(value any) string {
	return compactOptionalString(value)
}

func tokenPosition(index int, quantity int, payload map[string]any) map[string]any {
	if quantity == 1 {
		if position := normalizedPoint(mapField(payload, "position")); position != nil {
			return position
		}
	}
	column := index % 5
	row := index / 5
	columns := min(quantity, 5)
	rows := int(math.Ceil(float64(quantity) / 5))
	x := 0.5 + (float64(column)-((float64(columns)-1)/2))*0.028
	y := 0.5 + (float64(row)-((float64(rows)-1)/2))*0.04
	return map[string]any{"x": clampFloat(x, 0.08, 0.92), "y": clampFloat(y, 0.12, 0.88), "unit": "ratio"}
}

func offsetTokenCopyPosition(source map[string]any) map[string]any {
	position := normalizedPoint(source)
	position["x"] = clampFloat(toFloat(position["x"], 0.5)+0.028, 0.08, 0.92)
	position["y"] = clampFloat(toFloat(position["y"], 0.5)+0.04, 0.12, 0.88)
	return position
}

func normalizedPoint(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{"x": 0.5, "y": 0.5, "unit": "ratio"}
	}
	return map[string]any{
		"x":    clampFloat(toFloat(value["x"], 0.5), 0, 1),
		"y":    clampFloat(toFloat(value["y"], 0.5), 0, 1),
		"unit": "ratio",
	}
}

func toFloat(value any, fallback float64) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	default:
		return fallback
	}
}

func clampFloat(value float64, minValue float64, maxValue float64) float64 {
	return math.Max(minValue, math.Min(maxValue, value))
}

func zoneIDsForRandom(game *state.GameState, playerID string, zone state.Zone) []string {
	zones, ok := game.Zones[playerID]
	if !ok {
		return nil
	}
	switch zone {
	case state.ZoneLibrary:
		return append([]string(nil), zones.Library...)
	case state.ZoneHand:
		return append([]string(nil), zones.Hand...)
	case state.ZoneGraveyard:
		return append([]string(nil), zones.Graveyard...)
	case state.ZoneExile:
		return append([]string(nil), zones.Exile...)
	default:
		return nil
	}
}

func hashIndex(seed string, size int) int {
	if size <= 0 {
		return 0
	}
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(seed))
	return int(hash.Sum32() % uint32(size))
}

func stringInSlice(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func edgeMetrics(durationKey string, start time.Time, emitter *PatchEmitter) map[string]any {
	return map[string]any{
		"edge.runtime_route":   1,
		"edge.full_scan_count": 0,
		"edge.patch_bytes":     patchBytes(emitter),
		durationKey:            float64(time.Since(start).Microseconds()) / 1000,
	}
}
