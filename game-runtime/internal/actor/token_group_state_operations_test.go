package actor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sort"
	"testing"

	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

func TestTokenGroupSplitMergeRemoveDissolveReplayAndRetry(t *testing.T) {
	initial := testState()
	state.NormalizeForRecovery("game-1", &initial)
	store := persistence.NewInMemoryEventStore()
	gameActor := NewGameActor("game-1", initial.Clone(), store, 8, DefaultAppliers())
	create := tokenCreationCommand(20)
	create.ClientActionID = "group-create-20"
	created := gameActor.ApplyDirect(context.Background(), create, "p1")
	if created.Err != nil {
		t.Fatal(created.Err)
	}
	group := onlyTokenGroup(t, gameActor.Snapshot())

	split := command("game-1", 2, "group-split-10", "token.group.split", map[string]any{
		"groupId": group.GroupID, "expectedRevision": 1, "extractQuantity": 10,
		"destinationPosition": map[string]any{"unit": "ratio", "x": 0.7, "y": 0.4},
	})
	splitResult := gameActor.ApplyDirect(context.Background(), split, "p1")
	if splitResult.Err != nil {
		t.Fatal(splitResult.Err)
	}
	afterSplit := gameActor.Snapshot()
	if len(afterSplit.Relations.TokenGroups) != 2 {
		t.Fatalf("split groups = %d", len(afterSplit.Relations.TokenGroups))
	}
	original := afterSplit.Relations.TokenGroups[group.GroupID]
	if original.Quantity() != 10 || original.Revision != 2 || original.RootInstanceID != group.RootInstanceID {
		t.Fatalf("original after split = %#v", original)
	}
	var extracted state.TokenGroupRuntime
	for id, candidate := range afterSplit.Relations.TokenGroups {
		if id != group.GroupID {
			extracted = candidate
		}
	}
	if extracted.Quantity() != 10 || extracted.Revision != 1 || extracted.RootInstanceID != group.OrderedMemberIDs[10] {
		t.Fatalf("new split group = %#v", extracted)
	}
	for _, id := range extracted.OrderedMemberIDs {
		if afterSplit.Instances[id].Position["x"] != 0.7 {
			t.Fatalf("split position mismatch: %#v", afterSplit.Instances[id].Position)
		}
	}

	retry := gameActor.ApplyDirect(context.Background(), split, "p1")
	if retry.Err != nil || retry.Event.Version != splitResult.Event.Version || !reflect.DeepEqual(retry.Event.Payload, splitResult.Event.Payload) {
		t.Fatalf("split retry changed receipt: %#v / %v", retry.Event, retry.Err)
	}

	merge := command("game-1", 3, "group-merge", "token.group.merge", map[string]any{
		"sourceGroupIds": []string{group.GroupID, extracted.GroupID}, "sourceInstanceIds": []string{},
		"targetGroupId": group.GroupID, "expectedRevisions": map[string]any{group.GroupID: 2, extracted.GroupID: 1},
		"destinationPosition": map[string]any{"unit": "ratio", "x": 0.5, "y": 0.5},
	})
	mergedResult := gameActor.ApplyDirect(context.Background(), merge, "p1")
	if mergedResult.Err != nil {
		t.Fatal(mergedResult.Err)
	}
	merged := onlyTokenGroup(t, gameActor.Snapshot())
	if merged.GroupID != group.GroupID || merged.Quantity() != 20 || merged.Revision != 3 || merged.RootInstanceID != group.RootInstanceID {
		t.Fatalf("merged = %#v", merged)
	}

	remove := command("game-1", 4, "group-remove-19", "token.group.remove_members", map[string]any{
		"groupId": merged.GroupID, "expectedRevision": 3, "quantity": 19, "removalReason": "manual",
	})
	removed := gameActor.ApplyDirect(context.Background(), remove, "p1")
	if removed.Err != nil {
		t.Fatal(removed.Err)
	}
	afterRemove := gameActor.Snapshot()
	if len(afterRemove.Relations.TokenGroups) != 0 || len(afterRemove.Zones["p1"].Battlefield) != 2 {
		t.Fatalf("remove leaving one mismatch: groups=%#v battlefield=%#v", afterRemove.Relations.TokenGroups, afterRemove.Zones["p1"].Battlefield)
	}

	events, err := store.EventsAfter(context.Background(), "game-1", 1)
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := ReplayEvents(initial.Clone(), events, DefaultAppliers())
	if err != nil {
		t.Fatal(err)
	}
	live := gameActor.Snapshot()
	live.Stack = replayed.Stack
	if !reflect.DeepEqual(live, replayed) {
		t.Fatalf("mutation replay mismatch\nlive=%#v\nreplayed=%#v", live, replayed)
	}
}

