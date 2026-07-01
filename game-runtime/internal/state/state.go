package state

import "encoding/json"

type Zone string

const (
	ZoneLibrary     Zone = "library"
	ZoneHand        Zone = "hand"
	ZoneBattlefield Zone = "battlefield"
	ZoneGraveyard   Zone = "graveyard"
	ZoneExile       Zone = "exile"
	ZoneCommand     Zone = "command"
)

type GamePhase string

const (
	PhasePregame  GamePhase = "PREGAME"
	PhaseMulligan GamePhase = "MULLIGAN"
	PhasePlaying  GamePhase = "PLAYING"
	PhaseFinished GamePhase = "FINISHED"
)

type MulliganPlayerStatus string

const (
	MulliganStatusDeciding  MulliganPlayerStatus = "DECIDING"
	MulliganStatusBottoming MulliganPlayerStatus = "BOTTOMING"
	MulliganStatusScrying   MulliganPlayerStatus = "SCRYING"
	MulliganStatusReady     MulliganPlayerStatus = "READY"
)

type MulliganState struct {
	Rule              string                         `json:"rule"`
	FirstMulliganFree bool                           `json:"firstMulliganFree"`
	PlayerStatus      map[string]MulliganPlayerState `json:"playerStatus"`
	ReadyPlayers      map[string]bool                `json:"readyPlayers"`
	Completed         bool                           `json:"completed"`
	BottomOrderMode   string                         `json:"bottomOrderMode,omitempty"`
	ScryMode          string                         `json:"scryMode,omitempty"`
}

type MulliganPlayerState struct {
	Status             MulliganPlayerStatus `json:"status"`
	MulliganCount      int                  `json:"mulliganCount"`
	EffectiveMulligans int                  `json:"effectiveMulligans"`
	CurrentHandSize    int                  `json:"currentHandSize"`
	CardsToBottom      int                  `json:"cardsToBottom"`
	BottomPending      bool                 `json:"bottomPending"`
	ScryPending        bool                 `json:"scryPending"`
	BottomOrderMode    string               `json:"bottomOrderMode,omitempty"`
	ScryMode           string               `json:"scryMode,omitempty"`
	ScryCardInstanceID string               `json:"scryCardInstanceId,omitempty"`
}

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
	Counters      map[string]int `json:"counters,omitempty"`
	MutableStats  map[string]any `json:"mutableStats,omitempty"`
	Position      map[string]any `json:"position,omitempty"`
	FaceDown      bool           `json:"faceDown"`
	ActiveFace    int            `json:"activeFace"`
	VisibleToMask uint64         `json:"visibleToMask,omitempty"`
}

