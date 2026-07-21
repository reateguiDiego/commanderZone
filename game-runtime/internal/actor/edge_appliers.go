package actor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"hash/fnv"
	"math"
	"strconv"
	"strings"
	"time"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

const tokenCreatedEffectVersion = 1

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
	quantity, err := strictTokenQuantity(command.Payload, command.Type)
	if err != nil {
		return nil, err
	}
	if rawPosition, exists := command.Payload["position"]; exists {
		position, positionErr := canonicalRatioPosition(rawPosition, command.Type, "", 0)
		if positionErr != nil {
			return nil, positionErr
		}
		command.Payload = cloneMap(command.Payload)
		command.Payload["position"] = position
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
	printID := tokenPrintID(cardKey, card)
	cardVersion := compactOptionalString(card["cardVersion"])
	if cardVersion == "" {
		cardVersion = "runtime-identity-v1"
	}
	language := compactOptionalString(card["language"])
	if language == "" {
		language = "en"
	}
	staticCards := tokenStaticCards(cardKey, name, card)
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
	groupPosition := tokenPosition(0, 1, command.Payload)
	for index := 0; index < quantity; index++ {
		instanceID := deterministicRuntimeID("token", command.ClientActionID, index)
		ids = append(ids, instanceID)
		game.Instances[instanceID] = state.CardInstanceRuntime{
			InstanceID:    instanceID,
			CardKey:       cardKey,
			PrintID:       printID,
			CardVersion:   cardVersion,
			Language:      language,
			OwnerID:       playerID,
			ControllerID:  playerID,
			Zone:          state.ZoneBattlefield,
			IsToken:       true,
			TokenMeta:     cloneMap(tokenMeta),
			Position:      cloneMap(groupPosition),
			Counters:      map[string]int{},
			MutableStats:  tokenMutableStats(card),
			PrintedStats:  tokenPrintedStats(card, "token_creation"),
			VisibleToMask: 1,
		}
	}
	ops := state.NewZoneOps()
	insertIndex, err := ops.AddMany(game, playerID, state.ZoneBattlefield, ids, state.ZoneInsertAppend)
	if err != nil {
		return nil, err
	}
	var tokenGroup *state.TokenGroupRuntime
	if quantity > 1 {
		group := state.TokenGroupRuntime{
			GroupID:           deterministicOpaqueTokenGroupID(game.GameID, command.ClientActionID),
			RootInstanceID:    ids[0],
			OrderedMemberIDs:  append([]string(nil), ids...),
			Revision:          1,
			CreatedByPlayerID: playerID,
			CreatedAtVersion:  game.Version + 1,
			EffectVersion:     state.TokenGroupEffectVersion,
		}
		if err := state.AddTokenGroup(game, group); err != nil {
			return nil, err
		}
		tokenGroup = &group
	}
	cards := make([]map[string]any, 0, len(ids))
	for _, instanceID := range ids {
		cards = append(cards, tokenPatchData(game.Instances[instanceID], name, false))
	}
	data := map[string]any{
		"playerId": playerID,
		"zone":     state.ZoneBattlefield,
		"index":    insertIndex,
		"cards":    cards,
	}
	if len(staticCards) > 0 {
		data["staticCards"] = staticCards
	}
	emitter.EmitPublic(protocol.PatchOp{
		Op:   "zone.cards.add",
		Data: data,
	})
	if tokenGroup != nil {
		emitter.EmitPublic(protocol.PatchOp{Op: "token.group.set", Data: map[string]any{
			"group": tokenGroupPatch(*tokenGroup, game),
		}})
	}
	emitZoneCount(emitter, game, playerID, state.ZoneBattlefield)
	result := map[string]any{
		"effectVersion": tokenCreatedEffectVersion,
		"actorPlayerId": playerID,
		"playerId":      playerID,
		"instanceIds":   ids,
		"count":         quantity,
		"cardKey":       cardKey,
		"name":          name,
		"tokens":        cards,
		"tokenMeta":     tokenMeta,
		"staticCards":   staticCards,
		"metrics":       edgeMetrics("edge.token_create_ms", start, emitter),
	}
	if tokenGroup != nil {
		result["tokenGroup"] = tokenGroupEvent(*tokenGroup)
	}
	return result, nil
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
	sourcePublic := tokenCopySourcePublic(source, sourceLocation)
	cardKey := source.CardKey
	if !sourcePublic {
		cardKey = "token-copy:" + sanitizeID(instanceID)
	}
	copiedStats := copyBaseMutableStats(source)
	tokenMeta := map[string]any{
		"isCopy":               true,
		"copiedFromInstanceId": sourceID,
		"copiedValues": map[string]any{
			"power":     copiedStats["power"],
			"toughness": copiedStats["toughness"],
			"loyalty":   copiedStats["loyalty"],
		},
	}
	if sourcePublic {
		tokenMeta["copiedFromCardKey"] = source.CardKey
	}
	copy := state.CardInstanceRuntime{
		InstanceID:    instanceID,
		CardKey:       cardKey,
		OwnerID:       targetPlayerID,
		ControllerID:  targetPlayerID,
		Zone:          state.ZoneBattlefield,
		IsToken:       true,
		TokenMeta:     tokenMeta,
		Position:      offsetTokenCopyPosition(source.Position),
		Counters:      map[string]int{},
		MutableStats:  copiedStats,
		PrintedStats:  copyPrintedStats(source),
		ActiveFace:    source.ActiveFace,
		VisibleToMask: 1,
	}
	game.Instances[instanceID] = copy
	ops := state.NewZoneOps()
	insertIndex, err := ops.AddMany(game, targetPlayerID, state.ZoneBattlefield, []string{instanceID}, state.ZoneInsertAppend)
	if err != nil {
		return nil, err
	}
	card := tokenPatchData(copy, "Token Copy", true)
	emitter.EmitPublic(protocol.PatchOp{
		Op: "zone.cards.add",
		Data: map[string]any{
			"playerId": targetPlayerID,
			"zone":     state.ZoneBattlefield,
			"index":    insertIndex,
			"cards":    []map[string]any{card},
		},
	})
	emitZoneCount(emitter, game, targetPlayerID, state.ZoneBattlefield)
	payload := map[string]any{
		"playerId":         sourceLocation.PlayerID,
		"targetPlayerId":   targetPlayerID,
		"instanceId":       instanceID,
		"sourceInstanceId": sourceID,
		"tokens":           []map[string]any{card},
		"metrics":          edgeMetrics("edge.token_copy_ms", start, emitter),
	}
	if sourcePublic {
		payload["copiedFromCardKey"] = source.CardKey
	}
	return payload, nil
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
	marker, hasMarker := command.Payload["dungeonMarker"]
	if !hasMarker {
		marker, hasMarker = command.Payload["position"]
	}
	if !hasMarker {
		return nil, fmt.Errorf("%w: dungeonMarker", ErrMissingPayloadField)
	}
	if instance.MutableStats == nil {
		instance.MutableStats = map[string]any{}
	}
	var canonicalMarker any
	if marker == nil {
		delete(instance.MutableStats, "dungeonMarker")
		canonicalMarker = nil
	} else {
		point, ok := marker.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("%w: dungeonMarker", ErrInvalidPayloadField)
		}
		canonicalMarker = normalizedPoint(point)
		instance.MutableStats["dungeonMarker"] = canonicalMarker
	}
	game.Instances[instanceID] = instance
	emitDungeonMarkerPatchByViewer(emitter, game, instanceID, location, canonicalMarker)
	return map[string]any{
		"instanceId":    instanceID,
		"playerId":      location.PlayerID,
		"dungeonMarker": canonicalMarker,
		"metrics":       edgeMetrics("edge.dungeon_marker_ms", start, emitter),
	}, nil
}

