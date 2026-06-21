package state

import (
	"errors"
	"math/rand"
	"time"
)

var (
	ErrEmptyLibrary       = errors.New("library is empty")
	ErrInvalidWindow     = errors.New("invalid library window")
	ErrInvalidReorderSet = errors.New("ordered top ids do not match current top window")
	ErrMissingZone       = errors.New("missing player zone")
	ErrMissingInstance   = errors.New("missing instance")
)

type LibraryOps struct {
	rand *rand.Rand
}

func NewLibraryOps() *LibraryOps {
	return &LibraryOps{rand: rand.New(rand.NewSource(time.Now().UnixNano()))}
}

func NewLibraryOpsWithRand(random *rand.Rand) *LibraryOps {
	if random == nil {
		return NewLibraryOps()
	}
	return &LibraryOps{rand: random}
}

func (ops *LibraryOps) DrawOne(game *GameState, playerID string) (string, error) {
	drawn, err := ops.DrawMany(game, playerID, 1)
	if err != nil {
		return "", err
	}
	return drawn[0], nil
}

func (ops *LibraryOps) DrawMany(game *GameState, playerID string, count int) ([]string, error) {
	if count <= 0 {
		return []string{}, nil
	}
	zones, ok := game.Zones[playerID]
	if !ok {
		return nil, ErrMissingZone
	}
	if len(zones.Library) < count {
		return nil, ErrEmptyLibrary
	}
	start := len(zones.Library) - count
	drawn := append([]string(nil), zones.Library[start:]...)
	reverseStrings(drawn)
	zones.Library = zones.Library[:start]
	zones.Hand = append(zones.Hand, drawn...)
	game.Zones[playerID] = zones

	for index, instanceID := range drawn {
		instance := game.Instances[instanceID]
		instance.Zone = ZoneHand
		game.Instances[instanceID] = instance
		game.Loc[instanceID] = Location{PlayerID: playerID, Zone: ZoneHand, Index: len(zones.Hand) - len(drawn) + index, ControllerID: instance.ControllerID}
	}
	reindexZone(game, playerID, ZoneLibrary)
	return drawn, nil
}

func (ops *LibraryOps) PutOnTop(game *GameState, playerID string, instanceID string) error {
	return insertIntoZone(game, playerID, ZoneLibrary, instanceID, -1)
}

func (ops *LibraryOps) PutOnBottom(game *GameState, playerID string, instanceID string) error {
	return insertIntoZone(game, playerID, ZoneLibrary, instanceID, 0)
}

func (ops *LibraryOps) PeekTop(game *GameState, playerID string, count int) ([]string, error) {
	if count <= 0 {
		return []string{}, nil
	}
	zones, ok := game.Zones[playerID]
	if !ok {
		return nil, ErrMissingZone
	}
	if len(zones.Library) < count {
		return nil, ErrInvalidWindow
	}
	start := len(zones.Library) - count
	top := append([]string(nil), zones.Library[start:]...)
	reverseStrings(top)
	return top, nil
}

func (ops *LibraryOps) MoveTop(game *GameState, playerID string, count int, destination Zone) ([]string, error) {
	if count <= 0 {
		return []string{}, nil
	}
	zones, ok := game.Zones[playerID]
	if !ok {
		return nil, ErrMissingZone
	}
	if len(zones.Library) < count {
		return nil, ErrInvalidWindow
	}
	start := len(zones.Library) - count
	moved := append([]string(nil), zones.Library[start:]...)
	zones.Library = zones.Library[:start]
	reverseStrings(moved)
	zones = appendToZone(zones, destination, moved...)
	game.Zones[playerID] = zones
	for _, instanceID := range moved {
		instance := game.Instances[instanceID]
		instance.Zone = destination
		game.Instances[instanceID] = instance
	}
	reindexAllZones(game, playerID)
	return moved, nil
}