func (c *CardInstanceRuntime) UnmarshalJSON(data []byte) error {
	type alias CardInstanceRuntime
	aux := struct {
		Counters json.RawMessage `json:"counters"`
		*alias
	}{
		alias: (*alias)(c),
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	if len(aux.Counters) == 0 || string(aux.Counters) == "null" {
		return nil
	}
	var counters map[string]int
	if err := json.Unmarshal(aux.Counters, &counters); err == nil {
		c.Counters = counters
		return nil
	}
	var empty []any
	if err := json.Unmarshal(aux.Counters, &empty); err == nil && len(empty) == 0 {
		c.Counters = map[string]int{}
		return nil
	}
	return json.Unmarshal(aux.Counters, &c.Counters)
}

type VisibilityIndex struct {
	InstanceMasks       map[string]uint64          `json:"instanceMasks"`
	LibraryEpochByOwner map[string]int64           `json:"libraryEpochByOwner"`
	TopRevealWindows    map[string]TopRevealWindow `json:"topRevealWindows"`
}

type TopRevealWindow struct {
	OwnerID string   `json:"ownerId"`
	Count   int      `json:"count"`
	Epoch   int64    `json:"epoch"`
	To      []string `json:"to"`
	Mask    uint64   `json:"mask"`
}

type Relations struct {
	Attachments map[string]Relation `json:"attachments"`
	Arrows      map[string]Relation `json:"arrows"`
	Helpers     map[string]Relation `json:"helpers"`
	Indexes     RelationIndexes     `json:"indexes"`
}

func (r *Relations) UnmarshalJSON(data []byte) error {
	aux := struct {
		Attachments json.RawMessage `json:"attachments"`
		Arrows      json.RawMessage `json:"arrows"`
		Helpers     json.RawMessage `json:"helpers"`
		Indexes     RelationIndexes `json:"indexes"`
	}{}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	if err := decodeMapOrEmpty(aux.Attachments, &r.Attachments); err != nil {
		return err
	}
	if err := decodeMapOrEmpty(aux.Arrows, &r.Arrows); err != nil {
		return err
	}
	if err := decodeMapOrEmpty(aux.Helpers, &r.Helpers); err != nil {
		return err
	}
	r.Indexes = aux.Indexes
	if r.Indexes.BySource == nil {
		r.Indexes.BySource = map[string][]string{}
	}
	if r.Indexes.ByTarget == nil {
		r.Indexes.ByTarget = map[string][]string{}
	}
	return nil
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

func (r *RelationIndexes) UnmarshalJSON(data []byte) error {
	aux := struct {
		BySource               json.RawMessage `json:"bySource"`
		ByTarget               json.RawMessage `json:"byTarget"`
		ArrowsBySource         json.RawMessage `json:"arrowsBySource"`
		ArrowsByTarget         json.RawMessage `json:"arrowsByTarget"`
		AttachmentsByEquipment json.RawMessage `json:"attachmentsByEquipment"`
		AttachmentsByTarget    json.RawMessage `json:"attachmentsByTarget"`
	}{}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	if err := decodeMapOrEmpty(firstRaw(aux.BySource, aux.ArrowsBySource, aux.AttachmentsByEquipment), &r.BySource); err != nil {
		return err
	}
	if err := decodeMapOrEmpty(firstRaw(aux.ByTarget, aux.ArrowsByTarget, aux.AttachmentsByTarget), &r.ByTarget); err != nil {
		return err
	}
	return nil
}

type StackItem struct {
	StackID          string         `json:"stackId"`
	SourceInstanceID string         `json:"sourceInstanceId,omitempty"`
	CardKey          string         `json:"cardKey,omitempty"`
	ControllerID     string         `json:"controllerId"`
	Text             string         `json:"text,omitempty"`
	Meta             map[string]any `json:"meta,omitempty"`
}

func decodeMapOrEmpty[T any](raw json.RawMessage, out *map[string]T) error {
	if len(raw) == 0 || string(raw) == "null" {
		*out = map[string]T{}
		return nil
	}
	var decoded map[string]T
	if err := json.Unmarshal(raw, &decoded); err == nil {
		if decoded == nil {
			decoded = map[string]T{}
		}
		*out = decoded
		return nil
	}
	var empty []any
	if err := json.Unmarshal(raw, &empty); err == nil && len(empty) == 0 {
		*out = map[string]T{}
		return nil
	}
	return json.Unmarshal(raw, out)
}

func firstRaw(values ...json.RawMessage) json.RawMessage {
	for _, value := range values {
		if len(value) > 0 {
			return value
		}
	}
	return nil
}

type GameState struct {
	GameID         string                         `json:"gameId"`
	Version        int64                          `json:"version"`
	Status         string                         `json:"status"`
	Phase          GamePhase                      `json:"phase,omitempty"`
	Players        map[string]map[string]any      `json:"players"`
	SharedCounters map[string]map[string]int      `json:"sharedCounters,omitempty"`
	Turn           map[string]any                 `json:"turn"`
	Instances      map[string]CardInstanceRuntime `json:"instances"`
	Zones          map[string]PlayerZones         `json:"zones"`
	Loc            map[string]Location            `json:"loc"`
	Visibility     VisibilityIndex                `json:"visibility"`
	Relations      Relations                      `json:"relations"`
	Stack          []StackItem                    `json:"stack"`
	Mulligan       MulliganState                  `json:"mulligan,omitempty"`
}

func (s *GameState) UnmarshalJSON(data []byte) error {
	type alias GameState
	aux := struct {
		GamePhase GamePhase `json:"gamePhase"`
		*alias
	}{
		alias: (*alias)(s),
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	if s.Phase == "" && aux.GamePhase != "" {
		s.Phase = aux.GamePhase
	}
	return nil
}

func NormalizeForRecovery(gameID string, game *GameState) {
	if game.GameID == "" {
		game.GameID = gameID
	}
	if game.Status == "" {
		game.Status = "playing"
	}
	if game.Players == nil {
		game.Players = map[string]map[string]any{}
	}
	if game.SharedCounters == nil {
		game.SharedCounters = map[string]map[string]int{}
	}
	if game.Turn == nil {
		game.Turn = map[string]any{}
	}
	if game.Instances == nil {
		game.Instances = map[string]CardInstanceRuntime{}
	}
	if game.Zones == nil {
		game.Zones = map[string]PlayerZones{}
	}
	if game.Loc == nil {
		game.Loc = map[string]Location{}
	}
	if game.Visibility.InstanceMasks == nil {
		game.Visibility.InstanceMasks = map[string]uint64{}
	}
	if game.Visibility.LibraryEpochByOwner == nil {
		game.Visibility.LibraryEpochByOwner = map[string]int64{}
	}
	if game.Visibility.TopRevealWindows == nil {
		game.Visibility.TopRevealWindows = map[string]TopRevealWindow{}
	}
	if game.Relations.Attachments == nil {
		game.Relations.Attachments = map[string]Relation{}
	}
	if game.Relations.Arrows == nil {
		game.Relations.Arrows = map[string]Relation{}
	}
	if game.Relations.Helpers == nil {
		game.Relations.Helpers = map[string]Relation{}
	}
	if game.Relations.Indexes.BySource == nil {
		game.Relations.Indexes.BySource = map[string][]string{}
	}
	if game.Relations.Indexes.ByTarget == nil {
		game.Relations.Indexes.ByTarget = map[string][]string{}
	}
	if game.Stack == nil {
		game.Stack = []StackItem{}
	}
	if game.Mulligan.PlayerStatus == nil {
		game.Mulligan.PlayerStatus = map[string]MulliganPlayerState{}
	}
	if game.Mulligan.ReadyPlayers == nil {
		game.Mulligan.ReadyPlayers = map[string]bool{}
	}
}

func (s GameState) Clone() GameState {
	clone := s
	clone.Players = map[string]map[string]any{}
	for playerID, player := range s.Players {
		clone.Players[playerID] = cloneAnyMap(player)
	}
	clone.SharedCounters = map[string]map[string]int{}
	for scope, counters := range s.SharedCounters {
		clone.SharedCounters[scope] = cloneIntMap(counters)
	}
	clone.Turn = cloneAnyMap(s.Turn)
	clone.Instances = map[string]CardInstanceRuntime{}
	for instanceID, instance := range s.Instances {
		clone.Instances[instanceID] = instance.Clone()
	}
	clone.Zones = map[string]PlayerZones{}
	for playerID, zones := range s.Zones {
		clone.Zones[playerID] = zones.Clone()
	}
	clone.Loc = map[string]Location{}
	for instanceID, location := range s.Loc {
		clone.Loc[instanceID] = location
	}
	clone.Visibility = s.Visibility.Clone()
	clone.Relations = s.Relations.Clone()
	clone.Stack = append([]StackItem(nil), s.Stack...)
	clone.Mulligan = s.Mulligan.Clone()
	return clone
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

func (c CardInstanceRuntime) Clone() CardInstanceRuntime {
	c.TokenMeta = cloneAnyMap(c.TokenMeta)
	c.Counters = cloneIntMap(c.Counters)
	c.MutableStats = cloneAnyMap(c.MutableStats)
	c.Position = cloneAnyMap(c.Position)
	return c
}

func (z PlayerZones) Clone() PlayerZones {
	return PlayerZones{
		Library:     append([]string(nil), z.Library...),
		Hand:        append([]string(nil), z.Hand...),
		Battlefield: append([]string(nil), z.Battlefield...),
		Graveyard:   append([]string(nil), z.Graveyard...),
		Exile:       append([]string(nil), z.Exile...),
		Command:     append([]string(nil), z.Command...),
	}
}

func (m MulliganState) Clone() MulliganState {
	clone := m
	clone.PlayerStatus = map[string]MulliganPlayerState{}
	for playerID, status := range m.PlayerStatus {
		clone.PlayerStatus[playerID] = status
	}
	clone.ReadyPlayers = map[string]bool{}
	for playerID, ready := range m.ReadyPlayers {
		clone.ReadyPlayers[playerID] = ready
	}
	return clone
}

func (v VisibilityIndex) Clone() VisibilityIndex {
	clone := VisibilityIndex{
		InstanceMasks:       map[string]uint64{},
		LibraryEpochByOwner: map[string]int64{},
		TopRevealWindows:    map[string]TopRevealWindow{},
	}
	for key, value := range v.InstanceMasks {
		clone.InstanceMasks[key] = value
	}
	for key, value := range v.LibraryEpochByOwner {
		clone.LibraryEpochByOwner[key] = value
	}
	for key, value := range v.TopRevealWindows {
		value.To = append([]string(nil), value.To...)
		clone.TopRevealWindows[key] = value
	}
	return clone
}

func (r Relations) Clone() Relations {
	return Relations{
		Attachments: cloneRelationMap(r.Attachments),
		Arrows:      cloneRelationMap(r.Arrows),
		Helpers:     cloneRelationMap(r.Helpers),
		Indexes: RelationIndexes{
			BySource: cloneStringSliceMap(r.Indexes.BySource),
			ByTarget: cloneStringSliceMap(r.Indexes.ByTarget),
		},
	}
}

func cloneAnyMap(values map[string]any) map[string]any {
	if values == nil {
		return nil
	}
	clone := make(map[string]any, len(values))
	for key, value := range values {
		clone[key] = value
	}
	return clone
}

func cloneIntMap(values map[string]int) map[string]int {
	if values == nil {
		return nil
	}
	clone := make(map[string]int, len(values))
	for key, value := range values {
		clone[key] = value
	}
	return clone
}

func cloneRelationMap(values map[string]Relation) map[string]Relation {
	if values == nil {
		return nil
	}
	clone := make(map[string]Relation, len(values))
	for key, value := range values {
		value.Meta = cloneAnyMap(value.Meta)
		clone[key] = value
	}
	return clone
}

func cloneStringSliceMap(values map[string][]string) map[string][]string {
	if values == nil {
		return nil
	}
	clone := make(map[string][]string, len(values))
	for key, value := range values {
		clone[key] = append([]string(nil), value...)
	}
	return clone
}