func TestTokenGroupSeparateOneAndDissolve(t *testing.T) {
	gameActor, group := actorWithTokenGroup(t, 3, "separate-create")
	separate := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "separate-one", "token.group.split", map[string]any{
		"groupId": group.GroupID, "expectedRevision": 1, "extractQuantity": 1,
		"destinationPosition": map[string]any{"unit": "ratio", "x": 0.8, "y": 0.2},
	}), "p1")
	if separate.Err != nil {
		t.Fatal(separate.Err)
	}
	after := gameActor.Snapshot()
	remaining := onlyTokenGroup(t, after)
	if remaining.Quantity() != 2 || remaining.Revision != 2 {
		t.Fatalf("separate result = %#v", remaining)
	}
	if _, grouped := after.Relations.TokenGroupForMember(group.OrderedMemberIDs[2]); grouped {
		t.Fatal("separated member remained grouped")
	}

	dissolve := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "dissolve-two", "token.group.dissolve", map[string]any{
		"groupId": remaining.GroupID, "expectedRevision": 2,
	}), "p1")
	if dissolve.Err != nil {
		t.Fatal(dissolve.Err)
	}
	after = gameActor.Snapshot()
	if len(after.Relations.TokenGroups) != 0 || len(after.Relations.TokenGroupByMember) != 0 {
		t.Fatalf("dissolve left indexes: %#v", after.Relations)
	}
	if reflect.DeepEqual(after.Instances[remaining.OrderedMemberIDs[0]].Position, after.Instances[remaining.OrderedMemberIDs[1]].Position) {
		t.Fatal("deterministic dissolve did not separate positions")
	}
}

func TestTokenGroupSplitMatrixAndDeterministicRootPreservation(t *testing.T) {
	tests := []struct {
		name, actionID                          string
		quantity, extract, remaining, extracted int
	}{
		{name: "two_to_singles", actionID: "split-two", quantity: 2, extract: 1, remaining: 1, extracted: 1},
		{name: "ten_to_seven_three", actionID: "split-ten", quantity: 10, extract: 3, remaining: 7, extracted: 3},
		{name: "twenty_to_ten_ten", actionID: "split-twenty", quantity: 20, extract: 10, remaining: 10, extracted: 10},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gameActor, before := actorWithTokenGroup(t, tt.quantity, tt.actionID)
			result := gameActor.ApplyDirect(context.Background(), command("game-1", 2, tt.actionID+"-command", "token.group.split", map[string]any{
				"groupId": before.GroupID, "expectedRevision": 1, "extractQuantity": tt.extract,
				"destinationPosition": map[string]any{"unit": "ratio", "x": .75, "y": .25},
			}), "p1")
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			after := gameActor.Snapshot()
			if tt.remaining == 1 {
				if len(after.Relations.TokenGroups) != 0 {
					t.Fatalf("2 -> 1+1 retained groups: %#v", after.Relations.TokenGroups)
				}
				return
			}
			original := after.Relations.TokenGroups[before.GroupID]
			if original.Quantity() != tt.remaining || original.RootInstanceID != before.RootInstanceID || original.Revision != 2 {
				t.Fatalf("original=%#v", original)
			}
			if tt.extracted >= 2 && len(after.Relations.TokenGroups) != 2 {
				t.Fatalf("group count=%d", len(after.Relations.TokenGroups))
			}
		})
	}
}

