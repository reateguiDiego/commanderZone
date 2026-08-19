package actor

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/binary"
	"fmt"
	"strconv"
	"time"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

type LibraryDrawApplier struct{}

func (LibraryDrawApplier) Type() string { return "library.draw" }

func (LibraryDrawApplier) Apply(ctx context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	command.Payload["count"] = 1
	return LibraryDrawManyApplier{}.Apply(ctx, game, command, emitter)
}

type LibraryDrawManyApplier struct{}

func (LibraryDrawManyApplier) Type() string { return "library.draw_many" }

func (LibraryDrawManyApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	count, ok := intField(command.Payload, "count")
	if !ok {
		count = 1
	}
	ops := state.NewLibraryOps()
	drawn, err := ops.DrawMany(game, playerID, count)
	if err != nil {
		return nil, err
	}
	delete(game.Visibility.TopRevealWindows, playerID)
	cards := make([]map[string]any, 0, len(drawn))
	for _, instanceID := range drawn {
		cards = append(cards, cardPatchData(game, playerID, instanceID))
	}
	emitter.EmitPrivate(playerID, protocol.PatchOp{
		Op: "zone.cards.remove",
		Data: map[string]any{
			"playerId":    playerID,
			"zone":        state.ZoneLibrary,
			"instanceIds": drawn,
		},
	})
	emitter.EmitPrivate(playerID, protocol.PatchOp{
		Op: "zone.cards.add",
		Data: map[string]any{
			"playerId": playerID,
			"zone":     state.ZoneHand,
			"cards":    cards,
		},
	})
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)
	emitZoneCount(emitter, game, playerID, state.ZoneHand)
	emitCurrentTopWhenPlayTopRevealed(emitter, game, playerID)
	emitLibraryTopRevealMarker(emitter, game, playerID)
	return map[string]any{
		"playerId":    playerID,
		"count":       len(drawn),
		"instanceIds": drawn,
		"metrics":     libraryMetrics(command.Type, start, ops),
	}, nil
}

type LibraryRevealTopApplier struct{}

func (LibraryRevealTopApplier) Type() string { return "library.reveal_top" }

func (LibraryRevealTopApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	if stop, _ := boolField(command.Payload, "stop"); stop {
		return stopRevealingTopLibraryCard(game, playerID, command.Payload, emitter, start)
	}
	count, ok := intField(command.Payload, "count")
	if !ok {
		count = 1
	}
	ops := state.NewLibraryOps()
	top, err := ops.PeekTop(game, playerID, count)
	if err != nil {
		return nil, err
	}
	viewers, mask := revealTargets(game, command.Payload)
	if mask == 0 {
		mask = 1
	}
	if existing, ok := game.Visibility.TopRevealWindows[playerID]; ok && existing.Epoch == game.Visibility.LibraryEpochByOwner[playerID] && existing.Count == count {
		mask |= existing.Mask
		viewers = mergeViewerIDs(existing.To, viewers)
	}
	window := game.RevealTopWindow(playerID, count, viewers, mask)
	cards := make([]map[string]any, 0, len(top))
	for _, instanceID := range top {
		instance := game.Instances[instanceID]
		instance.VisibleToMask |= mask
		game.Instances[instanceID] = instance
		game.Visibility.InstanceMasks[instanceID] |= mask
		cards = append(cards, map[string]any{
			"instanceId": instanceID,
			"cardKey":    instance.CardKey,
			"revealedTo": viewers,
		})
	}
	revealOp := protocol.PatchOp{
		Op: "library.top.revealed",
		Data: map[string]any{
			"playerId": playerID,
			"count":    count,
			"epoch":    window.Epoch,
			"cards":    cards,
		},
	}
	if len(viewers) == 1 {
		emitter.EmitPrivate(viewers[0], revealOp)
	} else {
		emitter.EmitGroup(strconv.FormatUint(mask, 10), revealOp)
	}
	emitLibraryTopRevealMarker(emitter, game, playerID)
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)
	return map[string]any{
		"playerId":        playerID,
		"count":           count,
		"instanceIds":     top,
		"visibilityEpoch": window.Epoch,
		"metrics":         libraryMetrics(command.Type, start, ops),
	}, nil
}

type LibraryReorderTopApplier struct{}

func (LibraryReorderTopApplier) Type() string { return "library.reorder_top" }

