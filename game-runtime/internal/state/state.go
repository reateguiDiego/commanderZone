package state

import (
	"bytes"
	"encoding/json"
	"sort"
	"strconv"
)

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
	InstanceID      string                    `json:"instanceId"`
	CardKey         string                    `json:"cardKey,omitempty"`
	PrintID         string                    `json:"printId,omitempty"`
	CardVersion     string                    `json:"cardVersion,omitempty"`
	Language        string                    `json:"language,omitempty"`
	OwnerID         string                    `json:"ownerId"`
	ControllerID    string                    `json:"controllerId"`
	Zone            Zone                      `json:"zone"`
	IsCommander     bool                      `json:"isCommander"`
	IsToken         bool                      `json:"isToken"`
	TokenMeta       map[string]any            `json:"tokenMeta,omitempty"`
	Tapped          bool                      `json:"tapped"`
	Rotation        int                       `json:"rotation"`
	Counters        map[string]int            `json:"counters,omitempty"`
	MutableStats    map[string]any            `json:"mutableStats,omitempty"`
	PrintedStats    map[string]map[string]any `json:"printedStats,omitempty"`
	ManualOverrides map[string]map[string]any `json:"manualOverrides,omitempty"`
	Position        map[string]any            `json:"position,omitempty"`
	FaceDown        bool                      `json:"faceDown"`
	ActiveFace      int                       `json:"activeFace"`
	VisibleToMask   uint64                    `json:"visibleToMask,omitempty"`
}

