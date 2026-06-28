package actor

import (
	"context"
	"fmt"
	"time"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

const (
	mulliganRuleLondon    = "LONDON"
	mulliganRuleVancouver = "VANCOUVER"
	mulliganRuleParis     = "PARIS"
	mulliganRuleGenerous  = "GENEROUS"

	bottomOrderNone         = "NONE"
	bottomOrderPlayerChosen = "PLAYER_CHOSEN_ORDER"
	bottomOrderServerSide   = "RANDOM_SERVER_SIDE"
	scryModeNone            = "NONE"
	scryModeVancouver       = "VANCOUVER"
)

type MulliganTakeApplier struct{}

func (MulliganTakeApplier) Type() string { return "mulligan.take" }

func (MulliganTakeApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	if err := ensureMulliganReady(game, command.Payload); err != nil {
		return nil, err
	}
	if _, ok := game.Players[playerID]; !ok {
		return nil, fmt.Errorf("%w: playerId", ErrInvalidPayloadField)
	}
	player := mulliganPlayer(game, playerID)
	if player.Status == state.MulliganStatusReady {
		return nil, fmt.Errorf("%w: player already ready", ErrInvalidPayloadField)
	}
	player.MulliganCount++
	player = calculateMulliganPlayer(game.Mulligan, player.MulliganCount, state.MulliganStatusDeciding)

	handBefore := append([]string(nil), game.Zones[playerID].Hand...)
	if err := moveHandToLibraryAndShuffle(game, playerID, handBefore); err != nil {
		return nil, err
	}
	drawn, err := state.NewLibraryOps().DrawMany(game, playerID, playerDrawCount(game.Mulligan, player.MulliganCount))
	if err != nil {
		return nil, err
	}
	player.CurrentHandSize = len(game.Zones[playerID].Hand)
	game.Mulligan.PlayerStatus[playerID] = player
	delete(game.Mulligan.ReadyPlayers, playerID)

	emitMulliganPublic(emitter, game, playerID)
	emitMulliganPrivate(emitter, game, playerID)
	emitZoneCount(emitter, game, playerID, state.ZoneHand)
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)

	return mulliganEventPayload("mulligan.player_took", game, playerID, map[string]any{
		"returnedIds": handBefore,
		"drawnIds":    drawn,
		"metrics":     mulliganMetrics("mulligan.take_ms", start),
	}), nil
}

type MulliganKeepApplier struct{}

func (MulliganKeepApplier) Type() string { return "mulligan.keep" }

func (MulliganKeepApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	if err := ensureMulliganReady(game, command.Payload); err != nil {
		return nil, err
	}
	player := mulliganPlayer(game, playerID)
	if player.Status != state.MulliganStatusDeciding {
		return nil, fmt.Errorf("%w: player status", ErrInvalidPayloadField)
	}
	selected := []string{}
	if _, hasBottomCards := command.Payload["bottomCardIds"]; hasBottomCards {
		selected, err = stringSliceField(command.Payload, "bottomCardIds")
		if err != nil {
			return nil, err
		}
	}
	if player.CardsToBottom > 0 {
		if len(selected) == 0 {
			player.Status = state.MulliganStatusBottoming
			player.BottomPending = true
			game.Mulligan.PlayerStatus[playerID] = player
			emitMulliganPublic(emitter, game, playerID)
			emitMulliganPrivate(emitter, game, playerID)
			return mulliganEventPayload("mulligan.player_kept", game, playerID, map[string]any{
				"metrics": mulliganMetrics("mulligan.keep_ms", start),
			}), nil
		}
		if err := bottomSelectedCards(game, playerID, selected, player.CardsToBottom); err != nil {
			return nil, err
		}
	}
	player.CurrentHandSize = len(game.Zones[playerID].Hand)
	player.BottomPending = false
	player.CardsToBottom = 0
	if player.ScryPending {
		top, err := state.NewLibraryOps().PeekTop(game, playerID, 1)
		if err != nil {
			return nil, err
		}
		player.Status = state.MulliganStatusScrying
		player.ScryCardInstanceID = top[0]
	} else {
		player.Status = state.MulliganStatusReady
		game.Mulligan.ReadyPlayers[playerID] = true
	}
	game.Mulligan.PlayerStatus[playerID] = player
	completeIfAllReady(game, emitter)
	emitMulliganPublic(emitter, game, playerID)
	emitMulliganPrivate(emitter, game, playerID)
	emitZoneCount(emitter, game, playerID, state.ZoneHand)
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)

	return mulliganEventPayload("mulligan.player_kept", game, playerID, map[string]any{
		"bottomedIds": selected,
		"metrics":     mulliganMetrics("mulligan.keep_ms", start),
	}), nil
}