func (LibraryReorderTopApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	orderedTopIDs, err := stringSliceField(command.Payload, "instanceIds")
	if err != nil {
		return nil, err
	}
	ops := state.NewLibraryOps()
	if err := ops.ReorderTop(game, playerID, orderedTopIDs); err != nil {
		return nil, err
	}
	delete(game.Visibility.TopRevealWindows, playerID)
	emitter.EmitPrivate(playerID, protocol.PatchOp{
		Op: "library.top.reordered",
		Data: map[string]any{
			"playerId":    playerID,
			"instanceIds": orderedTopIDs,
		},
	})
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)
	emitCurrentTopWhenPlayTopRevealed(emitter, game, playerID)
	emitLibraryTopRevealMarker(emitter, game, playerID)
	return map[string]any{"playerId": playerID, "instanceIds": orderedTopIDs, "metrics": libraryMetrics(command.Type, start, ops)}, nil
}

type LibraryMoveTopApplier struct{}

type LibraryPlayTopFaceDownApplier struct{}

func (LibraryPlayTopFaceDownApplier) Type() string { return "library.play_top_face_down" }

func (LibraryPlayTopFaceDownApplier) Apply(ctx context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	top, err := state.NewLibraryOps().PeekTop(game, playerID, 1)
	if err != nil {
		return nil, err
	}
	if len(top) == 0 {
		return nil, state.ErrEmptyLibrary
	}
	command.Payload["instanceIds"] = top
	command.Payload["instanceId"] = top[0]
	command.Payload["fromZone"] = string(state.ZoneLibrary)
	command.Payload["toZone"] = string(state.ZoneBattlefield)
	command.Payload["faceDown"] = true
	return CardsMovedApplier{}.Apply(ctx, game, command, emitter)
}

func (LibraryMoveTopApplier) Type() string { return "library.move_top" }

func (LibraryMoveTopApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	count, ok := intField(command.Payload, "count")
	if !ok {
		count = 1
	}
	destination, err := zoneField(command.Payload, "toZone")
	if err != nil {
		if raw, ok := command.Payload["destination"].(string); ok && raw != "" {
			command.Payload["toZone"] = raw
			destination, err = zoneField(command.Payload, "toZone")
		}
		if err != nil {
			return nil, err
		}
	}
	toPlayerID := targetPlayerID(command.Payload, playerID)
	ops := state.NewLibraryOps()
	var moved []string
	if destination == state.ZoneLibrary {
		position, _ := command.Payload["position"].(string)
		if position != "bottom" {
			return nil, fmt.Errorf("%w: position", ErrInvalidPayloadField)
		}
		moved, err = ops.MoveTopToBottom(game, playerID, count)
		toPlayerID = playerID
	} else {
		moved, err = ops.MoveTopToPlayerZone(game, playerID, count, toPlayerID, destination)
	}
	if err != nil {
		return nil, err
	}
	delete(game.Visibility.TopRevealWindows, playerID)
	if destination == state.ZoneLibrary && toPlayerID == playerID {
		emitter.EmitPrivate(playerID, protocol.PatchOp{
			Op: "library.top.moved",
			Data: map[string]any{
				"playerId":    playerID,
				"count":       len(moved),
				"instanceIds": moved,
				"position":    "bottom",
			},
		})
		emitZoneCount(emitter, game, playerID, state.ZoneLibrary)
		emitCurrentTopWhenPlayTopRevealed(emitter, game, playerID)
		emitLibraryTopRevealMarker(emitter, game, playerID)
		return map[string]any{"playerId": playerID, "targetPlayerId": toPlayerID, "count": len(moved), "destination": string(destination), "instanceIds": moved, "metrics": libraryMetrics(command.Type, start, ops)}, nil
	}
	cards := make([]map[string]any, 0, len(moved))
	for _, instanceID := range moved {
		cards = append(cards, cardPatchData(game, toPlayerID, instanceID))
	}
	emitter.EmitPrivate(playerID, protocol.PatchOp{Op: "zone.cards.remove", Data: map[string]any{"playerId": playerID, "zone": state.ZoneLibrary, "instanceIds": moved}})
	emitter.EmitPrivate(toPlayerID, protocol.PatchOp{Op: "zone.cards.add", Data: map[string]any{"playerId": toPlayerID, "zone": destination, "cards": cards}})
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)
	emitZoneCount(emitter, game, toPlayerID, destination)
	emitCurrentTopWhenPlayTopRevealed(emitter, game, playerID)
	emitLibraryTopRevealMarker(emitter, game, playerID)
	return map[string]any{"playerId": playerID, "targetPlayerId": toPlayerID, "count": len(moved), "destination": string(destination), "instanceIds": moved, "metrics": libraryMetrics(command.Type, start, ops)}, nil
}