func (ops *LibraryOps) ReorderTop(game *GameState, playerID string, orderedTopIDs []string) error {
	if len(orderedTopIDs) == 0 {
		return nil
	}
	zones, ok := game.Zones[playerID]
	if !ok {
		return ErrMissingZone
	}
	count := len(orderedTopIDs)
	if len(zones.Library) < count {
		return ErrInvalidWindow
	}
	currentTop, err := ops.PeekTop(game, playerID, count)
	if err != nil {
		return err
	}
	if !sameStringSet(currentTop, orderedTopIDs) {
		return ErrInvalidReorderSet
	}
	tailOrder := append([]string(nil), orderedTopIDs...)
	reverseStrings(tailOrder)
	copy(zones.Library[len(zones.Library)-count:], tailOrder)
	game.Zones[playerID] = zones
	reindexZone(game, playerID, ZoneLibrary)
	return nil
}

func (ops *LibraryOps) Shuffle(game *GameState, playerID string) error {
	zones, ok := game.Zones[playerID]
	if !ok {
		return ErrMissingZone
	}
	ops.rand.Shuffle(len(zones.Library), func(i, j int) {
		zones.Library[i], zones.Library[j] = zones.Library[j], zones.Library[i]
	})
	game.Zones[playerID] = zones
	game.EnsureVisibility()
	game.Visibility.LibraryEpochByOwner[playerID]++
	delete(game.Visibility.TopRevealWindows, playerID)
	reindexZone(game, playerID, ZoneLibrary)
	return nil
}

func (s *GameState) EnsureVisibility() {
	if s.Visibility.InstanceMasks == nil {
		s.Visibility.InstanceMasks = map[string]uint64{}
	}
	if s.Visibility.LibraryEpochByOwner == nil {
		s.Visibility.LibraryEpochByOwner = map[string]int64{}
	}
	if s.Visibility.TopRevealWindows == nil {
		s.Visibility.TopRevealWindows = map[string]TopRevealWindow{}
	}
}

func (s *GameState) RevealTopWindow(ownerID string, count int, viewers []string, mask uint64) TopRevealWindow {
	s.EnsureVisibility()
	epoch := s.Visibility.LibraryEpochByOwner[ownerID]
	window := TopRevealWindow{OwnerID: ownerID, Count: count, Epoch: epoch, To: append([]string(nil), viewers...), Mask: mask}
	s.Visibility.TopRevealWindows[ownerID] = window
	return window
}

func (s *GameState) CanViewerSeeCardKey(viewerID string, instanceID string) bool {
	instance, ok := s.Instances[instanceID]
	if !ok {
		return false
	}
	if instance.FaceDown {
		return false
	}
	location, ok := s.Loc[instanceID]
	if !ok {
		return false
	}
	if location.Zone == ZoneHand && location.PlayerID == viewerID {
		return true
	}
	if location.Zone == ZoneLibrary && location.PlayerID == viewerID {
		return true
	}
	if location.Zone != ZoneHand && location.Zone != ZoneLibrary {
		return true
	}
	mask := s.Visibility.InstanceMasks[instanceID] | instance.VisibleToMask
	return mask != 0
}

func RemoveFromCurrentZone(game *GameState, instanceID string) (Location, error) {
	location, ok := game.GetLocation(instanceID)
	if !ok {
		return Location{}, ErrMissingInstance
	}
	zones := game.Zones[location.PlayerID]
	ids := zoneIDs(zones, location.Zone)
	if location.Index < 0 || location.Index >= len(ids) || ids[location.Index] != instanceID {
		for index, candidate := range ids {
			if candidate == instanceID {
				location.Index = index
				break
			}
		}
	}
	ids = append(ids[:location.Index], ids[location.Index+1:]...)
	zones = setZoneIDs(zones, location.Zone, ids)
	game.Zones[location.PlayerID] = zones
	delete(game.Loc, instanceID)
	reindexZone(game, location.PlayerID, location.Zone)
	return location, nil
}

func InsertIntoZone(game *GameState, playerID string, zone Zone, instanceID string, index int) error {
	return insertIntoZone(game, playerID, zone, instanceID, index)
}

