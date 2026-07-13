package actor

import (
	"errors"
	"strings"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

const (
	AuthorizationCodeInstanceNotFound          = "INSTANCE_NOT_FOUND"
	AuthorizationCodeInstanceNotControlled     = "INSTANCE_NOT_CONTROLLED"
	AuthorizationCodeInstanceNotOwned          = "INSTANCE_NOT_OWNED"
	AuthorizationCodeZoneMismatch              = "ZONE_MISMATCH"
	AuthorizationCodeMixedAuthorityBatch       = "MIXED_AUTHORITY_BATCH"
	AuthorizationCodeDuplicateInstance         = "DUPLICATE_INSTANCE"
	AuthorizationCodePermissionDenied          = "PERMISSION_DENIED"
	AuthorizationCodeCommanderNotFound         = "COMMANDER_NOT_FOUND"
	AuthorizationCodeInvalidCommander          = "INVALID_COMMANDER"
	AuthorizationCodeInvalidSource             = "INVALID_SOURCE"
	AuthorizationCodeInvalidTarget             = "INVALID_TARGET"
	AuthorizationCodePlayerDefeated            = "PLAYER_DEFEATED"
	AuthorizationCodePlayerConceded            = "PLAYER_CONCEDED"
	AuthorizationCodeGameClosed                = "GAME_CLOSED"
	AuthorizationCodeInvalidFace               = "INVALID_FACE"
	AuthorizationCodeInvalidPowerOverride      = "INVALID_POWER_OVERRIDE"
	AuthorizationCodeInvalidToughnessOverride  = "INVALID_TOUGHNESS_OVERRIDE"
	AuthorizationCodeNoStatsAxisProvided       = "NO_STATS_AXIS_PROVIDED"
	AuthorizationCodeNonNumericQuickAdjustment = "NON_NUMERIC_QUICK_ADJUSTMENT"
)

// AuthorizationError is safe to serialize to the command actor. InstanceID is
// always copied from that actor's command payload; no card identity is exposed.
type AuthorizationError struct {
	Code        string
	CommandType string
	InstanceID  string
	Index       int
}

func (e *AuthorizationError) Error() string {
	switch e.Code {
	case AuthorizationCodeInstanceNotFound:
		return "command references an instance that does not exist"
	case AuthorizationCodeInstanceNotControlled:
		return "actor does not control the referenced battlefield instance"
	case AuthorizationCodeInstanceNotOwned:
		return "actor does not own the referenced zone instance"
	case AuthorizationCodeZoneMismatch:
		return "referenced instance is no longer in the expected zone"
	case AuthorizationCodeMixedAuthorityBatch:
		return "batch contains instances with mixed authority"
	case AuthorizationCodeDuplicateInstance:
		return "batch contains a duplicate instance"
	case AuthorizationCodeInvalidFace:
		return "card face is invalid"
	case AuthorizationCodeInvalidPowerOverride:
		return "power override is invalid"
	case AuthorizationCodeInvalidToughnessOverride:
		return "toughness override is invalid"
	case AuthorizationCodeNoStatsAxisProvided:
		return "no power or toughness axis was provided"
	case AuthorizationCodeNonNumericQuickAdjustment:
		return "quick adjustment requires a numeric base or override"
	case AuthorizationCodeCommanderNotFound:
		return "command references a commander instance that does not exist"
	case AuthorizationCodeInvalidCommander:
		return "command references an invalid commander"
	case AuthorizationCodeInvalidSource:
		return "commander damage source is invalid"
	case AuthorizationCodeInvalidTarget:
		return "commander damage target is invalid"
	case AuthorizationCodePlayerDefeated:
		return "defeated players cannot perform gameplay mutations"
	case AuthorizationCodePlayerConceded:
		return "conceded players cannot perform gameplay mutations"
	case AuthorizationCodeGameClosed:
		return "closed or resolved games cannot receive gameplay mutations"
	default:
		return "actor is not allowed to perform command"
	}
}

func (e *AuthorizationError) Unwrap() error { return ErrActorPermission }

func AsAuthorizationError(err error) (*AuthorizationError, bool) {
	var authorizationError *AuthorizationError
	if !errors.As(err, &authorizationError) {
		return nil, false
	}
	return authorizationError, true
}

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
	"card.stats.override.set":      "playerId",
	"card.stats.override.clear":    "playerId",
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
	"card.stats.override.set":      {"instanceId"},
	"card.stats.override.clear":    {"instanceId"},
	"card.counter.changed":         {"instanceId"},
	"card.token_copy.created":      {"instanceId"},
	"stack.card_added":             {"instanceId"},
	"library.put_top":              {"instanceId"},
	"library.put_bottom":           {"instanceId"},
	"arrow.created":                {"fromInstanceId"},
	"attachment.created":           {"equipmentInstanceId"},
}

