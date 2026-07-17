package actor

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

const handRevealBatchEffectVersion = 1

const (
	HandRevealCodeInvalidBatch = "INVALID_HAND_REVEAL_BATCH"
	HandRevealCodeNotInHand    = "HAND_INSTANCE_NOT_AVAILABLE"
)

type HandRevealError struct {
	Code        string
	CommandType string
	Count       int
	Index       int
}

func AsHandRevealError(err error) (*HandRevealError, bool) {
	var revealError *HandRevealError
	if !errors.As(err, &revealError) {
		return nil, false
	}
	return revealError, true
}

func (e *HandRevealError) Error() string {
	if e.Code == HandRevealCodeNotInHand {
		return "a selected card is no longer in the actor's hand"
	}
	return "hand reveal batch is invalid"
}

type HandCardsRevealApplier struct{}

func (HandCardsRevealApplier) Type() string { return "hand.cards.reveal" }

func (HandCardsRevealApplier) Apply(ctx context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	return applyHandRevealBatch(ctx, game, command, emitter, true)
}

type HandCardsRevokeApplier struct{}

func (HandCardsRevokeApplier) Type() string { return "hand.cards.revoke" }

func (HandCardsRevokeApplier) Apply(ctx context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	return applyHandRevealBatch(ctx, game, command, emitter, false)
}

type handRevealEffect struct {
	instanceID   string
	location     state.Location
	previousMask uint64
	finalMask    uint64
	deltaMask    uint64
}