type MulliganCardsBottomedApplier struct{}

func (MulliganCardsBottomedApplier) Type() string { return "mulligan.cards_bottomed" }

func (MulliganCardsBottomedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	selected, err := stringSliceField(command.Payload, "bottomCardIds")
	if err != nil {
		return nil, err
	}
	if err := ensureMulliganReady(game, command.Payload); err != nil {
		return nil, err
	}
	player := mulliganPlayer(game, playerID)
	if !player.BottomPending {
		return nil, fmt.Errorf("%w: bottom not pending", ErrInvalidPayloadField)
	}
	if err := bottomSelectedCards(game, playerID, selected, player.CardsToBottom); err != nil {
		return nil, err
	}
	player.CurrentHandSize = len(game.Zones[playerID].Hand)
	player.BottomPending = false
	player.CardsToBottom = 0
	if player.ScryPending {
		top, err := state.NewLibraryOps().PeekTop(game, playerID, 1)
		if err != nil {
			return nil, err
		}
		player.Status = state.MulliganStatusScrying
		player.ScryCardInstanceID = top[0]
	} else {
		player.Status = state.MulliganStatusReady
		game.Mulligan.ReadyPlayers[playerID] = true
	}
	game.Mulligan.PlayerStatus[playerID] = player
	completeIfAllReady(game, emitter)
	emitMulliganPublic(emitter, game, playerID)
	emitMulliganPrivate(emitter, game, playerID)
	emitZoneCount(emitter, game, playerID, state.ZoneHand)
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)

	return mulliganEventPayload("mulligan.cards_bottomed", game, playerID, map[string]any{
		"bottomedIds": selected,
		"metrics":     mulliganMetrics("mulligan.bottom_cards_ms", start),
	}), nil
}

type MulliganScryConfirmApplier struct{}

func (MulliganScryConfirmApplier) Type() string { return "mulligan.scry.confirm" }

func (MulliganScryConfirmApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := time.Now()
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	choice, err := stringField(command.Payload, "choice")
	if err != nil {
		return nil, err
	}
	if err := ensureMulliganReady(game, command.Payload); err != nil {
		return nil, err
	}
	player := mulliganPlayer(game, playerID)
	if player.Status != state.MulliganStatusScrying {
		return nil, fmt.Errorf("%w: player status", ErrInvalidPayloadField)
	}
	top, err := state.NewLibraryOps().PeekTop(game, playerID, 1)
	if err != nil {
		return nil, err
	}
	moved := []string{}
	if choice == "bottom" {
		moved, err = state.NewLibraryOps().MoveTopToBottom(game, playerID, 1)
		if err != nil {
			return nil, err
		}
	} else if choice != "top" {
		return nil, fmt.Errorf("%w: choice", ErrInvalidPayloadField)
	}
	player.Status = state.MulliganStatusReady
	player.ScryPending = false
	player.ScryCardInstanceID = ""
	game.Mulligan.PlayerStatus[playerID] = player
	game.Mulligan.ReadyPlayers[playerID] = true
	completeIfAllReady(game, emitter)
	emitMulliganPublic(emitter, game, playerID)
	emitMulliganPrivate(emitter, game, playerID)
	emitZoneCount(emitter, game, playerID, state.ZoneLibrary)

	return mulliganEventPayload("mulligan.scry_confirmed", game, playerID, map[string]any{
		"choice":   choice,
		"topId":    top[0],
		"movedIds": moved,
		"metrics":  mulliganMetrics("mulligan.scry_confirm_ms", start),
	}), nil
}

type MulliganReadyApplier struct{}

func (MulliganReadyApplier) Type() string { return "mulligan.ready" }

func (MulliganReadyApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	playerID, err := stringField(command.Payload, "playerId")
	if err != nil {
		return nil, err
	}
	if err := ensureMulliganReady(game, command.Payload); err != nil {
		return nil, err
	}
	player := mulliganPlayer(game, playerID)
	if player.BottomPending || player.ScryPending {
		return nil, fmt.Errorf("%w: pending mulligan action", ErrInvalidPayloadField)
	}
	player.Status = state.MulliganStatusReady
	game.Mulligan.PlayerStatus[playerID] = player
	game.Mulligan.ReadyPlayers[playerID] = true
	completeIfAllReady(game, emitter)
	emitMulliganPublic(emitter, game, playerID)
	return mulliganEventPayload("mulligan.player_ready", game, playerID, nil), nil
}