func MoveInstance(game *GameState, instanceID string, toPlayerID string, toZone Zone, index int) (Location, error) {
	from, err := RemoveFromCurrentZone(game, instanceID)
	if err != nil {
		return Location{}, err
	}
	if err := insertIntoZone(game, toPlayerID, toZone, instanceID, index); err != nil {
		_ = insertIntoZone(game, from.PlayerID, from.Zone, instanceID, from.Index)
		return Location{}, err
	}
	instance := game.Instances[instanceID]
	instance.Zone = toZone
	if toZone == ZoneBattlefield && instance.ControllerID == "" {
		instance.ControllerID = toPlayerID
	}
	game.Instances[instanceID] = instance
	return from, nil
}

func ZoneCount(game *GameState, playerID string, zone Zone) int {
	return len(zoneIDs(game.Zones[playerID], zone))
}

func reindexAllZones(game *GameState, playerID string) {
	for _, zone := range []Zone{ZoneLibrary, ZoneHand, ZoneBattlefield, ZoneGraveyard, ZoneExile, ZoneCommand} {
		reindexZone(game, playerID, zone)
	}
}

func ReindexZone(game *GameState, playerID string, zone Zone) {
	reindexZone(game, playerID, zone)
}

func reindexZone(game *GameState, playerID string, zone Zone) {
	zones := game.Zones[playerID]
	for index, instanceID := range zoneIDs(zones, zone) {
		instance := game.Instances[instanceID]
		game.Loc[instanceID] = Location{PlayerID: playerID, Zone: zone, Index: index, ControllerID: instance.ControllerID}
	}
}

func insertIntoZone(game *GameState, playerID string, zone Zone, instanceID string, index int) error {
	zones, ok := game.Zones[playerID]
	if !ok {
		zones = PlayerZones{}
	}
	ids := zoneIDs(zones, zone)
	if index < 0 || index > len(ids) {
		index = len(ids)
	}
	ids = append(ids, "")
	copy(ids[index+1:], ids[index:])
	ids[index] = instanceID
	zones = setZoneIDs(zones, zone, ids)
	game.Zones[playerID] = zones
	instance := game.Instances[instanceID]
	instance.Zone = zone
	game.Instances[instanceID] = instance
	reindexZone(game, playerID, zone)
	return nil
}

func appendToZone(zones PlayerZones, zone Zone, instanceIDs ...string) PlayerZones {
	switch zone {
	case ZoneLibrary:
		zones.Library = append(zones.Library, instanceIDs...)
	case ZoneHand:
		zones.Hand = append(zones.Hand, instanceIDs...)
	case ZoneBattlefield:
		zones.Battlefield = append(zones.Battlefield, instanceIDs...)
	case ZoneGraveyard:
		zones.Graveyard = append(zones.Graveyard, instanceIDs...)
	case ZoneExile:
		zones.Exile = append(zones.Exile, instanceIDs...)
	case ZoneCommand:
		zones.Command = append(zones.Command, instanceIDs...)
	}
	return zones
}

func zoneIDs(zones PlayerZones, zone Zone) []string {
	switch zone {
	case ZoneLibrary:
		return zones.Library
	case ZoneHand:
		return zones.Hand
	case ZoneBattlefield:
		return zones.Battlefield
	case ZoneGraveyard:
		return zones.Graveyard
	case ZoneExile:
		return zones.Exile
	case ZoneCommand:
		return zones.Command
	default:
		return nil
	}
}

func setZoneIDs(zones PlayerZones, zone Zone, ids []string) PlayerZones {
	switch zone {
	case ZoneLibrary:
		zones.Library = ids
	case ZoneHand:
		zones.Hand = ids
	case ZoneBattlefield:
		zones.Battlefield = ids
	case ZoneGraveyard:
		zones.Graveyard = ids
	case ZoneExile:
		zones.Exile = ids
	case ZoneCommand:
		zones.Command = ids
	}
	return zones
}

func reverseStrings(values []string) {
	for left, right := 0, len(values)-1; left < right; left, right = left+1, right-1 {
		values[left], values[right] = values[right], values[left]
	}
}

func sameStringSet(a []string, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	counts := map[string]int{}
	for _, value := range a {
		counts[value]++
	}
	for _, value := range b {
		counts[value]--
	}
	for _, count := range counts {
		if count != 0 {
			return false
		}
	}
	return true
}