func applyHandRevealBatch(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter, reveal bool) (map[string]any, error) {
	startedAt := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	expectedZone, err := stringField(command.Payload, "expectedZone")
	if err != nil || state.Zone(expectedZone) != state.ZoneHand {
		return nil, &HandRevealError{Code: HandRevealCodeInvalidBatch, CommandType: command.Type, Index: -1}
	}
	// Hand reveal batches must always carry an explicit recipient audience. The
	// shared visibility resolver intentionally defaults an omitted `to` field to
	// public for legacy reveal commands; inheriting that fallback here would
	// turn a malformed private-hand request into an accidental all-player leak.
	if _, supplied := command.Payload["to"]; !supplied {
		return nil, &HandRevealError{Code: HandRevealCodeInvalidBatch, CommandType: command.Type, Index: -1}
	}
	orderedInstanceIDs, err := stringSliceField(command.Payload, "orderedInstanceIds")
	if err != nil || len(orderedInstanceIDs) == 0 {
		return nil, &HandRevealError{Code: HandRevealCodeInvalidBatch, CommandType: command.Type, Count: len(orderedInstanceIDs), Index: -1}
	}
	audience, err := resolveVisibilityAudience(game, command.Payload)
	if err != nil {
		return nil, err
	}

	game.EnsureVisibility()
	seen := make(map[string]struct{}, len(orderedInstanceIDs))
	effects := make([]handRevealEffect, 0, len(orderedInstanceIDs))
	for index, instanceID := range orderedInstanceIDs {
		if instanceID == "" {
			return nil, &HandRevealError{Code: HandRevealCodeInvalidBatch, CommandType: command.Type, Count: len(orderedInstanceIDs), Index: index}
		}
		if _, duplicate := seen[instanceID]; duplicate {
			return nil, &AuthorizationError{Code: AuthorizationCodeDuplicateInstance, CommandType: command.Type, InstanceID: instanceID, Index: index}
		}
		seen[instanceID] = struct{}{}
		instance, location, instanceErr := instanceAt(game, instanceID, state.ZoneHand)
		if instanceErr != nil || location.PlayerID != playerID || instance.OwnerID != "" && instance.OwnerID != playerID {
			return nil, &HandRevealError{Code: HandRevealCodeNotInHand, CommandType: command.Type, Count: len(orderedInstanceIDs), Index: index}
		}
		previousMask := instance.VisibleToMask | game.Visibility.InstanceMasks[instanceID]
		finalMask := previousMask | audience.Mask
		deltaMask := audience.Mask &^ previousMask
		if !reveal {
			finalMask = previousMask &^ audience.Mask
			deltaMask = previousMask & audience.Mask
		}
		effects = append(effects, handRevealEffect{instanceID: instanceID, location: location, previousMask: previousMask, finalMask: finalMask, deltaMask: deltaMask})
	}

	// All cards and their current hand locations are validated before this point.
	for _, effect := range effects {
		instance := game.Instances[effect.instanceID]
		instance.VisibleToMask = effect.finalMask
		game.Instances[effect.instanceID] = instance
		if effect.finalMask == 0 {
			delete(game.Visibility.InstanceMasks, effect.instanceID)
		} else {
			game.Visibility.InstanceMasks[effect.instanceID] = effect.finalMask
		}
		previousState := game.Visibility.HandRevealStates[effect.instanceID]
		revealedAtVersion := previousState.RevealedAtVersion
		if effect.previousMask == 0 && effect.finalMask != 0 {
			revealedAtVersion = game.Version + 1
		}
		game.Visibility.HandRevealStates[effect.instanceID] = state.HandRevealState{
			OwnerID: playerID, Zone: state.ZoneHand, Active: effect.finalMask != 0, VisibleToMask: effect.finalMask,
			RevealedTo: revealedToForMask(game, effect.finalMask), RevealedAtVersion: revealedAtVersion,
			LastChangedVersion: game.Version + 1, SourceCommand: command.Type, SourceClientActionID: command.ClientActionID,
		}
	}

	emitHandRevealBatchPatches(game, playerID, effects, reveal, emitter)
	emitZoneCount(emitter, game, playerID, state.ZoneHand)

	persistedEffects := make([]map[string]any, 0, len(effects))
	allPlayersMask := allPlayersVisibilityMask(game)
	for _, effect := range effects {
		materializedViewerIDs := []string{}
		concealedViewerIDs := []string{}
		if reveal && effect.deltaMask != 0 {
			materializedViewerIDs = revealedToForMask(game, effect.deltaMask)
			if effect.finalMask == allPlayersMask && effect.previousMask != allPlayersMask {
				materializedViewerIDs = []string{"all"}
			}
		}
		if !reveal && effect.deltaMask != 0 {
			concealedViewerIDs = revealedToForMask(game, effect.deltaMask)
			if effect.previousMask == allPlayersMask && effect.finalMask != allPlayersMask {
				concealedViewerIDs = []string{"all"}
			}
		}
		persistedEffects = append(persistedEffects, map[string]any{
			"instanceId":            effect.instanceID,
			"previousVisibleToMask": effect.previousMask,
			"finalVisibleToMask":    effect.finalMask,
			"previousAudience":      visibilityStateEventValue(game, effect.previousMask),
			"finalAudience":         visibilityStateEventValue(game, effect.finalMask),
			"materializedViewerIds": materializedViewerIDs,
			"concealedViewerIds":    concealedViewerIDs,
			"finalRevealedTo":       revealedToForMask(game, effect.finalMask),
			"revealState":           handRevealStateEventValue(game.Visibility.HandRevealStates[effect.instanceID]),
		})
	}
	return map[string]any{
		"effectVersion":      handRevealBatchEffectVersion,
		"playerId":           playerID,
		"orderedInstanceIds": append([]string(nil), orderedInstanceIDs...),
		"count":              len(orderedInstanceIDs),
		"zone":               string(state.ZoneHand),
		"revealed":           reveal,
		"audience":           audience.eventValue(),
		"viewers":            audience.revealedTo(),
		"visibleToMask":      audience.Mask,
		"effects":            persistedEffects,
		"metrics":            sensitiveMetrics("sensitive.hand_reveal_batch_ms", startedAt, emitter),
	}, nil
}

func handRevealStateEventValue(revealState state.HandRevealState) map[string]any {
	return map[string]any{
		"ownerId": revealState.OwnerID, "zone": revealState.Zone, "active": revealState.Active,
		"visibleToMask": revealState.VisibleToMask, "revealedTo": append([]string(nil), revealState.RevealedTo...),
		"revealedAtVersion": revealState.RevealedAtVersion, "lastChangedVersion": revealState.LastChangedVersion,
		"sourceCommand": revealState.SourceCommand, "sourceClientActionId": revealState.SourceClientActionID,
	}
}