func (a *GameActor) permissionErrorLocked(command protocol.CommandEnvelopeV2, actorID string) error {
	actorID = strings.TrimSpace(actorID)
	if command.Type == "disconnect.vote" && command.Client["source"] == "runtime_ws_presence" {
		return nil
	}
	if actorID == "" {
		return ErrActorPermission
	}
	if command.Type == "commander.damage.changed" {
		targetPlayerID, ok := command.Payload["targetPlayerId"].(string)
		targetPlayerID = strings.TrimSpace(targetPlayerID)
		if !ok || targetPlayerID == "" {
			return &AuthorizationError{Code: AuthorizationCodeInvalidTarget, CommandType: command.Type}
		}
		if _, exists := a.state.Players[targetPlayerID]; !exists {
			return &AuthorizationError{Code: AuthorizationCodeInvalidTarget, CommandType: command.Type}
		}
		if targetPlayerID != actorID {
			return &AuthorizationError{Code: AuthorizationCodePermissionDenied, CommandType: command.Type}
		}
	}
	if err := a.activeGameplayActorError(command.Type, actorID); err != nil {
		return err
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
	if err := a.requireAuthorizedCommandInstances(command, actorID); err != nil {
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

func (a *GameActor) activeGameplayActorError(commandType string, actorID string) error {
	switch commandType {
	case "game.close", "disconnect.vote":
		return nil
	}
	if commandType == "game.concede" && playerStatus(a.state, actorID) == "conceded" {
		return nil
	}
	player, ok := a.state.Players[actorID]
	if !ok {
		return ErrActorPermission
	}
	status, _ := player["status"].(string)
	switch status {
	case "defeated":
		return &AuthorizationError{Code: AuthorizationCodePlayerDefeated, CommandType: commandType}
	case "conceded":
		return &AuthorizationError{Code: AuthorizationCodePlayerConceded, CommandType: commandType}
	default:
		if a.state.Status == "finished" || a.state.Status == "closed" || a.state.Phase == state.PhaseFinished || a.state.ResultState != "" {
			return &AuthorizationError{Code: AuthorizationCodeGameClosed, CommandType: commandType}
		}
		return nil
	}
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

type authorizationSubject struct {
	instanceID   string
	index        int
	expectedZone state.Zone
}

func (a *GameActor) requireAuthorizedCommandInstances(command protocol.CommandEnvelopeV2, actorID string) error {
	subjects := a.authorizationSubjects(command)
	if len(subjects) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(subjects))
	locations := make([]state.Location, len(subjects))
	instances := make([]state.CardInstanceRuntime, len(subjects))
	for index, subject := range subjects {
		if _, duplicate := seen[subject.instanceID]; duplicate {
			return commandAuthorizationError(command, AuthorizationCodeDuplicateInstance, subject.instanceID, subject.index)
		}
		seen[subject.instanceID] = struct{}{}
		location, locationExists := a.state.GetLocation(subject.instanceID)
		instance, instanceExists := a.state.Instances[subject.instanceID]
		if !locationExists || !instanceExists {
			return commandAuthorizationError(command, AuthorizationCodeInstanceNotFound, subject.instanceID, subject.index)
		}
		if subject.expectedZone != "" && location.Zone != subject.expectedZone {
			return commandAuthorizationError(command, AuthorizationCodeZoneMismatch, subject.instanceID, subject.index)
		}
		locations[index] = location
		instances[index] = instance
	}

	firstUnauthorized := -1
	authorizedCount := 0
	for index := range subjects {
		if instanceAuthorityMatches(instances[index], locations[index], actorID) {
			authorizedCount++
			continue
		}
		if firstUnauthorized < 0 {
			firstUnauthorized = index
		}
	}
	if firstUnauthorized < 0 {
		return nil
	}
	invalid := subjects[firstUnauthorized]
	if len(subjects) > 1 && authorizedCount > 0 {
		return commandAuthorizationError(command, AuthorizationCodeMixedAuthorityBatch, invalid.instanceID, invalid.index)
	}
	code := AuthorizationCodeInstanceNotOwned
	if locations[firstUnauthorized].Zone == state.ZoneBattlefield {
		code = AuthorizationCodeInstanceNotControlled
	}
	return commandAuthorizationError(command, code, invalid.instanceID, invalid.index)
}

func (a *GameActor) authorizationSubjects(command protocol.CommandEnvelopeV2) []authorizationSubject {
	fromIDs := func(instanceIDs []string, expectedZone state.Zone) []authorizationSubject {
		subjects := make([]authorizationSubject, 0, len(instanceIDs))
		for index, instanceID := range instanceIDs {
			if strings.TrimSpace(instanceID) != "" {
				subjects = append(subjects, authorizationSubject{instanceID: instanceID, index: index, expectedZone: expectedZone})
			}
		}
		return subjects
	}

	switch command.Type {
	case "card.moved":
		instanceID, _ := command.Payload["instanceId"].(string)
		expectedZone := state.Zone(optionalPayloadString(command.Payload, "fromZone"))
		return fromIDs([]string{instanceID}, expectedZone)
	case "cards.moved":
		instanceIDs, err := stringSliceField(command.Payload, "instanceIds")
		if err != nil {
			return nil
		}
		expectedZone := state.Zone(optionalPayloadString(command.Payload, "fromZone"))
		return fromIDs(instanceIDs, expectedZone)
	case "cards.position.changed":
		return positionAuthorizationSubjects(command.Payload["positions"])
	case "zone.reorderedByIds", "library.reorder_top":
		instanceIDs, err := stringSliceField(command.Payload, "instanceIds")
		if err != nil {
			return nil
		}
		expectedZone := state.ZoneLibrary
		if command.Type == "zone.reorderedByIds" {
			expectedZone = state.Zone(optionalPayloadString(command.Payload, "zone"))
		}
		return fromIDs(instanceIDs, expectedZone)
	case "zone.move_all":
		playerID := optionalPayloadString(command.Payload, "playerId")
		zone := state.Zone(optionalPayloadString(command.Payload, "fromZone"))
		return fromIDs(append([]string(nil), movementZoneIDs(a.state.Zones[playerID], zone)...), zone)
	}

	subjects := make([]authorizationSubject, 0, len(ownInstanceSubjectCommands[command.Type]))
	for _, key := range ownInstanceSubjectCommands[command.Type] {
		instanceID, _ := command.Payload[key].(string)
		if instanceID == "" && command.Type == "stack.card_added" {
			if item, ok := command.Payload["item"].(map[string]any); ok {
				instanceID = optionalPayloadString(item, "sourceInstanceId")
				if instanceID == "" {
					instanceID = optionalPayloadString(item, "instanceId")
				}
			}
		}
		if instanceID != "" {
			subjects = append(subjects, authorizationSubject{instanceID: instanceID, index: len(subjects)})
		}
	}
	return subjects
}

func positionAuthorizationSubjects(raw any) []authorizationSubject {
	entries := []map[string]any{}
	switch typed := raw.(type) {
	case []map[string]any:
		entries = typed
	case []any:
		for _, value := range typed {
			entry, ok := value.(map[string]any)
			if !ok {
				return nil
			}
			entries = append(entries, entry)
		}
	default:
		return nil
	}
	subjects := make([]authorizationSubject, 0, len(entries))
	for index, entry := range entries {
		instanceID, _ := entry["instanceId"].(string)
		if strings.TrimSpace(instanceID) != "" {
			subjects = append(subjects, authorizationSubject{instanceID: instanceID, index: index, expectedZone: state.ZoneBattlefield})
		}
	}
	return subjects
}

func instanceAuthorityMatches(instance state.CardInstanceRuntime, location state.Location, actorID string) bool {
	if location.Zone == state.ZoneBattlefield {
		controllerID := strings.TrimSpace(instance.ControllerID)
		if controllerID == "" {
			controllerID = strings.TrimSpace(location.ControllerID)
		}
		if controllerID == "" {
			controllerID = strings.TrimSpace(instance.OwnerID)
		}
		return controllerID != "" && controllerID == actorID
	}
	ownerID := strings.TrimSpace(instance.OwnerID)
	if ownerID == "" {
		ownerID = strings.TrimSpace(location.PlayerID)
	}
	return ownerID != "" && ownerID == actorID
}

func commandAuthorizationError(command protocol.CommandEnvelopeV2, code string, instanceID string, index int) error {
	return &AuthorizationError{Code: code, CommandType: command.Type, InstanceID: instanceID, Index: index}
}

func optionalPayloadString(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return strings.TrimSpace(value)
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
	location, locationExists := a.state.GetLocation(instanceID)
	instance, instanceExists := a.state.Instances[instanceID]
	return locationExists && instanceExists && instanceAuthorityMatches(instance, location, actorID)
}

func eventCreatedByMatches(event protocol.EventPayloadV2, actorID string) bool {
	return strings.TrimSpace(event.CreatedBy) == "" || strings.TrimSpace(actorID) == "" || event.CreatedBy == actorID
}