type MulliganCompletedApplier struct{}

func (MulliganCompletedApplier) Type() string { return "mulligan.completed" }

func (MulliganCompletedApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	if err := ensureMulliganReady(game, command.Payload); err != nil {
		return nil, err
	}
	for playerID := range game.Players {
		if !game.Mulligan.ReadyPlayers[playerID] {
			return nil, fmt.Errorf("%w: readyPlayers", ErrInvalidPayloadField)
		}
	}
	game.Mulligan.Completed = true
	game.Phase = state.PhasePlaying
	game.Status = "playing"
	emitter.EmitPublic(protocol.PatchOp{Op: "mulligan.completed", Data: map[string]any{"completed": true}})
	emitter.EmitPublic(protocol.PatchOp{Op: "game.phase.set", Data: map[string]any{"phase": state.PhasePlaying}})
	return map[string]any{"_eventType": "mulligan.completed", "phase": state.PhasePlaying, "mulligan": game.Mulligan}, nil
}

type GamePhaseSetApplier struct{}

func (GamePhaseSetApplier) Type() string { return "game.phase.set" }

func (GamePhaseSetApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	phaseValue, err := stringField(command.Payload, "phase")
	if err != nil {
		return nil, err
	}
	phase := state.GamePhase(phaseValue)
	switch phase {
	case state.PhasePregame, state.PhaseMulligan, state.PhasePlaying, state.PhaseFinished:
	default:
		return nil, fmt.Errorf("%w: phase", ErrInvalidPayloadField)
	}
	game.Phase = phase
	game.Status = phaseStatus(phase)
	emitter.EmitPublic(protocol.PatchOp{Op: "game.phase.set", Data: map[string]any{"phase": phase}})
	return map[string]any{"_eventType": "game.phase_changed", "phase": phase}, nil
}

func ensureMulliganReady(game *state.GameState, payload map[string]any) error {
	if game.Phase == "" {
		if game.Status == "mulligan" {
			game.Phase = state.PhaseMulligan
		} else {
			game.Phase = state.PhaseMulligan
			game.Status = "mulligan"
		}
	}
	if game.Phase != state.PhaseMulligan {
		return fmt.Errorf("%w: phase", ErrInvalidPayloadField)
	}
	if value, ok := payload["rule"].(string); ok && value != "" {
		game.Mulligan.Rule = normalizeMulliganRule(value)
	}
	if game.Mulligan.Rule == "" {
		game.Mulligan.Rule = mulliganRuleLondon
	}
	if game.Mulligan.PlayerStatus == nil {
		game.Mulligan.PlayerStatus = map[string]state.MulliganPlayerState{}
	}
	if game.Mulligan.ReadyPlayers == nil {
		game.Mulligan.ReadyPlayers = map[string]bool{}
	}
	if game.Mulligan.ScryMode == "" {
		game.Mulligan.ScryMode = scryModeNone
	}
	return nil
}

func mulliganPlayer(game *state.GameState, playerID string) state.MulliganPlayerState {
	player, ok := game.Mulligan.PlayerStatus[playerID]
	if !ok || player.Status == "" {
		player = calculateMulliganPlayer(game.Mulligan, 0, state.MulliganStatusDeciding)
		player.CurrentHandSize = len(game.Zones[playerID].Hand)
	}
	return player
}

func calculateMulliganPlayer(mulligan state.MulliganState, count int, status state.MulliganPlayerStatus) state.MulliganPlayerState {
	effective := count
	if mulligan.FirstMulliganFree && effective > 0 {
		effective--
	}
	drawCount := drawCountForRule(mulligan.Rule, effective)
	cardsToBottom := bottomCountForRule(mulligan.Rule, drawCount, effective)
	return state.MulliganPlayerState{
		Status:             status,
		MulliganCount:      count,
		EffectiveMulligans: effective,
		CurrentHandSize:    drawCount,
		CardsToBottom:      cardsToBottom,
		BottomPending:      cardsToBottom > 0,
		ScryPending:        mulligan.Rule == mulliganRuleVancouver && effective > 0,
		BottomOrderMode:    bottomOrderModeForRule(mulligan.Rule, cardsToBottom),
		ScryMode:           scryModeForRule(mulligan.Rule, effective),
	}
}

