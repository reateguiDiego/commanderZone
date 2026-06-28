package actor

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

type CardFaceDownChangedApplier struct{}

func (CardFaceDownChangedApplier) Type() string { return "card.face_down.changed" }

func (CardFaceDownChangedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	instance, location, err := instanceAt(game, instanceID, "")
	if err != nil {
		return nil, err
	}
	faceDown, ok := boolField(command.Payload, "faceDown")
	if !ok {
		faceDown = !instance.FaceDown
	}

	instance.FaceDown = faceDown
	if faceDown {
		instance.VisibleToMask = 0
		game.EnsureVisibility()
		delete(game.Visibility.InstanceMasks, instanceID)
	}
	game.Instances[instanceID] = instance

	publicData := cardFieldData(instanceID, location, map[string]any{
		"faceDown": faceDown,
	})
	if faceDown {
		publicData["hidden"] = true
	} else if !privateZone(location.Zone) {
		publicData["hidden"] = false
		publicData["cardKey"] = instance.CardKey
	}
	if privateZone(location.Zone) {
		emitZoneCount(emitter, game, location.PlayerID, location.Zone)
	} else {
		emitter.EmitPublic(protocol.PatchOp{Op: "card.field.set", Data: publicData})
	}

	privateData := cardFieldData(instanceID, location, map[string]any{
		"faceDown": faceDown,
		"hidden":   false,
		"cardKey":  instance.CardKey,
	})
	emitter.EmitPrivate(location.PlayerID, protocol.PatchOp{Op: "card.field.set", Data: privateData})

	return map[string]any{
		"instanceId": instanceID,
		"playerId":   location.PlayerID,
		"zone":       location.Zone,
		"faceDown":   faceDown,
		"metrics":    sensitiveMetrics("sensitive.face_down_ms", start, emitter),
	}, nil
}

type CardRevealedApplier struct{}

func (CardRevealedApplier) Type() string { return "card.revealed" }

func (CardRevealedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	instance, location, err := instanceAt(game, instanceID, "")
	if err != nil {
		return nil, err
	}
	revealed := true
	if value, ok := boolField(command.Payload, "revealed"); ok {
		revealed = value
	}
	if value, ok := boolField(command.Payload, "hidden"); ok {
		revealed = !value
	}
	viewers, mask := revealTargets(command.Payload)
	targeted := hasTargetedVisibility(command.Payload, viewers)
	if mask == 0 {
		mask = 1
	}

	game.EnsureVisibility()
	if revealed {
		instance.VisibleToMask |= mask
		game.Visibility.InstanceMasks[instanceID] |= mask
	} else {
		instance.VisibleToMask &^= mask
		game.Visibility.InstanceMasks[instanceID] &^= mask
		if game.Visibility.InstanceMasks[instanceID] == 0 {
			delete(game.Visibility.InstanceMasks, instanceID)
		}
	}
	game.Instances[instanceID] = instance

	revealData := cardFieldData(instanceID, location, map[string]any{
		"hidden":     !revealed,
		"revealedTo": viewers,
	})
	if revealed {
		revealData["cardKey"] = instance.CardKey
	}
	if !revealed {
		delete(revealData, "cardKey")
	}
	emitTargetedCardPatch(emitter, viewers, mask, targeted, protocol.PatchOp{Op: "card.field.set", Data: revealData})

	if privateZone(location.Zone) {
		emitZoneCount(emitter, game, location.PlayerID, location.Zone)
	}
	return map[string]any{
		"instanceId":    instanceID,
		"playerId":      location.PlayerID,
		"zone":          location.Zone,
		"revealed":      revealed,
		"visibleToMask": mask,
		"viewers":       viewers,
		"metrics":       sensitiveMetrics("sensitive.revealed_ms", start, emitter),
	}, nil
}

type CardControllerChangedApplier struct{}

func (CardControllerChangedApplier) Type() string { return "card.controller.changed" }

func (CardControllerChangedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	controllerID, err := stringField(command.Payload, "targetPlayerId")
	if err != nil {
		if controllerID, err = stringField(command.Payload, "controllerId"); err != nil {
			return nil, fmt.Errorf("%w: targetPlayerId", ErrMissingPayloadField)
		}
	}
	if _, ok := game.Players[controllerID]; !ok {
		return nil, fmt.Errorf("%w: targetPlayerId", ErrInvalidPayloadField)
	}
	instance, location, err := instanceAt(game, instanceID, "")
	if err != nil {
		return nil, err
	}
	instance.ControllerID = controllerID
	game.Instances[instanceID] = instance
	location.ControllerID = controllerID
	game.Loc[instanceID] = location

	data := cardFieldData(instanceID, location, map[string]any{"controllerId": controllerID})
	if privateZone(location.Zone) || instance.FaceDown {
		emitter.EmitPrivate(location.PlayerID, protocol.PatchOp{Op: "card.field.set", Data: data})
		if !privateZone(location.Zone) && controllerID != location.PlayerID {
			emitter.EmitPrivate(controllerID, protocol.PatchOp{Op: "card.field.set", Data: data})
		}
		emitZoneCount(emitter, game, location.PlayerID, location.Zone)
	} else {
		emitter.EmitPublic(protocol.PatchOp{Op: "card.field.set", Data: data})
	}

	return map[string]any{
		"instanceId":   instanceID,
		"playerId":     location.PlayerID,
		"zone":         location.Zone,
		"controllerId": controllerID,
		"metrics":      sensitiveMetrics("sensitive.controller_ms", start, emitter),
	}, nil
}

type LibraryRevealApplier struct{}