func TestTokenGroupMergeSinglesAndLimit(t *testing.T) {
	gameActor, group := actorWithTokenGroup(t, 2, "merge-base")
	before := gameActor.Snapshot()
	// Dissolve creates two compatible independent instances without changing their state.
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "dissolve-merge", "token.group.dissolve", map[string]any{"groupId": group.GroupID, "expectedRevision": 1}), "p1")
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	merge := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "merge-singles", "token.group.merge", map[string]any{
		"sourceGroupIds": []string{}, "sourceInstanceIds": group.OrderedMemberIDs, "expectedRevisions": map[string]any{},
		"destinationPosition": map[string]any{"unit": "ratio", "x": 0.4, "y": 0.4},
	}), "p1")
	if merge.Err != nil {
		t.Fatal(merge.Err)
	}
	merged := onlyTokenGroup(t, gameActor.Snapshot())
	if merged.Quantity() != 2 || merged.Revision != 1 || merged.GroupID == group.GroupID {
		t.Fatalf("merge singles = %#v", merged)
	}
	if before.Version+2 != gameActor.Snapshot().Version {
		t.Fatal("merge did not use one version")
	}
}

func TestTokenGroupMergeGroupSingleAndRejectsOverTwenty(t *testing.T) {
	gameActor, group := actorWithTokenGroup(t, 2, "merge-group-single")
	singleCreate := tokenCreationCommand(1)
	singleCreate.BaseVersion = 2
	singleCreate.ClientActionID = "merge-single"
	singleResult := gameActor.ApplyDirect(context.Background(), singleCreate, "p1")
	if singleResult.Err != nil {
		t.Fatal(singleResult.Err)
	}
	singleID := singleResult.Event.Payload["instanceIds"].([]string)[0]
	mergedResult := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "merge-group-and-single", "token.group.merge", map[string]any{
		"sourceGroupIds": []string{group.GroupID}, "sourceInstanceIds": []string{singleID},
		"expectedRevisions":   map[string]any{group.GroupID: 1},
		"destinationPosition": map[string]any{"unit": "ratio", "x": .6, "y": .6},
	}), "p1")
	if mergedResult.Err != nil {
		t.Fatal(mergedResult.Err)
	}
	merged := onlyTokenGroup(t, gameActor.Snapshot())
	if merged.Quantity() != 3 || merged.GroupID != group.GroupID || merged.Revision != 2 || merged.OrderedMemberIDs[2] != singleID {
		t.Fatalf("group+single=%#v", merged)
	}

	largeActor, large := actorWithTokenGroup(t, 20, "merge-limit-group")
	one := tokenCreationCommand(1)
	one.BaseVersion = 2
	one.ClientActionID = "merge-limit-single"
	oneResult := largeActor.ApplyDirect(context.Background(), one, "p1")
	if oneResult.Err != nil {
		t.Fatal(oneResult.Err)
	}
	before := largeActor.Snapshot()
	rejected := largeActor.ApplyDirect(context.Background(), command("game-1", 3, "merge-over-limit", "token.group.merge", map[string]any{
		"sourceGroupIds": []string{large.GroupID}, "sourceInstanceIds": oneResult.Event.Payload["instanceIds"].([]string),
		"expectedRevisions":   map[string]any{large.GroupID: 1},
		"destinationPosition": map[string]any{"unit": "ratio", "x": .5, "y": .5},
	}), "p1")
	var groupErr *state.TokenGroupStateError
	if !errors.As(rejected.Err, &groupErr) || groupErr.Code != state.TokenGroupQuantityInvalid {
		t.Fatalf("merge limit error=%v", rejected.Err)
	}
	if !reflect.DeepEqual(before, largeActor.Snapshot()) {
		t.Fatal("merge limit rejection mutated state")
	}
}

