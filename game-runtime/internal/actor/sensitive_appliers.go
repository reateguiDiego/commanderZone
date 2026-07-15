package actor

import (
	"context"
	"fmt"
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
	previousVisibilityMask := instance.VisibleToMask
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
		if faceDown && previousVisibilityMask > 0 {
			if audience, audienceErr := visibilityAudienceFromMask(game, previousVisibilityMask); audienceErr == nil {
				emitVisibilityAudiencePatch(emitter, audience, privateCardsConcealOp(location.PlayerID, location.Zone, []privateCardSlot{{InstanceID: instanceID, PlaceholderID: privatePlaceholderID(location.PlayerID, location.Zone, location.Index), Index: privateProjectedIndex(game, location)}}))
			}
		}
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
	audience, err := resolveVisibilityAudience(game, command.Payload)
	if err != nil {
		return nil, err
	}
	viewers := audience.revealedTo()
	mask := audience.Mask

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

	patchRevealedTo := viewers
	if !revealed {
		patchRevealedTo = []string{}
	}
	if privateZone(location.Zone) {
		slot := privateCardSlot{
			InstanceID:    instanceID,
			PlaceholderID: privatePlaceholderID(location.PlayerID, location.Zone, location.Index),
			Index:         privateProjectedIndex(game, location),
		}
		if revealed {
			emitVisibilityAudiencePatch(emitter, audience, privateCardsMaterializeOp(game, location.PlayerID, location.Zone, []privateCardSlot{slot}, patchRevealedTo))
		} else {
			emitVisibilityAudiencePatch(emitter, audience, privateCardsConcealOp(location.PlayerID, location.Zone, []privateCardSlot{slot}))
		}
	} else {
		revealData := cardFieldData(instanceID, location, map[string]any{
			"hidden":     !revealed,
			"revealedTo": patchRevealedTo,
		})
		if revealed {
			revealData["cardKey"] = instance.CardKey
		}
		emitVisibilityAudiencePatch(emitter, audience, protocol.PatchOp{Op: "card.field.set", Data: revealData})
	}

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
		"audience":      audience.eventValue(),
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
	var dissolvedStack map[string]any
	if stackID, stack, stacked := state.NewRelationsOps().BattlefieldStackForInstance(game, instanceID); stacked {
		compatible := true
		for _, memberID := range stack.OrderedMemberIDs {
			member := game.Instances[memberID]
			if member.ControllerID != controllerID {
				compatible = false
				break
			}
		}
		if !compatible {
			dissolvedStack = battlefieldStackPatch(stack)
			delete(game.Relations.BattlefieldStacks, stackID)
			emitter.EmitPublic(protocol.PatchOp{Op: "battlefield.stack.remove", Data: map[string]any{"id": stackID}})
		}
	}

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

	payload := map[string]any{
		"instanceId":   instanceID,
		"playerId":     location.PlayerID,
		"zone":         location.Zone,
		"controllerId": controllerID,
		"metrics":      sensitiveMetrics("sensitive.controller_ms", start, emitter),
	}
	if dissolvedStack != nil {
		payload["dissolvedBattlefieldStack"] = dissolvedStack
	}
	return payload, nil
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
	audience, err := resolveVisibilityAudience(game, command.Payload)
	if err != nil {
		return nil, err
	}
	viewers := audience.revealedTo()
	mask := audience.Mask
	game.EnsureVisibility()
	orderedIDs := make([]string, 0, len(zones.Library))
	for index := len(zones.Library) - 1; index >= 0; index-- {
		orderedIDs = append(orderedIDs, zones.Library[index])
	}
	cards := make([]map[string]any, 0, len(orderedIDs))
	for _, instanceID := range orderedIDs {
		instance := game.Instances[instanceID]
		instance.VisibleToMask |= mask
		game.Instances[instanceID] = instance
		game.Visibility.InstanceMasks[instanceID] |= mask
		cards = append(cards, map[string]any{
			"instanceId": instanceID,
			"cardKey":    instance.CardKey,
		})
	}
	emitVisibilityAudiencePatch(emitter, audience, privateCardsMaterializeOp(game, playerID, state.ZoneLibrary, privateLibrarySlots(playerID, orderedIDs), viewers))
	op := protocol.PatchOp{
		Op: "library.revealed.set",
		Data: map[string]any{
			"playerId":   playerID,
			"count":      len(cards),
			"cards":      cards,
			"epoch":      game.Visibility.LibraryEpochByOwner[playerID],
			"revealedTo": viewers,
		},
	}
	emitVisibilityAudiencePatch(emitter, audience, op)
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)
	return map[string]any{
		"playerId":        playerID,
		"count":           len(cards),
		"visibleToMask":   mask,
		"viewers":         viewers,
		"audience":        audience.eventValue(),
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
			emitter.EmitPublic(privateCardsMaterializeOp(game, playerID, state.ZoneLibrary, privateLibrarySlots(playerID, top), []string{"all"}))
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

type privateCardSlot struct {
	InstanceID    string
	PlaceholderID string
	Index         int
}

func privateCardsMaterializeOp(game *state.GameState, playerID string, zone state.Zone, slots []privateCardSlot, revealedTo []string) protocol.PatchOp {
	entries := make([]map[string]any, 0, len(slots))
	for _, slot := range slots {
		instance := game.Instances[slot.InstanceID]
		card := cardPatchData(game, instance.OwnerID, slot.InstanceID)
		// Viewer language is resolved at the PHP/frontend hydration boundary; a
		// group operation must not force the owner's language on every recipient.
		delete(card, "language")
		card["hidden"] = false
		card["revealedTo"] = append([]string(nil), revealedTo...)
		entry := map[string]any{
			"index": slot.Index,
			"card":  card,
		}
		if slot.PlaceholderID != "" {
			entry["placeholderId"] = slot.PlaceholderID
		}
		entries = append(entries, entry)
	}
	return protocol.PatchOp{Op: "private.cards.materialize", Data: map[string]any{
		"playerId": playerID,
		"zone":     zone,
		"entries":  entries,
	}}
}

func privateCardsConcealOp(playerID string, zone state.Zone, slots []privateCardSlot) protocol.PatchOp {
	entries := make([]map[string]any, 0, len(slots))
	for _, slot := range slots {
		entries = append(entries, map[string]any{
			"instanceId":    slot.InstanceID,
			"placeholderId": slot.PlaceholderID,
			"index":         slot.Index,
		})
	}
	return protocol.PatchOp{Op: "private.cards.conceal", Data: map[string]any{
		"playerId": playerID,
		"zone":     zone,
		"entries":  entries,
	}}
}

func privateLibrarySlots(playerID string, instanceIDs []string) []privateCardSlot {
	slots := make([]privateCardSlot, 0, len(instanceIDs))
	for index, instanceID := range instanceIDs {
		placeholderID := ""
		if index == 0 {
			placeholderID = privatePlaceholderID(playerID, state.ZoneLibrary, index)
		}
		slots = append(slots, privateCardSlot{InstanceID: instanceID, PlaceholderID: placeholderID, Index: index})
	}
	return slots
}

func privatePlaceholderID(playerID string, zone state.Zone, index int) string {
	if zone == state.ZoneLibrary {
		return fmt.Sprintf("%s-hidden-library-top", playerID)
	}
	return fmt.Sprintf("%s-hidden-hand-%d", playerID, index)
}

func privateProjectedIndex(game *state.GameState, location state.Location) int {
	if location.Zone == state.ZoneLibrary {
		return 0
	}
	return location.Index
}

func sensitiveMetrics(durationKey string, start time.Time, emitter *PatchEmitter) map[string]any {
	return map[string]any{
		"sensitive.runtime_route":   1,
		"sensitive.full_scan_count": 0,
		"sensitive.patch_bytes":     patchBytes(emitter),
		durationKey:                 float64(time.Since(start).Microseconds()) / 1000,
	}
}
