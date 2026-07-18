package actor

import (
	"context"
	"errors"
	"fmt"
	"time"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

type StackCardAddedApplier struct{}

func (StackCardAddedApplier) Type() string { return "stack.card_added" }

func (StackCardAddedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	item, visibility, err := canonicalStackItem(game, command)
	if err != nil {
		return nil, err
	}
	next := make([]state.StackItem, 0, len(game.Stack)+1)
	for _, existing := range game.Stack {
		if existing.StackID != item.StackID {
			next = append(next, existing)
		}
	}
	game.Stack = append(next, item)
	patch := stackItemPatch(item)
	if visibility == "public" {
		emitter.EmitPublic(protocol.PatchOp{Op: "stack.item.add", Data: map[string]any{"item": patch}})
	} else {
		emitter.EmitPublic(protocol.PatchOp{Op: "stack.item.add", Data: map[string]any{"item": privateStackItemPatch(item)}})
		emitter.EmitPrivate(item.OwnerID, protocol.PatchOp{Op: "stack.item.add", Data: map[string]any{"item": patch}})
	}
	patch["visibility"] = visibility
	patch["ownerId"] = item.OwnerID
	payload := map[string]any{
		"stackId":          item.StackID,
		"instanceId":       item.SourceInstanceID,
		"sourceInstanceId": item.SourceInstanceID,
		"item":             patch,
		"metrics":          stackMetrics(start, emitter),
	}
	return payload, nil
}

func canonicalStackItem(game *state.GameState, command protocol.CommandEnvelopeV2) (state.StackItem, string, error) {
	// Canonical item payloads are a replay compatibility input only. Live
	// clients must reference the authoritative source instance and cannot
	// inject owner/controller/visibility/card identity through item fields.
	if raw, ok := command.Payload["item"].(map[string]any); ok && command.Type == "" {
		stackID := optionalString(raw, "stackId")
		if stackID == "" {
			stackID = optionalString(raw, "id")
		}
		if stackID == "" {
			return state.StackItem{}, "", fmt.Errorf("%w: stackId", ErrMissingPayloadField)
		}
		instanceID := optionalString(raw, "sourceInstanceId")
		if instanceID == "" {
			instanceID = optionalString(raw, "instanceId")
		}
		visibility := defaultString(optionalString(raw, "visibility"), "public")
		ownerID := optionalString(raw, "ownerId")
		return state.StackItem{
			StackID:          stackID,
			Kind:             defaultString(optionalString(raw, "kind"), "card"),
			SourceInstanceID: instanceID,
			CardKey:          optionalString(raw, "cardKey"),
			ControllerID:     optionalString(raw, "controllerId"),
			OwnerID:          ownerID,
			Visibility:       visibility,
			Text:             optionalString(raw, "text"),
			CreatedAt:        optionalString(raw, "createdAt"),
			Meta: map[string]any{
				"kind":       defaultString(optionalString(raw, "kind"), "card"),
				"playerId":   optionalString(raw, "playerId"),
				"zone":       optionalString(raw, "zone"),
				"ownerId":    ownerID,
				"visibility": visibility,
				"createdAt":  optionalString(raw, "createdAt"),
			},
		}, visibility, nil
	}

	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return state.StackItem{}, "", err
	}
	instance, location, err := instanceAt(game, instanceID, "")
	if err != nil {
		return state.StackItem{}, "", err
	}
	stackID := optionalString(command.Payload, "stackId")
	if stackID == "" {
		stackID = "stack-" + command.ClientActionID
	}
	visibility := "public"
	if privateZone(location.Zone) || instance.FaceDown {
		visibility = "player:" + location.PlayerID
	}
	createdAt := nowUTC().Format(time.RFC3339Nano)
	return state.StackItem{
		StackID:          stackID,
		Kind:             "card",
		SourceInstanceID: instanceID,
		CardKey:          instance.CardKey,
		ControllerID:     instance.ControllerID,
		OwnerID:          location.PlayerID,
		Visibility:       visibility,
		Text:             optionalString(command.Payload, "text"),
		CreatedAt:        createdAt,
		Meta: map[string]any{
			"kind":       "card",
			"playerId":   location.PlayerID,
			"zone":       string(location.Zone),
			"ownerId":    location.PlayerID,
			"visibility": visibility,
			"createdAt":  createdAt,
		},
	}, visibility, nil
}

