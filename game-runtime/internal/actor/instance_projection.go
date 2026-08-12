package actor

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

// projectInstanceReferenceForViewer resolves the instance identifier already
// present in a viewer's projected state. It never exposes a canonical private
// identifier when that viewer only has an opaque zone placeholder.
func projectInstanceReferenceForViewer(game *state.GameState, instanceID string, viewerID string) (string, bool) {
	instance, instanceExists := game.Instances[instanceID]
	location, locationExists := game.Loc[instanceID]
	if !instanceExists || !locationExists {
		return "", false
	}
	if game.CanViewerSeeCardKey(viewerID, instanceID) {
		return instanceID, true
	}
	if instance.FaceDown || privateZone(location.Zone) {
		return privatePlaceholderID(location.PlayerID, location.Zone, privateProjectedIndex(game, location)), true
	}
	return "", false
}

func emitInstancePatchByViewer(emitter *PatchEmitter, game *state.GameState, instanceID string, opName string, data map[string]any, includeOpaque bool) {
	instance, instanceExists := game.Instances[instanceID]
	location, locationExists := game.Loc[instanceID]
	if !instanceExists || !locationExists {
		return
	}
	if !instance.FaceDown && !privateZone(location.Zone) {
		emitter.EmitPublic(protocol.PatchOp{Op: opName, Data: data})
		return
	}
	for viewerID := range game.Players {
		projectedID, visible := projectInstanceReferenceForViewer(game, instanceID, viewerID)
		if !visible {
			continue
		}
		if projectedID != instanceID && !includeOpaque {
			continue
		}
		projectedData := cloneMap(data)
		projectedData["instanceId"] = projectedID
		emitter.EmitPrivate(viewerID, protocol.PatchOp{Op: opName, Data: projectedData})
	}
}

// projectTokenGroupForViewer uses the same canonical-to-viewer reference map as
// cards and binary relations. Complete membership is exposed only when every
// member remains canonical for that viewer; otherwise quantity and the opaque
// root are sufficient and memberRefs is deliberately absent.
func projectTokenGroupForViewer(game *state.GameState, group state.TokenGroupRuntime, viewerID string) (map[string]any, bool) {
	rootRef, visible := projectInstanceReferenceForViewer(game, group.RootInstanceID, viewerID)
	if !visible {
		return nil, false
	}
	fullyAuthorized := rootRef == group.RootInstanceID
	memberRefs := make([]string, 0, len(group.OrderedMemberIDs))
	for _, memberID := range group.OrderedMemberIDs {
		projectedRef, memberVisible := projectInstanceReferenceForViewer(game, memberID, viewerID)
		if !memberVisible {
			fullyAuthorized = false
			continue
		}
		if projectedRef != memberID {
			fullyAuthorized = false
		}
		memberRefs = append(memberRefs, projectedRef)
	}
	root, rootExists := game.Instances[group.RootInstanceID]
	if !rootExists {
		return nil, false
	}
	groupID := group.GroupID
	if !fullyAuthorized {
		groupID = viewerOpaqueTokenGroupID(viewerID, rootRef)
	}
	projected := map[string]any{
		"groupId":       groupID,
		"rootRef":       rootRef,
		"quantity":      group.Quantity(),
		"revision":      group.Revision,
		"position":      cloneMap(root.Position),
		"faceDown":      root.FaceDown,
		"tapped":        root.Tapped,
		"rotation":      root.Rotation,
		"effectVersion": group.EffectVersion,
	}
	if fullyAuthorized && len(memberRefs) == group.Quantity() {
		projected["memberRefs"] = memberRefs
		projected["counters"] = cloneIntMapAny(root.Counters)
		projected["mutableStats"] = cloneMap(root.MutableStats)
		projected["controllerId"] = root.ControllerID
	}
	return projected, true
}

func viewerOpaqueTokenGroupID(viewerID string, opaqueRootRef string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(viewerID) + "|" + strings.TrimSpace(opaqueRootRef)))
	return "token-group-view-" + hex.EncodeToString(digest[:12])
}
