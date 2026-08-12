package actor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

const (
	tokenGroupMutationEffectVersion = 1
	maxTokenGroupQuantity           = 20
)

type TokenGroupSplitApplier struct{}
type TokenGroupMergeApplier struct{}
type TokenGroupRemoveMembersApplier struct{}
type TokenGroupDissolveApplier struct{}
type TokenGroupStateSetApplier struct{}
type TokenGroupPositionSetApplier struct{}
type TokenGroupMoveApplier struct{}
type TokenGroupCounterChangedApplier struct{}
type TokenGroupPowerToughnessSetApplier struct{}
type TokenGroupControllerChangedApplier struct{}

func (TokenGroupSplitApplier) Type() string          { return "token.group.split" }
func (TokenGroupMergeApplier) Type() string          { return "token.group.merge" }
func (TokenGroupRemoveMembersApplier) Type() string  { return "token.group.remove_members" }
func (TokenGroupDissolveApplier) Type() string       { return "token.group.dissolve" }
func (TokenGroupStateSetApplier) Type() string       { return "token.group.state.set" }
func (TokenGroupPositionSetApplier) Type() string    { return "token.group.position.set" }
func (TokenGroupMoveApplier) Type() string           { return "token.group.move" }
func (TokenGroupCounterChangedApplier) Type() string { return "token.group.counter.changed" }
func (TokenGroupPowerToughnessSetApplier) Type() string {
	return "token.group.power_toughness.set"
}
func (TokenGroupControllerChangedApplier) Type() string { return "token.group.controller.changed" }

func (TokenGroupSplitApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	group, err := resolveCurrentTokenGroup(game, command)
	if err != nil {
		return nil, err
	}
	extractQuantity, ok := intField(command.Payload, "extractQuantity")
	if !ok || extractQuantity < 1 || extractQuantity >= group.Quantity() {
		return nil, tokenGroupQuantityError(state.TokenGroupSplitInvalid, command.Type, extractQuantity, 1, group.Quantity()-1, group)
	}
	position, err := requiredTokenGroupPosition(command.Payload, "destinationPosition", command.Type)
	if err != nil {
		return nil, err
	}
	groupBefore := group.Clone()
	beforeQuantity := group.Quantity()
	previous := captureTokenGroupProjections(game, []state.TokenGroupRuntime{group})
	extracted, remaining := deterministicTokenGroupExtraction(group, extractQuantity)
	state.RemoveTokenGroup(game, group.GroupID)

	for _, memberID := range extracted {
		instance := game.Instances[memberID]
		instance.Position = cloneMap(position)
		game.Instances[memberID] = instance
	}
	resulting := []state.TokenGroupRuntime{}
	if len(remaining) >= 2 {
		group.OrderedMemberIDs = remaining
		if !tokenGroupContains(remaining, group.RootInstanceID) {
			group.RootInstanceID = remaining[0]
		}
		group.Revision++
		if err := state.AddTokenGroup(game, group); err != nil {
			return nil, err
		}
		resulting = append(resulting, group)
	}
	var created *state.TokenGroupRuntime
	if len(extracted) >= 2 {
		newGroup := state.TokenGroupRuntime{
			GroupID:        deterministicTokenGroupMutationID(game.GameID, command.ClientActionID, "split"),
			RootInstanceID: extracted[0], OrderedMemberIDs: append([]string(nil), extracted...), Revision: 1,
			CreatedByPlayerID: actorPlayerID(command), CreatedAtVersion: game.Version + 1, EffectVersion: state.TokenGroupEffectVersion,
		}
		if err := state.AddTokenGroup(game, newGroup); err != nil {
			return nil, err
		}
		created = &newGroup
		resulting = append(resulting, newGroup)
	}
	emitTokenGroupRemovals(emitter, previous, []state.TokenGroupRuntime{groupBefore}, "split")
	emitPositionPatchByViewer(emitter, game, game.Loc[extracted[0]].PlayerID, "cards.position.set", tokenGroupPositionEntries(extracted, position))
	emitTokenGroupSets(emitter, game, resulting)

	payload := tokenGroupMutationEffect(command, []string{group.GroupID}, resulting, tokenGroupPositionEntries(extracted, position))
	payload["_eventType"] = "token.group.split"
	payload["extractedInstanceIds"] = append([]string(nil), extracted...)
	payload["beforeQuantity"] = beforeQuantity
	payload["remainingQuantity"] = len(remaining)
	payload["extractedQuantity"] = len(extracted)
	if created != nil {
		payload["createdGroupId"] = created.GroupID
	}
	return payload, nil
}