func (c *CardInstanceRuntime) UnmarshalJSON(data []byte) error {
	type alias CardInstanceRuntime
	aux := struct {
		Counters        json.RawMessage `json:"counters"`
		PrintedStats    json.RawMessage `json:"printedStats"`
		ManualOverrides json.RawMessage `json:"manualOverrides"`
		*alias
	}{
		alias: (*alias)(c),
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	if err := decodeMapOrEmpty(aux.Counters, &c.Counters); err != nil {
		return err
	}
	if err := decodeStatsMapOrList(aux.PrintedStats, &c.PrintedStats); err != nil {
		return err
	}
	if err := decodeStatsMapOrList(aux.ManualOverrides, &c.ManualOverrides); err != nil {
		return err
	}
	return nil
}

func decodeStatsMapOrList(raw json.RawMessage, out *map[string]map[string]any) error {
	if err := decodeMapOrEmpty(raw, out); err == nil {
		return nil
	}
	var entries []map[string]any
	if err := json.Unmarshal(raw, &entries); err != nil {
		return err
	}
	normalized := make(map[string]map[string]any, len(entries))
	for index, entry := range entries {
		faceKey := strconv.Itoa(index)
		if value, ok := entry["faceKey"].(string); ok && value != "" {
			faceKey = value
		} else if value, ok := entry["faceIndex"].(float64); ok {
			faceKey = strconv.Itoa(int(value))
		}
		normalized[faceKey] = entry
	}
	*out = normalized
	return nil
}

type VisibilityIndex struct {
	ViewerBits          map[string]uint64          `json:"viewerBits"`
	InstanceMasks       map[string]uint64          `json:"instanceMasks"`
	HandRevealStates    map[string]HandRevealState `json:"handRevealStates,omitempty"`
	LibraryEpochByOwner map[string]int64           `json:"libraryEpochByOwner"`
	TopRevealWindows    map[string]TopRevealWindow `json:"topRevealWindows"`
	LibraryWindows      map[string]LibraryWindow   `json:"libraryWindows,omitempty"`
}

type HandRevealState struct {
	OwnerID              string   `json:"ownerId"`
	Zone                 Zone     `json:"zone"`
	Active               bool     `json:"active"`
	VisibleToMask        uint64   `json:"visibleToMask"`
	RevealedTo           []string `json:"revealedTo"`
	RevealedAtVersion    int64    `json:"revealedAtVersion,omitempty"`
	LastChangedVersion   int64    `json:"lastChangedVersion"`
	SourceCommand        string   `json:"sourceCommand"`
	SourceClientActionID string   `json:"sourceClientActionId,omitempty"`
}

type TopRevealWindow struct {
	OwnerID     string   `json:"ownerId"`
	Count       int      `json:"count"`
	Epoch       int64    `json:"epoch"`
	To          []string `json:"to"`
	Mask        uint64   `json:"mask"`
	InstanceIDs []string `json:"instanceIds,omitempty"`
}

type LibraryWindow struct {
	WindowID          string   `json:"windowId"`
	OwnerID           string   `json:"ownerId"`
	InstanceIDs       []string `json:"instanceIds,omitempty"`
	ExpectedEpoch     int64    `json:"expectedEpoch"`
	OpenedAtVersion   int64    `json:"openedAtVersion"`
	CreatedByPlayerID string   `json:"createdByPlayerId,omitempty"`
	CreatedBySession  string   `json:"createdBySession,omitempty"`
	Status            string   `json:"status"`
}

type Relations struct {
	Attachments       map[string]Relation         `json:"attachments"`
	BattlefieldStacks map[string]BattlefieldStack `json:"battlefieldStacks"`
	Arrows            map[string]Relation         `json:"arrows"`
	Helpers           map[string]Relation         `json:"helpers"`
	Indexes           RelationIndexes             `json:"indexes"`
}

func (r *Relations) UnmarshalJSON(data []byte) error {
	aux := struct {
		Attachments       json.RawMessage `json:"attachments"`
		BattlefieldStacks json.RawMessage `json:"battlefieldStacks"`
		Arrows            json.RawMessage `json:"arrows"`
		Helpers           json.RawMessage `json:"helpers"`
		Indexes           RelationIndexes `json:"indexes"`
	}{}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	if err := decodeMapOrEmpty(aux.Attachments, &r.Attachments); err != nil {
		return err
	}
	if err := decodeMapOrEmpty(aux.BattlefieldStacks, &r.BattlefieldStacks); err != nil {
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
	ID               string         `json:"id"`
	RelationType     string         `json:"relationType,omitempty"`
	SourceID         string         `json:"sourceId,omitempty"`
	TargetID         string         `json:"targetId,omitempty"`
	OwnerPlayerID    string         `json:"ownerPlayerId,omitempty"`
	Order            int            `json:"order,omitempty"`
	EffectVersion    int            `json:"effectVersion,omitempty"`
	CreatedAtVersion int64          `json:"createdAtVersion,omitempty"`
	Meta             map[string]any `json:"meta,omitempty"`
}

func (r *Relation) UnmarshalJSON(data []byte) error {
	type alias Relation
	aux := struct {
		SourceInstanceID     string `json:"sourceInstanceId"`
		TargetInstanceID     string `json:"targetInstanceId"`
		EquipmentInstanceID  string `json:"equipmentInstanceId"`
		AttachedToInstanceID string `json:"attachedToInstanceId"`
		FromInstanceID       string `json:"fromInstanceId"`
		ToInstanceID         string `json:"toInstanceId"`
		OwnerID              string `json:"ownerId"`
		*alias
	}{alias: (*alias)(r)}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	if r.SourceID == "" {
		for _, candidate := range []string{aux.SourceInstanceID, aux.EquipmentInstanceID, aux.FromInstanceID} {
			if candidate != "" {
				r.SourceID = candidate
				break
			}
		}
	}
	if r.TargetID == "" {
		for _, candidate := range []string{aux.TargetInstanceID, aux.AttachedToInstanceID, aux.ToInstanceID} {
			if candidate != "" {
				r.TargetID = candidate
				break
			}
		}
	}
	if r.OwnerPlayerID == "" {
		r.OwnerPlayerID = aux.OwnerID
	}
	return nil
}

// BattlefieldStack is a visual grouping on the battlefield. It is distinct
// from GameState.Stack, which represents pending game actions.
type BattlefieldStack struct {
	ID                string   `json:"id"`
	RelationType      string   `json:"relationType"`
	RootInstanceID    string   `json:"rootInstanceId"`
	OrderedMemberIDs  []string `json:"orderedMemberIds"`
	StackKind         string   `json:"stackKind"`
	CreatedByPlayerID string   `json:"createdByPlayerId"`
	EffectVersion     int      `json:"effectVersion"`
	CreatedAtVersion  int64    `json:"createdAtVersion"`
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
	Kind             string         `json:"kind,omitempty"`
	SourceInstanceID string         `json:"sourceInstanceId,omitempty"`
	CardKey          string         `json:"cardKey,omitempty"`
	ControllerID     string         `json:"controllerId"`
	OwnerID          string         `json:"ownerId,omitempty"`
	Visibility       string         `json:"visibility,omitempty"`
	Text             string         `json:"text,omitempty"`
	CreatedAt        string         `json:"createdAt,omitempty"`
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
	GameID              string                         `json:"gameId"`
	OwnerID             string                         `json:"ownerId,omitempty"`
	Version             int64                          `json:"version"`
	Status              string                         `json:"status"`
	Phase               GamePhase                      `json:"phase,omitempty"`
	Players             map[string]map[string]any      `json:"players"`
	TurnOrder           []string                       `json:"turnOrder,omitempty"`
	WinnerPlayerID      string                         `json:"winnerPlayerId,omitempty"`
	ResultState         string                         `json:"resultState,omitempty"`
	FinishedReason      string                         `json:"finishedReason,omitempty"`
	SharedCounters      map[string]map[string]int      `json:"sharedCounters,omitempty"`
	Turn                map[string]any                 `json:"turn"`
	Presence            map[string]map[string]any      `json:"presence,omitempty"`
	DisconnectVote      map[string]any                 `json:"disconnectVote,omitempty"`
	DisconnectCooldowns map[string]map[string]any      `json:"disconnectCooldowns,omitempty"`
	Rematch             map[string]any                 `json:"rematch,omitempty"`
	Instances           map[string]CardInstanceRuntime `json:"instances"`
	Zones               map[string]PlayerZones         `json:"zones"`
	Loc                 map[string]Location            `json:"loc"`
	Visibility          VisibilityIndex                `json:"visibility"`
	Relations           Relations                      `json:"relations"`
	Stack               []StackItem                    `json:"stack"`
	Mulligan            MulliganState                  `json:"mulligan,omitempty"`
}

func (s *GameState) UnmarshalJSON(data []byte) error {
	type alias GameState
	normalizedData, err := normalizeLegacyEmptyObjectFields(
		data,
		"players",
		"sharedCounters",
		"turn",
		"presence",
		"disconnectVote",
		"disconnectCooldowns",
		"rematch",
		"instances",
		"zones",
		"loc",
	)
	if err != nil {
		return err
	}
	aux := struct {
		GamePhase GamePhase `json:"gamePhase"`
		*alias
	}{
		alias: (*alias)(s),
	}
	if err := json.Unmarshal(normalizedData, &aux); err != nil {
		return err
	}
	if s.Phase == "" && aux.GamePhase != "" {
		s.Phase = aux.GamePhase
	}
	if len(s.TurnOrder) == 0 {
		s.TurnOrder = orderedObjectKeys(data, "players")
	}
	return nil
}

func normalizeLegacyEmptyObjectFields(data []byte, fields ...string) ([]byte, error) {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(data, &object); err != nil {
		return nil, err
	}
	changed := false
	for _, field := range fields {
		raw, ok := object[field]
		if !ok || !bytes.Equal(bytes.TrimSpace(raw), []byte("[]")) {
			continue
		}
		object[field] = json.RawMessage(`{}`)
		changed = true
	}
	if !changed {
		return data, nil
	}
	return json.Marshal(object)
}

func orderedObjectKeys(data []byte, field string) []string {
	decoder := json.NewDecoder(bytes.NewReader(data))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return nil
	}
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return nil
		}
		if key != field {
			var ignored json.RawMessage
			if decoder.Decode(&ignored) != nil {
				return nil
			}
			continue
		}
		if token, err = decoder.Token(); err != nil || token != json.Delim('{') {
			return nil
		}
		keys := []string{}
		for decoder.More() {
			key, err := decoder.Token()
			if err != nil {
				return nil
			}
			keys = append(keys, key.(string))
			var ignored json.RawMessage
			if decoder.Decode(&ignored) != nil {
				return nil
			}
		}
		_, _ = decoder.Token()
		return keys
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
	game.TurnOrder = normalizeTurnOrder(game.TurnOrder, game.Players)
	if game.SharedCounters == nil {
		game.SharedCounters = map[string]map[string]int{}
	}
	if game.Turn == nil {
		game.Turn = map[string]any{}
	}
	if game.Presence == nil {
		game.Presence = map[string]map[string]any{}
	}
	if game.DisconnectCooldowns == nil {
		game.DisconnectCooldowns = map[string]map[string]any{}
	}
	if game.Rematch == nil {
		game.Rematch = map[string]any{}
	}
	if _, ok := game.Rematch["votes"].(map[string]any); !ok {
		game.Rematch["votes"] = map[string]any{}
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
	ensureViewerBits(game)
	if game.Visibility.LibraryEpochByOwner == nil {
		game.Visibility.LibraryEpochByOwner = map[string]int64{}
	}
	if game.Visibility.TopRevealWindows == nil {
		game.Visibility.TopRevealWindows = map[string]TopRevealWindow{}
	}
	if game.Visibility.LibraryWindows == nil {
		game.Visibility.LibraryWindows = map[string]LibraryWindow{}
	}
	for ownerID, window := range game.Visibility.TopRevealWindows {
		if len(window.InstanceIDs) == 0 && window.Count > 0 {
			window.InstanceIDs = libraryTopFirstIDs(game.Zones[ownerID].Library, window.Count)
			game.Visibility.TopRevealWindows[ownerID] = window
		}
	}
	if game.Relations.Attachments == nil {
		game.Relations.Attachments = map[string]Relation{}
	}
	if game.Relations.BattlefieldStacks == nil {
		game.Relations.BattlefieldStacks = map[string]BattlefieldStack{}
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
	clone.TurnOrder = append([]string(nil), s.TurnOrder...)
	clone.Players = map[string]map[string]any{}
	for playerID, player := range s.Players {
		clone.Players[playerID] = cloneAnyMap(player)
	}
	clone.SharedCounters = map[string]map[string]int{}
	for scope, counters := range s.SharedCounters {
		clone.SharedCounters[scope] = cloneIntMap(counters)
	}
	clone.Turn = cloneAnyMap(s.Turn)
	clone.Presence = map[string]map[string]any{}
	for playerID, presence := range s.Presence {
		clone.Presence[playerID] = cloneAnyMap(presence)
	}
	clone.DisconnectVote = cloneAnyMap(s.DisconnectVote)
	clone.DisconnectCooldowns = map[string]map[string]any{}
	for playerID, cooldown := range s.DisconnectCooldowns {
		clone.DisconnectCooldowns[playerID] = cloneAnyMap(cooldown)
	}
	clone.Rematch = cloneAnyMap(s.Rematch)
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

func normalizeTurnOrder(current []string, players map[string]map[string]any) []string {
	seen := map[string]bool{}
	order := make([]string, 0, len(players))
	for _, playerID := range current {
		if _, ok := players[playerID]; ok && !seen[playerID] {
			seen[playerID] = true
			order = append(order, playerID)
		}
	}
	missing := make([]string, 0, len(players)-len(order))
	for playerID := range players {
		if !seen[playerID] {
			missing = append(missing, playerID)
		}
	}
	sort.Strings(missing)
	return append(order, missing...)
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
	c.PrintedStats = cloneNestedAnyMap(c.PrintedStats)
	c.ManualOverrides = cloneNestedAnyMap(c.ManualOverrides)
	c.Position = cloneAnyMap(c.Position)
	return c
}

func cloneNestedAnyMap(source map[string]map[string]any) map[string]map[string]any {
	if source == nil {
		return nil
	}
	clone := make(map[string]map[string]any, len(source))
	for key, value := range source {
		clone[key] = cloneAnyMap(value)
	}
	return clone
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
		ViewerBits:          map[string]uint64{},
		InstanceMasks:       map[string]uint64{},
		HandRevealStates:    map[string]HandRevealState{},
		LibraryEpochByOwner: map[string]int64{},
		TopRevealWindows:    map[string]TopRevealWindow{},
		LibraryWindows:      map[string]LibraryWindow{},
	}
	for key, value := range v.ViewerBits {
		clone.ViewerBits[key] = value
	}
	for key, value := range v.InstanceMasks {
		clone.InstanceMasks[key] = value
	}
	for key, value := range v.HandRevealStates {
		value.RevealedTo = append([]string(nil), value.RevealedTo...)
		clone.HandRevealStates[key] = value
	}
	for key, value := range v.LibraryEpochByOwner {
		clone.LibraryEpochByOwner[key] = value
	}
	for key, value := range v.TopRevealWindows {
		value.To = append([]string(nil), value.To...)
		value.InstanceIDs = append([]string(nil), value.InstanceIDs...)
		clone.TopRevealWindows[key] = value
	}
	for key, value := range v.LibraryWindows {
		value.InstanceIDs = append([]string(nil), value.InstanceIDs...)
		clone.LibraryWindows[key] = value
	}
	return clone
}

func ensureViewerBits(game *GameState) {
	if game.Visibility.ViewerBits == nil {
		game.Visibility.ViewerBits = map[string]uint64{}
	}
	playerIDs := make([]string, 0, len(game.Players))
	for playerID := range game.Players {
		if playerID != "" {
			playerIDs = append(playerIDs, playerID)
		}
	}
	sort.Strings(playerIDs)
	used := uint64(0)
	for _, bit := range game.Visibility.ViewerBits {
		used |= bit
	}
	nextBit := uint64(1)
	for _, playerID := range playerIDs {
		if game.Visibility.ViewerBits[playerID] > 0 {
			continue
		}
		for nextBit != 0 && used&nextBit != 0 {
			nextBit <<= 1
		}
		if nextBit == 0 {
			break
		}
		game.Visibility.ViewerBits[playerID] = nextBit
		used |= nextBit
		nextBit <<= 1
	}
}

func (r Relations) Clone() Relations {
	return Relations{
		Attachments:       cloneRelationMap(r.Attachments),
		BattlefieldStacks: cloneBattlefieldStackMap(r.BattlefieldStacks),
		Arrows:            cloneRelationMap(r.Arrows),
		Helpers:           cloneRelationMap(r.Helpers),
		Indexes: RelationIndexes{
			BySource: cloneStringSliceMap(r.Indexes.BySource),
			ByTarget: cloneStringSliceMap(r.Indexes.ByTarget),
		},
	}
}

func cloneBattlefieldStackMap(values map[string]BattlefieldStack) map[string]BattlefieldStack {
	if values == nil {
		return nil
	}
	clone := make(map[string]BattlefieldStack, len(values))
	for key, value := range values {
		value.OrderedMemberIDs = append([]string(nil), value.OrderedMemberIDs...)
		clone[key] = value
	}
	return clone
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
