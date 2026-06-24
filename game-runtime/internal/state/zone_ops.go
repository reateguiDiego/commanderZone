package state

import "sort"

type ZoneInsertPosition string

const (
	ZoneInsertAppend ZoneInsertPosition = "append"
	ZoneInsertTop    ZoneInsertPosition = "top"
	ZoneInsertBottom ZoneInsertPosition = "bottom"
)

type ZoneMove struct {
	InstanceID string
	From       Location
	To         Location
}

type ZoneOps struct {
	fullScanCount int
	reindexCount  int
}

func NewZoneOps() *ZoneOps {
	return &ZoneOps{}
}

func (ops *ZoneOps) FullScanCount() int {
	if ops == nil {
		return 0
	}
	return ops.fullScanCount
}

func (ops *ZoneOps) ReindexCount() int {
	if ops == nil {
		return 0
	}
	return ops.reindexCount
}

func (ops *ZoneOps) MoveOne(game *GameState, instanceID string, toPlayerID string, toZone Zone, position ZoneInsertPosition) (ZoneMove, error) {
	moves, err := ops.MoveMany(game, []string{instanceID}, toPlayerID, toZone, position)
	if err != nil {
		return ZoneMove{}, err
	}
	return moves[0], nil
}

func (ops *ZoneOps) AddMany(game *GameState, playerID string, zone Zone, instanceIDs []string, position ZoneInsertPosition) (int, error) {
	if len(instanceIDs) == 0 {
		return 0, nil
	}
	seen := make(map[string]struct{}, len(instanceIDs))
	for _, instanceID := range instanceIDs {
		if _, duplicate := seen[instanceID]; duplicate {
			return 0, ErrInvalidReorderSet
		}
		seen[instanceID] = struct{}{}
		if _, exists := game.Loc[instanceID]; exists {
			return 0, ErrInvalidReorderSet
		}
		if _, exists := game.Instances[instanceID]; !exists {
			return 0, ErrMissingInstance
		}
	}
	insertStart, err := ops.insertMany(game, playerID, zone, instanceIDs, position)
	if err != nil {
		return 0, err
	}
	for offset, instanceID := range instanceIDs {
		instance := game.Instances[instanceID]
		instance.Zone = zone
		if zone == ZoneBattlefield || zone == ZoneHand {
			instance.ControllerID = playerID
		}
		game.Instances[instanceID] = instance
		game.Loc[instanceID] = Location{PlayerID: playerID, Zone: zone, Index: insertStart + offset, ControllerID: instance.ControllerID}
	}
	return insertStart, nil
}

func (ops *ZoneOps) MoveMany(game *GameState, instanceIDs []string, toPlayerID string, toZone Zone, position ZoneInsertPosition) ([]ZoneMove, error) {
	if len(instanceIDs) == 0 {
		return []ZoneMove{}, nil
	}
	if _, ok := game.Zones[toPlayerID]; !ok {
		game.Zones[toPlayerID] = PlayerZones{}
	}
	fromLocations := make(map[string]Location, len(instanceIDs))
	seen := make(map[string]struct{}, len(instanceIDs))
	for _, instanceID := range instanceIDs {
		if _, duplicate := seen[instanceID]; duplicate {
			return nil, ErrInvalidReorderSet
		}
		seen[instanceID] = struct{}{}
		location, ok := game.GetLocation(instanceID)
		if !ok {
			return nil, ErrMissingInstance
		}
		if _, ok := game.Instances[instanceID]; !ok {
			return nil, ErrMissingInstance
		}
		fromLocations[instanceID] = location
	}

	for _, group := range removalGroups(instanceIDs, fromLocations) {
		if err := ops.removeGroup(game, group.playerID, group.zone, group.ids); err != nil {
			return nil, err
		}
	}

	insertStart, err := ops.insertMany(game, toPlayerID, toZone, instanceIDs, position)
	if err != nil {
		return nil, err
	}

	moves := make([]ZoneMove, 0, len(instanceIDs))
	for offset, instanceID := range instanceIDs {
		instance := game.Instances[instanceID]
		instance.Zone = toZone
		if toZone == ZoneBattlefield || toZone == ZoneHand {
			instance.ControllerID = toPlayerID
		}
		game.Instances[instanceID] = instance
		to := Location{PlayerID: toPlayerID, Zone: toZone, Index: insertStart + offset, ControllerID: instance.ControllerID}
		game.Loc[instanceID] = to
		moves = append(moves, ZoneMove{InstanceID: instanceID, From: fromLocations[instanceID], To: to})
	}

	return moves, nil
}