func markHandRevealInactive(game *state.GameState, instanceID string, sourceCommand string) {
	game.EnsureVisibility()
	current, ok := game.Visibility.HandRevealStates[instanceID]
	if !ok && game.Visibility.InstanceMasks[instanceID] == 0 {
		return
	}
	instance := game.Instances[instanceID]
	current.OwnerID = instance.OwnerID
	current.Zone = instance.Zone
	current.Active = false
	current.VisibleToMask = 0
	current.RevealedTo = []string{}
	current.LastChangedVersion = game.Version + 1
	current.SourceCommand = sourceCommand
	current.SourceClientActionID = ""
	game.Visibility.HandRevealStates[instanceID] = current
}

func visibilityStateEventValue(game *state.GameState, mask uint64) map[string]any {
	if mask == 0 {
		return map[string]any{"scope": "hidden"}
	}
	audience, err := visibilityAudienceFromMask(game, mask)
	if err != nil {
		return map[string]any{"scope": "hidden"}
	}
	return audience.eventValue()
}

func emitHandRevealBatchPatches(game *state.GameState, ownerID string, effects []handRevealEffect, reveal bool, emitter *PatchEmitter) {
	deltaSlots := map[uint64][]privateCardSlot{}
	publicMaterializeSlots := make([]privateCardSlot, 0)
	publicConcealSlots := make([]privateCardSlot, 0)
	rematerializeSlots := map[uint64][]privateCardSlot{}
	allPlayersMask := allPlayersVisibilityMask(game)
	for _, effect := range effects {
		finalAudience := revealedToForMask(game, effect.finalMask)
		emitter.EmitPrivate(ownerID, protocol.PatchOp{Op: "card.field.set", Data: cardFieldData(effect.instanceID, effect.location, map[string]any{
			"revealedTo": finalAudience,
		})})
		slot := privateCardSlot{
			InstanceID: effect.instanceID, PlaceholderID: privatePlaceholderID(ownerID, state.ZoneHand, effect.location.Index), Index: effect.location.Index,
		}
		// A public audience also covers spectators, which do not have a player
		// bit. Crossing the public boundary therefore cannot be represented by
		// the player-mask delta alone.
		if reveal && effect.finalMask == allPlayersMask && effect.previousMask != allPlayersMask {
			publicMaterializeSlots = append(publicMaterializeSlots, slot)
			continue
		}
		if !reveal && effect.previousMask == allPlayersMask && effect.finalMask != allPlayersMask {
			publicConcealSlots = append(publicConcealSlots, slot)
			if effect.finalMask != 0 {
				rematerializeSlots[effect.finalMask] = append(rematerializeSlots[effect.finalMask], slot)
			}
			continue
		}
		if effect.deltaMask != 0 {
			deltaSlots[effect.deltaMask] = append(deltaSlots[effect.deltaMask], slot)
		}
	}
	if len(publicConcealSlots) > 0 {
		emitter.EmitPublic(privateCardsConcealOp(ownerID, state.ZoneHand, publicConcealSlots))
	}
	if len(publicMaterializeSlots) > 0 {
		emitter.EmitPublic(privateCardsMaterializePerCardAudienceOp(game, ownerID, state.ZoneHand, publicMaterializeSlots))
	}
	emitHandRevealMaterializations(game, ownerID, rematerializeSlots, emitter)

	masks := make([]uint64, 0, len(deltaSlots))
	for mask := range deltaSlots {
		masks = append(masks, mask)
	}
	sort.Slice(masks, func(i, j int) bool { return masks[i] < masks[j] })
	for _, mask := range masks {
		audience, err := visibilityAudienceFromMask(game, mask)
		if err != nil {
			continue
		}
		if reveal {
			emitVisibilityAudiencePatch(emitter, audience, privateCardsMaterializePerCardAudienceOp(game, ownerID, state.ZoneHand, deltaSlots[mask]))
		} else {
			emitVisibilityAudiencePatch(emitter, audience, privateCardsConcealOp(ownerID, state.ZoneHand, deltaSlots[mask]))
		}
	}

	// Existing authorized viewers also need the final audience metadata. Newly
	// authorized viewers already receive it inside private.cards.materialize;
	// sending them a real-id card.field.set in a separate visibility envelope
	// can arrive before materialization and target only their opaque placeholder.
	for _, effect := range effects {
		retainedMask := effect.previousMask & effect.finalMask
		if retainedMask == 0 {
			continue
		}
		audience, err := visibilityAudienceFromMask(game, retainedMask)
		if err != nil {
			continue
		}
		emitVisibilityAudiencePatch(emitter, audience, protocol.PatchOp{Op: "card.field.set", Data: cardFieldData(effect.instanceID, effect.location, map[string]any{
			"revealedTo": revealedToForMask(game, effect.finalMask),
		})})
	}
}

