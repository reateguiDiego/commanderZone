package actor

import (
	"context"
	"fmt"
	"strconv"
	"strings"
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
		delete(game.Visibility.HandRevealAudiences, instanceID)
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
		publicData["printId"] = printIDForViewer(instance, "")
		publicData["cardVersion"] = cardVersionForViewer(instance, "")
		publicData["language"] = languageForViewer(game, instance, "")
		publicData["viewerVisibility"] = viewerVisibilityForZone(location.Zone)
	}
	if privateZone(location.Zone) {
		emitZoneCount(emitter, game, location.PlayerID, location.Zone)
	} else {
		emitter.EmitPublic(protocol.PatchOp{Op: "card.field.set", Data: publicData})
	}

	privateData := cardFieldData(instanceID, location, map[string]any{
		"faceDown":         faceDown,
		"hidden":           false,
		"cardKey":          instance.CardKey,
		"printId":          printIDForViewer(instance, location.PlayerID),
		"cardVersion":      cardVersionForViewer(instance, location.PlayerID),
		"language":         languageForViewer(game, instance, location.PlayerID),
		"viewerVisibility": viewerVisibilityForZone(location.Zone),
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

// CardFaceDownInspectedApplier records a public audit event without changing
// the card or exposing its identity. The client command is limited to the
// owner inspecting a face-down battlefield card.
type CardFaceDownInspectedApplier struct{}

func (CardFaceDownInspectedApplier) Type() string { return "card.face_down.inspected" }

func (CardFaceDownInspectedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, _ *PatchEmitter) (map[string]any, error) {
	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	instance, location, err := instanceAt(game, instanceID, state.ZoneBattlefield)
	if err != nil {
		return nil, err
	}
	if instance.OwnerID != playerID || !instance.FaceDown {
		return nil, fmt.Errorf("%w: face-down owner card", ErrInvalidPayloadField)
	}

	// Deliberately omit instanceId from the persisted event payload: the public
	// activity log must not disclose which face-down card was inspected.
	return map[string]any{"playerId": location.PlayerID}, nil
}

type CardRevealedApplier struct{}

func (CardRevealedApplier) Type() string { return "card.revealed" }

func (CardRevealedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	instanceIDs, err := cardRevealedInstanceIDs(command.Payload)
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
	viewers, mask := revealTargets(game, command.Payload)
	game.EnsureVisibility()
	targets, err := cardRevealTargets(game, instanceIDs, command.Payload)
	if err != nil {
		return nil, err
	}
	if !revealed {
		if clearAll, _ := boolField(command.Payload, "clearAll"); clearAll {
			viewers = revealedCardAudience(game, targets)
		}
	}
	for _, target := range targets {
		applyCardReveal(game, emitter, target, revealed, viewers, mask, command.Payload)
	}

	location := targets[0].location
	return map[string]any{
		"instanceIds":   instanceIDs,
		"playerId":      location.PlayerID,
		"zone":          string(location.Zone),
		"revealed":      revealed,
		"visibleToMask": mask,
		"viewers":       viewers,
		"metrics":       sensitiveMetrics("sensitive.revealed_ms", start, emitter),
	}, nil
}

func revealedCardAudience(game *state.GameState, targets []cardRevealTarget) []string {
	viewers := make([]string, 0)
	for _, target := range targets {
		audience := game.Visibility.HandRevealAudiences[target.instanceID]
		viewers = mergeViewerIDs(viewers, audience)
		if len(audience) == 0 {
			viewers = mergeViewerIDs(viewers, viewerIDsForMask(game, target.instance.VisibleToMask))
		}
	}
	return viewers
}

type cardRevealTarget struct {
	instanceID string
	instance   state.CardInstanceRuntime
	location   state.Location
}

func cardRevealedInstanceIDs(payload map[string]any) ([]string, error) {
	if rawIDs, exists := payload["instanceIds"]; exists {
		instanceIDs, err := stringSliceField(map[string]any{"instanceIds": rawIDs}, "instanceIds")
		if err != nil || len(instanceIDs) == 0 {
			return nil, fmt.Errorf("%w: instanceIds", ErrMissingPayloadField)
		}
		return uniqueNonEmptyIDs(instanceIDs)
	}

	instanceID, err := stringField(payload, "instanceId")
	if err != nil {
		return nil, err
	}
	return []string{instanceID}, nil
}

func uniqueNonEmptyIDs(instanceIDs []string) ([]string, error) {
	unique := make([]string, 0, len(instanceIDs))
	seen := make(map[string]struct{}, len(instanceIDs))
	for _, instanceID := range instanceIDs {
		instanceID = strings.TrimSpace(instanceID)
		if instanceID == "" {
			return nil, fmt.Errorf("%w: instanceIds", ErrInvalidPayloadField)
		}
		if _, exists := seen[instanceID]; exists {
			continue
		}
		seen[instanceID] = struct{}{}
		unique = append(unique, instanceID)
	}
	if len(unique) == 0 {
		return nil, fmt.Errorf("%w: instanceIds", ErrMissingPayloadField)
	}
	return unique, nil
}

func cardRevealTargets(game *state.GameState, instanceIDs []string, payload map[string]any) ([]cardRevealTarget, error) {
	targets := make([]cardRevealTarget, 0, len(instanceIDs))
	requestedPlayerID := strings.TrimSpace(firstString(payload["playerId"]))
	requestedZone := strings.TrimSpace(firstString(payload["zone"]))
	for _, instanceID := range instanceIDs {
		instance, location, err := instanceAt(game, instanceID, "")
		if err != nil {
			return nil, err
		}
		if (requestedPlayerID != "" && location.PlayerID != requestedPlayerID) || (requestedZone != "" && string(location.Zone) != requestedZone) {
			return nil, fmt.Errorf("%w: reveal cards must belong to the requested player and zone", ErrInvalidPayloadField)
		}
		if len(targets) > 0 && (location.PlayerID != targets[0].location.PlayerID || location.Zone != targets[0].location.Zone) {
			return nil, fmt.Errorf("%w: reveal cards must share a player and zone", ErrInvalidPayloadField)
		}
		targets = append(targets, cardRevealTarget{instanceID: instanceID, instance: instance, location: location})
	}
	return targets, nil
}

func applyCardReveal(game *state.GameState, emitter *PatchEmitter, target cardRevealTarget, revealed bool, defaultViewers []string, defaultMask uint64, payload map[string]any) {
	instance := target.instance
	location := target.location
	viewers, mask := append([]string(nil), defaultViewers...), defaultMask
	targeted := hasTargetedVisibility(payload, viewers)
	if !revealed {
		if clearAll, _ := boolField(payload, "clearAll"); clearAll {
			mask = instance.VisibleToMask
			viewers = game.Visibility.HandRevealAudiences[target.instanceID]
			if len(viewers) == 0 {
				viewers = viewerIDsForMask(game, mask)
			}
			targeted = mask != 0 || len(viewers) > 0
		}
	}
	if mask == 0 {
		mask = 1
	}

	if revealed {
		instance.VisibleToMask |= mask
		game.Visibility.InstanceMasks[target.instanceID] |= mask
		if location.Zone == state.ZoneHand {
			game.Visibility.HandRevealAudiences[target.instanceID] = mergeViewerIDs(game.Visibility.HandRevealAudiences[target.instanceID], viewers)
		}
	} else {
		instance.VisibleToMask &^= mask
		game.Visibility.InstanceMasks[target.instanceID] &^= mask
		if game.Visibility.InstanceMasks[target.instanceID] == 0 {
			delete(game.Visibility.InstanceMasks, target.instanceID)
		}
		if location.Zone == state.ZoneHand {
			if clearAll, _ := boolField(payload, "clearAll"); clearAll {
				delete(game.Visibility.HandRevealAudiences, target.instanceID)
			} else {
				remaining := withoutViewerIDs(game.Visibility.HandRevealAudiences[target.instanceID], viewers)
				if len(remaining) == 0 {
					delete(game.Visibility.HandRevealAudiences, target.instanceID)
				} else {
					game.Visibility.HandRevealAudiences[target.instanceID] = remaining
				}
			}
		}
	}
	game.Instances[target.instanceID] = instance

	revealedTo := viewers
	if !revealed {
		revealedTo = []string{}
	}
	revealData := cardFieldData(target.instanceID, location, map[string]any{"hidden": !revealed, "revealedTo": revealedTo})
	if revealed {
		revealData["cardKey"] = instance.CardKey
		revealData["printId"] = printIDForViewer(instance, location.PlayerID)
	}
	patchViewers := viewers
	patchMask := mask
	if !revealed && location.Zone == state.ZoneHand {
		patchViewers = withoutViewerIDs(viewers, []string{location.PlayerID})
		if canonicalMask := viewerMaskForIDs(game, patchViewers); canonicalMask != 0 {
			patchMask = canonicalMask
		}
	}
	if revealed || location.Zone != state.ZoneHand || len(patchViewers) > 0 {
		emitTargetedCardPatch(emitter, patchViewers, patchMask, targeted, protocol.PatchOp{Op: "card.field.set", Data: revealData})
	}
	if !revealed && privateZone(location.Zone) {
		emitter.EmitPrivate(location.PlayerID, protocol.PatchOp{Op: "card.field.set", Data: cardFieldData(target.instanceID, location, map[string]any{"hidden": false, "revealedTo": []string{}})})
	}
	if location.Zone == state.ZoneHand {
		emitter.EmitPublic(protocol.PatchOp{Op: "hand.reveal_marker.set", Data: map[string]any{"playerId": location.PlayerID, "index": location.Index, "revealed": instance.VisibleToMask != 0}})
	}
	if privateZone(location.Zone) {
		emitZoneCount(emitter, game, location.PlayerID, location.Zone)
	}
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
	viewers, mask := revealTargets(game, command.Payload)
	targeted := hasTargetedVisibility(command.Payload, viewers)
	if mask == 0 {
		mask = 1
	}
	player, ok := game.Players[playerID]
	if !ok {
		return nil, fmt.Errorf("%w: playerId", ErrInvalidPayloadField)
	}
	player["revealedLibraryTo"] = append([]string(nil), viewers...)
	game.Players[playerID] = player
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
			"playerId":   playerID,
			"count":      len(cards),
			"cards":      cards,
			"epoch":      game.Visibility.LibraryEpochByOwner[playerID],
			"revealedTo": viewers,
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
	var viewers []string
	var mask uint64
	if enabled {
		viewers, mask = revealTargets(game, command.Payload)
		if len(viewers) == 0 {
			viewers, mask = allRevealTargets(game)
		}
		if mask == 0 {
			return nil, fmt.Errorf("%w: to", ErrInvalidPayloadField)
		}
	} else if window, revealed := game.Visibility.TopRevealWindows[playerID]; revealed {
		viewers, mask = window.To, window.Mask
	}
	player["playTopLibraryRevealed"] = enabled
	if enabled {
		player["playTopLibraryRevealedTo"] = viewers
	} else {
		delete(player, "playTopLibraryRevealedTo")
		clearLibraryTopReveal(game, playerID)
	}
	game.Players[playerID] = player

	emitter.EmitPublic(protocol.PatchOp{
		Op: "library.play_top_revealed.set",
		Data: map[string]any{
			"playerId": playerID,
			"enabled":  enabled,
		},
	})
	if enabled {
		emitCurrentTopWhenPlayTopRevealed(emitter, game, playerID)
	} else {
		emitTopRevealHidden(emitter, playerID, viewers, mask)
	}
	// Keep the visual visibility marker in lockstep with the mode. This is also
	// the authoritative clear for a stale eye after stopping the mode.
	emitLibraryTopRevealMarker(emitter, game, playerID)
	return map[string]any{
		"playerId": playerID,
		"enabled":  enabled,
		"viewers":  viewers,
		"metrics":  sensitiveMetrics("sensitive.play_top_revealed_ms", start, emitter),
	}, nil
}

func allRevealTargets(game *state.GameState) ([]string, uint64) {
	game.EnsureVisibility()
	viewers := make([]string, 0, len(game.Players))
	for playerID := range game.Players {
		viewers = append(viewers, playerID)
	}
	return viewers, viewerMaskForIDs(game, viewers)
}

func revealTargets(game *state.GameState, payload map[string]any) ([]string, uint64) {
	game.EnsureVisibility()
	viewers, err := stringSliceField(payload, "viewers")
	if err != nil {
		viewers = nil
		if value, ok := payload["to"].(string); ok && value == "all" {
			for playerID := range game.Players {
				viewers = append(viewers, playerID)
			}
		} else if value, ok := payload["to"].(string); ok && value != "" {
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
	if mask == 0 {
		for _, viewerID := range viewers {
			mask |= game.Visibility.ViewerBits[viewerID]
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

func viewerIDsForMask(game *state.GameState, mask uint64) []string {
	viewers := make([]string, 0)
	for playerID, bit := range game.Visibility.ViewerBits {
		if bit != 0 && mask&bit != 0 {
			viewers = append(viewers, playerID)
		}
	}
	return viewers
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