type StackItemRemovedApplier struct{}

func (StackItemRemovedApplier) Type() string { return "stack.item_removed" }

func (StackItemRemovedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	stackID := optionalString(command.Payload, "stackId")
	if stackID == "" {
		stackID = optionalString(command.Payload, "id")
	}
	if stackID == "" {
		return nil, fmt.Errorf("%w: stackId", ErrMissingPayloadField)
	}
	removed := false
	next := game.Stack[:0]
	for _, item := range game.Stack {
		if item.StackID == stackID {
			removed = true
			continue
		}
		next = append(next, item)
	}
	if !removed {
		return nil, state.ErrMissingRelation
	}
	game.Stack = next
	emitter.EmitPublic(protocol.PatchOp{Op: "stack.item.remove", Data: map[string]any{"id": stackID}})
	return map[string]any{"stackId": stackID, "metrics": stackMetrics(start, emitter)}, nil
}

type ArrowCreatedApplier struct{}

func (ArrowCreatedApplier) Type() string { return "arrow.created" }

func (ArrowCreatedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	fromID, err := stringField(command.Payload, "fromInstanceId")
	if err != nil {
		return nil, err
	}
	toID, err := stringField(command.Payload, "toInstanceId")
	if err != nil {
		return nil, err
	}
	id := optionalString(command.Payload, "id")
	if id == "" {
		id = "arrow-" + command.ClientActionID
	}
	relation := state.Relation{
		ID:       id,
		SourceID: fromID,
		TargetID: toID,
		Meta: map[string]any{
			"ownerId":   actorPlayerID(command),
			"color":     defaultString(optionalString(command.Payload, "color"), "yellow"),
			"createdAt": nowUTC().Format(time.RFC3339Nano),
		},
	}
	ops := state.NewRelationsOps()
	if err := ops.AddArrow(game, relation); err != nil {
		return nil, err
	}
	patch := arrowPatch(relation)
	emitter.EmitPublic(protocol.PatchOp{Op: "arrow.add", Data: map[string]any{"arrow": patch}})
	return map[string]any{"id": id, "fromInstanceId": fromID, "toInstanceId": toID, "metrics": relationsMetrics(start, ops, emitter)}, nil
}

type ArrowRemovedApplier struct{}

func (ArrowRemovedApplier) Type() string { return "arrow.removed" }

func (ArrowRemovedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	id, err := stringField(command.Payload, "id")
	if err != nil {
		return nil, err
	}
	ops := state.NewRelationsOps()
	if _, err := ops.RemoveArrow(game, id); err != nil {
		return nil, err
	}
	emitter.EmitPublic(protocol.PatchOp{Op: "arrow.remove", Data: map[string]any{"id": id}})
	return map[string]any{"id": id, "metrics": relationsMetrics(start, ops, emitter)}, nil
}

type AttachmentCreatedApplier struct{}

func (AttachmentCreatedApplier) Type() string { return "attachment.created" }

func (AttachmentCreatedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	equipmentID, err := stringField(command.Payload, "equipmentInstanceId")
	if err != nil {
		return nil, err
	}
	attachedToID, err := stringField(command.Payload, "attachedToInstanceId")
	if err != nil {
		return nil, err
	}
	if equipmentID == attachedToID {
		return nil, &RelationValidationError{Code: RelationCodeSelfReference, CommandType: command.Type, InstanceID: equipmentID}
	}
	id := optionalString(command.Payload, "id")
	if id == "" {
		id = "attachment-" + command.ClientActionID
	}
	relation := state.Relation{
		ID:               id,
		RelationType:     "attachment",
		SourceID:         equipmentID,
		TargetID:         attachedToID,
		OwnerPlayerID:    actorPlayerID(command),
		EffectVersion:    1,
		CreatedAtVersion: game.Version + 1,
		Meta: map[string]any{
			"ownerId":   actorPlayerID(command),
			"createdAt": nowUTC().Format(time.RFC3339Nano),
		},
	}
	ops := state.NewRelationsOps()
	if err := ops.AddAttachment(game, relation); err != nil {
		return nil, relationStateError(command.Type, equipmentID, err)
	}
	relation = game.Relations.Attachments[id]
	patch := attachmentPatch(relation)
	emitter.EmitPublic(protocol.PatchOp{Op: "attachment.set", Data: map[string]any{"attachment": patch}})
	return map[string]any{
		"id": id, "relationType": "attachment", "equipmentInstanceId": equipmentID,
		"attachedToInstanceId": attachedToID, "order": relation.Order,
		"ownerPlayerId": relation.OwnerPlayerID, "effectVersion": relation.EffectVersion,
		"createdAtVersion": relation.CreatedAtVersion, "createdAt": stringFromMap(relation.Meta, "createdAt"),
		"attachment": patch, "actorPlayerId": actorPlayerID(command), "metrics": relationsMetrics(start, ops, emitter),
	}, nil
}

