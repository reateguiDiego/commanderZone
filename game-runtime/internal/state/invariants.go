package state

import (
	"errors"
	"fmt"
)

var (
	ErrInvariantViolation = errors.New("game state invariant violation")
	ErrUnknownZone        = errors.New("unknown zone")
)

func RebuildLocIndexForRecoveryOnly(game *GameState) {
	if game.Loc == nil {
		game.Loc = map[string]Location{}
	}
	for instanceID := range game.Loc {
		delete(game.Loc, instanceID)
	}
	for playerID, zones := range game.Zones {
		rebuildZoneLoc(game, playerID, ZoneLibrary, zones.Library)
		rebuildZoneLoc(game, playerID, ZoneHand, zones.Hand)
		rebuildZoneLoc(game, playerID, ZoneBattlefield, zones.Battlefield)
		rebuildZoneLoc(game, playerID, ZoneGraveyard, zones.Graveyard)
		rebuildZoneLoc(game, playerID, ZoneExile, zones.Exile)
		rebuildZoneLoc(game, playerID, ZoneCommand, zones.Command)
	}
}

func ValidateInvariants(game GameState) error {
	if len(game.TurnOrder) > 0 {
		seenPlayers := map[string]bool{}
		for _, playerID := range game.TurnOrder {
			if _, ok := game.Players[playerID]; !ok || seenPlayers[playerID] {
				return fmt.Errorf("%w: invalid turn order player %s", ErrInvariantViolation, playerID)
			}
			seenPlayers[playerID] = true
		}
		if len(seenPlayers) != len(game.Players) {
			return fmt.Errorf("%w: turn order does not cover all players", ErrInvariantViolation)
		}
	}
	if game.WinnerPlayerID != "" {
		player, ok := game.Players[game.WinnerPlayerID]
		status, _ := player["status"].(string)
		if !ok || (status != "" && status != "active") {
			return fmt.Errorf("%w: winner is not active", ErrInvariantViolation)
		}
	}
	seen := map[string]Location{}
	for playerID, zones := range game.Zones {
		if err := validateZone(game, seen, playerID, ZoneLibrary, zones.Library); err != nil {
			return err
		}
		if err := validateZone(game, seen, playerID, ZoneHand, zones.Hand); err != nil {
			return err
		}
		if err := validateZone(game, seen, playerID, ZoneBattlefield, zones.Battlefield); err != nil {
			return err
		}
		if err := validateZone(game, seen, playerID, ZoneGraveyard, zones.Graveyard); err != nil {
			return err
		}
		if err := validateZone(game, seen, playerID, ZoneExile, zones.Exile); err != nil {
			return err
		}
		if err := validateZone(game, seen, playerID, ZoneCommand, zones.Command); err != nil {
			return err
		}
	}
	for instanceID, instance := range game.Instances {
		if instance.ControllerID != "" {
			if _, ok := game.Players[instance.ControllerID]; !ok {
				return fmt.Errorf("%w: controller %s for %s", ErrInvariantViolation, instance.ControllerID, instanceID)
			}
		}
		if _, ok := seen[instanceID]; !ok {
			return fmt.Errorf("%w: instance %s missing from zones", ErrInvariantViolation, instanceID)
		}
		location, ok := game.Loc[instanceID]
		if !ok {
			return fmt.Errorf("%w: missing loc for %s", ErrInvariantViolation, instanceID)
		}
		if location != seen[instanceID] {
			return fmt.Errorf("%w: loc mismatch for %s", ErrInvariantViolation, instanceID)
		}
	}
	if len(game.Loc) != len(seen) {
		return fmt.Errorf("%w: loc index contains stale entries", ErrInvariantViolation)
	}
	attachmentBySource := map[string]Relation{}
	for relationID, relation := range game.Relations.Attachments {
		if relation.ID == "" || relation.ID != relationID || relation.SourceID == "" || relation.TargetID == "" || relation.SourceID == relation.TargetID {
			return fmt.Errorf("%w: invalid attachment %s", ErrInvariantViolation, relationID)
		}
		for _, instanceID := range []string{relation.SourceID, relation.TargetID} {
			if location, ok := game.Loc[instanceID]; !ok || location.Zone != ZoneBattlefield {
				return fmt.Errorf("%w: attachment %s references non-battlefield instance %s", ErrInvariantViolation, relationID, instanceID)
			}
		}
		if _, duplicate := attachmentBySource[relation.SourceID]; duplicate {
			return fmt.Errorf("%w: attachment source %s has multiple targets", ErrInvariantViolation, relation.SourceID)
		}
		attachmentBySource[relation.SourceID] = relation
	}
	for sourceID, relation := range attachmentBySource {
		visited := map[string]bool{sourceID: true}
		cursor := relation.TargetID
		for cursor != "" {
			if visited[cursor] {
				return fmt.Errorf("%w: attachment cycle through %s", ErrInvariantViolation, cursor)
			}
			visited[cursor] = true
			next, ok := attachmentBySource[cursor]
			if !ok {
				break
			}
			cursor = next.TargetID
		}
	}
	stackMemberships := map[string]string{}
	for stackID, stack := range game.Relations.BattlefieldStacks {
		if stack.ID == "" || stack.ID != stackID || len(stack.OrderedMemberIDs) < 2 {
			return fmt.Errorf("%w: invalid battlefield stack %s", ErrInvariantViolation, stackID)
		}
		rootFound := false
		localSeen := map[string]bool{}
		for _, instanceID := range stack.OrderedMemberIDs {
			if localSeen[instanceID] {
				return fmt.Errorf("%w: duplicate battlefield stack member %s", ErrInvariantViolation, instanceID)
			}
			localSeen[instanceID] = true
			rootFound = rootFound || instanceID == stack.RootInstanceID
			if location, ok := game.Loc[instanceID]; !ok || location.Zone != ZoneBattlefield {
				return fmt.Errorf("%w: battlefield stack %s references non-battlefield member %s", ErrInvariantViolation, stackID, instanceID)
			}
			if instanceHasAttachment(game.Relations.Attachments, instanceID) {
				return fmt.Errorf("%w: battlefield stack member %s also belongs to an attachment", ErrInvariantViolation, instanceID)
			}
			if previous, duplicate := stackMemberships[instanceID]; duplicate {
				return fmt.Errorf("%w: member %s belongs to stacks %s and %s", ErrInvariantViolation, instanceID, previous, stackID)
			}
			stackMemberships[instanceID] = stackID
		}
		if !rootFound {
			return fmt.Errorf("%w: root missing from battlefield stack %s", ErrInvariantViolation, stackID)
		}
	}
	if err := ValidateTokenGroupState(game); err != nil {
		return fmt.Errorf("%w: %w", ErrInvariantViolation, err)
	}
	return nil
}

func rebuildZoneLoc(game *GameState, playerID string, zone Zone, instanceIDs []string) {
	for index, instanceID := range instanceIDs {
		instance := game.Instances[instanceID]
		game.Loc[instanceID] = Location{
			PlayerID:     playerID,
			Zone:         zone,
			Index:        index,
			ControllerID: instance.ControllerID,
		}
		instance.Zone = zone
		game.Instances[instanceID] = instance
	}
}

func validateZone(game GameState, seen map[string]Location, playerID string, zone Zone, instanceIDs []string) error {
	for index, instanceID := range instanceIDs {
		if _, duplicate := seen[instanceID]; duplicate {
			return fmt.Errorf("%w: duplicate instance %s", ErrInvariantViolation, instanceID)
		}
		instance, ok := game.Instances[instanceID]
		if !ok {
			return fmt.Errorf("%w: zone references missing instance %s", ErrInvariantViolation, instanceID)
		}
		seen[instanceID] = Location{
			PlayerID:     playerID,
			Zone:         zone,
			Index:        index,
			ControllerID: instance.ControllerID,
		}
	}
	return nil
}
