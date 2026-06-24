package state

import "errors"

var (
	ErrMissingRelation = errors.New("missing relation")
	ErrInvalidRelation = errors.New("invalid relation")
)

type RelationsOps struct {
	fullScanCount int
}

func NewRelationsOps() *RelationsOps {
	return &RelationsOps{}
}

func (ops *RelationsOps) FullScanCount() int {
	if ops == nil {
		return 0
	}
	return ops.fullScanCount
}

func (ops *RelationsOps) AddArrow(game *GameState, relation Relation) error {
	if relation.ID == "" || relation.SourceID == "" || relation.TargetID == "" {
		return ErrInvalidRelation
	}
	if _, ok := game.AssertLocation(relation.SourceID, zonePtr(ZoneBattlefield)); !ok {
		return ErrMissingInstance
	}
	if _, ok := game.AssertLocation(relation.TargetID, zonePtr(ZoneBattlefield)); !ok {
		return ErrMissingInstance
	}
	ensureRelations(game)
	game.Relations.Arrows[relation.ID] = relation.Clone()
	addRelationIndex(game, relation.SourceID, relation.ID, true)
	addRelationIndex(game, relation.TargetID, relation.ID, false)
	return nil
}

func (ops *RelationsOps) RemoveArrow(game *GameState, id string) (Relation, error) {
	ensureRelations(game)
	relation, ok := game.Relations.Arrows[id]
	if !ok {
		return Relation{}, ErrMissingRelation
	}
	delete(game.Relations.Arrows, id)
	removeRelationIndex(game, relation.SourceID, id, true)
	removeRelationIndex(game, relation.TargetID, id, false)
	return relation.Clone(), nil
}

func (ops *RelationsOps) AddAttachment(game *GameState, relation Relation) error {
	if relation.ID == "" || relation.SourceID == "" || relation.TargetID == "" || relation.SourceID == relation.TargetID {
		return ErrInvalidRelation
	}
	if _, ok := game.AssertLocation(relation.SourceID, zonePtr(ZoneBattlefield)); !ok {
		return ErrMissingInstance
	}
	if _, ok := game.AssertLocation(relation.TargetID, zonePtr(ZoneBattlefield)); !ok {
		return ErrMissingInstance
	}
	ensureRelations(game)
	if existingIDs := game.Relations.Indexes.BySource[relation.SourceID]; len(existingIDs) > 0 {
		for _, existingID := range append([]string(nil), existingIDs...) {
			if _, ok := game.Relations.Attachments[existingID]; ok {
				_, _ = ops.RemoveAttachment(game, existingID)
			}
		}
	}
	game.Relations.Attachments[relation.ID] = relation.Clone()
	addRelationIndex(game, relation.SourceID, relation.ID, true)
	addRelationIndex(game, relation.TargetID, relation.ID, false)
	return nil
}

func (ops *RelationsOps) RemoveAttachment(game *GameState, id string) (Relation, error) {
	ensureRelations(game)
	relation, ok := game.Relations.Attachments[id]
	if !ok {
		return Relation{}, ErrMissingRelation
	}
	delete(game.Relations.Attachments, id)
	removeRelationIndex(game, relation.SourceID, id, true)
	removeRelationIndex(game, relation.TargetID, id, false)
	return relation.Clone(), nil
}

func (ops *RelationsOps) AddHelper(game *GameState, relation Relation) error {
	if relation.ID == "" {
		return ErrInvalidRelation
	}
	ensureRelations(game)
	game.Relations.Helpers[relation.ID] = relation.Clone()
	return nil
}

func (ops *RelationsOps) UpdateHelper(game *GameState, id string, meta map[string]any) (Relation, error) {
	ensureRelations(game)
	relation, ok := game.Relations.Helpers[id]
	if !ok {
		return Relation{}, ErrMissingRelation
	}
	if relation.Meta == nil {
		relation.Meta = map[string]any{}
	}
	for key, value := range meta {
		relation.Meta[key] = value
	}
	game.Relations.Helpers[id] = relation.Clone()
	return relation.Clone(), nil
}

func (ops *RelationsOps) RemoveHelper(game *GameState, id string) (Relation, error) {
	ensureRelations(game)
	relation, ok := game.Relations.Helpers[id]
	if !ok {
		return Relation{}, ErrMissingRelation
	}
	delete(game.Relations.Helpers, id)
	return relation.Clone(), nil
}

func (ops *RelationsOps) PruneForMovedInstance(game *GameState, instanceID string) []RemovedRelation {
	ensureRelations(game)
	removed := []RemovedRelation{}
	for _, relationID := range append([]string(nil), game.Relations.Indexes.BySource[instanceID]...) {
		if relation, ok := game.Relations.Arrows[relationID]; ok {
			delete(game.Relations.Arrows, relationID)
			removeRelationIndex(game, relation.SourceID, relationID, true)
			removeRelationIndex(game, relation.TargetID, relationID, false)
			removed = append(removed, RemovedRelation{Kind: "arrow", ID: relationID})
			continue
		}
		if relation, ok := game.Relations.Attachments[relationID]; ok {
			delete(game.Relations.Attachments, relationID)
			removeRelationIndex(game, relation.SourceID, relationID, true)
			removeRelationIndex(game, relation.TargetID, relationID, false)
			removed = append(removed, RemovedRelation{Kind: "attachment", ID: relationID})
		}
	}
	for _, relationID := range append([]string(nil), game.Relations.Indexes.ByTarget[instanceID]...) {
		if relation, ok := game.Relations.Arrows[relationID]; ok {
			delete(game.Relations.Arrows, relationID)
			removeRelationIndex(game, relation.SourceID, relationID, true)
			removeRelationIndex(game, relation.TargetID, relationID, false)
			removed = append(removed, RemovedRelation{Kind: "arrow", ID: relationID})
			continue
		}
		if relation, ok := game.Relations.Attachments[relationID]; ok {
			delete(game.Relations.Attachments, relationID)
			removeRelationIndex(game, relation.SourceID, relationID, true)
			removeRelationIndex(game, relation.TargetID, relationID, false)
			removed = append(removed, RemovedRelation{Kind: "attachment", ID: relationID})
		}
	}
	return removed
}

type RemovedRelation struct {
	Kind string
	ID   string
}

func ensureRelations(game *GameState) {
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
}

func addRelationIndex(game *GameState, instanceID string, relationID string, source bool) {
	if instanceID == "" {
		return
	}
	index := game.Relations.Indexes.ByTarget
	if source {
		index = game.Relations.Indexes.BySource
	}
	for _, existing := range index[instanceID] {
		if existing == relationID {
			return
		}
	}
	index[instanceID] = append(index[instanceID], relationID)
}

func removeRelationIndex(game *GameState, instanceID string, relationID string, source bool) {
	if instanceID == "" {
		return
	}
	index := game.Relations.Indexes.ByTarget
	if source {
		index = game.Relations.Indexes.BySource
	}
	values := index[instanceID]
	next := values[:0]
	for _, existing := range values {
		if existing != relationID {
			next = append(next, existing)
		}
	}
	if len(next) == 0 {
		delete(index, instanceID)
		return
	}
	index[instanceID] = next
}

func zonePtr(zone Zone) *Zone {
	return &zone
}

func (r Relation) Clone() Relation {
	r.Meta = cloneAnyMap(r.Meta)
	return r
}