func (TokenGroupMergeApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	groupIDs, _ := optionalStrictStringSlice(command.Payload, "sourceGroupIds")
	instanceIDs, _ := optionalStrictStringSlice(command.Payload, "sourceInstanceIds")
	if len(groupIDs) == 0 && len(instanceIDs) < 2 {
		return nil, tokenGroupSimpleError(state.TokenGroupMergeInvalid, command.Type, 0)
	}
	if hasDuplicates(groupIDs) || hasDuplicates(instanceIDs) {
		return nil, tokenGroupSimpleError(state.TokenGroupMergeInvalid, command.Type, len(groupIDs)+len(instanceIDs))
	}
	expected, err := expectedRevisionMap(command.Payload)
	if err != nil {
		return nil, err
	}
	groups := make([]state.TokenGroupRuntime, 0, len(groupIDs))
	seenMembers := map[string]struct{}{}
	for _, groupID := range groupIDs {
		group, exists := game.Relations.TokenGroups[groupID]
		if !exists {
			return nil, tokenGroupSimpleError(state.TokenGroupNotFound, command.Type, 0)
		}
		want, exists := expected[groupID]
		if !exists || want != group.Revision {
			return nil, tokenGroupStaleError(command.Type, want, group.Revision, group.Quantity())
		}
		groups = append(groups, group.Clone())
		for _, memberID := range group.OrderedMemberIDs {
			seenMembers[memberID] = struct{}{}
		}
	}
	for _, instanceID := range instanceIDs {
		if _, duplicate := seenMembers[instanceID]; duplicate {
			return nil, tokenGroupSimpleError(state.TokenGroupMergeInvalid, command.Type, len(seenMembers))
		}
		if _, grouped := game.Relations.TokenGroupForMember(instanceID); grouped {
			return nil, tokenGroupSimpleError(state.TokenGroupMemberMismatch, command.Type, len(seenMembers))
		}
		seenMembers[instanceID] = struct{}{}
	}
	memberIDs, survivor, err := canonicalMergeMembership(groups, instanceIDs, optionalString(command.Payload, "targetGroupId"))
	if err != nil {
		return nil, err
	}
	if len(memberIDs) < 2 || len(memberIDs) > maxTokenGroupQuantity {
		return nil, tokenGroupQuantityError(state.TokenGroupQuantityInvalid, command.Type, len(memberIDs), 2, maxTokenGroupQuantity, state.TokenGroupRuntime{})
	}
	if err := state.ResolveTokenGroupingCompatibility(*game, memberIDs); err != nil {
		var groupErr *state.TokenGroupStateError
		if errors.As(err, &groupErr) && groupErr.Code == state.TokenGroupRelationConflict {
			groupErr.Operation = command.Type
			return nil, groupErr
		}
		return nil, &state.TokenGroupStateError{Code: state.TokenGroupMergeInvalid, Operation: command.Type, Count: len(memberIDs), InvalidIndex: -1}
	}
	position, err := requiredTokenGroupPosition(command.Payload, "destinationPosition", command.Type)
	if err != nil {
		return nil, err
	}
	previous := captureTokenGroupProjections(game, groups)
	removedIDs := make([]string, 0, len(groups))
	for _, group := range groups {
		state.RemoveTokenGroup(game, group.GroupID)
		removedIDs = append(removedIDs, group.GroupID)
	}
	for _, memberID := range memberIDs {
		instance := game.Instances[memberID]
		instance.Position = cloneMap(position)
		game.Instances[memberID] = instance
	}
	if survivor.GroupID == "" {
		survivor = state.TokenGroupRuntime{
			GroupID:        deterministicTokenGroupMutationID(game.GameID, command.ClientActionID, "merge"),
			RootInstanceID: memberIDs[0], Revision: 1, CreatedByPlayerID: actorPlayerID(command),
			CreatedAtVersion: game.Version + 1, EffectVersion: state.TokenGroupEffectVersion,
		}
	} else {
		survivor.Revision++
	}
	survivor.OrderedMemberIDs = append([]string(nil), memberIDs...)
	if !tokenGroupContains(memberIDs, survivor.RootInstanceID) {
		survivor.RootInstanceID = memberIDs[0]
	}
	if err := state.AddTokenGroup(game, survivor); err != nil {
		return nil, err
	}
	emitTokenGroupRemovals(emitter, previous, groups, "merged")
	emitPositionPatchByViewer(emitter, game, game.Loc[memberIDs[0]].PlayerID, "cards.position.set", tokenGroupPositionEntries(memberIDs, position))
	emitTokenGroupSets(emitter, game, []state.TokenGroupRuntime{survivor})
	payload := tokenGroupMutationEffect(command, removedIDs, []state.TokenGroupRuntime{survivor}, tokenGroupPositionEntries(memberIDs, position))
	payload["_eventType"] = "token.group.merged"
	payload["quantity"] = len(memberIDs)
	return payload, nil
}

func (TokenGroupRemoveMembersApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	group, err := resolveCurrentTokenGroup(game, command)
	if err != nil {
		return nil, err
	}
	quantity, ok := intField(command.Payload, "quantity")
	if !ok || quantity < 1 || quantity > group.Quantity() {
		return nil, tokenGroupQuantityError(state.TokenGroupQuantityInvalid, command.Type, quantity, 1, group.Quantity(), group)
	}
	groupBefore := group.Clone()
	previous := captureTokenGroupProjections(game, []state.TokenGroupRuntime{group})
	removed, remaining := deterministicTokenGroupRemoval(group, quantity)
	removalRefs := captureRemovedInstanceRefs(game, removed)
	state.RemoveTokenGroup(game, group.GroupID)
	if err := state.NewZoneOps().RemoveMany(game, removed); err != nil {
		return nil, err
	}
	for _, instanceID := range removed {
		delete(game.Instances, instanceID)
		delete(game.Visibility.InstanceMasks, instanceID)
	}
	resulting := []state.TokenGroupRuntime{}
	if len(remaining) >= 2 {
		group.OrderedMemberIDs = remaining
		if !tokenGroupContains(remaining, group.RootInstanceID) {
			group.RootInstanceID = remaining[0]
		}
		group.Revision++
		if err := state.AddTokenGroup(game, group); err != nil {
			return nil, err
		}
		resulting = append(resulting, group)
	}
	emitTokenGroupRemovals(emitter, previous, []state.TokenGroupRuntime{groupBefore}, "members_removed")
	emitRemovedInstancesByViewer(emitter, removalRefs)
	emitTokenGroupSets(emitter, game, resulting)
	emitZoneCount(emitter, game, groupOwnerPlayerID(game, remaining, removed, removalRefs), state.ZoneBattlefield)
	payload := tokenGroupMutationEffect(command, []string{group.GroupID}, resulting, nil)
	payload["_eventType"] = "token.group.members.removed"
	payload["removedInstanceIds"] = append([]string(nil), removed...)
	payload["removedQuantity"] = quantity
	payload["remainingQuantity"] = len(remaining)
	payload["removalReason"] = optionalString(command.Payload, "removalReason")
	return payload, nil
}

func (TokenGroupDissolveApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	group, err := resolveCurrentTokenGroup(game, command)
	if err != nil {
		return nil, err
	}
	positions, err := dissolveTokenGroupPositions(game, group, command)
	if err != nil {
		return nil, err
	}
	previous := captureTokenGroupProjections(game, []state.TokenGroupRuntime{group})
	state.RemoveTokenGroup(game, group.GroupID)
	for _, entry := range positions {
		instanceID := optionalString(entry, "instanceId")
		instance := game.Instances[instanceID]
		instance.Position = cloneMap(mapField(entry, "position"))
		game.Instances[instanceID] = instance
	}
	emitTokenGroupRemovals(emitter, previous, []state.TokenGroupRuntime{group}, "dissolved")
	emitPositionPatchByViewer(emitter, game, game.Loc[group.RootInstanceID].PlayerID, "cards.position.set", positions)
	payload := tokenGroupMutationEffect(command, []string{group.GroupID}, nil, positions)
	payload["_eventType"] = "token.group.dissolved"
	payload["quantity"] = group.Quantity()
	return payload, nil
}

func (TokenGroupStateSetApplier) Apply(ctx context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	group, err := resolveCurrentTokenGroup(game, command)
	if err != nil {
		return nil, err
	}
	tapped, hasTapped := boolField(command.Payload, "tapped")
	faceDown, hasFaceDown := boolField(command.Payload, "faceDown")
	if hasTapped == hasFaceDown {
		return nil, fmt.Errorf("%w: exactly one of tapped or faceDown", ErrInvalidPayloadField)
	}
	if tokenGroupAlreadyHasState(game, group, tapped, hasTapped, faceDown) {
		return nil, tokenGroupSimpleError(state.TokenGroupPatchConflict, command.Type, group.Quantity())
	}
	previous := captureTokenGroupProjections(game, []state.TokenGroupRuntime{group})
	if hasTapped {
		emitTokenGroupRemovals(emitter, previous, []state.TokenGroupRuntime{group}, "state_changed")
	}
	states := make([]map[string]any, 0, group.Quantity())
	for _, memberID := range group.OrderedMemberIDs {
		instance := game.Instances[memberID]
		if hasTapped {
			rotation := 0
			if tapped {
				rotation = 90
			}
			instance.Tapped, instance.Rotation = tapped, rotation
		} else {
			single := command
			single.Type = "card.face_down.changed"
			single.Payload = cloneMap(command.Payload)
			single.Payload["instanceId"] = memberID
			if _, err := (CardFaceDownChangedApplier{}).Apply(ctx, game, single, emitter); err != nil {
				return nil, err
			}
			instance = game.Instances[memberID]
		}
		game.Instances[memberID] = instance
		states = append(states, tokenGroupInstanceState(game, instance))
	}
	state.RemoveTokenGroup(game, group.GroupID)
	group.Revision++
	if err := state.AddTokenGroup(game, group); err != nil {
		return nil, err
	}
	if hasTapped {
		for _, memberID := range group.OrderedMemberIDs {
			instance := game.Instances[memberID]
			location := game.Loc[memberID]
			emitInstancePatchByViewer(emitter, game, memberID, "card.field.set", map[string]any{
				"instanceId": memberID, "playerId": location.PlayerID, "zone": location.Zone,
				"tapped": instance.Tapped, "rotation": instance.Rotation, "faceDown": instance.FaceDown,
			}, true)
		}
	}
	emitTokenGroupSets(emitter, game, []state.TokenGroupRuntime{group})
	payload := tokenGroupMutationEffect(command, []string{group.GroupID}, []state.TokenGroupRuntime{group}, nil)
	payload["_eventType"] = "token.group.state.changed"
	payload["instanceStates"] = states
	if hasTapped {
		payload["tapped"] = tapped
	} else {
		payload["faceDown"] = faceDown
	}
	payload["quantity"] = group.Quantity()
	return payload, nil
}