type AttachmentRemovedApplier struct{}

func (AttachmentRemovedApplier) Type() string { return "attachment.removed" }

func (AttachmentRemovedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	id := optionalString(command.Payload, "id")
	ops := state.NewRelationsOps()
	if id == "" {
		equipmentID, err := stringField(command.Payload, "equipmentInstanceId")
		if err != nil {
			return nil, err
		}
		for relationID, relation := range game.Relations.Attachments {
			if relation.SourceID == equipmentID {
				id = relationID
				break
			}
		}
	}
	if id == "" {
		return nil, state.ErrMissingRelation
	}
	relation, relationExists := game.Relations.Attachments[id]
	if !relationExists {
		return nil, state.ErrMissingRelation
	}
	_, sourceLocation, locationErr := instanceAt(game, relation.SourceID, state.ZoneBattlefield)
	if locationErr != nil {
		return nil, locationErr
	}
	removed, err := ops.RemoveAttachment(game, id)
	if err != nil {
		return nil, relationStateError(command.Type, optionalString(command.Payload, "equipmentInstanceId"), err)
	}
	emitter.EmitPublic(protocol.PatchOp{Op: "attachment.remove", Data: map[string]any{"id": id}})
	payload := map[string]any{
		"id": id, "effectVersion": 1, "previousAttachment": attachmentPatch(removed),
		"actorPlayerId": actorPlayerID(command), "metrics": relationsMetrics(start, ops, emitter),
	}
	if rawPosition, exists := command.Payload["position"]; exists {
		position, positionErr := canonicalRatioPosition(rawPosition, command.Type, removed.SourceID, 0)
		if positionErr != nil {
			return nil, positionErr
		}
		instance := game.Instances[removed.SourceID]
		instance.Position = cloneMap(position)
		game.Instances[removed.SourceID] = instance
		emitPositionPatchByViewer(emitter, game, sourceLocation.PlayerID, "card.position.set", []map[string]any{{
			"instanceId": removed.SourceID, "position": cloneMap(position),
		}})
		payload["instanceId"] = removed.SourceID
		payload["position"] = cloneMap(position)
	}
	return payload, nil
}

type AttachmentReorderedApplier struct{}

func (AttachmentReorderedApplier) Type() string { return "attachment.reordered" }

func (AttachmentReorderedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	targetID, err := stringField(command.Payload, "attachedToInstanceId")
	if err != nil {
		return nil, err
	}
	orderedIDs, err := stringSliceField(command.Payload, "orderedAttachmentIds")
	if err != nil {
		return nil, err
	}
	ops := state.NewRelationsOps()
	ordered, err := ops.ReorderAttachments(game, targetID, orderedIDs)
	if err != nil {
		return nil, relationStateError(command.Type, targetID, err)
	}
	attachments := make([]map[string]any, 0, len(ordered))
	for _, relation := range ordered {
		attachments = append(attachments, attachmentPatch(relation))
	}
	emitter.EmitPublic(protocol.PatchOp{Op: "attachment.order.set", Data: map[string]any{
		"attachedToInstanceId": targetID, "orderedAttachmentIds": append([]string(nil), orderedIDs...),
	}})
	return map[string]any{
		"attachedToInstanceId": targetID, "orderedAttachmentIds": append([]string(nil), orderedIDs...),
		"attachments": attachments, "effectVersion": 1, "actorPlayerId": actorPlayerID(command),
		"metrics": relationsMetrics(start, ops, emitter),
	}, nil
}

type BattlefieldStackCreatedApplier struct{}

func (BattlefieldStackCreatedApplier) Type() string { return "battlefield.stack.created" }

