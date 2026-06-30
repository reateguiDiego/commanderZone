package actor

import (
	"strings"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

var ownPlayerPayloadCommands = map[string]string{
	"life.changed":                 "playerId",
	"library.draw":                 "playerId",
	"library.draw_many":            "playerId",
	"library.reveal_top":           "playerId",
	"library.reveal":               "playerId",
	"library.play_top_revealed":    "playerId",
	"library.reorder_top":          "playerId",
	"library.move_top":             "playerId",
	"library.put_top":              "playerId",
	"library.put_bottom":           "playerId",
	"library.view":                 "playerId",
	"library.shuffle":              "playerId",
	"zone.reorderedByIds":          "playerId",
	"zone.move_all":                "playerId",
	"zone.random_card.selected":    "playerId",
	"battlefield.untap_all":        "playerId",
	"card.token.created":           "playerId",
	"card.moved":                   "playerId",
	"cards.moved":                  "playerId",
	"card.tapped":                  "playerId",
	"card.position.changed":        "playerId",
	"cards.position.changed":       "playerId",
	"card.dungeon_marker.changed":  "playerId",
	"card.face_down.changed":       "playerId",
	"card.face.changed":            "playerId",
	"card.revealed":                "playerId",
	"card.controller.changed":      "playerId",
	"card.power_toughness.changed": "playerId",
	"card.counter.changed":         "playerId",
	"stack.card_added":             "playerId",
	"arrow.created":                "ownerId",
	"attachment.created":           "ownerId",
	"helper.created":               "ownerPlayerId",
	"mulligan.take":                "playerId",
	"mulligan.keep":                "playerId",
	"mulligan.cards_bottomed":      "playerId",
	"mulligan.scry.confirm":        "playerId",
	"mulligan.ready":               "playerId",
}

var ownTargetPayloadCommands = map[string]string{
	"commander.damage.changed": "targetPlayerId",
}

var ownInstanceSubjectCommands = map[string][]string{
	"card.tapped":                  {"instanceId"},
	"card.position.changed":        {"instanceId"},
	"card.dungeon_marker.changed":  {"instanceId"},
	"card.face_down.changed":       {"instanceId"},
	"card.face.changed":            {"instanceId"},
	"card.revealed":                {"instanceId"},
	"card.controller.changed":      {"instanceId"},
	"card.power_toughness.changed": {"instanceId"},
	"card.counter.changed":         {"instanceId"},
	"card.token_copy.created":      {"instanceId"},
	"stack.card_added":             {"instanceId"},
	"attachment.created":           {"equipmentInstanceId"},
}

func (a *GameActor) permissionErrorLocked(command protocol.CommandEnvelopeV2, actorID string) error {
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return ErrActorPermission
	}
	if command.Type == "game.close" {
		return nil
	}
	if command.Type == "game.concede" {
		return a.requirePayloadPlayer(command.Payload, "playerId", actorID)
	}
	if command.Type == "turn.changed" {
		activePlayerID, _ := a.state.Turn["activePlayerId"].(string)
		if activePlayerID != "" && activePlayerID != actorID {
			return ErrActorPermission
		}
	}
	if key, ok := ownPlayerPayloadCommands[command.Type]; ok {
		if command.Type == "library.shuffle" && command.Payload["reason"] == "revealed-library-closed" {
			return nil
		}
		if err := a.requirePayloadPlayer(command.Payload, key, actorID); err != nil {
			return err
		}
	}
	if key, ok := ownTargetPayloadCommands[command.Type]; ok {
		if err := a.requirePayloadPlayer(command.Payload, key, actorID); err != nil {
			return err
		}
	}
	if command.Type == "counter.changed" {
		if err := a.requireCounterOwner(command.Payload, actorID); err != nil {
			return err
		}
	}
	if err := a.requireOwnInstances(command, actorID); err != nil {
		return err
	}
	if err := a.requireOwnMovedPrivateSources(command, actorID); err != nil {
		return err
	}
	if err := a.requireOwnRelation(command, actorID); err != nil {
		return err
	}
	if err := a.requireOwnHelper(command, actorID); err != nil {
		return err
	}
	if err := a.requireOwnStackItem(command, actorID); err != nil {
		return err
	}
	return nil
}

func (a *GameActor) requirePayloadPlayer(payload map[string]any, key string, actorID string) error {
	value, ok := payload[key].(string)
	if !ok || strings.TrimSpace(value) == "" {
		return nil
	}
	if value != actorID {
		return ErrActorPermission
	}
	return nil
}