// TokenGroupCounterChangedApplier applies one counter mutation to the current
// authoritative membership. It deliberately mutates instances directly rather
// than dispatching N client commands: the resulting event is one atomic intent.
func (TokenGroupCounterChangedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	group, err := resolveCurrentTokenGroup(game, command)
	if err != nil {
		return nil, err
	}
	counter, err := cardCounterName(command.Payload)
	if err != nil {
		return nil, err
	}
	remove, hasRemove := boolField(command.Payload, "remove")
	if hasRemove && !remove {
		return nil, fmt.Errorf("%w: remove", ErrInvalidPayloadField)
	}
	value, hasValue := intField(command.Payload, "value")
	delta, hasDelta := intField(command.Payload, "delta")
	if remove && (hasValue || hasDelta) || (!remove && hasValue == hasDelta) {
		return nil, fmt.Errorf("%w: exactly one of value, delta, or remove", ErrInvalidPayloadField)
	}
	root := game.Instances[group.RootInstanceID]
	if root.Counters == nil {
		root.Counters = map[string]int{}
	}
	finalValue := value
	if hasDelta {
		finalValue = root.Counters[counter] + delta
	}
	if remove {
		finalValue = 0
	}
	previous := captureTokenGroupProjections(game, []state.TokenGroupRuntime{group})
	emitTokenGroupRemovals(emitter, previous, []state.TokenGroupRuntime{group}, "counter_changed")
	states := make([]map[string]any, 0, group.Quantity())
	for _, memberID := range group.OrderedMemberIDs {
		instance := game.Instances[memberID]
		if instance.Counters == nil {
			instance.Counters = map[string]int{}
		}
		if remove {
			delete(instance.Counters, counter)
		} else {
			instance.Counters[counter] = finalValue
		}
		game.Instances[memberID] = instance
		location := game.Loc[memberID]
		emitInstancePatchByViewer(emitter, game, memberID, "card.counters.patch", map[string]any{
			"instanceId": memberID, "playerId": location.PlayerID, "zone": location.Zone, "counters": cloneIntMapAny(instance.Counters),
		}, true)
		states = append(states, tokenGroupInstanceState(game, instance))
	}
	if err := advanceTokenGroupRevision(game, &group); err != nil {
		return nil, err
	}
	emitTokenGroupSets(emitter, game, []state.TokenGroupRuntime{group})
	payload := tokenGroupMutationEffect(command, []string{group.GroupID}, []state.TokenGroupRuntime{group}, nil)
	payload["_eventType"] = "token.group.counter.changed"
	payload["instanceStates"] = states
	payload["counter"] = counter
	payload["value"] = finalValue
	payload["remove"] = remove
	payload["quantity"] = group.Quantity()
	return payload, nil
}

func (TokenGroupPowerToughnessSetApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	group, err := resolveCurrentTokenGroup(game, command)
	if err != nil {
		return nil, err
	}
	changed := map[string]any{}
	for _, key := range []string{"power", "toughness"} {
		if hasPayloadKey(command.Payload, key) {
			changed[key] = command.Payload[key]
		}
	}
	if len(changed) == 0 {
		return nil, fmt.Errorf("%w: power/toughness", ErrMissingPayloadField)
	}
	previous := captureTokenGroupProjections(game, []state.TokenGroupRuntime{group})
	emitTokenGroupRemovals(emitter, previous, []state.TokenGroupRuntime{group}, "power_toughness_changed")
	states := make([]map[string]any, 0, group.Quantity())
	for _, memberID := range group.OrderedMemberIDs {
		instance := game.Instances[memberID]
		if instance.MutableStats == nil {
			instance.MutableStats = map[string]any{}
		}
		for key, value := range changed {
			instance.MutableStats[key] = value
		}
		game.Instances[memberID] = instance
		location := game.Loc[memberID]
		patch := map[string]any{"instanceId": memberID, "playerId": location.PlayerID, "zone": location.Zone}
		for key, value := range changed {
			patch[key] = value
		}
		emitInstancePatchByViewer(emitter, game, memberID, "card.field.set", patch, false)
		states = append(states, tokenGroupInstanceState(game, instance))
	}
	if err := advanceTokenGroupRevision(game, &group); err != nil {
		return nil, err
	}
	emitTokenGroupSets(emitter, game, []state.TokenGroupRuntime{group})
	payload := tokenGroupMutationEffect(command, []string{group.GroupID}, []state.TokenGroupRuntime{group}, nil)
	payload["_eventType"] = "token.group.power_toughness.changed"
	payload["instanceStates"] = states
	payload["stats"] = cloneMap(changed)
	payload["quantity"] = group.Quantity()
	return payload, nil
}