func drawCountForRule(rule string, effective int) int {
	switch normalizeMulliganRule(rule) {
	case mulliganRuleLondon:
		return 7
	case mulliganRuleGenerous:
		return maxInt(0, 10-effective)
	default:
		return maxInt(0, 7-effective)
	}
}

func bottomCountForRule(rule string, drawCount int, effective int) int {
	switch normalizeMulliganRule(rule) {
	case mulliganRuleLondon:
		return effective
	case mulliganRuleGenerous:
		return maxInt(0, drawCount-7)
	default:
		return 0
	}
}

func bottomOrderModeForRule(rule string, bottomCount int) string {
	switch normalizeMulliganRule(rule) {
	case mulliganRuleLondon:
		return bottomOrderPlayerChosen
	case mulliganRuleGenerous:
		if bottomCount > 0 {
			return bottomOrderServerSide
		}
	}
	return bottomOrderNone
}

func scryModeForRule(rule string, effective int) string {
	if normalizeMulliganRule(rule) == mulliganRuleVancouver && effective > 0 {
		return scryModeVancouver
	}
	return scryModeNone
}

func playerDrawCount(mulligan state.MulliganState, count int) int {
	player := calculateMulliganPlayer(mulligan, count, state.MulliganStatusDeciding)
	return player.CurrentHandSize
}

func normalizeMulliganRule(rule string) string {
	switch rule {
	case mulliganRuleLondon, mulliganRuleVancouver, mulliganRuleParis, mulliganRuleGenerous:
		return rule
	default:
		return mulliganRuleLondon
	}
}

func moveHandToLibraryAndShuffle(game *state.GameState, playerID string, handIDs []string) error {
	for _, instanceID := range handIDs {
		if _, err := state.RemoveFromCurrentZone(game, instanceID); err != nil {
			return err
		}
	}
	if err := state.NewLibraryOps().PutManyOnBottom(game, playerID, handIDs); err != nil {
		return err
	}
	return state.NewLibraryOps().Shuffle(game, playerID)
}

func bottomSelectedCards(game *state.GameState, playerID string, selected []string, required int) error {
	if len(selected) != required {
		return fmt.Errorf("%w: bottomCardIds", ErrInvalidPayloadField)
	}
	seen := map[string]bool{}
	for _, instanceID := range selected {
		if seen[instanceID] {
			return fmt.Errorf("%w: duplicate bottomCardIds", ErrInvalidPayloadField)
		}
		seen[instanceID] = true
		location, ok := game.GetLocation(instanceID)
		if !ok || location.PlayerID != playerID || location.Zone != state.ZoneHand {
			return fmt.Errorf("%w: bottomCardIds", ErrInvalidPayloadField)
		}
	}
	for _, instanceID := range selected {
		if _, err := state.RemoveFromCurrentZone(game, instanceID); err != nil {
			return err
		}
	}
	return state.NewLibraryOps().PutManyOnBottom(game, playerID, selected)
}

func completeIfAllReady(game *state.GameState, emitter *PatchEmitter) {
	if len(game.Players) == 0 {
		return
	}
	for playerID := range game.Players {
		if !game.Mulligan.ReadyPlayers[playerID] {
			return
		}
	}
	game.Mulligan.Completed = true
	game.Phase = state.PhasePlaying
	game.Status = "playing"
	emitter.EmitPublic(protocol.PatchOp{Op: "mulligan.completed", Data: map[string]any{"completed": true}})
	emitter.EmitPublic(protocol.PatchOp{Op: "game.phase.set", Data: map[string]any{"phase": state.PhasePlaying}})
}

func emitMulliganPublic(emitter *PatchEmitter, game *state.GameState, playerID string) {
	player := mulliganPlayer(game, playerID)
	emitter.EmitPublic(protocol.PatchOp{Op: "mulligan.status.set", Data: map[string]any{
		"playerId":           playerID,
		"status":             player.Status,
		"effectiveMulligans": player.EffectiveMulligans,
		"ready":              game.Mulligan.ReadyPlayers[playerID],
	}})
	emitter.EmitPublic(protocol.PatchOp{Op: "mulligan.hand.count.set", Data: map[string]any{
		"playerId": playerID,
		"count":    len(game.Zones[playerID].Hand),
	}})
	if player.BottomPending {
		emitter.EmitPublic(protocol.PatchOp{Op: "mulligan.bottom.required.set", Data: map[string]any{
			"playerId": playerID,
			"count":    player.CardsToBottom,
			"pending":  true,
		}})
	}
}