func emitDungeonMarkerPatchByViewer(
	emitter *PatchEmitter,
	game *state.GameState,
	instanceID string,
	location state.Location,
	marker any,
) {
	instance := game.Instances[instanceID]
	if !instance.FaceDown {
		emitter.EmitPublic(protocol.PatchOp{
			Op:   "card.field.set",
			Data: cardFieldData(instanceID, location, map[string]any{"dungeonMarker": marker}),
		})
		return
	}

	for viewerID := range game.Players {
		projectedID, visible := projectInstanceReferenceForViewer(game, instanceID, viewerID)
		if !visible {
			continue
		}
		emitter.EmitPrivate(viewerID, protocol.PatchOp{
			Op:   "card.field.set",
			Data: cardFieldData(projectedID, location, map[string]any{"dungeonMarker": marker}),
		})
	}
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
	printID := instance.PrintID
	if printID == "" {
		printID = instance.CardKey
	}
	cardVersion := instance.CardVersion
	if cardVersion == "" {
		cardVersion = "runtime-identity-v1"
	}
	language := instance.Language
	if language == "" {
		language = "en"
	}
	data := map[string]any{
		"instanceId":         instance.InstanceID,
		"ownerId":            instance.OwnerID,
		"ownerPlayerId":      instance.OwnerID,
		"controllerId":       instance.ControllerID,
		"controllerPlayerId": instance.ControllerID,
		"name":               name,
		"cardKey":            instance.CardKey,
		"printId":            printID,
		"cardVersion":        cardVersion,
		"language":           language,
		"viewerVisibility":   "public",
		"zone":               string(instance.Zone),
		"isToken":            true,
		"isTokenCopy":        isCopy,
		"tokenMeta":          cloneMap(instance.TokenMeta),
		"position":           cloneMap(instance.Position),
		"counters":           cloneIntMap(instance.Counters),
		"tapped":             instance.Tapped,
		"rotation":           instance.Rotation,
		"faceDown":           instance.FaceDown,
		"activeFace":         instance.ActiveFace,
		"activeFaceIndex":    instance.ActiveFace,
		"mutableStats":       cloneMap(instance.MutableStats),
		"printedStats":       copyNestedStatsMap(instance.PrintedStats),
		"manualOverrides":    copyNestedStatsMap(instance.ManualOverrides),
	}
	for key, value := range instance.MutableStats {
		data[key] = value
	}
	return data
}