func (TokenGroupControllerChangedApplier) Apply(ctx context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	group, err := resolveCurrentTokenGroup(game, command)
	if err != nil {
		return nil, err
	}
	controllerID, err := stringField(command.Payload, "targetPlayerId")
	if err != nil {
		if controllerID, err = stringField(command.Payload, "controllerId"); err != nil {
			return nil, fmt.Errorf("%w: targetPlayerId", ErrMissingPayloadField)
		}
	}
	if _, exists := game.Players[controllerID]; !exists {
		return nil, fmt.Errorf("%w: targetPlayerId", ErrInvalidPayloadField)
	}
	if game.Instances[group.RootInstanceID].ControllerID == controllerID {
		return nil, tokenGroupSimpleError(state.TokenGroupPatchConflict, command.Type, group.Quantity())
	}
	previous := captureTokenGroupProjections(game, []state.TokenGroupRuntime{group})
	emitTokenGroupRemovals(emitter, previous, []state.TokenGroupRuntime{group}, "controller_changed")
	states := make([]map[string]any, 0, group.Quantity())
	for _, memberID := range group.OrderedMemberIDs {
		single := command
		single.Type = "card.controller.changed"
		single.Payload = cloneMap(command.Payload)
		single.Payload["instanceId"] = memberID
		single.Payload["targetPlayerId"] = controllerID
		if _, err := (CardControllerChangedApplier{}).Apply(ctx, game, single, emitter); err != nil {
			return nil, err
		}
		states = append(states, tokenGroupInstanceState(game, game.Instances[memberID]))
	}
	if err := advanceTokenGroupRevision(game, &group); err != nil {
		return nil, err
	}
	emitTokenGroupSets(emitter, game, []state.TokenGroupRuntime{group})
	payload := tokenGroupMutationEffect(command, []string{group.GroupID}, []state.TokenGroupRuntime{group}, nil)
	payload["_eventType"] = "token.group.controller.changed"
	payload["instanceStates"] = states
	payload["controllerId"] = controllerID
	payload["quantity"] = group.Quantity()
	return payload, nil
}

func advanceTokenGroupRevision(game *state.GameState, group *state.TokenGroupRuntime) error {
	state.RemoveTokenGroup(game, group.GroupID)
	group.Revision++
	return state.AddTokenGroup(game, *group)
}

func (TokenGroupPositionSetApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	group, err := resolveCurrentTokenGroup(game, command)
	if err != nil {
		return nil, err
	}
	position, err := requiredTokenGroupPosition(command.Payload, "position", command.Type)
	if err != nil {
		return nil, err
	}
	previous := captureTokenGroupProjections(game, []state.TokenGroupRuntime{group})
	for _, memberID := range group.OrderedMemberIDs {
		instance := game.Instances[memberID]
		instance.Position = cloneMap(position)
		game.Instances[memberID] = instance
	}
	state.RemoveTokenGroup(game, group.GroupID)
	group.Revision++
	if err := state.AddTokenGroup(game, group); err != nil {
		return nil, err
	}
	positions := tokenGroupPositionEntries(group.OrderedMemberIDs, position)
	emitTokenGroupRemovals(emitter, previous, []state.TokenGroupRuntime{group}, "position_changed")
	emitPositionPatchByViewer(emitter, game, game.Loc[group.RootInstanceID].PlayerID, "cards.position.set", positions)
	emitTokenGroupSets(emitter, game, []state.TokenGroupRuntime{group})
	payload := tokenGroupMutationEffect(command, []string{group.GroupID}, []state.TokenGroupRuntime{group}, positions)
	payload["_eventType"] = "token.group.position.changed"
	payload["quantity"] = group.Quantity()
	return payload, nil
}

func (TokenGroupMoveApplier) Apply(ctx context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	group, err := resolveCurrentTokenGroup(game, command)
	if err != nil {
		return nil, err
	}
	toZone, err := zoneField(command.Payload, "toZone")
	if err != nil {
		return nil, err
	}
	if toZone == state.ZoneBattlefield {
		return nil, tokenGroupSimpleError(state.TokenGroupMergeInvalid, command.Type, group.Quantity())
	}
	previous := captureTokenGroupProjections(game, []state.TokenGroupRuntime{group})
	state.RemoveTokenGroup(game, group.GroupID)
	move := command
	move.Type = "cards.moved"
	move.Payload = cloneMap(command.Payload)
	move.Payload["playerId"] = game.Loc[group.RootInstanceID].PlayerID
	move.Payload["fromZone"] = string(state.ZoneBattlefield)
	move.Payload["instanceIds"] = append([]string(nil), group.OrderedMemberIDs...)
	moveResult, err := (CardsMovedApplier{}).Apply(ctx, game, move, emitter)
	if err != nil {
		return nil, err
	}
	emitTokenGroupRemovals(emitter, previous, []state.TokenGroupRuntime{group}, "moved")
	payload := tokenGroupMutationEffect(command, []string{group.GroupID}, nil, nil)
	payload["_eventType"] = "token.group.moved"
	payload["quantity"] = group.Quantity()
	payload["movement"] = moveResult
	return payload, nil
}