func TestTokenGroupUniformStatePositionAndIndividualDivergence(t *testing.T) {
	gameActor, group := actorWithTokenGroup(t, 3, "uniform-create")
	tapped := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "tap-group", "token.group.state.set", map[string]any{"groupId": group.GroupID, "expectedRevision": 1, "tapped": true}), "p1")
	if tapped.Err != nil {
		t.Fatal(tapped.Err)
	}
	group = onlyTokenGroup(t, gameActor.Snapshot())
	if group.Revision != 2 {
		t.Fatalf("tap revision=%d", group.Revision)
	}
	for _, id := range group.OrderedMemberIDs {
		instance := gameActor.Snapshot().Instances[id]
		if !instance.Tapped || instance.Rotation != 90 {
			t.Fatalf("not uniformly tapped: %#v", instance)
		}
	}

	hidden := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "hide-group", "token.group.state.set", map[string]any{"groupId": group.GroupID, "expectedRevision": 2, "faceDown": true}), "p1")
	if hidden.Err != nil {
		t.Fatal(hidden.Err)
	}
	group = onlyTokenGroup(t, gameActor.Snapshot())
	if group.Revision != 3 {
		t.Fatalf("faceDown revision=%d", group.Revision)
	}
	stateEntries, err := tokenGroupPositionList(hidden.Event.Payload["instanceStates"])
	if err != nil || len(stateEntries) != group.Quantity() {
		t.Fatalf("faceDown final states=%#v err=%v", stateEntries, err)
	}
	for _, entry := range stateEntries {
		revealedTo, ok := entry["revealedTo"].([]string)
		if !ok || len(revealedTo) != 0 {
			t.Fatalf("faceDown final audience=%#v", entry["revealedTo"])
		}
	}
	assertNoCanonicalTokenGroupLeak(t, hidden.Patches, group, "p2")

	positioned := gameActor.ApplyDirect(context.Background(), command("game-1", 4, "position-group", "token.group.position.set", map[string]any{"groupId": group.GroupID, "expectedRevision": 3, "position": map[string]any{"unit": "ratio", "x": 0.9, "y": 0.1}}), "p1")
	if positioned.Err != nil {
		t.Fatal(positioned.Err)
	}
	group = onlyTokenGroup(t, gameActor.Snapshot())
	if group.Revision != 4 {
		t.Fatalf("position revision=%d", group.Revision)
	}

	before := gameActor.Snapshot()
	rejected := gameActor.ApplyDirect(context.Background(), command("game-1", 5, "tap-one", "card.tapped", map[string]any{"instanceId": group.OrderedMemberIDs[1], "tapped": false}), "p1")
	var groupErr *state.TokenGroupStateError
	if !errors.As(rejected.Err, &groupErr) || groupErr.Code != state.TokenGroupMemberRequiresSplit {
		t.Fatalf("individual mutation error=%v", rejected.Err)
	}
	if !reflect.DeepEqual(before, gameActor.Snapshot()) {
		t.Fatal("rejected divergence mutated state")
	}

	stale := gameActor.ApplyDirect(context.Background(), command("game-1", 5, "stale-group", "token.group.dissolve", map[string]any{"groupId": group.GroupID, "expectedRevision": 3}), "p1")
	if !errors.As(stale.Err, &groupErr) || groupErr.Code != state.TokenGroupStale {
		t.Fatalf("stale error=%v", stale.Err)
	}
}