func (ops *ZoneOps) MoveAll(game *GameState, playerID string, fromZone Zone, toPlayerID string, toZone Zone, position ZoneInsertPosition) ([]ZoneMove, error) {
	ids := append([]string(nil), zoneIDs(game.Zones[playerID], fromZone)...)
	return ops.MoveMany(game, ids, toPlayerID, toZone, position)
}

func (ops *ZoneOps) ReorderByIDs(game *GameState, playerID string, zone Zone, orderedIDs []string) error {
	zones, ok := game.Zones[playerID]
	if !ok {
		return ErrMissingZone
	}
	currentIDs := zoneIDs(zones, zone)
	if !sameStringSet(currentIDs, orderedIDs) {
		return ErrInvalidReorderSet
	}
	nextIDs := append([]string(nil), orderedIDs...)
	game.Zones[playerID] = setZoneIDs(zones, zone, nextIDs)
	for index, instanceID := range nextIDs {
		instance, ok := game.Instances[instanceID]
		if !ok {
			return ErrMissingInstance
		}
		game.Loc[instanceID] = Location{PlayerID: playerID, Zone: zone, Index: index, ControllerID: instance.ControllerID}
	}
	return nil
}

type removeGroup struct {
	playerID string
	zone     Zone
	ids      []string
}

func removalGroups(instanceIDs []string, locations map[string]Location) []removeGroup {
	byKey := map[string]*removeGroup{}
	order := []string{}
	for _, instanceID := range instanceIDs {
		location := locations[instanceID]
		key := location.PlayerID + "\x00" + string(location.Zone)
		group, ok := byKey[key]
		if !ok {
			group = &removeGroup{playerID: location.PlayerID, zone: location.Zone}
			byKey[key] = group
			order = append(order, key)
		}
		group.ids = append(group.ids, instanceID)
	}
	groups := make([]removeGroup, 0, len(order))
	for _, key := range order {
		groups = append(groups, *byKey[key])
	}
	return groups
}

func (ops *ZoneOps) removeGroup(game *GameState, playerID string, zone Zone, instanceIDs []string) error {
	zones, ok := game.Zones[playerID]
	if !ok {
		return ErrMissingZone
	}
	ids := append([]string(nil), zoneIDs(zones, zone)...)
	indexes := make([]int, 0, len(instanceIDs))
	for _, instanceID := range instanceIDs {
		location, ok := game.GetLocation(instanceID)
		if !ok || location.PlayerID != playerID || location.Zone != zone {
			return ErrMissingInstance
		}
		if location.Index < 0 || location.Index >= len(ids) || ids[location.Index] != instanceID {
			return ErrMissingInstance
		}
		indexes = append(indexes, location.Index)
	}
	sort.Ints(indexes)
	for i := 1; i < len(indexes); i++ {
		if indexes[i] == indexes[i-1] {
			return ErrInvalidReorderSet
		}
	}

	removeAt := map[int]struct{}{}
	for _, index := range indexes {
		removeAt[index] = struct{}{}
	}
	next := make([]string, 0, len(ids)-len(indexes))
	for index, instanceID := range ids {
		if _, remove := removeAt[index]; remove {
			delete(game.Loc, instanceID)
			continue
		}
		nextIndex := len(next)
		next = append(next, instanceID)
		instance := game.Instances[instanceID]
		game.Loc[instanceID] = Location{PlayerID: playerID, Zone: zone, Index: nextIndex, ControllerID: instance.ControllerID}
	}
	game.Zones[playerID] = setZoneIDs(zones, zone, next)
	return nil
}

func (ops *ZoneOps) insertMany(game *GameState, playerID string, zone Zone, instanceIDs []string, position ZoneInsertPosition) (int, error) {
	zones, ok := game.Zones[playerID]
	if !ok {
		zones = PlayerZones{}
	}
	ids := append([]string(nil), zoneIDs(zones, zone)...)
	insertIndex := len(ids)
	switch position {
	case ZoneInsertTop:
		if zone == ZoneLibrary {
			insertIndex = len(ids)
		} else {
			insertIndex = len(ids)
		}
	case ZoneInsertBottom:
		if zone == ZoneLibrary {
			insertIndex = 0
		} else {
			insertIndex = 0
		}
	case ZoneInsertAppend, "":
		insertIndex = len(ids)
	default:
		insertIndex = len(ids)
	}
	next := make([]string, 0, len(ids)+len(instanceIDs))
	next = append(next, ids[:insertIndex]...)
	next = append(next, instanceIDs...)
	next = append(next, ids[insertIndex:]...)
	game.Zones[playerID] = setZoneIDs(zones, zone, next)
	for index, instanceID := range next {
		instance := game.Instances[instanceID]
		game.Loc[instanceID] = Location{PlayerID: playerID, Zone: zone, Index: index, ControllerID: instance.ControllerID}
	}
	return insertIndex, nil
}