func tokenGroupAlreadyHasState(game *state.GameState, group state.TokenGroupRuntime, tapped bool, hasTapped bool, faceDown bool) bool {
	expectedRotation := 0
	if tapped {
		expectedRotation = 90
	}
	for _, memberID := range group.OrderedMemberIDs {
		instance := game.Instances[memberID]
		if hasTapped && (instance.Tapped != tapped || instance.Rotation != expectedRotation) {
			return false
		}
		if !hasTapped && instance.FaceDown != faceDown {
			return false
		}
	}
	return true
}

func resolveCurrentTokenGroup(game *state.GameState, command protocol.CommandEnvelopeV2) (state.TokenGroupRuntime, error) {
	groupID, err := stringField(command.Payload, "groupId")
	if err != nil {
		return state.TokenGroupRuntime{}, err
	}
	group, ok := game.Relations.TokenGroups[groupID]
	if !ok {
		return state.TokenGroupRuntime{}, tokenGroupSimpleError(state.TokenGroupNotFound, command.Type, 0)
	}
	expected, ok := intField(command.Payload, "expectedRevision")
	if !ok || expected < 1 {
		return state.TokenGroupRuntime{}, fmt.Errorf("%w: expectedRevision", ErrInvalidPayloadField)
	}
	if expected != group.Revision {
		return state.TokenGroupRuntime{}, tokenGroupStaleError(command.Type, expected, group.Revision, group.Quantity())
	}
	if err := state.ValidateTokenGroupState(*game); err != nil {
		return state.TokenGroupRuntime{}, err
	}
	return group.Clone(), nil
}

func deterministicTokenGroupMutationID(gameID, actionID, discriminator string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(gameID) + "\x00" + strings.TrimSpace(actionID) + "\x00token-group-" + discriminator + "-v1"))
	return "token-group-" + hex.EncodeToString(digest[:12])
}

func deterministicTokenGroupExtraction(group state.TokenGroupRuntime, quantity int) ([]string, []string) {
	selected := map[string]struct{}{}
	for index := len(group.OrderedMemberIDs) - 1; index >= 0 && len(selected) < quantity; index-- {
		memberID := group.OrderedMemberIDs[index]
		if memberID == group.RootInstanceID {
			continue
		}
		selected[memberID] = struct{}{}
	}
	if len(selected) < quantity {
		selected[group.RootInstanceID] = struct{}{}
	}
	extracted, remaining := []string{}, []string{}
	for _, memberID := range group.OrderedMemberIDs {
		if _, ok := selected[memberID]; ok {
			extracted = append(extracted, memberID)
		} else {
			remaining = append(remaining, memberID)
		}
	}
	return extracted, remaining
}

func deterministicTokenGroupRemoval(group state.TokenGroupRuntime, quantity int) ([]string, []string) {
	remove := make(map[string]struct{}, quantity)
	for index := len(group.OrderedMemberIDs) - 1; index >= 0 && len(remove) < quantity; index-- {
		memberID := group.OrderedMemberIDs[index]
		if memberID == group.RootInstanceID {
			continue
		}
		remove[memberID] = struct{}{}
	}
	if len(remove) < quantity {
		remove[group.RootInstanceID] = struct{}{}
	}
	removed, remaining := []string{}, []string{}
	for _, memberID := range group.OrderedMemberIDs {
		if _, ok := remove[memberID]; ok {
			removed = append(removed, memberID)
		} else {
			remaining = append(remaining, memberID)
		}
	}
	return removed, remaining
}