func TestTokenGroupUntapAllMoveNoOpAndRelationConflicts(t *testing.T) {
	gameActor, group := actorWithTokenGroup(t, 3, "group-uniform-extra")
	tapped := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "tap-extra", "token.group.state.set", map[string]any{
		"groupId": group.GroupID, "expectedRevision": 1, "tapped": true,
	}), "p1")
	if tapped.Err != nil {
		t.Fatal(tapped.Err)
	}
	noop := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "tap-noop", "token.group.state.set", map[string]any{
		"groupId": group.GroupID, "expectedRevision": 2, "tapped": true,
	}), "p1")
	var groupErr *state.TokenGroupStateError
	if !errors.As(noop.Err, &groupErr) || groupErr.Code != state.TokenGroupPatchConflict || gameActor.Snapshot().Version != 3 {
		t.Fatalf("no-op contract error=%v version=%d", noop.Err, gameActor.Snapshot().Version)
	}
	untapped := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "untap-all-group", "battlefield.untap_all", map[string]any{"playerId": "p1"}), "p1")
	if untapped.Err != nil {
		t.Fatal(untapped.Err)
	}
	group = onlyTokenGroup(t, gameActor.Snapshot())
	if group.Revision != 3 {
		t.Fatalf("untap all group revision=%d", group.Revision)
	}
	for _, memberID := range group.OrderedMemberIDs {
		instance := gameActor.Snapshot().Instances[memberID]
		if instance.Tapped || instance.Rotation != 0 {
			t.Fatalf("untap all left member tapped: %#v", instance)
		}
	}

	for _, relationCommand := range []protocol.CommandEnvelopeV2{
		command("game-1", 4, "group-arrow", "arrow.created", map[string]any{"fromInstanceId": group.OrderedMemberIDs[0], "toInstanceId": "bf-1"}),
		command("game-1", 4, "group-attachment", "attachment.created", map[string]any{"equipmentInstanceId": group.OrderedMemberIDs[0], "attachedToInstanceId": "bf-1"}),
	} {
		before := gameActor.Snapshot()
		result := gameActor.ApplyDirect(context.Background(), relationCommand, "p1")
		if !errors.As(result.Err, &groupErr) || groupErr.Code != state.TokenGroupRelationConflict {
			t.Fatalf("relation conflict %s error=%v", relationCommand.Type, result.Err)
		}
		if !reflect.DeepEqual(before, gameActor.Snapshot()) {
			t.Fatalf("relation conflict %s mutated state", relationCommand.Type)
		}
	}

	move := gameActor.ApplyDirect(context.Background(), command("game-1", 4, "move-token-group", "token.group.move", map[string]any{
		"groupId": group.GroupID, "expectedRevision": 3, "toZone": "graveyard",
	}), "p1")
	if move.Err != nil {
		t.Fatal(move.Err)
	}
	after := gameActor.Snapshot()
	if len(after.Relations.TokenGroups) != 0 {
		t.Fatalf("move retained group: %#v", after.Relations.TokenGroups)
	}
	for _, memberID := range group.OrderedMemberIDs {
		if _, exists := after.Instances[memberID]; exists {
			t.Fatalf("moved token did not evaporate: %s", memberID)
		}
		if _, exists := after.Loc[memberID]; exists {
			t.Fatalf("moved token retained loc: %s", memberID)
		}
	}
}

func TestTokenGroupAppendFailureRollsBackGraphAndInstances(t *testing.T) {
	seed, group := actorWithTokenGroup(t, 3, "rollback-create")
	initial := seed.Snapshot()
	store := &tokenFailOnceStore{delegate: persistence.NewInMemoryEventStore(), err: errors.New("append failed")}
	gameActor := NewGameActor("game-1", initial.Clone(), store, 8, DefaultAppliers())
	failed := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "rollback-split", "token.group.split", map[string]any{
		"groupId": group.GroupID, "expectedRevision": 1, "extractQuantity": 1,
		"destinationPosition": map[string]any{"unit": "ratio", "x": 0.8, "y": 0.8},
	}), "p1")
	if failed.Err == nil {
		t.Fatal("expected append failure")
	}
	if !reflect.DeepEqual(initial, gameActor.Snapshot()) {
		t.Fatal("creation rollback left group residue")
	}
}

func TestTokenGroupMergePreservesRelationConflictCategory(t *testing.T) {
	initial := testState()
	state.NormalizeForRecovery("game-1", &initial)
	gameActor := NewGameActor("game-1", initial, nil, 8, DefaultAppliers())
	for index, actionID := range []string{"merge-conflict-token-a", "merge-conflict-token-b"} {
		create := tokenCreationCommand(1)
		create.BaseVersion = int64(index + 1)
		create.ClientActionID = actionID
		if result := gameActor.ApplyDirect(context.Background(), create, "p1"); result.Err != nil {
			t.Fatal(result.Err)
		}
	}
	tokenIDs := make([]string, 0, 2)
	for instanceID, instance := range gameActor.Snapshot().Instances {
		if instance.IsToken {
			tokenIDs = append(tokenIDs, instanceID)
		}
	}
	if len(tokenIDs) != 2 {
		t.Fatalf("token count=%d", len(tokenIDs))
	}
	sort.Strings(tokenIDs)
	arrow := command("game-1", 3, "merge-conflict-arrow", "arrow.created", map[string]any{
		"fromInstanceId": tokenIDs[0], "toInstanceId": "i1",
	})
	if result := gameActor.ApplyDirect(context.Background(), arrow, "p1"); result.Err != nil {
		t.Fatal(result.Err)
	}
	before := gameActor.Snapshot()
	merge := command("game-1", 4, "merge-conflict", "token.group.merge", map[string]any{
		"sourceInstanceIds":   tokenIDs,
		"expectedRevisions":   map[string]any{},
		"destinationPosition": map[string]any{"unit": "ratio", "x": 0.5, "y": 0.5},
	})
	result := gameActor.ApplyDirect(context.Background(), merge, "p1")
	var groupErr *state.TokenGroupStateError
	if !errors.As(result.Err, &groupErr) || groupErr.Code != state.TokenGroupRelationConflict {
		t.Fatalf("merge relation conflict error=%v", result.Err)
	}
	if !reflect.DeepEqual(before, gameActor.Snapshot()) {
		t.Fatal("merge relation conflict mutated state")
	}
}