func tokenStaticCards(cardKey string, name string, card map[string]any) map[string]map[string]any {
	staticCard := map[string]any{
		"cardRef":          cardKey,
		"cardKey":          cardKey,
		"printId":          tokenPrintID(cardKey, card),
		"cardVersion":      "runtime-identity-v1",
		"language":         "en",
		"viewerVisibility": "public",
		"scryfallId":       nil,
		"name":             name,
		"imageUris":        nil,
		"cardFaces":        []map[string]any{},
		"typeLine":         nil,
		"manaCost":         nil,
		"colorIdentity":    []string{},
		"defaultPower":     compactStat(card["power"], fallbackTokenStat(card, "power", 1)),
		"defaultToughness": compactStat(card["toughness"], fallbackTokenStat(card, "toughness", 1)),
		"defaultLoyalty":   compactStat(card["loyalty"], nil),
		"defaultDefense":   nil,
		"hasRulings":       false,
	}
	if scryfallID := compactOptionalString(card["scryfallId"]); scryfallID != "" {
		staticCard["scryfallId"] = scryfallID
	}
	if cardVersion := compactOptionalString(card["cardVersion"]); cardVersion != "" {
		staticCard["cardVersion"] = cardVersion
	}
	if language := compactOptionalString(card["language"]); language != "" {
		staticCard["language"] = language
	}
	if imageUris := sanitizedStringMap(card["imageUris"]); len(imageUris) > 0 {
		staticCard["imageUris"] = imageUris
	}
	if faces := sanitizedCardFaces(card["cardFaces"]); len(faces) > 0 {
		staticCard["cardFaces"] = faces
	}
	if typeLine := compactOptionalString(card["typeLine"]); typeLine != "" {
		staticCard["typeLine"] = typeLine
	}
	if manaCost := compactOptionalString(card["manaCost"]); manaCost != "" {
		staticCard["manaCost"] = manaCost
	}
	if colorIdentity := sanitizedStringSlice(card["colorIdentity"]); len(colorIdentity) > 0 {
		staticCard["colorIdentity"] = colorIdentity
	}
	if defense := compactStat(card["defense"], nil); defense != nil {
		staticCard["defaultDefense"] = defense
	}
	if hasRulings, ok := card["hasRulings"].(bool); ok {
		staticCard["hasRulings"] = hasRulings
	}

	return map[string]map[string]any{cardKey: staticCard}
}

func tokenPrintID(cardKey string, card map[string]any) string {
	if printID := compactOptionalString(card["printId"]); printID != "" {
		return printID
	}
	if scryfallID := compactOptionalString(card["scryfallId"]); scryfallID != "" {
		return scryfallID
	}
	return cardKey
}

func tokenCopySourcePublic(source state.CardInstanceRuntime, location state.Location) bool {
	return !privateZone(location.Zone) && !source.FaceDown
}

