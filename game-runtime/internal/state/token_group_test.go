package state

import (
	"bytes"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

func TestTokenGroupStateValidatesFingerprintMembershipAndDerivedIndex(t *testing.T) {
	game := tokenGroupState()
	group := TokenGroupRuntime{
		GroupID: "opaque-group", RootInstanceID: "t1", OrderedMemberIDs: []string{"t1", "t2"},
		Revision: 1, CreatedByPlayerID: "p1", CreatedAtVersion: 2, EffectVersion: TokenGroupEffectVersion,
	}
	if err := AddTokenGroup(&game, group); err != nil {
		t.Fatal(err)
	}
	if found, ok := game.Relations.TokenGroupForMember("t2"); !ok || found.GroupID != group.GroupID || found.Quantity() != 2 {
		t.Fatalf("member index = %#v, %t", found, ok)
	}
	if err := ValidateInvariants(game); err != nil {
		t.Fatalf("invariants: %v", err)
	}

	encoded, err := json.Marshal(game)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encoded, []byte(`"quantity"`)) {
		t.Fatalf("authoritative snapshot persisted derived quantity: %s", encoded)
	}
	var hydrated GameState
	if err := json.Unmarshal(encoded, &hydrated); err != nil {
		t.Fatal(err)
	}
	NormalizeForRecovery("game-1", &hydrated)
	if err := ValidateInvariants(hydrated); err != nil {
		t.Fatalf("hydrated invariants: %v", err)
	}
	if !reflect.DeepEqual(hydrated.Relations.TokenGroups, game.Relations.TokenGroups) {
		t.Fatalf("snapshot roundtrip groups = %#v", hydrated.Relations.TokenGroups)
	}
}

func TestLegacySnapshotWithoutTokenGroupsHydratesAsEmptyWithoutInference(t *testing.T) {
	game := tokenGroupState()
	game.Relations.TokenGroups = nil
	game.Relations.TokenGroupByMember = nil
	encoded, err := json.Marshal(game)
	if err != nil {
		t.Fatal(err)
	}
	var object map[string]any
	if err := json.Unmarshal(encoded, &object); err != nil {
		t.Fatal(err)
	}
	relations := object["relations"].(map[string]any)
	delete(relations, "tokenGroups")
	legacy, err := json.Marshal(object)
	if err != nil {
		t.Fatal(err)
	}
	var hydrated GameState
	if err := json.Unmarshal(legacy, &hydrated); err != nil {
		t.Fatal(err)
	}
	NormalizeForRecovery("game-1", &hydrated)
	if len(hydrated.Relations.TokenGroups) != 0 || len(hydrated.Relations.TokenGroupByMember) != 0 {
		t.Fatalf("legacy snapshot inferred groups: %#v", hydrated.Relations.TokenGroups)
	}
	if err := ValidateInvariants(hydrated); err != nil {
		t.Fatal(err)
	}
}

func TestTokenGroupSnapshotRejectsUnknownOrAuthoritativeQuantityFields(t *testing.T) {
	game := tokenGroupState()
	group := TokenGroupRuntime{
		GroupID: "g1", RootInstanceID: "t1", OrderedMemberIDs: []string{"t1", "t2"},
		Revision: 1, CreatedByPlayerID: "p1", CreatedAtVersion: 2, EffectVersion: 1,
	}
	if err := AddTokenGroup(&game, group); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(game)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := json.Unmarshal(encoded, &raw); err != nil {
		t.Fatal(err)
	}
	relations := raw["relations"].(map[string]any)
	groups := relations["tokenGroups"].(map[string]any)
	groups["g1"].(map[string]any)["quantity"] = float64(2)
	corrupt, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	var hydrated GameState
	if err := json.Unmarshal(corrupt, &hydrated); err == nil {
		t.Fatal("authoritative quantity was silently accepted")
	}
}