func TestTokenGroupReplayAppliesPersistedRootPromotion(t *testing.T) {
	gameActor, group := actorWithTokenGroup(t, 4, "root-promotion-create")
	initial := gameActor.Snapshot()
	promoted := group.Clone()
	promoted.OrderedMemberIDs = append([]string(nil), group.OrderedMemberIDs[1:]...)
	promoted.RootInstanceID = promoted.OrderedMemberIDs[0]
	promoted.Revision++
	event := protocol.EventPayloadV2{
		GameID: "game-1", Version: initial.Version + 1, Type: "token.group.members.removed",
		CreatedBy: "p1", ClientActionID: "root-promotion-effect",
		Payload: map[string]any{
			"effectVersion":      1,
			"actorPlayerId":      "p1",
			"removedGroupIds":    []string{group.GroupID},
			"removedInstanceIds": []string{group.RootInstanceID},
			"resultingGroups":    []map[string]any{tokenGroupEvent(promoted)},
		},
	}
	replayed, err := ReplayEvents(initial, []protocol.EventPayloadV2{event}, DefaultAppliers())
	if err != nil {
		t.Fatal(err)
	}
	actual := onlyTokenGroup(t, replayed)
	if actual.RootInstanceID != promoted.RootInstanceID || actual.Revision != promoted.Revision || !reflect.DeepEqual(actual.OrderedMemberIDs, promoted.OrderedMemberIDs) {
		t.Fatalf("root promotion replay=%#v want=%#v", actual, promoted)
	}
	if _, exists := replayed.Instances[group.RootInstanceID]; exists {
		t.Fatal("removed root instance survived replay")
	}
}