func (BattlefieldStackCreatedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	members, err := canonicalStackMembers(command, "orderedInstanceIds")
	if err != nil {
		return nil, err
	}
	if len(members) < 2 {
		return nil, &RelationValidationError{Code: RelationCodeMemberMissing, CommandType: command.Type}
	}
	rootID := optionalString(command.Payload, "rootInstanceId")
	if rootID == "" {
		rootID = members[0]
	}
	stackKind := defaultString(optionalString(command.Payload, "stackKind"), "land")
	if stackKind != "land" && stackKind != "generic" {
		return nil, &RelationValidationError{Code: RelationCodeInvalidType, CommandType: command.Type}
	}
	stackID := optionalString(command.Payload, "stackId")
	if stackID == "" {
		stackID = "battlefield-stack-" + command.ClientActionID
	}
	stack := state.BattlefieldStack{
		ID: stackID, RelationType: "battlefield_stack", RootInstanceID: rootID,
		OrderedMemberIDs: members, StackKind: stackKind, CreatedByPlayerID: actorPlayerID(command),
		EffectVersion: 1, CreatedAtVersion: game.Version + 1,
	}
	ops := state.NewRelationsOps()
	if err := ops.AddBattlefieldStack(game, stack); err != nil {
		return nil, relationStateError(command.Type, rootID, err)
	}
	patch := battlefieldStackPatch(stack)
	emitter.EmitPublic(protocol.PatchOp{Op: "battlefield.stack.set", Data: map[string]any{"stack": patch}})
	return map[string]any{
		"stackId": stackID, "rootInstanceId": rootID, "orderedInstanceIds": append([]string(nil), members...),
		"stackKind": stackKind, "stack": patch, "effectVersion": 1,
		"actorPlayerId": actorPlayerID(command), "metrics": relationsMetrics(start, ops, emitter),
	}, nil
}

type BattlefieldStackMemberAddedApplier struct{}

func (BattlefieldStackMemberAddedApplier) Type() string { return "battlefield.stack.member_added" }

func (BattlefieldStackMemberAddedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	stackID, err := stringField(command.Payload, "stackId")
	if err != nil {
		return nil, err
	}
	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	stack, ok := game.Relations.BattlefieldStacks[stackID]
	if !ok {
		return nil, &RelationValidationError{Code: RelationCodeNotFound, CommandType: command.Type}
	}
	index := len(stack.OrderedMemberIDs)
	if rawIndex, exists := command.Payload["index"]; exists {
		parsed, valid := intFromAny(rawIndex)
		if !valid || parsed < 0 || parsed > len(stack.OrderedMemberIDs) {
			return nil, &RelationValidationError{Code: RelationCodeOrderMismatch, CommandType: command.Type}
		}
		index = parsed
	}
	previous := battlefieldStackPatch(stack)
	stack.OrderedMemberIDs = append(stack.OrderedMemberIDs, "")
	copy(stack.OrderedMemberIDs[index+1:], stack.OrderedMemberIDs[index:])
	stack.OrderedMemberIDs[index] = instanceID
	ops := state.NewRelationsOps()
	if err := ops.SetBattlefieldStack(game, stack); err != nil {
		return nil, relationStateError(command.Type, instanceID, err)
	}
	patch := battlefieldStackPatch(stack)
	emitter.EmitPublic(protocol.PatchOp{Op: "battlefield.stack.set", Data: map[string]any{"stack": patch}})
	return map[string]any{
		"stackId": stackID, "instanceId": instanceID, "previousStack": previous, "stack": patch,
		"effectVersion": 1, "actorPlayerId": actorPlayerID(command), "metrics": relationsMetrics(start, ops, emitter),
	}, nil
}

type BattlefieldStackMemberRemovedApplier struct{}

func (BattlefieldStackMemberRemovedApplier) Type() string { return "battlefield.stack.member_removed" }

func (BattlefieldStackMemberRemovedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	stackID, err := stringField(command.Payload, "stackId")
	if err != nil {
		return nil, err
	}
	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	position, err := canonicalRatioPosition(command.Payload["position"], command.Type, instanceID, 0)
	if err != nil {
		return nil, err
	}
	stack, ok := game.Relations.BattlefieldStacks[stackID]
	if !ok {
		return nil, &RelationValidationError{Code: RelationCodeNotFound, CommandType: command.Type}
	}
	previous := battlefieldStackPatch(stack)
	remaining := make([]string, 0, len(stack.OrderedMemberIDs)-1)
	found := false
	for _, memberID := range stack.OrderedMemberIDs {
		if memberID == instanceID {
			found = true
			continue
		}
		remaining = append(remaining, memberID)
	}
	if !found {
		return nil, &RelationValidationError{Code: RelationCodeMemberMissing, CommandType: command.Type, InstanceID: instanceID}
	}
	instance, instanceLocation, locationErr := instanceAt(game, instanceID, state.ZoneBattlefield)
	if locationErr != nil {
		return nil, locationErr
	}
	instance.Position = cloneMap(position)
	game.Instances[instanceID] = instance
	ops := state.NewRelationsOps()
	var finalStack map[string]any
	if len(remaining) < 2 {
		_, _ = ops.RemoveBattlefieldStack(game, stackID)
		emitter.EmitPublic(protocol.PatchOp{Op: "battlefield.stack.remove", Data: map[string]any{"id": stackID}})
	} else {
		stack.OrderedMemberIDs = remaining
		if stack.RootInstanceID == instanceID {
			stack.RootInstanceID = remaining[0]
		}
		if err := ops.SetBattlefieldStack(game, stack); err != nil {
			return nil, relationStateError(command.Type, instanceID, err)
		}
		finalStack = battlefieldStackPatch(stack)
		emitter.EmitPublic(protocol.PatchOp{Op: "battlefield.stack.set", Data: map[string]any{"stack": finalStack}})
	}
	emitPositionPatchByViewer(emitter, game, instanceLocation.PlayerID, "card.position.set", []map[string]any{{
		"instanceId": instanceID, "position": cloneMap(position),
	}})
	return compactMap(map[string]any{
		"stackId": stackID, "instanceId": instanceID, "position": cloneMap(position),
		"previousStack": previous, "stack": finalStack, "effectVersion": 1,
		"actorPlayerId": actorPlayerID(command), "metrics": relationsMetrics(start, ops, emitter),
	}), nil
}

type BattlefieldStackReorderedApplier struct{}

func (BattlefieldStackReorderedApplier) Type() string { return "battlefield.stack.reordered" }

func (BattlefieldStackReorderedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	stackID, err := stringField(command.Payload, "stackId")
	if err != nil {
		return nil, err
	}
	members, err := canonicalStackMembers(command, "orderedInstanceIds")
	if err != nil {
		return nil, err
	}
	stack, ok := game.Relations.BattlefieldStacks[stackID]
	if !ok {
		return nil, &RelationValidationError{Code: RelationCodeNotFound, CommandType: command.Type}
	}
	if !sameStringSet(stack.OrderedMemberIDs, members) {
		return nil, &RelationValidationError{Code: RelationCodeOrderMismatch, CommandType: command.Type}
	}
	rootID := defaultString(optionalString(command.Payload, "rootInstanceId"), stack.RootInstanceID)
	if !relationSliceContains(members, rootID) {
		return nil, &RelationValidationError{Code: RelationCodeMemberMissing, CommandType: command.Type, InstanceID: rootID}
	}
	previous := battlefieldStackPatch(stack)
	stack.OrderedMemberIDs = members
	stack.RootInstanceID = rootID
	ops := state.NewRelationsOps()
	if err := ops.SetBattlefieldStack(game, stack); err != nil {
		return nil, relationStateError(command.Type, rootID, err)
	}
	patch := battlefieldStackPatch(stack)
	emitter.EmitPublic(protocol.PatchOp{Op: "battlefield.stack.order.set", Data: map[string]any{
		"stackId": stackID, "rootInstanceId": rootID, "orderedInstanceIds": append([]string(nil), members...),
	}})
	return map[string]any{
		"stackId": stackID, "rootInstanceId": rootID, "orderedInstanceIds": append([]string(nil), members...),
		"previousStack": previous, "stack": patch, "effectVersion": 1,
		"actorPlayerId": actorPlayerID(command), "metrics": relationsMetrics(start, ops, emitter),
	}, nil
}

type BattlefieldStackDissolvedApplier struct{}

func (BattlefieldStackDissolvedApplier) Type() string { return "battlefield.stack.dissolved" }

func (BattlefieldStackDissolvedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	stackID, err := stringField(command.Payload, "stackId")
	if err != nil {
		return nil, err
	}
	stack, ok := game.Relations.BattlefieldStacks[stackID]
	if !ok {
		return nil, &RelationValidationError{Code: RelationCodeNotFound, CommandType: command.Type}
	}
	positions, err := canonicalRelationPositions(command, stack.OrderedMemberIDs)
	if err != nil {
		return nil, err
	}
	_, rootLocation, locationErr := instanceAt(game, stack.RootInstanceID, state.ZoneBattlefield)
	if locationErr != nil {
		return nil, locationErr
	}
	previous := battlefieldStackPatch(stack)
	for instanceID, position := range positions {
		instance := game.Instances[instanceID]
		instance.Position = cloneMap(position)
		game.Instances[instanceID] = instance
	}
	ops := state.NewRelationsOps()
	if _, err := ops.RemoveBattlefieldStack(game, stackID); err != nil {
		return nil, relationStateError(command.Type, "", err)
	}
	positionPatches := orderedPositionPatches(stack.OrderedMemberIDs, positions)
	emitter.EmitPublic(protocol.PatchOp{Op: "battlefield.stack.remove", Data: map[string]any{"id": stackID}})
	emitPositionPatchByViewer(emitter, game, rootLocation.PlayerID, "cards.position.set", positionPatches)
	return map[string]any{
		"stackId": stackID, "previousStack": previous, "positions": positionPatches,
		"effectVersion": 1, "actorPlayerId": actorPlayerID(command), "metrics": relationsMetrics(start, ops, emitter),
	}, nil
}

type HelperCreatedApplier struct{}

func (HelperCreatedApplier) Type() string { return "helper.created" }

func (HelperCreatedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	id := optionalString(command.Payload, "entityId")
	if id == "" {
		id = optionalString(command.Payload, "id")
	}
	if id == "" {
		id = "helper-" + command.ClientActionID
	}
	meta := helperMeta(command.Payload)
	meta["id"] = id
	ops := state.NewRelationsOps()
	relation := state.Relation{ID: id, Meta: meta}
	if err := ops.AddHelper(game, relation); err != nil {
		return nil, err
	}
	emitter.EmitPublic(protocol.PatchOp{Op: "helper.add", Data: map[string]any{"entity": helperPatch(relation)}})
	payload := cloneMap(meta)
	payload["entityId"] = id
	payload["id"] = id
	payload["metrics"] = relationsMetrics(start, ops, emitter)
	return payload, nil
}

type HelperUpdatedApplier struct{}

func (HelperUpdatedApplier) Type() string { return "helper.updated" }

func (HelperUpdatedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	id, err := stringField(command.Payload, "entityId")
	if err != nil {
		return nil, err
	}
	ops := state.NewRelationsOps()
	relation, err := ops.UpdateHelper(game, id, helperMeta(command.Payload))
	if err != nil {
		return nil, err
	}
	emitter.EmitPublic(protocol.PatchOp{Op: "helper.update", Data: map[string]any{"entity": helperPatch(relation)}})
	payload := cloneMap(relation.Meta)
	payload["entityId"] = id
	payload["id"] = id
	payload["metrics"] = relationsMetrics(start, ops, emitter)
	return payload, nil
}

type HelperRemovedApplier struct{}

func (HelperRemovedApplier) Type() string { return "helper.removed" }

func (HelperRemovedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	id, err := stringField(command.Payload, "entityId")
	if err != nil {
		return nil, err
	}
	ops := state.NewRelationsOps()
	if _, err := ops.RemoveHelper(game, id); err != nil {
		return nil, err
	}
	emitter.EmitPublic(protocol.PatchOp{Op: "helper.remove", Data: map[string]any{"id": id}})
	return map[string]any{"entityId": id, "metrics": relationsMetrics(start, ops, emitter)}, nil
}

func stackItemPatch(item state.StackItem) map[string]any {
	data := map[string]any{
		"id":               item.StackID,
		"stackId":          item.StackID,
		"kind":             defaultString(item.Kind, defaultString(stringFromMap(item.Meta, "kind"), "card")),
		"sourceInstanceId": item.SourceInstanceID,
		"instanceId":       item.SourceInstanceID,
		"controllerId":     item.ControllerID,
		"cardKey":          item.CardKey,
		"text":             item.Text,
		"playerId":         stringFromMap(item.Meta, "playerId"),
		"zone":             stringFromMap(item.Meta, "zone"),
	}
	if createdAt := defaultString(item.CreatedAt, stringFromMap(item.Meta, "createdAt")); createdAt != "" {
		data["createdAt"] = createdAt
	}
	return compactMap(data)
}

