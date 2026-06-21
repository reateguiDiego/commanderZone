package state

type Zone string

const (
	ZoneLibrary     Zone = "library"
	ZoneHand        Zone = "hand"
	ZoneBattlefield Zone = "battlefield"
	ZoneGraveyard   Zone = "graveyard"
	ZoneExile       Zone = "exile"
	ZoneCommand     Zone = "command"
)

type Location struct {
	PlayerID     string `json:"playerId"`
	Zone         Zone   `json:"zone"`
	Index        int    `json:"index"`
	ControllerID string `json:"controllerId,omitempty"`
}

type PlayerZones struct {
	Library     []string `json:"library"`
	Hand        []string `json:"hand"`
	Battlefield []string `json:"battlefield"`
	Graveyard   []string `json:"graveyard"`
	Exile       []string `json:"exile"`
	Command     []string `json:"command"`
}

type CardInstanceRuntime struct {
	InstanceID    string         `json:"instanceId"`
	CardKey       string         `json:"cardKey,omitempty"`
	OwnerID       string         `json:"ownerId"`
	ControllerID  string         `json:"controllerId"`
	Zone          Zone           `json:"zone"`
	IsCommander   bool           `json:"isCommander"`
	IsToken       bool           `json:"isToken"`
	TokenMeta     map[string]any `json:"tokenMeta,omitempty"`
	Tapped        bool           `json:"tapped"`
	Rotation      int            `json:"rotation"`
	Counters      map[string]int  `json:"counters,omitempty"`
	MutableStats  map[string]any `json:"mutableStats,omitempty"`
	Position      map[string]any `json:"position,omitempty"`
	FaceDown      bool           `json:"faceDown"`
	ActiveFace    int            `json:"activeFace"`
	VisibleToMask uint64         `json:"visibleToMask,omitempty"`
}

type VisibilityIndex struct {
	InstanceMasks       map[string]uint64         `json:"instanceMasks"`
	LibraryEpochByOwner map[string]int64          `json:"libraryEpochByOwner"`
	TopRevealWindows    map[string]TopRevealWindow `json:"topRevealWindows"`
}

type TopRevealWindow struct {
	OwnerID string   `json:"ownerId"`
	Count   int      `json:"count"`
	Epoch   int64    `json:"epoch"`
	To      []string `json:"to"`
}

type Relations struct {
	Attachments map[string]Relation `json:"attachments"`
	Arrows      map[string]Relation `json:"arrows"`
	Helpers     map[string]Relation `json:"helpers"`
	Indexes     RelationIndexes     `json:"indexes"`
}

type Relation struct {
	ID       string         `json:"id"`
	SourceID string         `json:"sourceId,omitempty"`
	TargetID string         `json:"targetId,omitempty"`
	Meta     map[string]any `json:"meta,omitempty"`
}

type RelationIndexes struct {
	BySource map[string][]string `json:"bySource"`
	ByTarget map[string][]string `json:"byTarget"`
}

type StackItem struct {
	StackID          string         `json:"stackId"`
	SourceInstanceID string         `json:"sourceInstanceId,omitempty"`
	CardKey          string         `json:"cardKey,omitempty"`
	ControllerID     string         `json:"controllerId"`
	Text             string         `json:"text,omitempty"`
	Meta             map[string]any `json:"meta,omitempty"`
}

type GameState struct {
	GameID     string                         `json:"gameId"`
	Version    int64                          `json:"version"`
	Status     string                         `json:"status"`
	Players    map[string]map[string]any      `json:"players"`
	Turn       map[string]any                 `json:"turn"`
	Instances map[string]CardInstanceRuntime `json:"instances"`
	Zones      map[string]PlayerZones         `json:"zones"`
	Loc        map[string]Location            `json:"loc"`
	Visibility VisibilityIndex                `json:"visibility"`
	Relations  Relations                      `json:"relations"`
	Stack      []StackItem                    `json:"stack"`
}

func (s *GameState) GetLocation(instanceID string) (Location, bool) {
	if s == nil || s.Loc == nil {
		return Location{}, false
	}
	location, ok := s.Loc[instanceID]
	return location, ok
}

func (s *GameState) AssertLocation(instanceID string, expectedZone *Zone) (Location, bool) {
	location, ok := s.GetLocation(instanceID)
	if !ok {
		return Location{}, false
	}
	if expectedZone != nil && location.Zone != *expectedZone {
		return Location{}, false
	}
	return location, true
}