func BenchmarkTokenGroupStateOperations(b *testing.B) {
	type benchmarkCase struct {
		quantity int
		prepare  func(*testing.B, *GameActor, state.TokenGroupRuntime) protocol.CommandEnvelopeV2
	}
	position := map[string]any{"unit": "ratio", "x": .7, "y": .3}
	cases := map[string]benchmarkCase{
		"split_20_to_19_1": {20, func(_ *testing.B, _ *GameActor, group state.TokenGroupRuntime) protocol.CommandEnvelopeV2 {
			return command("game-1", 2, "bench-split-1", "token.group.split", map[string]any{"groupId": group.GroupID, "expectedRevision": 1, "extractQuantity": 1, "destinationPosition": position})
		}},
		"split_20_to_10_10": {20, func(_ *testing.B, _ *GameActor, group state.TokenGroupRuntime) protocol.CommandEnvelopeV2 {
			return command("game-1", 2, "bench-split-10", "token.group.split", map[string]any{"groupId": group.GroupID, "expectedRevision": 1, "extractQuantity": 10, "destinationPosition": position})
		}},
		"remove_1_of_20": {20, func(_ *testing.B, _ *GameActor, group state.TokenGroupRuntime) protocol.CommandEnvelopeV2 {
			return command("game-1", 2, "bench-remove-1", "token.group.remove_members", map[string]any{"groupId": group.GroupID, "expectedRevision": 1, "quantity": 1})
		}},
		"remove_19_of_20": {20, func(_ *testing.B, _ *GameActor, group state.TokenGroupRuntime) protocol.CommandEnvelopeV2 {
			return command("game-1", 2, "bench-remove-19", "token.group.remove_members", map[string]any{"groupId": group.GroupID, "expectedRevision": 1, "quantity": 19})
		}},
		"remove_20_of_20": {20, func(_ *testing.B, _ *GameActor, group state.TokenGroupRuntime) protocol.CommandEnvelopeV2 {
			return command("game-1", 2, "bench-remove-20", "token.group.remove_members", map[string]any{"groupId": group.GroupID, "expectedRevision": 1, "quantity": 20})
		}},
		"dissolve_2": {2, func(_ *testing.B, _ *GameActor, group state.TokenGroupRuntime) protocol.CommandEnvelopeV2 {
			return command("game-1", 2, "bench-dissolve-2", "token.group.dissolve", map[string]any{"groupId": group.GroupID, "expectedRevision": 1})
		}},
		"dissolve_10": {10, func(_ *testing.B, _ *GameActor, group state.TokenGroupRuntime) protocol.CommandEnvelopeV2 {
			return command("game-1", 2, "bench-dissolve-10", "token.group.dissolve", map[string]any{"groupId": group.GroupID, "expectedRevision": 1})
		}},
		"dissolve_20": {20, func(_ *testing.B, _ *GameActor, group state.TokenGroupRuntime) protocol.CommandEnvelopeV2 {
			return command("game-1", 2, "bench-dissolve-20", "token.group.dissolve", map[string]any{"groupId": group.GroupID, "expectedRevision": 1})
		}},
		"tap_20": {20, func(_ *testing.B, _ *GameActor, group state.TokenGroupRuntime) protocol.CommandEnvelopeV2 {
			return command("game-1", 2, "bench-tap-20", "token.group.state.set", map[string]any{"groupId": group.GroupID, "expectedRevision": 1, "tapped": true})
		}},
		"face_down_20": {20, func(_ *testing.B, _ *GameActor, group state.TokenGroupRuntime) protocol.CommandEnvelopeV2 {
			return command("game-1", 2, "bench-face-down-20", "token.group.state.set", map[string]any{"groupId": group.GroupID, "expectedRevision": 1, "faceDown": true})
		}},
		"position_20": {20, func(_ *testing.B, _ *GameActor, group state.TokenGroupRuntime) protocol.CommandEnvelopeV2 {
			return command("game-1", 2, "bench-position-20", "token.group.position.set", map[string]any{"groupId": group.GroupID, "expectedRevision": 1, "position": position})
		}},
	}
	for name, benchmark := range cases {
		benchmark := benchmark
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for iteration := 0; iteration < b.N; iteration++ {
				b.StopTimer()
				gameActor, group := benchmarkTokenGroupActor(b, benchmark.quantity, name)
				cmd := benchmark.prepare(b, gameActor, group)
				b.StartTimer()
				result := gameActor.ApplyDirect(context.Background(), cmd, "p1")
				b.StopTimer()
				if result.Err != nil {
					b.Fatal(result.Err)
				}
				if iteration == 0 {
					eventBytes, _ := json.Marshal(result.Event.Payload)
					patchBytes, _ := json.Marshal(result.Patches)
					if len(eventBytes) >= 64*1024 || len(patchBytes) >= 64*1024 {
						b.Fatalf("payload budget exceeded: event=%d patch=%d", len(eventBytes), len(patchBytes))
					}
					b.ReportMetric(float64(len(eventBytes)), "event_bytes")
					b.ReportMetric(float64(len(patchBytes)), "patch_bytes")
				}
				b.StartTimer()
			}
		})
	}
}