func canonicalMergeMembership(groups []state.TokenGroupRuntime, singles []string, targetID string) ([]string, state.TokenGroupRuntime, error) {
	var survivor state.TokenGroupRuntime
	if targetID != "" {
		for _, group := range groups {
			if group.GroupID == targetID {
				survivor = group
				break
			}
		}
		if survivor.GroupID == "" {
			return nil, survivor, tokenGroupSimpleError(state.TokenGroupMergeInvalid, "token.group.merge", 0)
		}
	} else if len(groups) > 0 {
		sorted := append([]state.TokenGroupRuntime(nil), groups...)
		sort.SliceStable(sorted, func(i, j int) bool {
			if sorted[i].CreatedAtVersion != sorted[j].CreatedAtVersion {
				return sorted[i].CreatedAtVersion < sorted[j].CreatedAtVersion
			}
			return sorted[i].GroupID < sorted[j].GroupID
		})
		survivor = sorted[0]
	}
	orderedGroups := append([]state.TokenGroupRuntime(nil), groups...)
	sort.SliceStable(orderedGroups, func(i, j int) bool {
		if orderedGroups[i].GroupID == survivor.GroupID {
			return true
		}
		if orderedGroups[j].GroupID == survivor.GroupID {
			return false
		}
		if orderedGroups[i].CreatedAtVersion != orderedGroups[j].CreatedAtVersion {
			return orderedGroups[i].CreatedAtVersion < orderedGroups[j].CreatedAtVersion
		}
		return orderedGroups[i].GroupID < orderedGroups[j].GroupID
	})
	members := []string{}
	for _, group := range orderedGroups {
		members = append(members, group.OrderedMemberIDs...)
	}
	members = append(members, singles...)
	if hasDuplicates(members) {
		return nil, survivor, tokenGroupSimpleError(state.TokenGroupMergeInvalid, "token.group.merge", len(members))
	}
	return members, survivor, nil
}

func expectedRevisionMap(payload map[string]any) (map[string]int, error) {
	raw, ok := payload["expectedRevisions"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%w: expectedRevisions", ErrInvalidPayloadField)
	}
	result := make(map[string]int, len(raw))
	for groupID, value := range raw {
		revision, ok := strictInteger(value)
		if strings.TrimSpace(groupID) == "" || !ok || revision < 1 {
			return nil, fmt.Errorf("%w: expectedRevisions", ErrInvalidPayloadField)
		}
		result[groupID] = revision
	}
	return result, nil
}

func optionalStrictStringSlice(payload map[string]any, key string) ([]string, error) {
	if _, ok := payload[key]; !ok {
		return []string{}, nil
	}
	values, err := stringSliceField(payload, key)
	if err != nil {
		return nil, err
	}
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			return nil, fmt.Errorf("%w: %s", ErrInvalidPayloadField, key)
		}
	}
	return values, nil
}

func requiredTokenGroupPosition(payload map[string]any, key, commandType string) (map[string]any, error) {
	raw, ok := payload[key]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrMissingPayloadField, key)
	}
	return canonicalRatioPosition(raw, commandType, "", 0)
}

func dissolveTokenGroupPositions(game *state.GameState, group state.TokenGroupRuntime, command protocol.CommandEnvelopeV2) ([]map[string]any, error) {
	if raw, exists := command.Payload["positions"]; exists {
		entries, err := tokenGroupPositionList(raw)
		if err != nil || len(entries) != group.Quantity() {
			return nil, fmt.Errorf("%w: positions", ErrInvalidPayloadField)
		}
		seen := map[string]struct{}{}
		for _, entry := range entries {
			instanceID, err := stringField(entry, "instanceId")
			if err != nil || !tokenGroupContains(group.OrderedMemberIDs, instanceID) {
				return nil, tokenGroupSimpleError(state.TokenGroupMemberMismatch, command.Type, len(entries))
			}
			if _, duplicate := seen[instanceID]; duplicate {
				return nil, tokenGroupSimpleError(state.TokenGroupDuplicateMember, command.Type, len(entries))
			}
			seen[instanceID] = struct{}{}
			position, err := canonicalRatioPosition(entry["position"], command.Type, instanceID, 0)
			if err != nil {
				return nil, err
			}
			entry["position"] = position
		}
		return entries, nil
	}
	root := game.Instances[group.RootInstanceID]
	x, _ := numericPosition(root.Position["x"])
	y, _ := numericPosition(root.Position["y"])
	positions := make([]map[string]any, 0, group.Quantity())
	for index, memberID := range group.OrderedMemberIDs {
		column := float64(index%5) - float64(minInt(group.Quantity(), 5)-1)/2
		row := float64(index / 5)
		positions = append(positions, map[string]any{"instanceId": memberID, "position": map[string]any{
			"unit": "ratio", "x": math.Max(0, math.Min(1, x+column*0.035)), "y": math.Max(0, math.Min(1, y+row*0.045)),
		}})
	}
	return positions, nil
}

func tokenGroupPositionList(raw any) ([]map[string]any, error) {
	result := []map[string]any{}
	switch typed := raw.(type) {
	case []map[string]any:
		result = append(result, typed...)
	case []any:
		for _, value := range typed {
			entry, ok := value.(map[string]any)
			if !ok {
				return nil, ErrInvalidPayloadField
			}
			result = append(result, entry)
		}
	default:
		return nil, ErrInvalidPayloadField
	}
	return result, nil
}

func tokenGroupMutationEffect(command protocol.CommandEnvelopeV2, removed []string, resulting []state.TokenGroupRuntime, positions []map[string]any) map[string]any {
	groups := make([]map[string]any, 0, len(resulting))
	for _, group := range resulting {
		groups = append(groups, tokenGroupEvent(group))
	}
	payload := map[string]any{
		"effectVersion": tokenGroupMutationEffectVersion, "actorPlayerId": actorPlayerID(command),
		"removedGroupIds": append([]string(nil), removed...), "resultingGroups": groups,
	}
	if len(positions) > 0 {
		payload["positions"] = positions
	}
	return payload
}

