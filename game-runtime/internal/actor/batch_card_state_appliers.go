package actor

import (
	"context"
	"fmt"
	"sort"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

const batchCardStateEffectVersion = 1

type CardsTappedSetApplier struct{}

func (CardsTappedSetApplier) Type() string { return "cards.tapped.set" }

func (CardsTappedSetApplier) Apply(ctx context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	instanceIDs, err := requiredBatchInstanceIDs(command)
	if err != nil {
		return nil, err
	}
	tapped, ok := boolField(command.Payload, "tapped")
	if !ok {
		return nil, fmt.Errorf("%w: tapped", ErrInvalidPayloadField)
	}

	for _, instanceID := range instanceIDs {
		single := command
		single.Type = "card.tapped"
		single.Payload = cloneMap(command.Payload)
		single.Payload["instanceId"] = instanceID
		if _, err := (CardTappedApplier{}).Apply(ctx, game, single, emitter); err != nil {
			return nil, err
		}
	}

	return map[string]any{
		"effectVersion": batchCardStateEffectVersion,
		"playerId":      optionalString(command.Payload, "playerId"),
		"zone":          "battlefield",
		"instanceIds":   append([]string(nil), instanceIDs...),
		"count":         len(instanceIDs),
		"tapped":        tapped,
		"actorPlayerId": actorPlayerID(command),
	}, nil
}

type CardsFaceDownSetApplier struct{}

func (CardsFaceDownSetApplier) Type() string { return "cards.face_down.set" }

func (CardsFaceDownSetApplier) Apply(ctx context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	instanceIDs, err := requiredBatchInstanceIDs(command)
	if err != nil {
		return nil, err
	}
	faceDown, ok := boolField(command.Payload, "faceDown")
	if !ok {
		return nil, fmt.Errorf("%w: faceDown", ErrInvalidPayloadField)
	}
	affectedGroups, err := completeTokenGroupsForBatch(game, instanceIDs)
	if err != nil {
		return nil, err
	}
	previousProjections := captureTokenGroupProjections(game, affectedGroups)

	for _, instanceID := range instanceIDs {
		single := command
		single.Type = "card.face_down.changed"
		single.Payload = cloneMap(command.Payload)
		single.Payload["instanceId"] = instanceID
		if _, err := (CardFaceDownChangedApplier{}).Apply(ctx, game, single, emitter); err != nil {
			return nil, err
		}
	}
	emitTokenGroupProjectionRefresh(emitter, game, affectedGroups, previousProjections)

	return map[string]any{
		"effectVersion": batchCardStateEffectVersion,
		"playerId":      optionalString(command.Payload, "playerId"),
		"zone":          "battlefield",
		"instanceIds":   append([]string(nil), instanceIDs...),
		"count":         len(instanceIDs),
		"faceDown":      faceDown,
		"actorPlayerId": actorPlayerID(command),
	}, nil
}

func completeTokenGroupsForBatch(game *state.GameState, instanceIDs []string) ([]state.TokenGroupRuntime, error) {
	requested := make(map[string]struct{}, len(instanceIDs))
	for _, instanceID := range instanceIDs {
		requested[instanceID] = struct{}{}
	}
	groupIDs := map[string]struct{}{}
	for _, instanceID := range instanceIDs {
		if group, grouped := game.Relations.TokenGroupForMember(instanceID); grouped {
			groupIDs[group.GroupID] = struct{}{}
		}
	}
	orderedGroupIDs := make([]string, 0, len(groupIDs))
	for groupID := range groupIDs {
		orderedGroupIDs = append(orderedGroupIDs, groupID)
	}
	sort.Strings(orderedGroupIDs)
	groups := make([]state.TokenGroupRuntime, 0, len(orderedGroupIDs))
	for _, groupID := range orderedGroupIDs {
		group := game.Relations.TokenGroups[groupID]
		for index, memberID := range group.OrderedMemberIDs {
			if _, included := requested[memberID]; !included {
				return nil, &state.TokenGroupStateError{Code: state.TokenGroupMemberMismatch, Count: group.Quantity(), InvalidIndex: index}
			}
		}
		groups = append(groups, group.Clone())
	}
	return groups, nil
}

func captureTokenGroupProjections(game *state.GameState, groups []state.TokenGroupRuntime) map[string]map[string]map[string]any {
	projections := make(map[string]map[string]map[string]any, len(groups))
	viewerIDs := sortedPlayerIDs(game)
	for _, group := range groups {
		byViewer := make(map[string]map[string]any, len(viewerIDs))
		for _, viewerID := range viewerIDs {
			if projected, visible := projectTokenGroupForViewer(game, group, viewerID); visible {
				byViewer[viewerID] = projected
			}
		}
		projections[group.GroupID] = byViewer
	}
	return projections
}

func emitTokenGroupProjectionRefresh(
	emitter *PatchEmitter,
	game *state.GameState,
	groups []state.TokenGroupRuntime,
	previous map[string]map[string]map[string]any,
) {
	for _, groupBefore := range groups {
		group, exists := game.Relations.TokenGroups[groupBefore.GroupID]
		if !exists {
			continue
		}
		for _, viewerID := range sortedPlayerIDs(game) {
			projected, visible := projectTokenGroupForViewer(game, group, viewerID)
			if !visible {
				continue
			}
			prior := previous[group.GroupID][viewerID]
			if prior != nil && prior["groupId"] == projected["groupId"] {
				emitter.EmitPrivate(viewerID, protocol.PatchOp{Op: "token.group.remove", Data: map[string]any{
					"groupId":  prior["groupId"],
					"revision": group.Revision,
					"reason":   "projection_changed",
				}})
			}
			emitter.EmitPrivate(viewerID, protocol.PatchOp{Op: "token.group.set", Data: map[string]any{"group": projected}})
		}
	}
}

func sortedPlayerIDs(game *state.GameState) []string {
	viewerIDs := make([]string, 0, len(game.Players))
	for viewerID := range game.Players {
		viewerIDs = append(viewerIDs, viewerID)
	}
	sort.Strings(viewerIDs)
	return viewerIDs
}

func requiredBatchInstanceIDs(command protocol.CommandEnvelopeV2) ([]string, error) {
	instanceIDs, err := stringSliceField(command.Payload, "instanceIds")
	if err != nil {
		return nil, err
	}
	if len(instanceIDs) == 0 {
		return nil, fmt.Errorf("%w: instanceIds", ErrInvalidPayloadField)
	}
	return instanceIDs, nil
}