func BenchmarkTokenGroupMerge(b *testing.B) {
	for _, extractQuantity := range []int{10, 1} {
		name := "10_plus_10"
		if extractQuantity == 1 {
			name = "19_plus_single"
		}
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for iteration := 0; iteration < b.N; iteration++ {
				b.StopTimer()
				gameActor, initialGroup := benchmarkTokenGroupActor(b, 20, "merge-"+name)
				split := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "benchmark-pre-split-"+name, "token.group.split", map[string]any{
					"groupId": initialGroup.GroupID, "expectedRevision": 1, "extractQuantity": extractQuantity,
					"destinationPosition": map[string]any{"unit": "ratio", "x": .7, "y": .3},
				}), "p1")
				if split.Err != nil {
					b.Fatal(split.Err)
				}
				snapshot := gameActor.Snapshot()
				original := snapshot.Relations.TokenGroups[initialGroup.GroupID]
				groupIDs := []string{original.GroupID}
				expected := map[string]any{original.GroupID: original.Revision}
				singleIDs := []string{}
				for groupID, group := range snapshot.Relations.TokenGroups {
					if groupID != original.GroupID {
						groupIDs = append(groupIDs, groupID)
						expected[groupID] = group.Revision
					}
				}
				if extractQuantity == 1 {
					singleIDs = []string{initialGroup.OrderedMemberIDs[len(initialGroup.OrderedMemberIDs)-1]}
				}
				merge := command("game-1", 3, "benchmark-merge-"+name, "token.group.merge", map[string]any{
					"sourceGroupIds": groupIDs, "sourceInstanceIds": singleIDs, "targetGroupId": original.GroupID,
					"expectedRevisions": expected, "destinationPosition": map[string]any{"unit": "ratio", "x": .5, "y": .5},
				})
				b.StartTimer()
				result := gameActor.ApplyDirect(context.Background(), merge, "p1")
				b.StopTimer()
				if result.Err != nil {
					b.Fatal(result.Err)
				}
				if iteration == 0 {
					eventBytes, _ := json.Marshal(result.Event.Payload)
					patchBytes, _ := json.Marshal(result.Patches)
					if len(eventBytes) >= 64*1024 || len(patchBytes) >= 64*1024 {
						b.Fatalf("payload budget exceeded: event=%d patch=%d", len(eventBytes), len(patchBytes))
					}
					b.ReportMetric(float64(len(eventBytes)), "event_bytes")
					b.ReportMetric(float64(len(patchBytes)), "patch_bytes")
				}
				b.StartTimer()
			}
		})
	}
}

func benchmarkTokenGroupActor(b *testing.B, quantity int, actionID string) (*GameActor, state.TokenGroupRuntime) {
	b.Helper()
	initial := testState()
	state.NormalizeForRecovery("game-1", &initial)
	gameActor := NewGameActor("game-1", initial, nil, 8, DefaultAppliers())
	create := tokenCreationCommand(quantity)
	create.ClientActionID = "benchmark-create-" + actionID
	result := gameActor.ApplyDirect(context.Background(), create, "p1")
	if result.Err != nil {
		b.Fatal(result.Err)
	}
	for _, group := range gameActor.Snapshot().Relations.TokenGroups {
		return gameActor, group
	}
	b.Fatal("benchmark TokenGroup was not created")
	return nil, state.TokenGroupRuntime{}
}

func actorWithTokenGroup(t *testing.T, quantity int, actionID string) (*GameActor, state.TokenGroupRuntime) {
	t.Helper()
	initial := testState()
	state.NormalizeForRecovery("game-1", &initial)
	gameActor := NewGameActor("game-1", initial, nil, 8, DefaultAppliers())
	create := tokenCreationCommand(quantity)
	create.ClientActionID = actionID
	result := gameActor.ApplyDirect(context.Background(), create, "p1")
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	return gameActor, onlyTokenGroup(t, gameActor.Snapshot())
}

func onlyTokenGroup(t *testing.T, game state.GameState) state.TokenGroupRuntime {
	t.Helper()
	if len(game.Relations.TokenGroups) != 1 {
		t.Fatalf("groups=%d, want 1", len(game.Relations.TokenGroups))
	}
	for _, group := range game.Relations.TokenGroups {
		return group
	}
	return state.TokenGroupRuntime{}
}

func assertNoCanonicalTokenGroupLeak(t *testing.T, patches []protocol.PatchEnvelopeV2, group state.TokenGroupRuntime, viewer string) {
	t.Helper()
	set := patchForVisibility(patches, protocol.PlayerVisibility(viewer), "token.group.set")
	if set == nil {
		t.Fatal("missing projected token.group.set")
	}
	encoded, _ := jsonMarshal(set)
	for _, canonical := range append([]string{group.GroupID}, group.OrderedMemberIDs...) {
		if bytesContains(encoded, []byte(canonical)) {
			t.Fatalf("canonical token group identity leaked to %s: %s", viewer, encoded)
		}
	}
}

func jsonMarshal(value any) ([]byte, error)   { return json.Marshal(value) }
func bytesContains(value, needle []byte) bool { return bytes.Contains(value, needle) }