func sanitizedStringMap(value any) map[string]string {
	raw, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	out := map[string]string{}
	for key, item := range raw {
		if strings.TrimSpace(key) == "" {
			continue
		}
		text := compactOptionalString(item)
		if text == "" {
			continue
		}
		out[key] = text
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func sanitizedCardFaces(value any) []map[string]any {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		face, ok := item.(map[string]any)
		if !ok {
			continue
		}
		sanitized := map[string]any{}
		for _, key := range []string{"name", "manaCost", "typeLine", "power", "toughness", "loyalty", "defense"} {
			if text := compactOptionalString(face[key]); text != "" {
				sanitized[key] = text
			}
		}
		if imageUris := sanitizedStringMap(face["imageUris"]); len(imageUris) > 0 {
			sanitized["imageUris"] = imageUris
		}
		if len(sanitized) > 0 {
			out = append(out, sanitized)
		}
	}
	return out
}

func sanitizedStringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		text := compactOptionalString(item)
		if text != "" {
			out = append(out, text)
		}
	}
	return out
}

func deterministicRuntimeID(prefix string, actionID string, index int) string {
	actionID = strings.TrimSpace(actionID)
	if actionID == "" {
		actionID = strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return fmt.Sprintf("%s-%s-%d", prefix, sanitizeID(actionID), index)
}

func deterministicOpaqueTokenGroupID(gameID string, actionID string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(gameID) + "\x00" + strings.TrimSpace(actionID) + "\x00token-group-v1"))
	return "token-group-" + hex.EncodeToString(digest[:12])
}

func tokenGroupEvent(group state.TokenGroupRuntime) map[string]any {
	return map[string]any{
		"groupId":           group.GroupID,
		"rootInstanceId":    group.RootInstanceID,
		"orderedMemberIds":  append([]string(nil), group.OrderedMemberIDs...),
		"revision":          group.Revision,
		"createdByPlayerId": group.CreatedByPlayerID,
		"createdAtVersion":  group.CreatedAtVersion,
		"effectVersion":     group.EffectVersion,
	}
}

func tokenGroupPatch(group state.TokenGroupRuntime, game *state.GameState) map[string]any {
	root := game.Instances[group.RootInstanceID]
	return map[string]any{
		"groupId":       group.GroupID,
		"rootRef":       group.RootInstanceID,
		"memberRefs":    append([]string(nil), group.OrderedMemberIDs...),
		"quantity":      group.Quantity(),
		"revision":      group.Revision,
		"position":      cloneMap(root.Position),
		"faceDown":      root.FaceDown,
		"tapped":        root.Tapped,
		"rotation":      root.Rotation,
		"effectVersion": group.EffectVersion,
	}
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

func tokenPrintedStats(card map[string]any, provenance string) map[string]map[string]any {
	stats := map[string]map[string]any{}
	faces := sanitizedCardFaces(card["cardFaces"])
	if len(faces) == 0 {
		stats["0"] = map[string]any{
			"faceKey":    "0",
			"faceIndex":  0,
			"power":      compactStat(card["power"], fallbackTokenStat(card, "power", 1)),
			"toughness":  compactStat(card["toughness"], fallbackTokenStat(card, "toughness", 1)),
			"provenance": provenance,
		}
		return stats
	}
	for index, face := range faces {
		key := strconv.Itoa(index)
		stats[key] = map[string]any{
			"faceKey":    key,
			"faceIndex":  index,
			"power":      compactStat(face["power"], nil),
			"toughness":  compactStat(face["toughness"], nil),
			"provenance": provenance,
		}
	}
	return stats
}

func copyPrintedStats(source state.CardInstanceRuntime) map[string]map[string]any {
	printed := copyNestedStatsMap(source.PrintedStats)
	if len(printed) == 0 {
		printed = map[string]map[string]any{
			strconv.Itoa(source.ActiveFace): {
				"faceKey":   strconv.Itoa(source.ActiveFace),
				"faceIndex": source.ActiveFace,
				"power":     source.MutableStats["power"],
				"toughness": source.MutableStats["toughness"],
			},
		}
	}
	for _, face := range printed {
		face["provenance"] = "copy_effect"
	}
	return printed
}

func copyBaseMutableStats(source state.CardInstanceRuntime) map[string]any {
	stats := cloneMap(source.MutableStats)
	if len(source.PrintedStats) == 0 {
		return stats
	}
	face := source.PrintedStats[strconv.Itoa(source.ActiveFace)]
	for _, axis := range []string{"power", "toughness"} {
		value, ok := face[axis]
		if !ok || value == nil {
			delete(stats, axis)
			continue
		}
		stats[axis] = value
	}
	return stats
}

func copyNestedStatsMap(source map[string]map[string]any) map[string]map[string]any {
	if len(source) == 0 {
		return nil
	}
	copy := make(map[string]map[string]any, len(source))
	for key, value := range source {
		copy[key] = cloneMap(value)
	}
	return copy
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