func (a *GameActor) requireCounterOwner(payload map[string]any, actorID string) error {
	scope, _ := payload["scope"].(string)
	if strings.HasPrefix(scope, "player:") {
		if strings.TrimPrefix(scope, "player:") != actorID {
			return ErrActorPermission
		}
	}
	if strings.HasPrefix(scope, "commander:") {
		instanceID := strings.TrimPrefix(scope, "commander:")
		if instanceID != "" && !a.actorControlsInstance(instanceID, actorID) {
			return ErrActorPermission
		}
	}
	return nil
}

func (a *GameActor) requireOwnInstances(command protocol.CommandEnvelopeV2, actorID string) error {
	for _, key := range ownInstanceSubjectCommands[command.Type] {
		instanceID, _ := command.Payload[key].(string)
		if instanceID == "" {
			continue
		}
		if !a.actorControlsInstance(instanceID, actorID) {
			return ErrActorPermission
		}
	}
	return nil
}

func (a *GameActor) requireOwnMovedPrivateSources(command protocol.CommandEnvelopeV2, actorID string) error {
	if command.Type != "card.moved" && command.Type != "cards.moved" {
		return nil
	}
	instanceIDs, err := stringSliceField(command.Payload, "instanceIds")
	if err != nil {
		if instanceID, ok := command.Payload["instanceId"].(string); ok && instanceID != "" {
			instanceIDs = []string{instanceID}
		}
	}
	for _, instanceID := range instanceIDs {
		location, ok := a.state.GetLocation(instanceID)
		if !ok {
			continue
		}
		if privateZone(location.Zone) && location.PlayerID != actorID {
			return ErrActorPermission
		}
	}
	return nil
}

func (a *GameActor) requireOwnRelation(command protocol.CommandEnvelopeV2, actorID string) error {
	switch command.Type {
	case "arrow.removed":
		id, _ := command.Payload["id"].(string)
		if id == "" {
			return nil
		}
		relation, ok := a.state.Relations.Arrows[id]
		if !ok {
			return nil
		}
		return a.requireRelationOwner(relation, actorID)
	case "attachment.removed":
		id, _ := command.Payload["id"].(string)
		if id == "" {
			equipmentID, _ := command.Payload["equipmentInstanceId"].(string)
			if equipmentID != "" && !a.actorControlsInstance(equipmentID, actorID) {
				return ErrActorPermission
			}
			return nil
		}
		relation, ok := a.state.Relations.Attachments[id]
		if !ok {
			return nil
		}
		return a.requireRelationOwner(relation, actorID)
	default:
		return nil
	}
}

func (a *GameActor) requireRelationOwner(relation state.Relation, actorID string) error {
	if ownerID, _ := relation.Meta["ownerId"].(string); ownerID != "" && ownerID != actorID {
		return ErrActorPermission
	}
	if relation.SourceID != "" && !a.actorControlsInstance(relation.SourceID, actorID) {
		return ErrActorPermission
	}
	return nil
}

func (a *GameActor) requireOwnHelper(command protocol.CommandEnvelopeV2, actorID string) error {
	if command.Type != "helper.updated" && command.Type != "helper.removed" {
		return nil
	}
	id, _ := command.Payload["entityId"].(string)
	if id == "" {
		return nil
	}
	relation, ok := a.state.Relations.Helpers[id]
	if !ok {
		return nil
	}
	ownerID, _ := relation.Meta["ownerPlayerId"].(string)
	if ownerID != "" && ownerID != actorID {
		return ErrActorPermission
	}
	return nil
}

func (a *GameActor) requireOwnStackItem(command protocol.CommandEnvelopeV2, actorID string) error {
	if command.Type != "stack.item_removed" {
		return nil
	}
	stackID, _ := command.Payload["stackId"].(string)
	if stackID == "" {
		stackID, _ = command.Payload["id"].(string)
	}
	if stackID == "" {
		return nil
	}
	for _, item := range a.state.Stack {
		if item.StackID != stackID {
			continue
		}
		if item.ControllerID != "" && item.ControllerID != actorID {
			return ErrActorPermission
		}
		if sourceID := item.SourceInstanceID; sourceID != "" && !a.actorControlsInstance(sourceID, actorID) {
			return ErrActorPermission
		}
	}
	return nil
}

func (a *GameActor) actorControlsInstance(instanceID string, actorID string) bool {
	location, ok := a.state.GetLocation(instanceID)
	if ok && location.PlayerID == actorID {
		return true
	}
	instance, ok := a.state.Instances[instanceID]
	if !ok {
		return true
	}
	return instance.ControllerID == actorID || instance.OwnerID == actorID
}

func eventCreatedByMatches(event protocol.EventPayloadV2, actorID string) bool {
	return strings.TrimSpace(event.CreatedBy) == "" || strings.TrimSpace(actorID) == "" || event.CreatedBy == actorID
}
