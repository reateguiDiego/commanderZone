package state

import (
	"errors"
	"reflect"
	"testing"
)

func TestAttachmentRelationsAreExplicitOrderedAndAcyclic(t *testing.T) {
	game := relationState()
	ops := NewRelationsOps()

	if err := ops.AddAttachment(&game, Relation{ID: "a1", SourceID: "i2", TargetID: "i1"}); err != nil {
		t.Fatalf("add first attachment: %v", err)
	}
	if err := ops.AddAttachment(&game, Relation{ID: "a2", SourceID: "i3", TargetID: "i1"}); err != nil {
		t.Fatalf("add second attachment: %v", err)
	}
	if game.Relations.Attachments["a1"].Order != 1 || game.Relations.Attachments["a2"].Order != 2 {
		t.Fatalf("orders = %#v", game.Relations.Attachments)
	}
	if err := ops.AddAttachment(&game, Relation{ID: "a3", SourceID: "i2", TargetID: "i4"}); !errors.Is(err, ErrRelationExists) {
		t.Fatalf("duplicate source err = %v", err)
	}
	if err := ops.AddAttachment(&game, Relation{ID: "cycle", SourceID: "i1", TargetID: "i2"}); !errors.Is(err, ErrRelationCycle) {
		t.Fatalf("cycle err = %v", err)
	}

	ordered, err := ops.ReorderAttachments(&game, "i1", []string{"a2", "a1"})
	if err != nil {
		t.Fatalf("reorder: %v", err)
	}
	if got := []string{ordered[0].ID, ordered[1].ID}; !reflect.DeepEqual(got, []string{"a2", "a1"}) {
		t.Fatalf("ordered ids = %v", got)
	}
	if _, err := ops.ReorderAttachments(&game, "i1", []string{"a2", "a2"}); !errors.Is(err, ErrInvalidRelation) {
		t.Fatalf("duplicate order err = %v", err)
	}
	if err := ValidateInvariants(game); err != nil {
		t.Fatalf("invariants: %v", err)
	}
}

func TestBattlefieldStacksRequireExactUniqueMembership(t *testing.T) {
	game := relationState()
	ops := NewRelationsOps()
	stack := BattlefieldStack{
		ID: "s1", RootInstanceID: "i1", OrderedMemberIDs: []string{"i1", "i2", "i3"}, StackKind: "land",
	}

	if err := ops.AddBattlefieldStack(&game, stack); err != nil {
		t.Fatalf("add stack: %v", err)
	}
	if id, found, ok := ops.BattlefieldStackForInstance(&game, "i2"); !ok || id != "s1" || !reflect.DeepEqual(found.OrderedMemberIDs, stack.OrderedMemberIDs) {
		t.Fatalf("lookup = %q %#v %t", id, found, ok)
	}
	if err := ops.AddBattlefieldStack(&game, BattlefieldStack{ID: "s2", RootInstanceID: "i2", OrderedMemberIDs: []string{"i2", "i4"}}); !errors.Is(err, ErrInstanceAlreadyStacked) {
		t.Fatalf("already stacked err = %v", err)
	}
	if err := ops.AddBattlefieldStack(&game, BattlefieldStack{ID: "duplicates", RootInstanceID: "i4", OrderedMemberIDs: []string{"i4", "i4"}}); !errors.Is(err, ErrInvalidRelation) {
		t.Fatalf("duplicate member err = %v", err)
	}
	if err := ops.AddBattlefieldStack(&game, BattlefieldStack{ID: "missing-root", RootInstanceID: "i3", OrderedMemberIDs: []string{"i4", "i5"}}); !errors.Is(err, ErrInvalidRelation) {
		t.Fatalf("missing root err = %v", err)
	}
	if err := ValidateInvariants(game); err != nil {
		t.Fatalf("invariants: %v", err)
	}
}

func TestPruneForMovedInstanceRemovesWholeRelationGraphEntry(t *testing.T) {
	game := relationState()
	ops := NewRelationsOps()
	if err := ops.AddAttachment(&game, Relation{ID: "a1", SourceID: "i4", TargetID: "i5"}); err != nil {
		t.Fatal(err)
	}
	if err := ops.AddBattlefieldStack(&game, BattlefieldStack{ID: "s1", RootInstanceID: "i1", OrderedMemberIDs: []string{"i1", "i2", "i3"}}); err != nil {
		t.Fatal(err)
	}

	removed := ops.PruneForMovedInstance(&game, "i1")
	if len(removed) != 1 {
		t.Fatalf("removed = %#v", removed)
	}
	if len(game.Relations.Attachments) != 1 || len(game.Relations.BattlefieldStacks) != 1 {
		t.Fatalf("relations survived prune: %#v", game.Relations)
	}
	if stack := game.Relations.BattlefieldStacks["s1"]; stack.RootInstanceID != "i2" || !reflect.DeepEqual(stack.OrderedMemberIDs, []string{"i2", "i3"}) {
		t.Fatalf("stack was not normalized: %#v", stack)
	}
	removed = ops.PruneForMovedInstance(&game, "i4")
	if len(removed) != 1 || len(game.Relations.Attachments) != 0 {
		t.Fatalf("attachment prune = %#v relations=%#v", removed, game.Relations)
	}
	removed = ops.PruneForMovedInstance(&game, "i2")
	if len(removed) != 1 || len(game.Relations.BattlefieldStacks) != 0 {
		t.Fatalf("two-member stack was not dissolved: %#v relations=%#v", removed, game.Relations)
	}
}

func TestValidateInvariantsRejectsMalformedBattlefieldStack(t *testing.T) {
	game := relationState()
	game.Relations.BattlefieldStacks["s1"] = BattlefieldStack{
		ID: "s1", RelationType: "battlefield_stack", RootInstanceID: "i1", OrderedMemberIDs: []string{"i1", "i1"}, EffectVersion: 1,
	}
	if err := ValidateInvariants(game); !errors.Is(err, ErrInvariantViolation) {
		t.Fatalf("err = %v", err)
	}
}

func TestAttachmentsAndBattlefieldStacksCannotShareMembers(t *testing.T) {
	game := relationState()
	ops := NewRelationsOps()
	if err := ops.AddAttachment(&game, Relation{ID: "a1", SourceID: "i4", TargetID: "i5"}); err != nil {
		t.Fatal(err)
	}
	if err := ops.AddBattlefieldStack(&game, BattlefieldStack{ID: "s1", RootInstanceID: "i1", OrderedMemberIDs: []string{"i1", "i4"}}); !errors.Is(err, ErrInvalidRelation) {
		t.Fatalf("mixed relation err = %v", err)
	}
}

func relationState() GameState {
	game := invariantState()
	game.Instances = map[string]CardInstanceRuntime{}
	game.Zones["p1"] = PlayerZones{Battlefield: []string{"i1", "i2", "i3", "i4", "i5"}}
	game.Loc = map[string]Location{}
	for index, id := range game.Zones["p1"].Battlefield {
		game.Instances[id] = CardInstanceRuntime{InstanceID: id, OwnerID: "p1", ControllerID: "p1", Zone: ZoneBattlefield}
		game.Loc[id] = Location{PlayerID: "p1", Zone: ZoneBattlefield, Index: index, ControllerID: "p1"}
	}
	game.Relations = Relations{
		Attachments:       map[string]Relation{},
		BattlefieldStacks: map[string]BattlefieldStack{},
		Arrows:            map[string]Relation{},
		Helpers:           map[string]Relation{},
		Indexes: RelationIndexes{
			BySource: map[string][]string{},
			ByTarget: map[string][]string{},
		},
	}
	return game
}