func tokenGroupPositionEntries(memberIDs []string, position map[string]any) []map[string]any {
	result := make([]map[string]any, 0, len(memberIDs))
	for _, memberID := range memberIDs {
		result = append(result, map[string]any{"instanceId": memberID, "position": cloneMap(position)})
	}
	return result
}

func tokenGroupInstanceState(game *state.GameState, instance state.CardInstanceRuntime) map[string]any {
	return map[string]any{
		"instanceId": instance.InstanceID, "tapped": instance.Tapped, "rotation": instance.Rotation,
		"faceDown": instance.FaceDown, "visibleToMask": instance.VisibleToMask,
		"revealedTo": revealedToForMask(game, instance.VisibleToMask),
		"counters":   cloneIntMapAny(instance.Counters), "mutableStats": cloneMap(instance.MutableStats),
		"controllerId": instance.ControllerID,
	}
}

func emitTokenGroupRemovals(emitter *PatchEmitter, previous map[string]map[string]map[string]any, groups []state.TokenGroupRuntime, reason string) {
	for _, group := range groups {
		for viewerID, projection := range previous[group.GroupID] {
			emitter.EmitPrivate(viewerID, protocol.PatchOp{Op: "token.group.remove", Data: map[string]any{"groupId": projection["groupId"], "revision": group.Revision + 1, "reason": reason}})
		}
	}
}

func emitTokenGroupSets(emitter *PatchEmitter, game *state.GameState, groups []state.TokenGroupRuntime) {
	for _, group := range groups {
		for _, viewerID := range sortedPlayerIDs(game) {
			if projected, visible := projectTokenGroupForViewer(game, group, viewerID); visible {
				emitter.EmitPrivate(viewerID, protocol.PatchOp{Op: "token.group.set", Data: map[string]any{"group": projected}})
			}
		}
	}
}

type removedInstanceProjection struct {
	playerID string
	refs     map[string]string
}

func captureRemovedInstanceRefs(game *state.GameState, instanceIDs []string) map[string]removedInstanceProjection {
	result := map[string]removedInstanceProjection{}
	for _, instanceID := range instanceIDs {
		location := game.Loc[instanceID]
		entry := removedInstanceProjection{playerID: location.PlayerID, refs: map[string]string{}}
		for _, viewerID := range sortedPlayerIDs(game) {
			if ref, visible := projectInstanceReferenceForViewer(game, instanceID, viewerID); visible {
				entry.refs[viewerID] = ref
			}
		}
		result[instanceID] = entry
	}
	return result
}
func emitRemovedInstancesByViewer(emitter *PatchEmitter, projections map[string]removedInstanceProjection) {
	byViewer := map[string]map[string][]string{}
	for _, entry := range projections {
		for viewerID, ref := range entry.refs {
			if byViewer[viewerID] == nil {
				byViewer[viewerID] = map[string][]string{}
			}
			byViewer[viewerID][entry.playerID] = append(byViewer[viewerID][entry.playerID], ref)
		}
	}
	for viewerID, byPlayer := range byViewer {
		for playerID, refs := range byPlayer {
			emitter.EmitPrivate(viewerID, protocol.PatchOp{Op: "zone.cards.remove", Data: map[string]any{"playerId": playerID, "zone": state.ZoneBattlefield, "instanceIds": refs}})
		}
	}
}

func groupOwnerPlayerID(game *state.GameState, remaining, removed []string, refs map[string]removedInstanceProjection) string {
	if len(remaining) > 0 {
		return game.Loc[remaining[0]].PlayerID
	}
	if len(removed) > 0 {
		return refs[removed[0]].playerID
	}
	return ""
}

func tokenGroupSimpleError(code, operation string, count int) error {
	return &state.TokenGroupStateError{Code: code, Operation: operation, Count: count, InvalidIndex: -1}
}
func tokenGroupQuantityError(code, operation string, requested, min, max int, group state.TokenGroupRuntime) error {
	return &state.TokenGroupStateError{Code: code, Operation: operation, Count: group.Quantity(), Requested: requested, Min: min, Max: max, InvalidIndex: -1}
}
func tokenGroupStaleError(operation string, expected, actual, count int) error {
	return &state.TokenGroupStateError{Code: state.TokenGroupStale, Operation: operation, Count: count, ExpectedRevision: expected, ActualRevision: actual, InvalidIndex: -1}
}
func hasDuplicates(values []string) bool {
	seen := map[string]struct{}{}
	for _, v := range values {
		if _, ok := seen[v]; ok {
			return true
		}
		seen[v] = struct{}{}
	}
	return false
}
func tokenGroupContains(values []string, target string) bool {
	for _, v := range values {
		if v == target {
			return true
		}
	}
	return false
}
func numericPosition(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	}
	return 0, false
}
func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