func emitHandRevealMaterializations(game *state.GameState, ownerID string, slotsByMask map[uint64][]privateCardSlot, emitter *PatchEmitter) {
	masks := make([]uint64, 0, len(slotsByMask))
	for mask := range slotsByMask {
		masks = append(masks, mask)
	}
	sort.Slice(masks, func(i, j int) bool { return masks[i] < masks[j] })
	for _, mask := range masks {
		audience, err := visibilityAudienceFromMask(game, mask)
		if err != nil {
			continue
		}
		emitVisibilityAudiencePatch(emitter, audience, privateCardsMaterializePerCardAudienceOp(game, ownerID, state.ZoneHand, slotsByMask[mask]))
	}
}

func privateCardsMaterializePerCardAudienceOp(game *state.GameState, playerID string, zone state.Zone, slots []privateCardSlot) protocol.PatchOp {
	entries := make([]map[string]any, 0, len(slots))
	for _, slot := range slots {
		instance := game.Instances[slot.InstanceID]
		card := cardPatchData(game, instance.OwnerID, slot.InstanceID)
		delete(card, "language")
		card["hidden"] = false
		card["revealedTo"] = revealedToForMask(game, instance.VisibleToMask)
		entries = append(entries, map[string]any{"index": slot.Index, "placeholderId": slot.PlaceholderID, "card": card})
	}
	return protocol.PatchOp{Op: "private.cards.materialize", Data: map[string]any{"playerId": playerID, "zone": zone, "entries": entries}}
}

func revealedToForMask(game *state.GameState, mask uint64) []string {
	if mask == 0 {
		return []string{}
	}
	audience, err := visibilityAudienceFromMask(game, mask)
	if err != nil {
		return []string{}
	}
	return audience.revealedTo()
}

func replayHandRevealBatchEvent(game *state.GameState, event protocol.EventPayloadV2) error {
	effectVersion, _ := intField(event.Payload, "effectVersion")
	if effectVersion < handRevealBatchEffectVersion {
		return fmt.Errorf("%w: effectVersion", ErrInvalidPayloadField)
	}
	effects := mapsFromAny(event.Payload["effects"])
	if len(effects) == 0 {
		return fmt.Errorf("%w: effects", ErrMissingPayloadField)
	}
	game.EnsureVisibility()
	for _, effect := range effects {
		instanceID, err := stringField(effect, "instanceId")
		if err != nil {
			return err
		}
		instance, ok := game.Instances[instanceID]
		if !ok {
			return state.ErrMissingInstance
		}
		finalMask, ok := intField(effect, "finalVisibleToMask")
		if !ok || finalMask < 0 {
			return fmt.Errorf("%w: finalVisibleToMask", ErrInvalidPayloadField)
		}
		instance.VisibleToMask = uint64(finalMask)
		game.Instances[instanceID] = instance
		if finalMask == 0 {
			delete(game.Visibility.InstanceMasks, instanceID)
		} else {
			game.Visibility.InstanceMasks[instanceID] = uint64(finalMask)
		}
		if revealState, ok := effect["revealState"].(map[string]any); ok {
			ownerID, _ := stringField(revealState, "ownerId")
			zone, _ := stringField(revealState, "zone")
			active, _ := boolField(revealState, "active")
			visibleToMask, _ := intField(revealState, "visibleToMask")
			revealedTo, _ := stringSliceField(revealState, "revealedTo")
			revealedAtVersion, _ := intField(revealState, "revealedAtVersion")
			lastChangedVersion, _ := intField(revealState, "lastChangedVersion")
			game.Visibility.HandRevealStates[instanceID] = state.HandRevealState{
				OwnerID: ownerID, Zone: state.Zone(zone), Active: active, VisibleToMask: uint64(maxInt(0, visibleToMask)),
				RevealedTo: revealedTo, RevealedAtVersion: int64(revealedAtVersion), LastChangedVersion: int64(lastChangedVersion),
				SourceCommand:        optionalString(revealState, "sourceCommand"),
				SourceClientActionID: optionalString(revealState, "sourceClientActionId"),
			}
		}
	}
	return nil
}
