package actor

import (
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
