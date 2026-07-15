package state

import "errors"

var (
	ErrMissingRelation        = errors.New("missing relation")
	ErrInvalidRelation        = errors.New("invalid relation")
	ErrRelationExists         = errors.New("relation already exists")
	ErrRelationCycle          = errors.New("relation cycle")
	ErrInstanceAlreadyStacked = errors.New("instance already stacked")
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
	if _, _, ok := ops.BattlefieldStackForInstance(game, relation.SourceID); ok {
		return ErrInvalidRelation
	}
	if _, _, ok := ops.BattlefieldStackForInstance(game, relation.TargetID); ok {
		return ErrInvalidRelation
	}
	for _, existing := range game.Relations.Attachments {
		if existing.ID == relation.ID || existing.SourceID == relation.SourceID {
			return ErrRelationExists
		}
	}
	if attachmentPathExists(game.Relations.Attachments, relation.TargetID, relation.SourceID) {
		return ErrRelationCycle
	}
	relation.RelationType = "attachment"
	relation.EffectVersion = max(relation.EffectVersion, 1)
	if relation.Order <= 0 {
		relation.Order = nextAttachmentOrder(game.Relations.Attachments, relation.TargetID)
	}
	game.Relations.Attachments[relation.ID] = relation.Clone()
	addRelationIndex(game, relation.SourceID, relation.ID, true)
	addRelationIndex(game, relation.TargetID, relation.ID, false)
	return nil
}

func (ops *RelationsOps) ReorderAttachments(game *GameState, targetID string, orderedIDs []string) ([]Relation, error) {
	ensureRelations(game)
	existing := make([]Relation, 0)
	for _, relation := range game.Relations.Attachments {
		if relation.TargetID == targetID {
			existing = append(existing, relation)
		}
	}
	if len(existing) != len(orderedIDs) || len(existing) == 0 {
		return nil, ErrInvalidRelation
	}
	byID := make(map[string]Relation, len(existing))
	for _, relation := range existing {
		byID[relation.ID] = relation
	}
	seen := map[string]bool{}
	ordered := make([]Relation, 0, len(orderedIDs))
	for index, id := range orderedIDs {
		relation, ok := byID[id]
		if !ok || seen[id] {
			return nil, ErrInvalidRelation
		}
		seen[id] = true
		relation.Order = index + 1
		game.Relations.Attachments[id] = relation
		ordered = append(ordered, relation.Clone())
	}
	return ordered, nil
}

func (ops *RelationsOps) AddBattlefieldStack(game *GameState, stack BattlefieldStack) error {
	ensureRelations(game)
	if stack.ID == "" || stack.RootInstanceID == "" || len(stack.OrderedMemberIDs) < 2 {
		return ErrInvalidRelation
	}
	if _, exists := game.Relations.BattlefieldStacks[stack.ID]; exists {
		return ErrRelationExists
	}
	seen := map[string]bool{}
	rootFound := false
	for _, instanceID := range stack.OrderedMemberIDs {
		if instanceID == "" || seen[instanceID] {
			return ErrInvalidRelation
		}
		seen[instanceID] = true
		rootFound = rootFound || instanceID == stack.RootInstanceID
		if _, ok := game.AssertLocation(instanceID, zonePtr(ZoneBattlefield)); !ok {
			return ErrMissingInstance
		}
		if instanceHasAttachment(game.Relations.Attachments, instanceID) {
			return ErrInvalidRelation
		}
		if _, _, ok := ops.BattlefieldStackForInstance(game, instanceID); ok {
			return ErrInstanceAlreadyStacked
		}
	}
	if !rootFound {
		return ErrInvalidRelation
	}
	stack.RelationType = "battlefield_stack"
	stack.EffectVersion = max(stack.EffectVersion, 1)
	stack.OrderedMemberIDs = append([]string(nil), stack.OrderedMemberIDs...)
	game.Relations.BattlefieldStacks[stack.ID] = stack
	return nil
}

func instanceHasAttachment(attachments map[string]Relation, instanceID string) bool {
	for _, relation := range attachments {
		if relation.SourceID == instanceID || relation.TargetID == instanceID {
			return true
		}
	}
	return false
}

func (ops *RelationsOps) BattlefieldStackForInstance(game *GameState, instanceID string) (string, BattlefieldStack, bool) {
	if game == nil {
		return "", BattlefieldStack{}, false
	}
	for stackID, stack := range game.Relations.BattlefieldStacks {
		for _, memberID := range stack.OrderedMemberIDs {
			if memberID == instanceID {
				return stackID, stack, true
			}
		}
	}
	return "", BattlefieldStack{}, false
}

func (ops *RelationsOps) SetBattlefieldStack(game *GameState, stack BattlefieldStack) error {
	ensureRelations(game)
	if _, exists := game.Relations.BattlefieldStacks[stack.ID]; !exists {
		return ErrMissingRelation
	}
	delete(game.Relations.BattlefieldStacks, stack.ID)
	if err := ops.AddBattlefieldStack(game, stack); err != nil {
		return err
	}
	return nil
}

func (ops *RelationsOps) RemoveBattlefieldStack(game *GameState, id string) (BattlefieldStack, error) {
	ensureRelations(game)
	stack, ok := game.Relations.BattlefieldStacks[id]
	if !ok {
		return BattlefieldStack{}, ErrMissingRelation
	}
	delete(game.Relations.BattlefieldStacks, id)
	stack.OrderedMemberIDs = append([]string(nil), stack.OrderedMemberIDs...)
	return stack, nil
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
	if stackID, _, ok := ops.BattlefieldStackForInstance(game, instanceID); ok {
		stack := game.Relations.BattlefieldStacks[stackID]
		remaining := make([]string, 0, len(stack.OrderedMemberIDs)-1)
		for _, memberID := range stack.OrderedMemberIDs {
			if memberID != instanceID {
				remaining = append(remaining, memberID)
			}
		}
		if len(remaining) < 2 {
			delete(game.Relations.BattlefieldStacks, stackID)
			removed = append(removed, RemovedRelation{Kind: "battlefield_stack", ID: stackID})
		} else {
			stack.OrderedMemberIDs = remaining
			if stack.RootInstanceID == instanceID {
				stack.RootInstanceID = remaining[0]
			}
			game.Relations.BattlefieldStacks[stackID] = stack
			removed = append(removed, RemovedRelation{Kind: "battlefield_stack_set", ID: stackID, Stack: stack})
		}
	}
	return removed
}

type RemovedRelation struct {
	Kind  string
	ID    string
	Stack BattlefieldStack
}

func ensureRelations(game *GameState) {
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
}

func nextAttachmentOrder(attachments map[string]Relation, targetID string) int {
	next := 1
	for _, relation := range attachments {
		if relation.TargetID == targetID && relation.Order >= next {
			next = relation.Order + 1
		}
	}
	return next
}

func attachmentPathExists(attachments map[string]Relation, fromID string, toID string) bool {
	visited := map[string]bool{}
	var visit func(string) bool
	visit = func(instanceID string) bool {
		if instanceID == toID {
			return true
		}
		if visited[instanceID] {
			return false
		}
		visited[instanceID] = true
		for _, relation := range attachments {
			if relation.SourceID == instanceID && visit(relation.TargetID) {
				return true
			}
		}
		return false
	}
	return visit(fromID)
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
