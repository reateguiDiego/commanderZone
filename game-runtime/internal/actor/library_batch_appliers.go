package actor

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/hex"
	"fmt"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

const LibraryBatchEffectVersion = 1

type LibrarySelectionMoveApplier struct{}

func (LibrarySelectionMoveApplier) Type() string { return "library.selection.move" }

func (LibrarySelectionMoveApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	windowID, err := stringField(command.Payload, "windowId")
	if err != nil {
		return nil, libraryWindowError(command.Type, LibraryWindowCodeNotFound, "", game.Visibility.LibraryEpochByOwner[playerID], game.Visibility.LibraryEpochByOwner[playerID], 0, -1)
	}
	expectedEpoch, ok := intField(command.Payload, "expectedEpoch")
	if !ok || expectedEpoch < 0 {
		return nil, libraryWindowError(command.Type, LibraryWindowCodeEpochMismatch, windowID, int64(expectedEpoch), game.Visibility.LibraryEpochByOwner[playerID], 0, -1)
	}
	orderedIDs, err := stringSliceField(command.Payload, "orderedInstanceIds")
	if err != nil || len(orderedIDs) == 0 {
		return nil, libraryWindowError(command.Type, LibraryWindowCodeInvalidBatch, windowID, int64(expectedEpoch), game.Visibility.LibraryEpochByOwner[playerID], len(orderedIDs), -1)
	}
	toZone, position, faceDown, err := validateLibraryBatchDestination(command)
	if err != nil {
		return nil, err
	}
	window, err := validateActiveLibraryWindow(game, command.Type, playerID, windowID, int64(expectedEpoch), orderedIDs)
	if err != nil {
		return nil, err
	}

	previousLibraryCount := state.ZoneCount(game, playerID, state.ZoneLibrary)
	insertIDs := append([]string(nil), orderedIDs...)
	insertPosition := state.ZoneInsertAppend
	if toZone == state.ZoneLibrary {
		if position == "top" {
			reverseLibraryBatchIDs(insertIDs)
			insertPosition = state.ZoneInsertTop
		} else {
			insertPosition = state.ZoneInsertBottom
		}
	}
	epochs := invalidateLibraryVisibilityWithReason(game, emitter, "consumed", "batch_succeeded", playerID)
	zoneOps := state.NewZoneOps()
	moves, moveErr := zoneOps.MoveMany(game, insertIDs, playerID, toZone, insertPosition)
	if moveErr != nil {
		return nil, moveErr
	}
	requestedFaceDown := faceDown
	hasFaceDown := toZone == state.ZoneBattlefield
	applyMovementZoneState(game, moves, nil, hasFaceDown, requestedFaceDown)
	emitMovementPatches(emitter, game, moves, nil)
	emitTouchedZoneCounts(emitter, game, moves)

	finalEpoch := game.Visibility.LibraryEpochByOwner[playerID]
	game.InvalidateLibraryWindow(playerID, "consumed")
	return map[string]any{
		"effectVersion": LibraryBatchEffectVersion,
		"windowId":      window.WindowID, "expectedEpoch": window.ExpectedEpoch, "finalEpoch": finalEpoch,
		"ownerPlayerId": playerID, "playerId": playerID,
		"orderedInstanceIds": append([]string(nil), orderedIDs...), "instanceIds": append([]string(nil), orderedIDs...),
		"fromZone": string(state.ZoneLibrary), "toZone": string(toZone), "destination": string(toZone),
		"position": position, "faceDown": faceDown, "count": len(orderedIDs),
		"moves":                movementEventMoves(game, moves, nil),
		"previousLibraryCount": previousLibraryCount, "finalLibraryCount": state.ZoneCount(game, playerID, state.ZoneLibrary),
		"libraryVisibilityEpochs": epochs,
	}, nil
}

type LibraryTopPlayFaceDownApplier struct{}

func (LibraryTopPlayFaceDownApplier) Type() string { return "library.top.play_face_down" }

func (LibraryTopPlayFaceDownApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	count, ok := intField(command.Payload, "count")
	if !ok || count <= 0 {
		return nil, libraryWindowError(command.Type, LibraryWindowCodeInvalidBatch, "", 0, game.Visibility.LibraryEpochByOwner[playerID], count, -1)
	}
	expectedEpoch, ok := intField(command.Payload, "expectedEpoch")
	currentEpoch := game.Visibility.LibraryEpochByOwner[playerID]
	if !ok || expectedEpoch < 0 || int64(expectedEpoch) != currentEpoch {
		return nil, libraryWindowError(command.Type, LibraryWindowCodeEpochMismatch, "", int64(expectedEpoch), currentEpoch, count, -1)
	}
	windowID, err := stringField(command.Payload, "windowId")
	if err != nil {
		return nil, libraryWindowError(command.Type, LibraryWindowCodeNotFound, "", int64(expectedEpoch), currentEpoch, count, -1)
	}
	window, err := validateActiveLibraryWindow(game, command.Type, playerID, windowID, int64(expectedEpoch), nil)
	if err != nil {
		return nil, err
	}
	if count > len(window.InstanceIDs) {
		return nil, libraryWindowError(command.Type, LibraryWindowCodeInvalidBatch, windowID, int64(expectedEpoch), currentEpoch, count, -1)
	}
	top, err := state.NewLibraryOps().PeekTop(game, playerID, count)
	if err != nil {
		return nil, libraryWindowError(command.Type, LibraryWindowCodeInvalidBatch, "", int64(expectedEpoch), currentEpoch, count, -1)
	}
	previousLibraryCount := state.ZoneCount(game, playerID, state.ZoneLibrary)
	epochs := invalidateLibraryVisibilityWithReason(game, emitter, "stale", "top_batch_succeeded", playerID)
	moves, err := state.NewZoneOps().MoveMany(game, top, playerID, state.ZoneBattlefield, state.ZoneInsertAppend)
	if err != nil {
		return nil, err
	}
	applyMovementZoneState(game, moves, nil, true, true)
	emitMovementPatches(emitter, game, moves, nil)
	emitTouchedZoneCounts(emitter, game, moves)
	return map[string]any{
		"effectVersion": LibraryBatchEffectVersion,
		"windowId":      window.WindowID,
		"ownerPlayerId": playerID, "playerId": playerID,
		"expectedEpoch": int64(expectedEpoch), "finalEpoch": game.Visibility.LibraryEpochByOwner[playerID],
		"orderedInstanceIds": append([]string(nil), top...), "instanceIds": append([]string(nil), top...),
		"fromZone": string(state.ZoneLibrary), "toZone": string(state.ZoneBattlefield), "destination": string(state.ZoneBattlefield),
		"faceDown": true, "count": len(top), "moves": movementEventMoves(game, moves, nil),
		"previousLibraryCount": previousLibraryCount, "finalLibraryCount": state.ZoneCount(game, playerID, state.ZoneLibrary),
		"libraryVisibilityEpochs": epochs,
	}, nil
}

