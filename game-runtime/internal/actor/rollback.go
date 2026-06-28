package actor

import (
	"strings"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

type playerMapBackup struct {
	Value  map[string]any
	Exists bool
}

type sharedCounterBackup struct {
	Value  map[string]int
	Exists bool
}

type instanceBackup struct {
	Value  state.CardInstanceRuntime
	Exists bool
}

type zoneBackup struct {
	Value  state.PlayerZones
	Exists bool
}

type locationBackup struct {
	Value  state.Location
	Exists bool
}

type commandRollback struct {
	version int64
	status  string
	phase   state.GamePhase

	full *state.GameState

	players        map[string]playerMapBackup
	sharedCounters map[string]sharedCounterBackup
	instances      map[string]instanceBackup
	zones          map[string]zoneBackup
	loc            map[string]locationBackup

	turnCaptured       bool
	turn               map[string]any
	visibilityCaptured bool
	visibility         state.VisibilityIndex
	relationsCaptured  bool
	relations          state.Relations
	stackCaptured      bool
	stack              []state.StackItem
	mulliganCaptured   bool
	mulligan           state.MulliganState
}

func newCommandRollback(game *state.GameState, command protocol.CommandEnvelopeV2) *commandRollback {
	rollback := &commandRollback{
		version:        game.Version,
		status:         game.Status,
		phase:          game.Phase,
		players:        map[string]playerMapBackup{},
		sharedCounters: map[string]sharedCounterBackup{},
		instances:      map[string]instanceBackup{},
		zones:          map[string]zoneBackup{},
		loc:            map[string]locationBackup{},
	}

	switch command.Type {
	case "life.changed":
		rollback.capturePlayer(game, stringPayload(command.Payload, "playerId"))
	case "turn.changed":
		rollback.captureTurn(game)
	case "dice.rolled":
	case "card.tapped", "card.counter.changed", "card.power_toughness.changed", "card.position.changed":
		rollback.captureInstanceWithLocation(game, stringPayload(command.Payload, "instanceId"))
	case "card.face_down.changed", "card.revealed":
		rollback.captureInstanceWithLocation(game, stringPayload(command.Payload, "instanceId"))
		rollback.captureVisibility(game)
	case "card.controller.changed":
		rollback.captureInstanceWithLocation(game, stringPayload(command.Payload, "instanceId"))
	case "cards.position.changed":
		for _, instanceID := range positionInstanceIDs(command.Payload) {
			rollback.captureInstanceWithLocation(game, instanceID)
		}
	case "battlefield.untap_all":
		rollback.capturePlayerZoneInstances(game, stringPayload(command.Payload, "playerId"), state.ZoneBattlefield)
	case "counter.changed":
		scope := stringPayload(command.Payload, "scope")
		if strings.HasPrefix(scope, "player:") {
			rollback.capturePlayer(game, strings.TrimPrefix(scope, "player:"))
		} else {
			rollback.captureSharedCounter(game, scope)
		}
	case "commander.damage.changed":
		rollback.capturePlayer(game, stringPayload(command.Payload, "targetPlayerId"))
	case "library.draw", "library.draw_many", "library.shuffle", "library.reveal_top", "library.reorder_top", "library.move_top", "library.view":
		playerID := stringPayload(command.Payload, "playerId")
		rollback.capturePlayerZonesAndCards(game, playerID)
		if target := targetPlayerID(command.Payload, playerID); target != "" && target != playerID {
			rollback.capturePlayerZonesAndCards(game, target)
		}
		rollback.captureVisibility(game)
	case "library.reveal", "library.play_top_revealed":
		playerID := stringPayload(command.Payload, "playerId")
		rollback.capturePlayer(game, playerID)
		rollback.capturePlayerZonesAndCards(game, playerID)
		rollback.captureVisibility(game)
	case "library.put_top", "library.put_bottom":
		playerID := stringPayload(command.Payload, "playerId")
		instanceID := stringPayload(command.Payload, "instanceId")
		rollback.capturePlayerZonesAndCards(game, playerID)
		if location, ok := game.GetLocation(instanceID); ok && location.PlayerID != playerID {
			rollback.capturePlayerZonesAndCards(game, location.PlayerID)
		}
		rollback.captureInstanceWithLocation(game, instanceID)
		rollback.captureVisibility(game)
	case "card.token.created":
		rollback.capturePlayerZonesAndCards(game, stringPayload(command.Payload, "playerId"))
	case "card.token_copy.created":
		instanceID := stringPayload(command.Payload, "instanceId")
		if location, ok := game.GetLocation(instanceID); ok {
			rollback.capturePlayerZonesAndCards(game, location.PlayerID)
			targetID := targetPlayerID(command.Payload, location.PlayerID)
			if targetID != "" && targetID != location.PlayerID {
				rollback.capturePlayerZonesAndCards(game, targetID)
			}
		}
		rollback.captureInstanceWithLocation(game, instanceID)
	case "zone.random_card.selected":
	case "card.dungeon_marker.changed", "card.face.changed":
		rollback.captureInstanceWithLocation(game, stringPayload(command.Payload, "instanceId"))
	case "card.moved", "cards.moved":
		rollback.captureMovement(game, command.Payload)
	case "zone.move_all":
		playerID := stringPayload(command.Payload, "playerId")
		targetID := targetPlayerID(command.Payload, playerID)
		rollback.capturePlayerZonesAndCards(game, playerID)
		if targetID != "" && targetID != playerID {
			rollback.capturePlayerZonesAndCards(game, targetID)
		}
		rollback.captureRelations(game)
	case "zone.reorderedByIds":
		playerID := stringPayload(command.Payload, "playerId")
		zone := state.Zone(stringPayload(command.Payload, "zone"))
		rollback.capturePlayerZoneInstances(game, playerID, zone)
	case "stack.card_added", "stack.item_removed":
		rollback.captureStack(game)
	case "arrow.created", "arrow.removed", "attachment.created", "attachment.removed", "helper.created", "helper.updated", "helper.removed":
		rollback.captureRelations(game)
	case "game.concede":
		playerID := stringPayload(command.Payload, "playerId")
		rollback.capturePlayer(game, playerID)
		rollback.captureTurn(game)
	case "game.close":
	case "mulligan.take", "mulligan.keep", "mulligan.cards_bottomed", "mulligan.scry.confirm", "mulligan.ready", "mulligan.completed", "game.phase.set":
		rollback.captureMulligan(game)
		rollback.captureVisibility(game)
		if playerID := stringPayload(command.Payload, "playerId"); playerID != "" {
			rollback.capturePlayerZonesAndCards(game, playerID)
		}
	default:
		full := game.Clone()
		rollback.full = &full
	}

	return rollback
}

func (r *commandRollback) Restore(game *state.GameState) {
	if r == nil || game == nil {
		return
	}
	if r.full != nil {
		*game = *r.full
		return
	}

	game.Version = r.version
	game.Status = r.status
	game.Phase = r.phase

	for playerID, backup := range r.players {
		if !backup.Exists {
			delete(game.Players, playerID)
			continue
		}
		if game.Players == nil {
			game.Players = map[string]map[string]any{}
		}
		game.Players[playerID] = rollbackCloneAnyMap(backup.Value)
	}
	for scope, backup := range r.sharedCounters {
		if !backup.Exists {
			delete(game.SharedCounters, scope)
			continue
		}
		if game.SharedCounters == nil {
			game.SharedCounters = map[string]map[string]int{}
		}
		game.SharedCounters[scope] = rollbackCloneIntMap(backup.Value)
	}
	for instanceID, backup := range r.instances {
		if !backup.Exists {
			delete(game.Instances, instanceID)
			continue
		}
		if game.Instances == nil {
			game.Instances = map[string]state.CardInstanceRuntime{}
		}
		game.Instances[instanceID] = backup.Value.Clone()
	}
	for playerID, backup := range r.zones {
		if !backup.Exists {
			delete(game.Zones, playerID)
			continue
		}
		if game.Zones == nil {
			game.Zones = map[string]state.PlayerZones{}
		}
		game.Zones[playerID] = backup.Value.Clone()
	}
	for instanceID, backup := range r.loc {
		if !backup.Exists {
			delete(game.Loc, instanceID)
			continue
		}
		if game.Loc == nil {
			game.Loc = map[string]state.Location{}
		}
		game.Loc[instanceID] = backup.Value
	}
	if r.turnCaptured {
		game.Turn = rollbackCloneAnyMap(r.turn)
	}
	if r.visibilityCaptured {
		game.Visibility = r.visibility.Clone()
	}
	if r.relationsCaptured {
		game.Relations = r.relations.Clone()
	}
	if r.stackCaptured {
		game.Stack = cloneStackItems(r.stack)
	}
	if r.mulliganCaptured {
		game.Mulligan = r.mulligan.Clone()
	}
}

func (r *commandRollback) capturePlayer(game *state.GameState, playerID string) {
	if playerID == "" {
		return
	}
	if _, captured := r.players[playerID]; captured {
		return
	}
	value, exists := game.Players[playerID]
	r.players[playerID] = playerMapBackup{Value: rollbackCloneAnyMap(value), Exists: exists}
}

func (r *commandRollback) captureSharedCounter(game *state.GameState, scope string) {
	if scope == "" {
		return
	}
	if _, captured := r.sharedCounters[scope]; captured {
		return
	}
	value, exists := game.SharedCounters[scope]
	r.sharedCounters[scope] = sharedCounterBackup{Value: rollbackCloneIntMap(value), Exists: exists}
}

func (r *commandRollback) captureTurn(game *state.GameState) {
	if r.turnCaptured {
		return
	}
	r.turnCaptured = true
	r.turn = rollbackCloneAnyMap(game.Turn)
}

func (r *commandRollback) captureInstanceWithLocation(game *state.GameState, instanceID string) {
	if instanceID == "" {
		return
	}
	if _, captured := r.instances[instanceID]; !captured {
		value, exists := game.Instances[instanceID]
		r.instances[instanceID] = instanceBackup{Value: value.Clone(), Exists: exists}
	}
	if _, captured := r.loc[instanceID]; !captured {
		value, exists := game.Loc[instanceID]
		r.loc[instanceID] = locationBackup{Value: value, Exists: exists}
	}
}

func (r *commandRollback) captureZone(game *state.GameState, playerID string) {
	if playerID == "" {
		return
	}
	if _, captured := r.zones[playerID]; captured {
		return
	}
	value, exists := game.Zones[playerID]
	r.zones[playerID] = zoneBackup{Value: value.Clone(), Exists: exists}
}

func (r *commandRollback) capturePlayerZonesAndCards(game *state.GameState, playerID string) {
	if playerID == "" {
		return
	}
	r.captureZone(game, playerID)
	zones, ok := game.Zones[playerID]
	if !ok {
		return
	}
	for _, instanceID := range allZoneInstanceIDs(zones) {
		r.captureInstanceWithLocation(game, instanceID)
	}
}

func (r *commandRollback) capturePlayerZoneInstances(game *state.GameState, playerID string, zone state.Zone) {
	if playerID == "" {
		return
	}
	r.captureZone(game, playerID)
	zones, ok := game.Zones[playerID]
	if !ok {
		return
	}
	for _, instanceID := range zoneInstanceIDs(zones, zone) {
		r.captureInstanceWithLocation(game, instanceID)
	}
}

func (r *commandRollback) captureVisibility(game *state.GameState) {
	if r.visibilityCaptured {
		return
	}
	r.visibilityCaptured = true
	r.visibility = game.Visibility.Clone()
}

func (r *commandRollback) captureRelations(game *state.GameState) {
	if r.relationsCaptured {
		return
	}
	r.relationsCaptured = true
	r.relations = game.Relations.Clone()
}

func (r *commandRollback) captureStack(game *state.GameState) {
	if r.stackCaptured {
		return
	}
	r.stackCaptured = true
	r.stack = cloneStackItems(game.Stack)
}

func (r *commandRollback) captureMulligan(game *state.GameState) {
	if r.mulliganCaptured {
		return
	}
	r.mulliganCaptured = true
	r.mulligan = game.Mulligan.Clone()
}

func (r *commandRollback) captureMovement(game *state.GameState, payload map[string]any) {
	playerID := stringPayload(payload, "playerId")
	targetID := targetPlayerID(payload, playerID)
	if playerID != "" {
		r.capturePlayerZonesAndCards(game, playerID)
	}
	if targetID != "" && targetID != playerID {
		r.capturePlayerZonesAndCards(game, targetID)
	}
	for _, instanceID := range instanceIDsFromPayload(payload) {
		if location, ok := game.GetLocation(instanceID); ok {
			r.capturePlayerZonesAndCards(game, location.PlayerID)
		}
		r.captureInstanceWithLocation(game, instanceID)
	}
	r.captureRelations(game)
}

func stringPayload(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return value
}

func instanceIDsFromPayload(payload map[string]any) []string {
	if instanceID := stringPayload(payload, "instanceId"); instanceID != "" {
		return []string{instanceID}
	}
	raw, ok := payload["instanceIds"]
	if !ok {
		return nil
	}
	switch typed := raw.(type) {
	case []string:
		return append([]string(nil), typed...)
	case []any:
		out := make([]string, 0, len(typed))
		for _, value := range typed {
			if instanceID, ok := value.(string); ok && instanceID != "" {
				out = append(out, instanceID)
			}
		}
		return out
	default:
		return nil
	}
}

func positionInstanceIDs(payload map[string]any) []string {
	raw, ok := payload["positions"]
	if !ok {
		return nil
	}
	out := []string{}
	switch typed := raw.(type) {
	case []map[string]any:
		for _, entry := range typed {
			if instanceID := stringPayload(entry, "instanceId"); instanceID != "" {
				out = append(out, instanceID)
			}
		}
	case []any:
		for _, rawEntry := range typed {
			entry, ok := rawEntry.(map[string]any)
			if !ok {
				continue
			}
			if instanceID := stringPayload(entry, "instanceId"); instanceID != "" {
				out = append(out, instanceID)
			}
		}
	}
	return out
}

func zoneInstanceIDs(zones state.PlayerZones, zone state.Zone) []string {
	switch zone {
	case state.ZoneLibrary:
		return zones.Library
	case state.ZoneHand:
		return zones.Hand
	case state.ZoneBattlefield:
		return zones.Battlefield
	case state.ZoneGraveyard:
		return zones.Graveyard
	case state.ZoneExile:
		return zones.Exile
	case state.ZoneCommand:
		return zones.Command
	default:
		return nil
	}
}

func allZoneInstanceIDs(zones state.PlayerZones) []string {
	total := len(zones.Library) + len(zones.Hand) + len(zones.Battlefield) + len(zones.Graveyard) + len(zones.Exile) + len(zones.Command)
	out := make([]string, 0, total)
	out = append(out, zones.Library...)
	out = append(out, zones.Hand...)
	out = append(out, zones.Battlefield...)
	out = append(out, zones.Graveyard...)
	out = append(out, zones.Exile...)
	out = append(out, zones.Command...)
	return out
}

func cloneStackItems(items []state.StackItem) []state.StackItem {
	if items == nil {
		return nil
	}
	out := make([]state.StackItem, len(items))
	for index, item := range items {
		item.Meta = rollbackCloneAnyMap(item.Meta)
		out[index] = item
	}
	return out
}

func rollbackCloneAnyMap(values map[string]any) map[string]any {
	if values == nil {
		return nil
	}
	clone := make(map[string]any, len(values))
	for key, value := range values {
		clone[key] = rollbackCloneAnyValue(value)
	}
	return clone
}

func rollbackCloneAnyValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return rollbackCloneAnyMap(typed)
	case map[string]int:
		return rollbackCloneIntMap(typed)
	case []string:
		return append([]string(nil), typed...)
	case []any:
		out := make([]any, len(typed))
		for index, value := range typed {
			out[index] = rollbackCloneAnyValue(value)
		}
		return out
	default:
		return typed
	}
}

func rollbackCloneIntMap(values map[string]int) map[string]int {
	if values == nil {
		return nil
	}
	clone := make(map[string]int, len(values))
	for key, value := range values {
		clone[key] = value
	}
	return clone
}