type LibraryPutTopApplier struct{}

func (LibraryPutTopApplier) Type() string { return "library.put_top" }

func (LibraryPutTopApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	return applyLibraryPut(command, game, emitter, true)
}

type LibraryPutBottomApplier struct{}

func (LibraryPutBottomApplier) Type() string { return "library.put_bottom" }

func (LibraryPutBottomApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	return applyLibraryPut(command, game, emitter, false)
}

type LibraryViewApplier struct{}

func (LibraryViewApplier) Type() string { return "library.view" }

func (LibraryViewApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	count, ok := intField(command.Payload, "count")
	if !ok {
		count = 1
	}
	ops := state.NewLibraryOps()
	top, err := ops.PeekTop(game, playerID, count)
	if err != nil {
		return nil, err
	}
	cards := make([]map[string]any, 0, len(top))
	for _, instanceID := range top {
		cards = append(cards, cardPatchData(game, playerID, instanceID))
	}
	emitter.EmitPrivate(playerID, protocol.PatchOp{
		Op: "library.top.viewed",
		Data: map[string]any{
			"playerId": playerID,
			"count":    len(cards),
			"cards":    cards,
		},
	})
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)
	return map[string]any{"playerId": playerID, "count": len(cards), "instanceIds": top, "metrics": libraryMetrics(command.Type, start, ops)}, nil
}

type LibraryShuffleApplier struct{}

func (LibraryShuffleApplier) Type() string { return "library.shuffle" }

func (LibraryShuffleApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	before := game.Visibility.LibraryEpochByOwner[playerID]
	seed := libraryShuffleSeed()
	ops := state.NewLibraryOps()
	if err := ops.ShuffleWithSeed(game, playerID, seed); err != nil {
		return nil, err
	}
	after := game.Visibility.LibraryEpochByOwner[playerID]
	if after <= before {
		return nil, fmt.Errorf("%w: visibilityEpoch", ErrInvalidPayloadField)
	}
	emitter.EmitPublic(protocol.PatchOp{
		Op: "library.shuffled",
		Data: map[string]any{
			"playerId":        playerID,
			"visibilityEpoch": after,
		},
	})
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)
	emitCurrentTopWhenPlayTopRevealed(emitter, game, playerID)
	emitLibraryTopRevealMarker(emitter, game, playerID)
	return map[string]any{
		"playerId":         playerID,
		"visibilityEpoch":  after,
		"shuffleSeed":      int(seed),
		"shuffleAlgorithm": state.DeterministicShuffleAlgorithm,
		"metrics":          libraryMetrics(command.Type, start, ops),
	}, nil
}

func applyLibraryPut(command protocol.CommandEnvelopeV2, game *state.GameState, emitter *PatchEmitter, top bool) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	if top {
		delete(game.Visibility.TopRevealWindows, playerID)
	}
	instanceID, err := stringField(command.Payload, "instanceId")
	if err != nil {
		return nil, err
	}
	from, ok := game.GetLocation(instanceID)
	if !ok {
		return nil, state.ErrMissingInstance
	}
	instance, ok := game.Instances[instanceID]
	if !ok {
		return nil, state.ErrMissingInstance
	}
	_, err = state.RemoveFromCurrentZone(game, instanceID)
	if err != nil {
		return nil, err
	}
	ops := state.NewLibraryOps()
	if top {
		err = ops.PutOnTop(game, playerID, instanceID)
	} else {
		err = ops.PutOnBottom(game, playerID, instanceID)
	}
	if err != nil {
		return nil, err
	}
	card := cardPatchData(game, playerID, instanceID)
	emitter.EmitPrivate(playerID, protocol.PatchOp{Op: "zone.cards.remove", Data: map[string]any{"playerId": from.PlayerID, "zone": from.Zone, "instanceIds": []string{instanceID}}})
	emitter.EmitPrivate(playerID, protocol.PatchOp{Op: "zone.cards.add", Data: map[string]any{"playerId": playerID, "zone": state.ZoneLibrary, "cards": []map[string]any{card}}})
	emitZoneCount(emitter, game, from.PlayerID, from.Zone)
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)
	if top {
		emitCurrentTopWhenPlayTopRevealed(emitter, game, playerID)
		emitLibraryTopRevealMarker(emitter, game, playerID)
	}
	position := "bottom"
	if top {
		position = "top"
	}
	return map[string]any{"playerId": playerID, "instanceId": instanceID, "fromPlayerId": from.PlayerID, "fromZone": from.Zone, "position": position, "cardKey": instance.CardKey, "metrics": libraryMetrics(command.Type, start, ops)}, nil
}