func (LibraryRevealApplier) Type() string { return "library.reveal" }

func (LibraryRevealApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	zones, ok := game.Zones[playerID]
	if !ok {
		return nil, state.ErrMissingZone
	}
	viewers, mask := revealTargets(command.Payload)
	targeted := hasTargetedVisibility(command.Payload, viewers)
	if mask == 0 {
		mask = 1
	}
	game.EnsureVisibility()
	cards := make([]map[string]any, 0, len(zones.Library))
	for _, instanceID := range zones.Library {
		instance := game.Instances[instanceID]
		instance.VisibleToMask |= mask
		game.Instances[instanceID] = instance
		game.Visibility.InstanceMasks[instanceID] |= mask
		cards = append(cards, map[string]any{
			"instanceId": instanceID,
			"cardKey":    instance.CardKey,
		})
	}
	op := protocol.PatchOp{
		Op: "library.revealed.set",
		Data: map[string]any{
			"playerId": playerID,
			"count":    len(cards),
			"cards":    cards,
			"epoch":    game.Visibility.LibraryEpochByOwner[playerID],
		},
	}
	emitTargetedCardPatch(emitter, viewers, mask, targeted, op)
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)
	return map[string]any{
		"playerId":        playerID,
		"count":           len(cards),
		"visibleToMask":   mask,
		"viewers":         viewers,
		"visibilityEpoch": game.Visibility.LibraryEpochByOwner[playerID],
		"metrics":         sensitiveMetrics("sensitive.library_reveal_ms", start, emitter),
	}, nil
}

type LibraryPlayTopRevealedApplier struct{}

func (LibraryPlayTopRevealedApplier) Type() string { return "library.play_top_revealed" }

func (LibraryPlayTopRevealedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	enabled, ok := boolField(command.Payload, "enabled")
	if !ok {
		enabled = true
	}
	player, ok := game.Players[playerID]
	if !ok {
		return nil, fmt.Errorf("%w: playerId", ErrInvalidPayloadField)
	}
	player["playTopLibraryRevealed"] = enabled
	game.Players[playerID] = player

	emitter.EmitPublic(protocol.PatchOp{
		Op: "library.play_top_revealed.set",
		Data: map[string]any{
			"playerId": playerID,
			"enabled":  enabled,
		},
	})
	if enabled {
		ops := state.NewLibraryOps()
		top, err := ops.PeekTop(game, playerID, 1)
		if err == nil && len(top) == 1 {
			instance := game.Instances[top[0]]
			game.EnsureVisibility()
			instance.VisibleToMask |= 1
			game.Instances[top[0]] = instance
			game.Visibility.InstanceMasks[top[0]] |= 1
			emitter.EmitPublic(protocol.PatchOp{
				Op: "library.top.revealed",
				Data: map[string]any{
					"playerId": playerID,
					"count":    1,
					"cards": []map[string]any{{
						"instanceId": top[0],
						"cardKey":    instance.CardKey,
					}},
				},
			})
		}
	} else {
		emitter.EmitPublic(protocol.PatchOp{
			Op:   "library.top.hidden",
			Data: map[string]any{"playerId": playerID},
		})
	}
	return map[string]any{
		"playerId": playerID,
		"enabled":  enabled,
		"metrics":  sensitiveMetrics("sensitive.play_top_revealed_ms", start, emitter),
	}, nil
}

func revealTargets(payload map[string]any) ([]string, uint64) {
	viewers, err := stringSliceField(payload, "viewers")
	if err != nil {
		viewers = nil
		if value, ok := payload["to"].(string); ok && value != "" && value != "all" {
			viewers = []string{value}
		} else if values, ok := payload["to"].([]any); ok {
			for _, value := range values {
				if viewer, ok := value.(string); ok && viewer != "" {
					viewers = append(viewers, viewer)
				}
			}
		} else if values, ok := payload["to"].([]string); ok {
			viewers = append([]string(nil), values...)
		}
	}
	mask := uint64(0)
	if value, ok := intField(payload, "visibleToMask"); ok && value > 0 {
		mask = uint64(value)
	}
	if mask == 0 && len(viewers) > 0 {
		mask = 1
		for index := 1; index < len(viewers) && index < 63; index++ {
			mask |= 1 << index
		}
	}
	return viewers, mask
}

func hasTargetedVisibility(payload map[string]any, viewers []string) bool {
	if len(viewers) > 0 {
		return true
	}
	if value, ok := intField(payload, "visibleToMask"); ok && value > 0 {
		return true
	}
	return false
}

func emitTargetedCardPatch(emitter *PatchEmitter, viewers []string, mask uint64, targeted bool, op protocol.PatchOp) {
	if len(viewers) == 1 {
		emitter.EmitPrivate(viewers[0], op)
		return
	}
	if targeted {
		emitter.EmitGroup(strconv.FormatUint(mask, 10), op)
		return
	}
	emitter.EmitPublic(op)
}

func cardFieldData(instanceID string, location state.Location, fields map[string]any) map[string]any {
	data := map[string]any{
		"instanceId": instanceID,
		"playerId":   location.PlayerID,
		"zone":       location.Zone,
	}
	for key, value := range fields {
		data[key] = value
	}
	return data
}

func sensitiveMetrics(durationKey string, start time.Time, emitter *PatchEmitter) map[string]any {
	return map[string]any{
		"sensitive.runtime_route":   1,
		"sensitive.full_scan_count": 0,
		"sensitive.patch_bytes":     patchBytes(emitter),
		durationKey:                 float64(time.Since(start).Microseconds()) / 1000,
	}
}
