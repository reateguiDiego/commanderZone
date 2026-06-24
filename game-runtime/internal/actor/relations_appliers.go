package actor

import (
	"context"
	"fmt"
	"time"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

type StackCardAddedApplier struct{}

func (StackCardAddedApplier) Type() string { return "stack.card_added" }

func (StackCardAddedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	instance, location, err := instanceAt(game, instanceID, "")
	if err != nil {
		return nil, err
	}
	stackID := optionalString(command.Payload, "stackId")
	if stackID == "" {
		stackID = "stack-" + command.ClientActionID
	}
	item := state.StackItem{
		StackID:          stackID,
		SourceInstanceID: instanceID,
		CardKey:          instance.CardKey,
		ControllerID:     instance.ControllerID,
		Text:             optionalString(command.Payload, "text"),
		Meta: map[string]any{
			"kind":      "card",
			"playerId":  location.PlayerID,
			"zone":      location.Zone,
			"createdAt": nowUTC().Format(time.RFC3339Nano),
		},
	}
	game.Stack = append(game.Stack, item)
	patch := stackItemPatch(item)
	emitter.EmitPublic(protocol.PatchOp{Op: "stack.item.add", Data: map[string]any{"item": patch}})
	payload := map[string]any{"stackId": stackID, "instanceId": instanceID, "sourceInstanceId": instanceID, "metrics": stackMetrics(start, emitter)}
	if item.Text != "" {
		payload["text"] = item.Text
	}
	return payload, nil
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
	id := optionalString(command.Payload, "id")
	if id == "" {
		id = "attachment-" + command.ClientActionID
	}
	relation := state.Relation{
		ID:       id,
		SourceID: equipmentID,
		TargetID: attachedToID,
		Meta: map[string]any{
			"ownerId":   actorPlayerID(command),
			"createdAt": nowUTC().Format(time.RFC3339Nano),
		},
	}
	ops := state.NewRelationsOps()
	if err := ops.AddAttachment(game, relation); err != nil {
		return nil, err
	}
	patch := attachmentPatch(relation)
	emitter.EmitPublic(protocol.PatchOp{Op: "attachment.add", Data: map[string]any{"attachment": patch}})
	return map[string]any{"id": id, "equipmentInstanceId": equipmentID, "attachedToInstanceId": attachedToID, "metrics": relationsMetrics(start, ops, emitter)}, nil
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
	if _, err := ops.RemoveAttachment(game, id); err != nil {
		return nil, err
	}
	emitter.EmitPublic(protocol.PatchOp{Op: "attachment.remove", Data: map[string]any{"id": id}})
	return map[string]any{"id": id, "metrics": relationsMetrics(start, ops, emitter)}, nil
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
		"kind":             defaultString(stringFromMap(item.Meta, "kind"), "card"),
		"sourceInstanceId": item.SourceInstanceID,
		"instanceId":       item.SourceInstanceID,
		"controllerId":     item.ControllerID,
		"cardKey":          item.CardKey,
		"text":             item.Text,
	}
	if createdAt := stringFromMap(item.Meta, "createdAt"); createdAt != "" {
		data["createdAt"] = createdAt
	}
	return compactMap(data)
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
		"ownerId":              stringFromMap(relation.Meta, "ownerId"),
		"equipmentInstanceId":  relation.SourceID,
		"attachedToInstanceId": relation.TargetID,
		"createdAt":            stringFromMap(relation.Meta, "createdAt"),
	})
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
	if playerID, ok := command.Payload["playerId"].(string); ok && playerID != "" {
		return playerID
	}
	if ownerID, ok := command.Payload["ownerId"].(string); ok && ownerID != "" {
		return ownerID
	}
	return ""
}