// emitCurrentTopWhenPlayTopRevealed is deliberately O(1): it reads only the
// first library entry after a mutation, preserving the runtime's compact patch
// path while keeping the public top card current.
func emitCurrentTopWhenPlayTopRevealed(emitter *PatchEmitter, game *state.GameState, playerID string) {
	player := game.Players[playerID]
	if player == nil || player["playTopLibraryRevealed"] != true {
		return
	}
	zones, ok := game.Zones[playerID]
	if !ok || len(zones.Library) == 0 {
		emitter.EmitPublic(protocol.PatchOp{Op: "library.top.hidden", Data: map[string]any{"playerId": playerID}})
		return
	}
	instanceID := zones.Library[len(zones.Library)-1]
	instance, ok := game.Instances[instanceID]
	if !ok {
		return
	}
	emitter.EmitPublic(protocol.PatchOp{
		Op: "library.top.revealed",
		Data: map[string]any{
			"playerId": playerID,
			"count":    1,
			"cards": []map[string]any{{
				"instanceId": instanceID,
				"cardKey":    instance.CardKey,
			}},
		},
	})
}

func emitLibraryTopRevealMarker(emitter *PatchEmitter, game *state.GameState, playerID string) {
	zones, ok := game.Zones[playerID]
	if !ok || len(zones.Library) == 0 {
		emitLibraryTopRevealAudience(emitter, playerID, nil)
		emitter.EmitPublic(protocol.PatchOp{Op: "library.top.reveal_marker.set", Data: map[string]any{"playerId": playerID, "revealed": false}})
		return
	}

	player := game.Players[playerID]
	if player != nil && player["playTopLibraryRevealed"] == true {
		emitLibraryTopRevealAudience(emitter, playerID, nil)
		emitter.EmitPublic(protocol.PatchOp{Op: "library.top.reveal_marker.set", Data: map[string]any{"playerId": playerID, "revealed": true}})
		return
	}
	window, revealed := game.Visibility.TopRevealWindows[playerID]
	if !revealed || window.Epoch != game.Visibility.LibraryEpochByOwner[playerID] || window.Count != 1 {
		emitLibraryTopRevealAudience(emitter, playerID, nil)
		emitter.EmitPublic(protocol.PatchOp{Op: "library.top.reveal_marker.set", Data: map[string]any{"playerId": playerID, "revealed": false}})
		return
	}
	emitLibraryTopRevealAudience(emitter, playerID, window.To)
	emitter.EmitPublic(protocol.PatchOp{
		Op: "library.top.reveal_marker.set",
		Data: map[string]any{
			"playerId": playerID,
			"revealed": true,
		},
	})
}

func emitLibraryTopRevealAudience(emitter *PatchEmitter, playerID string, viewers []string) {
	normalizedViewers := append([]string{}, viewers...)
	emitter.EmitPrivate(playerID, protocol.PatchOp{
		Op:   "library.top.reveal_audience.set",
		Data: map[string]any{"playerId": playerID, "revealedTo": normalizedViewers},
	})
}

