package actor

import (
	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

// invalidateLibraryVisibility is the single actor-side invalidation path for
// transient top-library reveals. It uses the existing conceal Patch.v2 op so
// live viewers lose materialized identity in the same authoritative version.
func invalidateLibraryVisibility(game *state.GameState, emitter *PatchEmitter, ownerIDs ...string) map[string]int64 {
	return invalidateLibraryVisibilityWithReason(game, emitter, "stale", "library_changed", ownerIDs...)
}

func invalidateLibraryVisibilityWithReason(game *state.GameState, emitter *PatchEmitter, status string, reason string, ownerIDs ...string) map[string]int64 {
	epochs := map[string]int64{}
	seen := map[string]struct{}{}
	for _, ownerID := range ownerIDs {
		if ownerID == "" {
			continue
		}
		if _, duplicate := seen[ownerID]; duplicate {
			continue
		}
		seen[ownerID] = struct{}{}
		actionWindow, hadActionWindow := game.LibraryWindow(ownerID)
		window, existed := game.InvalidateLibraryVisibility(ownerID)
		epochs[ownerID] = game.Visibility.LibraryEpochByOwner[ownerID]
		if existed {
			emitTopRevealWindowConceal(game, emitter, ownerID, window)
		}
		if hadActionWindow && actionWindow.Status == "active" {
			game.InvalidateLibraryWindow(ownerID, status)
			emitLibraryWindowInvalidated(emitter, ownerID, actionWindow.WindowID, status, reason, epochs[ownerID])
		}
		if emitter != nil {
			emitter.EmitPublic(libraryEpochSetOp(ownerID, epochs[ownerID]))
		}
	}
	return epochs
}

func emitLibraryWindowInvalidated(emitter *PatchEmitter, ownerID string, windowID string, status string, reason string, epoch int64) {
	if emitter == nil || ownerID == "" || windowID == "" {
		return
	}
	emitter.EmitPrivate(ownerID, protocol.PatchOp{Op: "library.window.invalidated", Data: map[string]any{
		"playerId": ownerID, "windowId": windowID, "status": status, "reason": reason, "currentEpoch": epoch,
	}})
}

func libraryEpochSetOp(ownerID string, epoch int64) protocol.PatchOp {
	return protocol.PatchOp{Op: "library.epoch.set", Data: map[string]any{"playerId": ownerID, "epoch": epoch}}
}

func emitTopRevealWindowConceal(game *state.GameState, emitter *PatchEmitter, ownerID string, window state.TopRevealWindow) {
	if emitter == nil || len(window.InstanceIDs) == 0 {
		return
	}
	audience := audienceForPersistedTopReveal(game, ownerID, window)
	emitVisibilityAudiencePatch(
		emitter,
		audience,
		privateCardsConcealOp(ownerID, state.ZoneLibrary, privateLibrarySlots(ownerID, window.InstanceIDs)),
	)
}

func audienceForPersistedTopReveal(game *state.GameState, ownerID string, window state.TopRevealWindow) visibilityAudience {
	for _, target := range window.To {
		if target == "all" {
			return publicVisibilityAudience(game)
		}
	}
	players := append([]string(nil), window.To...)
	if len(players) == 0 && window.Mask > 0 {
		if audience, err := visibilityAudienceFromMask(game, window.Mask); err == nil {
			return audience
		}
	}
	if audience, err := playerVisibilityAudience(game, players); err == nil {
		return audience
	}
	return visibilityAudience{Scope: audienceScopePlayers, PlayerIDs: []string{ownerID}, Mask: game.Visibility.ViewerBits[ownerID]}
}

func libraryVisibilityEpochValue(epochs map[string]int64, ownerID string) any {
	if epoch, ok := epochs[ownerID]; ok {
		return epoch
	}
	return nil
}

func libraryVisibilityOwnersForMove(game *state.GameState, instanceIDs []string, toPlayerID string, toZone state.Zone) []string {
	owners := []string{}
	seen := map[string]struct{}{}
	add := func(ownerID string) {
		if ownerID == "" {
			return
		}
		if _, duplicate := seen[ownerID]; duplicate {
			return
		}
		seen[ownerID] = struct{}{}
		owners = append(owners, ownerID)
	}
	for _, instanceID := range instanceIDs {
		if location, ok := game.GetLocation(instanceID); ok && location.Zone == state.ZoneLibrary {
			add(location.PlayerID)
		}
	}
	if toZone == state.ZoneLibrary {
		add(toPlayerID)
	}
	return owners
}