func TestTokenGroupStateRejectsDuplicateRootFingerprintAndRelationConflicts(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*GameState, *TokenGroupRuntime)
		code   string
	}{
		{name: "duplicate", mutate: func(_ *GameState, group *TokenGroupRuntime) { group.OrderedMemberIDs[1] = "t1" }, code: TokenGroupDuplicateMember},
		{name: "root", mutate: func(_ *GameState, group *TokenGroupRuntime) { group.RootInstanceID = "missing" }, code: TokenGroupRootInvalid},
		{name: "fingerprint", mutate: func(game *GameState, _ *TokenGroupRuntime) {
			token := game.Instances["t2"]
			token.Tapped = true
			game.Instances["t2"] = token
		}, code: TokenGroupMemberMismatch},
		{name: "stack", mutate: func(game *GameState, _ *TokenGroupRuntime) {
			game.Relations.BattlefieldStacks["s1"] = BattlefieldStack{ID: "s1", RootInstanceID: "t1", OrderedMemberIDs: []string{"t1", "x"}}
		}, code: TokenGroupRelationConflict},
		{name: "attachment", mutate: func(game *GameState, _ *TokenGroupRuntime) {
			game.Relations.Attachments["a1"] = Relation{ID: "a1", SourceID: "t1", TargetID: "x"}
		}, code: TokenGroupRelationConflict},
		{name: "arrow", mutate: func(game *GameState, _ *TokenGroupRuntime) {
			game.Relations.Arrows["r1"] = Relation{ID: "r1", SourceID: "t1", TargetID: "x"}
		}, code: TokenGroupRelationConflict},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			game := tokenGroupState()
			group := TokenGroupRuntime{GroupID: "g1", RootInstanceID: "t1", OrderedMemberIDs: []string{"t1", "t2"}, Revision: 1, CreatedByPlayerID: "p1", CreatedAtVersion: 2, EffectVersion: 1}
			test.mutate(&game, &group)
			game.Relations.TokenGroups[group.GroupID] = group
			game.Relations.RebuildTokenGroupIndex()
			err := ValidateTokenGroupState(game)
			var groupErr *TokenGroupStateError
			if !errors.As(err, &groupErr) || groupErr.Code != test.code {
				t.Fatalf("err = %v, want %s", err, test.code)
			}
		})
	}

	game := tokenGroupState()
	first := TokenGroupRuntime{GroupID: "g1", RootInstanceID: "t1", OrderedMemberIDs: []string{"t1", "t2"}, Revision: 1, CreatedByPlayerID: "p1", CreatedAtVersion: 2, EffectVersion: 1}
	if err := AddTokenGroup(&game, first); err != nil {
		t.Fatal(err)
	}
	second := TokenGroupRuntime{GroupID: "g2", RootInstanceID: "t2", OrderedMemberIDs: []string{"t2", "t3"}, Revision: 1, CreatedByPlayerID: "p1", CreatedAtVersion: 2, EffectVersion: 1}
	var groupErr *TokenGroupStateError
	if err := AddTokenGroup(&game, second); !errors.As(err, &groupErr) || groupErr.Code != TokenGroupDuplicateMember {
		t.Fatalf("double membership err = %v", err)
	}
}

func tokenGroupState() GameState {
	game := invariantState()
	game.Version = 1
	game.Zones["p1"] = PlayerZones{Battlefield: []string{"t1", "t2", "t3", "x"}}
	game.Instances = map[string]CardInstanceRuntime{}
	game.Loc = map[string]Location{}
	for index, id := range game.Zones["p1"].Battlefield {
		game.Instances[id] = CardInstanceRuntime{
			InstanceID: id, CardKey: "token:treasure", PrintID: "treasure", CardVersion: "v1", Language: "en",
			OwnerID: "p1", ControllerID: "p1", Zone: ZoneBattlefield, IsToken: id != "x",
			TokenMeta: map[string]any{"kind": "treasure"}, Counters: map[string]int{}, MutableStats: map[string]any{},
			Position: map[string]any{"x": 0.5, "y": 0.5, "unit": "ratio"}, VisibleToMask: 1,
		}
		game.Loc[id] = Location{PlayerID: "p1", Zone: ZoneBattlefield, Index: index, ControllerID: "p1"}
	}
	game.Relations = Relations{
		Attachments: map[string]Relation{}, BattlefieldStacks: map[string]BattlefieldStack{}, TokenGroups: map[string]TokenGroupRuntime{},
		Arrows: map[string]Relation{}, Helpers: map[string]Relation{}, TokenGroupByMember: map[string]string{},
		Indexes: RelationIndexes{BySource: map[string][]string{}, ByTarget: map[string][]string{}},
	}
	return game
}