func validateActiveLibraryWindow(game *state.GameState, commandType string, playerID string, windowID string, expectedEpoch int64, selectedIDs []string) (state.LibraryWindow, error) {
	currentEpoch := game.Visibility.LibraryEpochByOwner[playerID]
	window, exists := game.LibraryWindow(playerID)
	if !exists || window.WindowID == "" {
		return state.LibraryWindow{}, libraryWindowError(commandType, LibraryWindowCodeNotFound, windowID, expectedEpoch, currentEpoch, len(selectedIDs), -1)
	}
	if window.WindowID != windowID {
		return state.LibraryWindow{}, libraryWindowError(commandType, LibraryWindowCodeStale, windowID, expectedEpoch, currentEpoch, len(selectedIDs), -1)
	}
	if window.Status == "consumed" {
		return state.LibraryWindow{}, libraryWindowError(commandType, LibraryWindowCodeConsumed, windowID, expectedEpoch, currentEpoch, len(selectedIDs), -1)
	}
	if window.Status != "active" {
		return state.LibraryWindow{}, libraryWindowError(commandType, LibraryWindowCodeStale, windowID, expectedEpoch, currentEpoch, len(selectedIDs), -1)
	}
	if window.ExpectedEpoch != expectedEpoch || currentEpoch != expectedEpoch {
		return state.LibraryWindow{}, libraryWindowError(commandType, LibraryWindowCodeEpochMismatch, windowID, expectedEpoch, currentEpoch, len(selectedIDs), -1)
	}
	currentTop, peekErr := state.NewLibraryOps().PeekTop(game, playerID, len(window.InstanceIDs))
	if peekErr != nil || !sameLibraryBatchOrder(currentTop, window.InstanceIDs) {
		return state.LibraryWindow{}, libraryWindowError(commandType, LibraryWindowCodeOrderMismatch, windowID, expectedEpoch, currentEpoch, len(selectedIDs), -1)
	}
	allowed := make(map[string]struct{}, len(window.InstanceIDs))
	for _, instanceID := range window.InstanceIDs {
		allowed[instanceID] = struct{}{}
	}
	seen := make(map[string]struct{}, len(selectedIDs))
	for index, instanceID := range selectedIDs {
		if _, duplicate := seen[instanceID]; duplicate {
			return state.LibraryWindow{}, libraryWindowError(commandType, LibraryWindowCodeDuplicateInstance, windowID, expectedEpoch, currentEpoch, len(selectedIDs), index)
		}
		seen[instanceID] = struct{}{}
		if _, permitted := allowed[instanceID]; !permitted {
			return state.LibraryWindow{}, libraryWindowError(commandType, LibraryWindowCodeInstanceMissing, windowID, expectedEpoch, currentEpoch, len(selectedIDs), index)
		}
		location, located := game.GetLocation(instanceID)
		if !located || location.PlayerID != playerID || location.Zone != state.ZoneLibrary {
			return state.LibraryWindow{}, libraryWindowError(commandType, LibraryWindowCodeSelectionMismatch, windowID, expectedEpoch, currentEpoch, len(selectedIDs), index)
		}
	}
	return window, nil
}

func validateLibraryBatchDestination(command protocol.CommandEnvelopeV2) (state.Zone, string, bool, error) {
	toZone, err := zoneField(command.Payload, "toZone")
	if err != nil {
		return "", "", false, libraryWindowError(command.Type, LibraryWindowCodeInvalidDestination, optionalPayloadString(command.Payload, "windowId"), 0, 0, 0, -1)
	}
	switch toZone {
	case state.ZoneHand, state.ZoneBattlefield, state.ZoneGraveyard, state.ZoneExile, state.ZoneLibrary:
	default:
		return "", "", false, libraryWindowError(command.Type, LibraryWindowCodeInvalidDestination, optionalPayloadString(command.Payload, "windowId"), 0, 0, 0, -1)
	}
	position, _ := command.Payload["position"].(string)
	if toZone == state.ZoneLibrary && position != "top" && position != "bottom" {
		return "", "", false, libraryWindowError(command.Type, LibraryWindowCodeInvalidDestination, optionalPayloadString(command.Payload, "windowId"), 0, 0, 0, -1)
	}
	faceDown, hasFaceDown := boolField(command.Payload, "faceDown")
	if hasFaceDown && faceDown && toZone != state.ZoneBattlefield {
		return "", "", false, libraryWindowError(command.Type, LibraryWindowCodeInvalidFaceDown, optionalPayloadString(command.Payload, "windowId"), 0, 0, 0, -1)
	}
	if toZone != state.ZoneBattlefield {
		faceDown = false
	}
	return toZone, position, faceDown, nil
}

func newLibraryWindowID() (string, error) {
	var bytes [16]byte
	if _, err := cryptorand.Read(bytes[:]); err != nil {
		return "", fmt.Errorf("generate library window id: %w", err)
	}
	return "lw_" + hex.EncodeToString(bytes[:]), nil
}

func libraryWindowError(commandType string, code string, windowID string, expectedEpoch int64, currentEpoch int64, count int, index int) error {
	return &LibraryWindowError{Code: code, CommandType: commandType, WindowID: windowID, ExpectedEpoch: expectedEpoch, CurrentEpoch: currentEpoch, Count: count, Index: index}
}

func sameLibraryBatchOrder(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func reverseLibraryBatchIDs(values []string) {
	for left, right := 0, len(values)-1; left < right; left, right = left+1, right-1 {
		values[left], values[right] = values[right], values[left]
	}
}