func emitMulliganPrivate(emitter *PatchEmitter, game *state.GameState, playerID string) {
	player := mulliganPlayer(game, playerID)
	hand := compactHandForViewer(game, playerID)
	emitter.EmitPrivate(playerID, protocol.PatchOp{Op: "mulligan.private_state.set", Data: map[string]any{
		"playerId": playerID,
		"state": map[string]any{
			"status":             player.Status,
			"effectiveMulligans": player.EffectiveMulligans,
			"handSize":           len(hand),
			"cardsToBottom":      player.CardsToBottom,
			"bottomPending":      player.BottomPending,
			"scryPending":        player.Status == state.MulliganStatusScrying || player.ScryPending,
		},
	}})
	emitter.EmitPrivate(playerID, protocol.PatchOp{Op: "mulligan.hand.replace_private", Data: map[string]any{
		"playerId": playerID,
		"hand":     hand,
	}})
	if player.Status == state.MulliganStatusScrying && player.ScryCardInstanceID != "" {
		emitter.EmitPrivate(playerID, protocol.PatchOp{Op: "mulligan.scry.available.set", Data: map[string]any{
			"playerId":  playerID,
			"available": true,
			"card":      compactCard(game, player.ScryCardInstanceID, true),
		}})
	}
}

func compactHandForViewer(game *state.GameState, playerID string) []map[string]any {
	hand := game.Zones[playerID].Hand
	cards := make([]map[string]any, 0, len(hand))
	for _, instanceID := range hand {
		cards = append(cards, compactCard(game, instanceID, true))
	}
	return cards
}

func compactCard(game *state.GameState, instanceID string, includeCardKey bool) map[string]any {
	instance := game.Instances[instanceID]
	card := map[string]any{"instanceId": instanceID}
	if includeCardKey && instance.CardKey != "" {
		card["cardKey"] = instance.CardKey
	}
	return card
}

func mulliganEventPayload(eventType string, game *state.GameState, playerID string, extra map[string]any) map[string]any {
	payload := map[string]any{
		"_eventType":   eventType,
		"playerId":     playerID,
		"phase":        game.Phase,
		"mulligan":     game.Mulligan,
		"handIds":      append([]string(nil), game.Zones[playerID].Hand...),
		"libraryOrder": append([]string(nil), game.Zones[playerID].Library...),
	}
	for key, value := range extra {
		payload[key] = value
	}
	return payload
}

func mulliganMetrics(durationKey string, start time.Time) map[string]any {
	return map[string]any{
		durationKey:                      float64(time.Since(start).Microseconds()) / 1000,
		"mulligan.private_payload_bytes": 0,
		"mulligan.public_payload_bytes":  0,
		"mulligan.full_scan_count":       0,
		"mulligan.library_reindex_count": 0,
		"mulligan.snapshot_write_count":  0,
	}
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}

func phaseStatus(phase state.GamePhase) string {
	switch phase {
	case state.PhasePregame:
		return "pregame"
	case state.PhaseMulligan:
		return "mulligan"
	case state.PhasePlaying:
		return "playing"
	case state.PhaseFinished:
		return "finished"
	default:
		return string(phase)
	}
}

func BootstrapV2ForViewer(game state.GameState, viewerID string) map[string]any {
	players := map[string]any{}
	zones := map[string]any{}
	instances := map[string]any{}
	zoneCounts := map[string]any{}
	for playerID, player := range game.Players {
		players[playerID] = cloneMap(player)
		playerZones := game.Zones[playerID]
		zoneCounts[playerID] = map[string]any{
			"hand":        len(playerZones.Hand),
			"library":     len(playerZones.Library),
			"battlefield": len(playerZones.Battlefield),
			"graveyard":   len(playerZones.Graveyard),
			"exile":       len(playerZones.Exile),
			"command":     len(playerZones.Command),
		}
		if playerID == viewerID {
			zones[playerID] = map[string]any{
				"hand":    append([]string(nil), playerZones.Hand...),
				"library": []string{},
			}
			for _, instanceID := range playerZones.Hand {
				instances[instanceID] = compactCard(&game, instanceID, true)
			}
		} else {
			zones[playerID] = map[string]any{
				"hand":    []string{},
				"library": []string{},
			}
		}
	}
	return map[string]any{
		"game": map[string]any{
			"gameId":  game.GameID,
			"phase":   game.Phase,
			"version": game.Version,
		},
		"players":    players,
		"zones":      zones,
		"instances":  instances,
		"zoneCounts": zoneCounts,
		"mulligan":   game.Mulligan,
	}
}