func privateStackItemPatch(item state.StackItem) map[string]any {
	return compactMap(map[string]any{
		"id":        item.StackID,
		"stackId":   item.StackID,
		"kind":      defaultString(item.Kind, defaultString(stringFromMap(item.Meta, "kind"), "card")),
		"text":      item.Text,
		"createdAt": defaultString(item.CreatedAt, stringFromMap(item.Meta, "createdAt")),
	})
}

func arrowPatch(relation state.Relation) map[string]any {
	return compactMap(map[string]any{
		"id":             relation.ID,
		"ownerId":        stringFromMap(relation.Meta, "ownerId"),
		"fromInstanceId": relation.SourceID,
		"toInstanceId":   relation.TargetID,
		"color":          defaultString(stringFromMap(relation.Meta, "color"), "yellow"),
		"createdAt":      stringFromMap(relation.Meta, "createdAt"),
	})
}

func attachmentPatch(relation state.Relation) map[string]any {
	return compactMap(map[string]any{
		"id":                   relation.ID,
		"relationType":         defaultString(relation.RelationType, "attachment"),
		"ownerId":              defaultString(relation.OwnerPlayerID, stringFromMap(relation.Meta, "ownerId")),
		"ownerPlayerId":        defaultString(relation.OwnerPlayerID, stringFromMap(relation.Meta, "ownerId")),
		"equipmentInstanceId":  relation.SourceID,
		"attachedToInstanceId": relation.TargetID,
		"order":                relation.Order,
		"effectVersion":        relation.EffectVersion,
		"createdAtVersion":     relation.CreatedAtVersion,
		"createdAt":            stringFromMap(relation.Meta, "createdAt"),
	})
}

func battlefieldStackPatch(stack state.BattlefieldStack) map[string]any {
	return map[string]any{
		"id": stack.ID, "stackId": stack.ID,
		"relationType":      defaultString(stack.RelationType, "battlefield_stack"),
		"rootInstanceId":    stack.RootInstanceID,
		"orderedMemberIds":  append([]string(nil), stack.OrderedMemberIDs...),
		"stackKind":         defaultString(stack.StackKind, "land"),
		"createdByPlayerId": stack.CreatedByPlayerID,
		"effectVersion":     stack.EffectVersion,
		"createdAtVersion":  stack.CreatedAtVersion,
	}
}

func canonicalStackMembers(command protocol.CommandEnvelopeV2, key string) ([]string, error) {
	members, err := stringSliceField(command.Payload, key)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for index, instanceID := range members {
		if seen[instanceID] {
			return nil, &RelationValidationError{Code: RelationCodeMemberDuplicate, CommandType: command.Type, InstanceID: instanceID, Index: index}
		}
		seen[instanceID] = true
	}
	return members, nil
}

func relationStateError(commandType string, instanceID string, err error) error {
	switch {
	case errors.Is(err, state.ErrMissingRelation):
		return &RelationValidationError{Code: RelationCodeNotFound, CommandType: commandType, InstanceID: instanceID}
	case errors.Is(err, state.ErrRelationExists):
		return &RelationValidationError{Code: RelationCodeAlreadyExists, CommandType: commandType, InstanceID: instanceID}
	case errors.Is(err, state.ErrRelationCycle):
		return &RelationValidationError{Code: RelationCodeCycle, CommandType: commandType, InstanceID: instanceID}
	case errors.Is(err, state.ErrInstanceAlreadyStacked):
		return &RelationValidationError{Code: RelationCodeAlreadyStacked, CommandType: commandType, InstanceID: instanceID}
	case errors.Is(err, state.ErrMissingInstance):
		return &AuthorizationError{Code: AuthorizationCodeInstanceNotFound, CommandType: commandType, InstanceID: instanceID}
	default:
		return &RelationValidationError{Code: RelationCodeOrderMismatch, CommandType: commandType, InstanceID: instanceID}
	}
}

func sameStringSet(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	seen := make(map[string]int, len(left))
	for _, value := range left {
		seen[value]++
	}
	for _, value := range right {
		seen[value]--
		if seen[value] < 0 {
			return false
		}
	}
	for _, count := range seen {
		if count != 0 {
			return false
		}
	}
	return true
}

func relationSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func canonicalRelationPositions(command protocol.CommandEnvelopeV2, expectedIDs []string) (map[string]map[string]any, error) {
	raw, ok := command.Payload["positions"]
	if !ok {
		return nil, &PositionValidationError{Code: PositionCodeInvalid, CommandType: command.Type}
	}
	entries := []map[string]any{}
	switch typed := raw.(type) {
	case []map[string]any:
		entries = typed
	case []any:
		for _, value := range typed {
			entry, ok := value.(map[string]any)
			if !ok {
				return nil, &PositionValidationError{Code: PositionCodeInvalid, CommandType: command.Type}
			}
			entries = append(entries, entry)
		}
	default:
		return nil, &PositionValidationError{Code: PositionCodeInvalid, CommandType: command.Type}
	}
	if len(entries) != len(expectedIDs) {
		return nil, &RelationValidationError{Code: RelationCodeOrderMismatch, CommandType: command.Type}
	}
	expected := map[string]bool{}
	for _, instanceID := range expectedIDs {
		expected[instanceID] = true
	}
	positions := make(map[string]map[string]any, len(entries))
	for index, entry := range entries {
		instanceID := optionalString(entry, "instanceId")
		if !expected[instanceID] || positions[instanceID] != nil {
			return nil, &RelationValidationError{Code: RelationCodeOrderMismatch, CommandType: command.Type, InstanceID: instanceID, Index: index}
		}
		position, err := canonicalRatioPosition(entry["position"], command.Type, instanceID, index)
		if err != nil {
			return nil, err
		}
		positions[instanceID] = position
	}
	return positions, nil
}

func orderedPositionPatches(order []string, positions map[string]map[string]any) []map[string]any {
	out := make([]map[string]any, 0, len(order))
	for _, instanceID := range order {
		out = append(out, map[string]any{"instanceId": instanceID, "position": cloneMap(positions[instanceID])})
	}
	return out
}

func helperPatch(relation state.Relation) map[string]any {
	entity := cloneMap(relation.Meta)
	entity["id"] = relation.ID
	if _, ok := entity["state"]; !ok {
		entity["state"] = map[string]any{}
	}
	if _, ok := entity["card"]; !ok {
		entity["card"] = nil
	}
	return compactMap(entity)
}

func helperMeta(payload map[string]any) map[string]any {
	meta := map[string]any{}
	for _, key := range []string{"template", "scope", "ownerPlayerId", "state", "createdAt"} {
		if value, ok := payload[key]; ok {
			meta[key] = value
		}
	}
	if card, ok := payload["card"].(map[string]any); ok && card != nil {
		sanitized := map[string]any{}
		for _, key := range []string{"scryfallId", "name", "layout"} {
			if value, ok := card[key]; ok {
				sanitized[key] = value
			}
		}
		meta["card"] = sanitized
	}
	return meta
}

func optionalString(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return value
}

func defaultString(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func stringFromMap(values map[string]any, key string) string {
	value, _ := values[key].(string)
	return value
}

func compactMap(values map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range values {
		switch typed := value.(type) {
		case string:
			if typed != "" {
				out[key] = typed
			}
		case nil:
			out[key] = nil
		default:
			out[key] = typed
		}
	}
	return out
}

func stackMetrics(start time.Time, emitter *PatchEmitter) map[string]any {
	return map[string]any{
		"stack.runtime_route":        1,
		"stack.patch_bytes":          patchBytes(emitter),
		"stack.apply_ms":             float64(time.Since(start).Microseconds()) / 1000,
		"stack.static_payload_bytes": 0,
	}
}

func relationsMetrics(start time.Time, ops *state.RelationsOps, emitter *PatchEmitter) map[string]any {
	return map[string]any{
		"relations.runtime_route":   1,
		"relations.full_scan_count": ops.FullScanCount(),
		"relations.patch_bytes":     patchBytes(emitter),
		"relations.apply_ms":        float64(time.Since(start).Microseconds()) / 1000,
	}
}

func actorPlayerID(command protocol.CommandEnvelopeV2) string {
	if playerID, ok := command.Payload["actorPlayerId"].(string); ok && playerID != "" {
		return playerID
	}
	if playerID, ok := command.Payload["playerId"].(string); ok && playerID != "" {
		return playerID
	}
	if playerID, ok := command.Payload["ownerPlayerId"].(string); ok && playerID != "" {
		return playerID
	}
	if ownerID, ok := command.Payload["ownerId"].(string); ok && ownerID != "" {
		return ownerID
	}
	return ""
}