func stopRevealingTopLibraryCard(game *state.GameState, playerID string, payload map[string]any, emitter *PatchEmitter, start time.Time) (map[string]any, error) {
	game.EnsureVisibility()
	window, hasWindow := game.Visibility.TopRevealWindows[playerID]
	if hasWindow {
		removeMask := window.Mask
		_, hasTo := payload["to"]
		_, hasViewers := payload["viewers"]
		_, hasVisibleMask := payload["visibleToMask"]
		targetedStop := hasTo || hasViewers || hasVisibleMask
		if targetedStop {
			targetViewers, targetMask := revealTargets(game, payload)
			removeMask &= targetMask
			// A legacy window can contain a fallback bit with no corresponding
			// audience entry. Remove that stale remainder together with the
			// requested target so the public eye cannot outlive the reveal.
			removeMask |= window.Mask &^ viewerMaskForIDs(game, window.To)
			if removeMask == 0 {
				removeMask = viewerMaskForIDs(game, targetViewers) & window.Mask
				// Snapshots written before viewer bits were initialized can retain
				// a fallback mask that cannot be mapped back to an individual
				// viewer. Close that stale window rather than leaving the card
				// revealed (and its public eye marker) indefinitely.
				if removeMask == 0 && hasAnyViewer(window.To, targetViewers) {
					removeMask = window.Mask
				}
			}
		}
		remainingMask := window.Mask &^ removeMask
		remainingViewers := window.To
		if targetedStop {
			targetViewers, _ := revealTargets(game, payload)
			remainingViewers = withoutViewerIDs(window.To, targetViewers)
		}
		if zones, ok := game.Zones[playerID]; ok && len(zones.Library) > 0 {
			topID := zones.Library[len(zones.Library)-1]
			instance := game.Instances[topID]
			instance.VisibleToMask &^= removeMask
			game.Instances[topID] = instance
			game.Visibility.InstanceMasks[topID] &^= removeMask
			if game.Visibility.InstanceMasks[topID] == 0 {
				delete(game.Visibility.InstanceMasks, topID)
			}
		}
		if remainingMask == 0 {
			delete(game.Visibility.TopRevealWindows, playerID)
		} else {
			game.RevealTopWindow(playerID, window.Count, remainingViewers, remainingMask)
		}
		if removeMask != 0 {
			hiddenOp := protocol.PatchOp{Op: "library.top.hidden", Data: map[string]any{"playerId": playerID}}
			if !targetedStop {
				emitter.EmitPublic(hiddenOp)
			} else {
				removedViewers, _ := revealTargets(game, payload)
				if len(removedViewers) == 1 {
					emitter.EmitPrivate(removedViewers[0], hiddenOp)
				} else {
					emitter.EmitGroup(strconv.FormatUint(removeMask, 10), hiddenOp)
				}
			}
		}
	}
	emitLibraryTopRevealMarker(emitter, game, playerID)
	return map[string]any{
		"playerId": playerID,
		"stop":     true,
		"metrics":  libraryMetrics("library.reveal_top", start, state.NewLibraryOps()),
	}, nil
}

func mergeViewerIDs(existing []string, requested []string) []string {
	viewers := make([]string, 0, len(existing)+len(requested))
	seen := map[string]struct{}{}
	for _, viewerID := range append(existing, requested...) {
		if viewerID == "" {
			continue
		}
		if _, ok := seen[viewerID]; ok {
			continue
		}
		seen[viewerID] = struct{}{}
		viewers = append(viewers, viewerID)
	}
	return viewers
}

func withoutViewerIDs(viewers []string, removed []string) []string {
	removedSet := make(map[string]struct{}, len(removed))
	for _, viewerID := range removed {
		removedSet[viewerID] = struct{}{}
	}
	remaining := make([]string, 0, len(viewers))
	for _, viewerID := range viewers {
		if _, removed := removedSet[viewerID]; !removed {
			remaining = append(remaining, viewerID)
		}
	}
	return remaining
}

func hasAnyViewer(viewers []string, candidates []string) bool {
	candidateSet := make(map[string]struct{}, len(candidates))
	for _, viewerID := range candidates {
		candidateSet[viewerID] = struct{}{}
	}
	for _, viewerID := range viewers {
		if _, ok := candidateSet[viewerID]; ok {
			return true
		}
	}
	return false
}

func viewerMaskForIDs(game *state.GameState, viewers []string) uint64 {
	var mask uint64
	for _, viewerID := range viewers {
		mask |= game.Visibility.ViewerBits[viewerID]
	}
	return mask
}

func libraryMetrics(commandType string, start time.Time, ops *state.LibraryOps) map[string]any {
	durationKey := "library.draw_ms"
	switch commandType {
	case "library.draw_many":
		durationKey = "library.draw_many_ms"
	case "library.reveal_top":
		durationKey = "library.reveal_top_ms"
	case "library.view":
		durationKey = "library.view_ms"
	case "library.reorder_top":
		durationKey = "library.reorder_top_ms"
	case "library.move_top":
		durationKey = "library.move_top_ms"
	case "library.put_top":
		durationKey = "library.put_top_ms"
	case "library.put_bottom":
		durationKey = "library.put_bottom_ms"
	case "library.shuffle":
		durationKey = "library.shuffle_ms"
	}
	return map[string]any{
		"library.runtime_route":   1,
		"library.full_scan_count": ops.FullScanCount(),
		"library.reindex_count":   ops.ReindexCount(),
		durationKey:               float64(time.Since(start).Microseconds()) / 1000,
	}
}

func libraryShuffleSeed() uint32 {
	var buffer [4]byte
	if _, err := cryptorand.Read(buffer[:]); err == nil {
		return binary.BigEndian.Uint32(buffer[:])
	}
	return uint32(time.Now().UnixNano())
}
