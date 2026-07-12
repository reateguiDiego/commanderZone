package actor

import (
	"fmt"
	"sort"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

const (
	audienceScopePublic  = "public"
	audienceScopePlayers = "players"
)

type visibilityAudience struct {
	Scope     string
	PlayerIDs []string
	Mask      uint64
}

func validateClientVisibilityAudience(game *state.GameState, command protocol.CommandEnvelopeV2) error {
	switch command.Type {
	case "card.revealed", "library.reveal", "library.reveal_top":
	default:
		return nil
	}
	for _, serverField := range []string{"audience", "viewers", "visibleToMask"} {
		if _, supplied := command.Payload[serverField]; supplied {
			return fmt.Errorf("%w: %s", ErrInvalidPayloadField, serverField)
		}
	}
	_, err := resolveVisibilityAudience(game, command.Payload)
	return err
}

func resolveVisibilityAudience(game *state.GameState, payload map[string]any) (visibilityAudience, error) {
	game.EnsureVisibility()
	if raw, ok := payload["audience"].(map[string]any); ok {
		scope, _ := raw["scope"].(string)
		switch scope {
		case audienceScopePublic:
			return publicVisibilityAudience(game), nil
		case audienceScopePlayers:
			playerIDs, err := stringSliceField(raw, "playerIds")
			if err != nil {
				return visibilityAudience{}, err
			}
			return playerVisibilityAudience(game, playerIDs)
		default:
			return visibilityAudience{}, fmt.Errorf("%w: audience.scope", ErrInvalidPayloadField)
		}
	}

	if _, ok := payload["viewers"]; ok {
		viewers, err := stringSliceField(payload, "viewers")
		if err != nil {
			return visibilityAudience{}, err
		}
		return visibilityAudienceFromTargets(game, viewers)
	}
	if rawMask, ok := intField(payload, "visibleToMask"); ok && rawMask > 0 {
		return visibilityAudienceFromMask(game, uint64(rawMask))
	}

	raw, supplied := payload["to"]
	if !supplied {
		return publicVisibilityAudience(game), nil
	}
	switch typed := raw.(type) {
	case string:
		return visibilityAudienceFromTargets(game, []string{typed})
	case []string:
		return visibilityAudienceFromTargets(game, typed)
	case []any:
		players := make([]string, 0, len(typed))
		for _, item := range typed {
			playerID, ok := item.(string)
			if !ok {
				return visibilityAudience{}, fmt.Errorf("%w: to", ErrInvalidPayloadField)
			}
			players = append(players, playerID)
		}
		return visibilityAudienceFromTargets(game, players)
	default:
		return visibilityAudience{}, fmt.Errorf("%w: to", ErrInvalidPayloadField)
	}
}

func visibilityAudienceFromTargets(game *state.GameState, targets []string) (visibilityAudience, error) {
	if len(targets) == 1 && targets[0] == "all" {
		return publicVisibilityAudience(game), nil
	}
	for _, target := range targets {
		if target == "all" {
			return visibilityAudience{}, fmt.Errorf("%w: to", ErrInvalidPayloadField)
		}
	}
	return playerVisibilityAudience(game, targets)
}

func playerVisibilityAudience(game *state.GameState, playerIDs []string) (visibilityAudience, error) {
	if len(playerIDs) == 0 {
		return visibilityAudience{}, fmt.Errorf("%w: to", ErrInvalidPayloadField)
	}
	seen := map[string]struct{}{}
	canonical := make([]string, 0, len(playerIDs))
	mask := uint64(0)
	for _, playerID := range playerIDs {
		bit := game.Visibility.ViewerBits[playerID]
		if playerID == "" || bit == 0 {
			return visibilityAudience{}, fmt.Errorf("%w: to", ErrInvalidPayloadField)
		}
		if _, duplicate := seen[playerID]; duplicate {
			continue
		}
		seen[playerID] = struct{}{}
		canonical = append(canonical, playerID)
		mask |= bit
	}
	sort.Slice(canonical, func(i, j int) bool {
		return game.Visibility.ViewerBits[canonical[i]] < game.Visibility.ViewerBits[canonical[j]]
	})
	if mask == allPlayersVisibilityMask(game) {
		return publicVisibilityAudience(game), nil
	}
	return visibilityAudience{Scope: audienceScopePlayers, PlayerIDs: canonical, Mask: mask}, nil
}

func visibilityAudienceFromMask(game *state.GameState, mask uint64) (visibilityAudience, error) {
	if mask == 0 || mask&^allPlayersVisibilityMask(game) != 0 {
		return visibilityAudience{}, fmt.Errorf("%w: visibleToMask", ErrInvalidPayloadField)
	}
	if mask == allPlayersVisibilityMask(game) {
		return publicVisibilityAudience(game), nil
	}
	players := make([]string, 0, len(game.Visibility.ViewerBits))
	for playerID, bit := range game.Visibility.ViewerBits {
		if mask&bit != 0 {
			players = append(players, playerID)
		}
	}
	return playerVisibilityAudience(game, players)
}

func publicVisibilityAudience(game *state.GameState) visibilityAudience {
	return visibilityAudience{Scope: audienceScopePublic, Mask: allPlayersVisibilityMask(game)}
}

func allPlayersVisibilityMask(game *state.GameState) uint64 {
	mask := uint64(0)
	for playerID := range game.Players {
		mask |= game.Visibility.ViewerBits[playerID]
	}
	return mask
}

func (a visibilityAudience) revealedTo() []string {
	if a.Scope == audienceScopePublic {
		return []string{"all"}
	}
	return append([]string(nil), a.PlayerIDs...)
}

func (a visibilityAudience) eventValue() map[string]any {
	value := map[string]any{"scope": a.Scope}
	if a.Scope == audienceScopePlayers {
		value["playerIds"] = append([]string(nil), a.PlayerIDs...)
	}
	return value
}

func emitVisibilityAudiencePatch(emitter *PatchEmitter, audience visibilityAudience, op protocol.PatchOp) {
	if audience.Scope == audienceScopePublic {
		emitter.EmitPublic(op)
		return
	}
	if len(audience.PlayerIDs) == 1 {
		emitter.EmitPrivate(audience.PlayerIDs[0], op)
		return
	}
	emitter.EmitGroup(fmt.Sprintf("%d", audience.Mask), op)
}
