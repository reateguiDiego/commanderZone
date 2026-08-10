package actor

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

func TestLibraryDrawEmitsPrivateCardKeyAndPublicCounts(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "draw-1", "library.draw", map[string]any{"playerId": "p1"}), "p1")
	if result.Err != nil {
		t.Fatalf("draw failed: %v", result.Err)
	}
	var privateCards int
	var publicCounts int
	for _, envelope := range result.Patches {
		for _, op := range envelope.Ops {
			if op.Op == "zone.cards.add" {
				if envelope.Visibility != "player:p1" {
					t.Fatalf("card payload leaked outside owner visibility: %s", envelope.Visibility)
				}
				cards := op.Data["cards"].([]map[string]any)
				if cards[0]["cardKey"] == nil {
					t.Fatal("owner did not receive cardKey")
				}
				if cards[0]["printId"] != cards[0]["cardKey"] || cards[0]["cardVersion"] != "runtime-identity-v1" || cards[0]["language"] != "en" || cards[0]["viewerVisibility"] != "private" {
					t.Fatalf("owner did not receive complete private identity: %#v", cards[0])
				}
				privateCards++
			}
			if op.Op == "zone.count.set" {
				if _, leaked := op.Data["cardKey"]; leaked {
					t.Fatal("count patch leaked cardKey")
				}
				publicCounts++
			}
		}
	}
	if privateCards != 1 || publicCounts != 2 {
		t.Fatalf("patch counts private=%d public=%d", privateCards, publicCounts)
	}
}

func TestRuntimeCommandEmitsIdempotentGameLogEntry(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	cmd := command("game-1", 1, "draw-log", "library.draw", map[string]any{"playerId": "p1"})

	result := gameActor.ApplyDirect(context.Background(), cmd, "p1")
	if result.Err != nil {
		t.Fatalf("draw failed: %v", result.Err)
	}
	logPatch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "eventLog.append")
	if logPatch == nil {
		t.Fatalf("missing eventLog.append patch: %#v", result.Patches)
	}
	entries := logPatch.Data["entries"].([]map[string]any)
	if len(entries) != 1 || entries[0]["type"] != "library.draw" || entries[0]["actorId"] != "p1" {
		t.Fatalf("bad draw log entry: %#v", entries)
	}
	eventEntries := result.Event.Payload["eventLogEntries"].([]map[string]any)
	if len(eventEntries) != 1 || eventEntries[0]["id"] != entries[0]["id"] {
		t.Fatalf("event payload did not carry matching log entry: patch=%#v event=%#v", entries, eventEntries)
	}

	retry := gameActor.ApplyDirect(context.Background(), cmd, "p1")
	if retry.Err != nil {
		t.Fatalf("retry failed: %v", retry.Err)
	}
	retryLogPatch := patchForVisibility(retry.Patches, protocol.VisibilityPublic, "eventLog.append")
	if retryLogPatch == nil {
		t.Fatalf("missing retry eventLog.append patch: %#v", retry.Patches)
	}
	retryEntries := retryLogPatch.Data["entries"].([]map[string]any)
	if len(retryEntries) != 1 || retryEntries[0]["id"] != entries[0]["id"] {
		t.Fatalf("retry produced a different log entry: first=%#v retry=%#v", entries, retryEntries)
	}
}

func TestDiceRolledEmitsServerResultPatchAndGameLog(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "dice-d20", "dice.rolled", map[string]any{
		"playerId": "p1",
		"kind":     "d20",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("dice failed: %v", result.Err)
	}
	dicePatch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "dice.result")
	if dicePatch == nil {
		t.Fatalf("missing dice.result patch: %#v", result.Patches)
	}
	if dicePatch.Data["playerId"] != "p1" || dicePatch.Data["kind"] != "d20" {
		t.Fatalf("bad dice patch metadata: %#v", dicePatch.Data)
	}
	value, ok := intFromAny(dicePatch.Data["result"])
	if !ok || value < 1 || value > 20 {
		t.Fatalf("dice result out of range: %#v", dicePatch.Data)
	}
	if dicePatch.Data["value"] != dicePatch.Data["result"] {
		t.Fatalf("dice patch must carry value compatibility field: %#v", dicePatch.Data)
	}
	logPatch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "eventLog.append")
	if logPatch == nil {
		t.Fatalf("missing dice log patch: %#v", result.Patches)
	}
	entries := logPatch.Data["entries"].([]map[string]any)
	if len(entries) != 1 || entries[0]["type"] != "dice.rolled" {
		t.Fatalf("bad dice log entry: %#v", entries)
	}
}

func TestLifeChangedEmitsGameLogEntry(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "life-log", "life.changed", map[string]any{
		"playerId": "p1",
		"delta":    -3,
	}), "p1")
	if result.Err != nil {
		t.Fatalf("life failed: %v", result.Err)
	}
	if result.Event.Payload["previousLife"] != 40 || result.Event.Payload["life"] != 37 || result.Event.Payload["delta"] != -3 {
		t.Fatalf("life event payload missing before/after: %#v", result.Event.Payload)
	}
	logPatch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "eventLog.append")
	if logPatch == nil {
		t.Fatalf("missing life log patch: %#v", result.Patches)
	}
	entries := logPatch.Data["entries"].([]map[string]any)
	if len(entries) != 1 || entries[0]["type"] != "life.changed" {
		t.Fatalf("bad life log entry: %#v", entries)
	}
}

func TestLibraryShuffleEmitsCompactGameLogEntry(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "shuffle-log", "library.shuffle", map[string]any{"playerId": "p1"}), "p1")
	if result.Err != nil {
		t.Fatalf("shuffle failed: %v", result.Err)
	}

	logPatch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "eventLog.append")
	if logPatch == nil {
		t.Fatalf("missing eventLog.append patch: %#v", result.Patches)
	}
	entries := logPatch.Data["entries"].([]map[string]any)
	if len(entries) != 1 || entries[0]["type"] != "library.shuffle" || entries[0]["actorId"] != "p1" {
		t.Fatalf("bad shuffle log entry: %#v", entries)
	}
	if message, _ := entries[0]["message"].(string); !strings.Contains(message, "shuffled their library") {
		t.Fatalf("bad shuffle log message: %#v", entries[0])
	}
	if _, leaked := entries[0]["cardNames"]; leaked {
		t.Fatalf("shuffle log must not include card names: %#v", entries[0])
	}
	encoded := fmt.Sprintf("%#v", entries[0])
	if contains(encoded, "cardKey") || contains(encoded, "library-") {
		t.Fatalf("shuffle log leaked library identity/order: %s", encoded)
	}

	eventEntries := result.Event.Payload["eventLogEntries"].([]map[string]any)
	if len(eventEntries) != 1 || eventEntries[0]["id"] != entries[0]["id"] {
		t.Fatalf("event payload did not carry matching shuffle log entry: patch=%#v event=%#v", entries, eventEntries)
	}
}

func TestRuntimeP0GameLogEntriesCarrySemanticI18nMetadata(t *testing.T) {
	tests := []struct {
		name       string
		initial    state.GameState
		command    protocol.CommandEnvelopeV2
		actorID    string
		i18nKey    string
		assertions func(t *testing.T, entry map[string]any)
	}{
		{
			name:    "draw one",
			initial: testState(),
			command: command("game-1", 1, "i18n-draw-one", "library.draw", map[string]any{"playerId": "p1"}),
			actorID: "p1",
			i18nKey: "gameLog.library.draw",
			assertions: func(t *testing.T, entry map[string]any) {
				params := requireMap(t, entry["params"])
				if params["count"] != 1 || params["playerId"] != "p1" {
					t.Fatalf("bad draw params: %#v", params)
				}
				assertNoPrivateCardIdentity(t, entry)
			},
		},
		{
			name:    "draw many",
			initial: testState(),
			command: command("game-1", 1, "i18n-draw-many", "library.draw_many", map[string]any{"playerId": "p1", "count": 2}),
			actorID: "p1",
			i18nKey: "gameLog.library.drawMany",
			assertions: func(t *testing.T, entry map[string]any) {
				params := requireMap(t, entry["params"])
				if params["count"] != 2 {
					t.Fatalf("bad draw_many params: %#v", params)
				}
				assertNoPrivateCardIdentity(t, entry)
			},
		},
		{
			name:    "shuffle",
			initial: testState(),
			command: command("game-1", 1, "i18n-shuffle", "library.shuffle", map[string]any{"playerId": "p1"}),
			actorID: "p1",
			i18nKey: "gameLog.library.shuffle",
			assertions: func(t *testing.T, entry map[string]any) {
				assertNoPrivateCardIdentity(t, entry)
			},
		},
		{
			name:    "move card",
			initial: testState(),
			command: command("game-1", 1, "i18n-move", "card.moved", map[string]any{"playerId": "p1", "fromZone": "hand", "toZone": "battlefield", "instanceId": "h1"}),
			actorID: "p1",
			i18nKey: "gameLog.card.moved",
			assertions: func(t *testing.T, entry map[string]any) {
				params := requireMap(t, entry["params"])
				if params["fromZone"] != "hand" || params["toZone"] != "battlefield" || params["cardInstanceId"] != "h1" {
					t.Fatalf("bad move params: %#v", params)
				}
				cardRef := requireCardRef(t, entry, "h1")
				if cardRef["visibility"] != "public" || cardRef["cardKey"] == "" {
					t.Fatalf("public move should expose public card ref only after reveal: %#v", cardRef)
				}
			},
		},
		{
			name:    "tap card",
			initial: testState(),
			command: command("game-1", 1, "i18n-tap", "card.tapped", map[string]any{"instanceId": "i1", "tapped": true}),
			actorID: "p1",
			i18nKey: "gameLog.card.tapped",
			assertions: func(t *testing.T, entry map[string]any) {
				params := requireMap(t, entry["params"])
				if params["tapped"] != true || params["cardInstanceId"] != "i1" {
					t.Fatalf("bad tap params: %#v", params)
				}
			},
		},
		{
			name:    "card counter",
			initial: stateIntegrityCounterState(t),
			command: command("game-1", 1, "i18n-counter", "card.counter.changed", map[string]any{"instanceId": "i1", "counter": "+1/+1", "value": 3}),
			actorID: "p1",
			i18nKey: "gameLog.cardCounter.changed",
			assertions: func(t *testing.T, entry map[string]any) {
				params := requireMap(t, entry["params"])
				if params["counter"] != "+1/+1" || params["value"] != 3 {
					t.Fatalf("bad counter params: %#v", params)
				}
				cardRef := requireCardRef(t, entry, "i1")
				if cardRef["visibility"] != "hidden" || cardRef["cardKey"] != nil {
					t.Fatalf("face-down counter ref leaked identity: %#v", cardRef)
				}
			},
		},
		{
			name:    "life",
			initial: testState(),
			command: command("game-1", 1, "i18n-life", "life.changed", map[string]any{"playerId": "p2", "life": 37}),
			actorID: "p2",
			i18nKey: "gameLog.life.changed",
			assertions: func(t *testing.T, entry map[string]any) {
				params := requireMap(t, entry["params"])
				if params["playerId"] != "p2" || params["previousLife"] != 40 || params["life"] != 37 {
					t.Fatalf("bad life params: %#v", params)
				}
				requirePlayerRef(t, entry, "p2")
			},
		},
		{
			name:    "dice",
			initial: testState(),
			command: command("game-1", 1, "i18n-dice", "dice.rolled", map[string]any{"playerId": "p1", "kind": "d20"}),
			actorID: "p1",
			i18nKey: "gameLog.dice.rolled",
			assertions: func(t *testing.T, entry map[string]any) {
				params := requireMap(t, entry["params"])
				if params["kind"] != "d20" || params["result"] == nil {
					t.Fatalf("bad dice params: %#v", params)
				}
			},
		},
		{
			name:    "commander cast",
			initial: testStateWithCommanderInCommand(),
			command: command("game-1", 1, "i18n-commander", "card.moved", map[string]any{"playerId": "p1", "fromZone": "command", "toZone": "battlefield", "instanceId": "commander-1"}),
			actorID: "p1",
			i18nKey: "gameLog.commander.cast",
			assertions: func(t *testing.T, entry map[string]any) {
				params := requireMap(t, entry["params"])
				if params["commanderCastCount"] != 1 || params["cardInstanceId"] != "commander-1" {
					t.Fatalf("bad commander params: %#v", params)
				}
			},
		},
		{
			name:    "token created",
			initial: testState(),
			command: command("game-1", 1, "i18n-token", "card.token.created", map[string]any{"playerId": "p1", "quantity": 2, "name": "Clue"}),
			actorID: "p1",
			i18nKey: "gameLog.token.createdMany",
			assertions: func(t *testing.T, entry map[string]any) {
				params := requireMap(t, entry["params"])
				if params["count"] != 2 || params["tokenName"] != "Clue" {
					t.Fatalf("bad token params: %#v", params)
				}
			},
		},
		{
			name:    "token copy",
			initial: testState(),
			command: command("game-1", 1, "i18n-token-copy", "card.token_copy.created", map[string]any{"instanceId": "i1", "targetPlayerId": "p1"}),
			actorID: "p1",
			i18nKey: "gameLog.tokenCopy.created",
			assertions: func(t *testing.T, entry map[string]any) {
				params := requireMap(t, entry["params"])
				if params["sourceCardInstanceId"] != "i1" || params["cardInstanceId"] == "" {
					t.Fatalf("bad token copy params: %#v", params)
				}
			},
		},
		{
			name:    "concede",
			initial: testState(),
			command: command("game-1", 1, "i18n-concede", "game.concede", map[string]any{"playerId": "p1"}),
			actorID: "p1",
			i18nKey: "gameLog.game.concede",
			assertions: func(t *testing.T, entry map[string]any) {
				params := requireMap(t, entry["params"])
				if params["playerId"] != "p1" {
					t.Fatalf("bad concede params: %#v", params)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gameActor := NewGameActor("game-1", tt.initial, nil, 8, DefaultAppliers())
			result := gameActor.ApplyDirect(context.Background(), tt.command, tt.actorID)
			if result.Err != nil {
				t.Fatalf("command failed: %v", result.Err)
			}
			entry := requireRuntimeLogEntry(t, result)
			if entry["message"] == "" {
				t.Fatalf("semantic log entry must keep legacy message fallback: %#v", entry)
			}
			if entry["i18nKey"] != tt.i18nKey || entry["visibility"] != "public" {
				t.Fatalf("bad i18n fields: %#v", entry)
			}
			params := requireMap(t, entry["params"])
			if params["actorPlayerId"] != tt.actorID {
				t.Fatalf("bad actor param: %#v", params)
			}
			requirePlayerRef(t, entry, tt.actorID)
			tt.assertions(t, entry)
		})
	}
}

func TestMoveFromPrivateToPublicKeepsLocalizedOwnerIdentityAndCanonicalPublicIdentity(t *testing.T) {
	game := testState()
	instance := game.Instances["h1"]
	instance.PrintID = "spanish-print-id"
	instance.CardVersion = "localized-v1"
	instance.Language = "es"
	game.Instances["h1"] = instance
	initial := game.Clone()
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())

	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-localized", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "hand",
		"toZone":     "battlefield",
		"instanceId": "h1",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("move failed: %v", result.Err)
	}

	publicAdd := patchForVisibility(result.Patches, protocol.VisibilityPublic, "zone.cards.add")
	if publicAdd == nil {
		t.Fatalf("missing public add patch: %#v", result.Patches)
	}
	publicCards := publicAdd.Data["cards"].([]map[string]any)
	if publicCards[0]["language"] != "en" || publicCards[0]["printId"] != "hand-1@1" || publicCards[0]["viewerVisibility"] != "public" {
		t.Fatalf("bad public identity: %#v", publicCards[0])
	}

	privateMove := patchForVisibility(result.Patches, protocol.PlayerVisibility("p1"), "zone.cards.move")
	if privateMove == nil {
		t.Fatalf("missing private move patch: %#v", result.Patches)
	}
	card := privateMove.Data["card"].(map[string]any)
	if card["language"] != "es" || card["printId"] != "spanish-print-id" || card["cardVersion"] != "localized-v1" || card["viewerVisibility"] != "public" {
		t.Fatalf("bad owner identity: %#v", card)
	}
}

func TestMoveFromPrivateToPublicUsesViewerCardLanguageFromCompactPlayerPreferences(t *testing.T) {
	game := testState()
	game.Players["p1"]["user"] = map[string]any{
		"preferences": map[string]any{"cardLanguage": "es"},
	}
	gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())

	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-player-language", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "hand",
		"toZone":     "battlefield",
		"instanceId": "h1",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("move failed: %v", result.Err)
	}

	publicAdd := patchForVisibility(result.Patches, protocol.VisibilityPublic, "zone.cards.add")
	if publicAdd == nil {
		t.Fatalf("missing public add patch: %#v", result.Patches)
	}
	publicCards := publicAdd.Data["cards"].([]map[string]any)
	if publicCards[0]["language"] != "en" || publicCards[0]["viewerVisibility"] != "public" {
		t.Fatalf("bad public identity: %#v", publicCards[0])
	}

	privateMove := patchForVisibility(result.Patches, protocol.PlayerVisibility("p1"), "zone.cards.move")
	if privateMove == nil {
		t.Fatalf("missing private move patch: %#v", result.Patches)
	}
	card := privateMove.Data["card"].(map[string]any)
	if card["language"] != "es" || card["printId"] != "hand-1@1" || card["cardVersion"] != "runtime-identity-v1" || card["viewerVisibility"] != "public" {
		t.Fatalf("bad owner identity: %#v", card)
	}
}

func TestMoveFromPublicToPublicEmitsLocalizedOwnerIdentityPatch(t *testing.T) {
	game := testState()
	game.Players["p1"]["user"] = map[string]any{
		"preferences": map[string]any{"cardLanguage": "es"},
	}
	game.Instances["cmd1"] = state.CardInstanceRuntime{
		InstanceID:   "cmd1",
		CardKey:      "commander-dfc@1",
		OwnerID:      "p1",
		ControllerID: "p1",
		Zone:         state.ZoneCommand,
		IsCommander:  true,
	}
	zones := game.Zones["p1"]
	zones.Command = []string{"cmd1"}
	game.Zones["p1"] = zones
	game.Loc["cmd1"] = state.Location{PlayerID: "p1", Zone: state.ZoneCommand, Index: 0, ControllerID: "p1"}
	gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())

	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-public-localized", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "command",
		"toZone":     "battlefield",
		"instanceId": "cmd1",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("move failed: %v", result.Err)
	}

	publicMove := patchForVisibility(result.Patches, protocol.VisibilityPublic, "zone.cards.move")
	if publicMove == nil {
		t.Fatalf("missing public move patch: %#v", result.Patches)
	}
	publicCard := publicMove.Data["card"].(map[string]any)
	if publicCard["language"] != "en" || publicCard["viewerVisibility"] != "public" {
		t.Fatalf("bad public identity: %#v", publicCard)
	}

	privateMove := patchForVisibility(result.Patches, protocol.PlayerVisibility("p1"), "zone.cards.move")
	if privateMove == nil {
		t.Fatalf("missing localized private move patch: %#v", result.Patches)
	}
	card := privateMove.Data["card"].(map[string]any)
	if card["language"] != "es" || card["printId"] != "commander-dfc@1" || card["viewerVisibility"] != "public" {
		t.Fatalf("bad localized owner identity: %#v", card)
	}
}

func TestGameConcedeEmitsPlayerStatusPatchWithoutSnapshotWrite(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "concede-1", "game.concede", map[string]any{"playerId": "p1"}), "p1")
	if result.Err != nil {
		t.Fatalf("concede failed: %v", result.Err)
	}
	if result.Event.Type != "game.concede" {
		t.Fatalf("event type got %s", result.Event.Type)
	}
	metrics := result.Event.Payload["metrics"].(map[string]any)
	if metrics["lifecycle.snapshot_write_count"] != 0 {
		t.Fatalf("unexpected snapshot write metrics: %#v", metrics)
	}
	snapshot := gameActor.Snapshot()
	if snapshot.Players["p1"]["status"] != "conceded" {
		t.Fatalf("player was not conceded: %#v", snapshot.Players["p1"])
	}
	patch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "player.status.set")
	if patch == nil {
		t.Fatalf("missing player.status.set patch: %#v", result.Patches)
	}
	if patch.Data["playerId"] != "p1" || patch.Data["status"] != "conceded" {
		t.Fatalf("bad concede patch: %#v", patch)
	}

	duplicate := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "concede-1", "game.concede", map[string]any{"playerId": "p1"}), "p1")
	if duplicate.Err != nil {
		t.Fatalf("duplicate concede failed: %v", duplicate.Err)
	}
	if duplicate.Event.Version != result.Event.Version || gameActor.Snapshot().Version != 2 {
		t.Fatalf("duplicate was not idempotent: duplicate=%d state=%d", duplicate.Event.Version, gameActor.Snapshot().Version)
	}

	secondConcede := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "concede-2", "game.concede", map[string]any{"playerId": "p1"}), "p1")
	if secondConcede.Err != nil {
		t.Fatalf("idempotent second concede failed: %v", secondConcede.Err)
	}
	if gameActor.Snapshot().Version != 2 {
		t.Fatalf("idempotent second concede changed version: %d", gameActor.Snapshot().Version)
	}
	if secondConcede.Event.Version != result.Event.Version {
		t.Fatalf("idempotent second concede returned version %d want %d", secondConcede.Event.Version, result.Event.Version)
	}
}

func TestGameConcedeWithNewActionIDDoesNotAppendDuplicateEvent(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	gameActor := NewGameActor("game-1", testState(), store, 8, DefaultAppliers())
	first := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "concede-1", "game.concede", map[string]any{"playerId": "p1"}), "p1")
	if first.Err != nil {
		t.Fatalf("first concede failed: %v", first.Err)
	}
	second := gameActor.ApplyDirect(context.Background(), command("game-1", first.Event.Version, "concede-2", "game.concede", map[string]any{"playerId": "p1"}), "p1")
	if second.Err != nil {
		t.Fatalf("second concede failed: %v", second.Err)
	}
	events, err := store.EventsAfter(context.Background(), "game-1", 0)
	if err != nil {
		t.Fatalf("load events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("concede appended duplicate events: %#v", events)
	}
	if gameActor.Snapshot().Version != first.Event.Version || second.Event.Version != first.Event.Version {
		t.Fatalf("idempotent concede changed versions: first=%d second=%d state=%d", first.Event.Version, second.Event.Version, gameActor.Snapshot().Version)
	}
}

func TestThreePlayerConcedeKeepsActorAndVersionStreamHealthyForRemainingPlayers(t *testing.T) {
	game := testState()
	game.Players["p3"] = map[string]any{"life": 40, "status": "active", "counters": map[string]any{}, "commanderDamage": map[string]any{}}
	game.Turn = map[string]any{"activePlayerId": "p1", "phase": "main-1", "number": 1}
	store := persistence.NewInMemoryEventStore()
	gameActor := NewGameActor("game-1", game, store, 8, DefaultAppliers())

	concede := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "concede-p2", "game.concede", map[string]any{"playerId": "p2"}), "p2")
	if concede.Err != nil {
		t.Fatalf("concede failed: %v", concede.Err)
	}
	if snapshot := gameActor.Snapshot(); snapshot.Status == "finished" || snapshot.Phase == state.PhaseFinished {
		t.Fatalf("concede finished active game: status=%s phase=%s", snapshot.Status, snapshot.Phase)
	}
	bAfterLeave := gameActor.ApplyDirect(context.Background(), command("game-1", concede.Event.Version, "b-after-leave", "life.changed", map[string]any{"playerId": "p2", "life": 39}), "p2")
	if !errors.Is(bAfterLeave.Err, ErrActorPermission) || gameActor.Snapshot().Version != concede.Event.Version {
		t.Fatalf("conceded player retained gameplay access: result=%#v snapshot=%#v", bAfterLeave, gameActor.Snapshot())
	}

	aFirst := gameActor.ApplyDirect(context.Background(), command("game-1", concede.Event.Version, "a-after-b-left", "life.changed", map[string]any{"playerId": "p1", "life": 39}), "p1")
	if aFirst.Err != nil {
		t.Fatalf("player A action after concede failed: %v", aFirst.Err)
	}
	cAction := gameActor.ApplyDirect(context.Background(), command("game-1", aFirst.Event.Version, "c-after-b-left", "life.changed", map[string]any{"playerId": "p3", "life": 39}), "p3")
	if cAction.Err != nil {
		t.Fatalf("player C action after concede failed: %v", cAction.Err)
	}
	aSecond := gameActor.ApplyDirect(context.Background(), command("game-1", cAction.Event.Version, "a-again-after-b-left", "life.changed", map[string]any{"playerId": "p1", "life": 38}), "p1")
	if aSecond.Err != nil {
		t.Fatalf("player A second action after concede failed: %v", aSecond.Err)
	}

	snapshot := gameActor.Snapshot()
	if snapshot.Version != 5 || snapshot.Players["p2"]["status"] != "conceded" || snapshot.Players["p1"]["life"] != 38 || snapshot.Players["p3"]["life"] != 39 {
		t.Fatalf("three-player state mismatch: version=%d players=%#v", snapshot.Version, snapshot.Players)
	}
	events, err := store.EventsAfter(context.Background(), "game-1", 0)
	if err != nil {
		t.Fatalf("load events: %v", err)
	}
	if len(events) != 4 {
		t.Fatalf("event count got %d want 4: %#v", len(events), events)
	}
	for index, event := range events {
		want := int64(index + 2)
		if event.Version != want {
			t.Fatalf("event %d version got %d want %d", index, event.Version, want)
		}
	}
	if gameActor.QueueDepth() != 0 {
		t.Fatalf("mailbox did not drain after concede continuity commands: %d", gameActor.QueueDepth())
	}
}

func TestReplayRebuildsConcedeAndCloseLifecycleEvents(t *testing.T) {
	initial := testState()
	concede := protocol.EventPayloadV2{
		GameID:         "game-1",
		Version:        2,
		Type:           "game.concede",
		Payload:        map[string]any{"playerId": "p2", "status": "conceded", "concededAt": "2026-01-01T00:00:00Z"},
		CreatedBy:      "p2",
		ClientActionID: "concede-p2",
	}
	replayed, err := ReplayEvents(initial, []protocol.EventPayloadV2{concede}, DefaultAppliers())
	if err != nil {
		t.Fatalf("concede replay failed: %v", err)
	}
	if replayed.Players["p2"]["status"] != "conceded" || replayed.Status != "finished" || replayed.WinnerPlayerID != "p1" {
		t.Fatalf("concede replay lost lifecycle state: status=%s player=%#v", replayed.Status, replayed.Players["p2"])
	}

	closeEvent := protocol.EventPayloadV2{
		GameID:         "game-1",
		Version:        3,
		Type:           "game.close",
		Payload:        map[string]any{"status": "finished", "phase": string(state.PhaseFinished)},
		CreatedBy:      "p1",
		ClientActionID: "close-game",
	}
	replayed, err = ReplayEvents(initial, []protocol.EventPayloadV2{concede, closeEvent}, DefaultAppliers())
	if err != nil {
		t.Fatalf("close replay failed: %v", err)
	}
	if replayed.Status != "finished" || replayed.Phase != state.PhaseFinished {
		t.Fatalf("close replay did not finish game: status=%s phase=%s", replayed.Status, replayed.Phase)
	}
}

func TestManyTurnChangesWithInterleavedCommandsKeepStateCoherent(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	version := int64(1)
	phases := []string{"upkeep", "draw", "main-1", "combat", "main-2", "end"}
	for index := 0; index < 30; index++ {
		payload := map[string]any{"activePlayerId": "p1", "phase": phases[index%len(phases)], "number": 1 + index/len(phases)}
		result := gameActor.ApplyDirect(context.Background(), command("game-1", version, fmt.Sprintf("turn-%02d", index), "turn.changed", payload), "p1")
		if result.Err != nil {
			t.Fatalf("turn %d failed: %v", index, result.Err)
		}
		version = result.Event.Version
		switch index {
		case 3:
			draw := gameActor.ApplyDirect(context.Background(), command("game-1", version, "interleave-draw", "library.draw", map[string]any{"playerId": "p1"}), "p1")
			if draw.Err != nil {
				t.Fatalf("interleaved draw failed: %v", draw.Err)
			}
			version = draw.Event.Version
		case 8:
			tap := gameActor.ApplyDirect(context.Background(), command("game-1", version, "interleave-tap", "card.tapped", map[string]any{"instanceId": "i1", "tapped": true}), "p1")
			if tap.Err != nil {
				t.Fatalf("interleaved tap failed: %v", tap.Err)
			}
			version = tap.Event.Version
		case 12:
			counter := gameActor.ApplyDirect(context.Background(), command("game-1", version, "interleave-counter", "card.counter.changed", map[string]any{"instanceId": "i1", "counter": "charge", "value": 1}), "p1")
			if counter.Err != nil {
				t.Fatalf("interleaved counter failed: %v", counter.Err)
			}
			version = counter.Event.Version
		case 18:
			move := gameActor.ApplyDirect(context.Background(), command("game-1", version, "interleave-move", "card.moved", map[string]any{
				"playerId":   "p1",
				"fromZone":   "hand",
				"toZone":     "battlefield",
				"instanceId": "h1",
			}), "p1")
			if move.Err != nil {
				t.Fatalf("interleaved move failed: %v", move.Err)
			}
			version = move.Event.Version
		}
	}

	snapshot := gameActor.Snapshot()
	if snapshot.Version != version {
		t.Fatalf("version got %d want %d", snapshot.Version, version)
	}
	if snapshot.Turn["activePlayerId"] != "p1" || snapshot.Turn["phase"] != phases[29%len(phases)] {
		t.Fatalf("bad long-running turn state: %#v", snapshot.Turn)
	}
	if snapshot.Status == "finished" || snapshot.Phase == state.PhaseFinished {
		t.Fatalf("long-running turns finished game: status=%s phase=%s", snapshot.Status, snapshot.Phase)
	}
}

func TestGameConcedeRejectsActorMismatch(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "concede-other", "game.concede", map[string]any{"playerId": "p2"}), "p1")
	if !errors.Is(result.Err, ErrActorPermission) {
		t.Fatalf("expected actor permission error, got %v", result.Err)
	}
	if gameActor.Snapshot().Version != 1 {
		t.Fatalf("rejected concede changed version: %d", gameActor.Snapshot().Version)
	}
	if gameActor.Snapshot().Players["p2"]["status"] == "conceded" {
		t.Fatalf("actor mismatch conceded another player: %#v", gameActor.Snapshot().Players["p2"])
	}
}

func TestPlayerScopedRuntimeCommandsRejectActorMismatch(t *testing.T) {
	tests := []struct {
		name        string
		commandType string
		payload     map[string]any
		actorID     string
	}{
		{name: "life", commandType: "life.changed", payload: map[string]any{"playerId": "p2", "life": 10}, actorID: "p1"},
		{name: "commander damage", commandType: "commander.damage.changed", payload: map[string]any{"targetPlayerId": "p2", "commanderInstanceId": "commander-1", "damage": 5}, actorID: "p1"},
		{name: "library view", commandType: "library.view", payload: map[string]any{"playerId": "p2", "count": 1}, actorID: "p1"},
		{name: "card without player payload", commandType: "card.tapped", payload: map[string]any{"instanceId": "i1", "tapped": true}, actorID: "p2"},
		{name: "player counter", commandType: "counter.changed", payload: map[string]any{"scope": "player:p2", "key": "poison", "value": 1}, actorID: "p1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
			result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "permission-"+tt.name, tt.commandType, tt.payload), tt.actorID)
			if !errors.Is(result.Err, ErrActorPermission) {
				t.Fatalf("err = %v, want %v", result.Err, ErrActorPermission)
			}
			if gameActor.Snapshot().Version != 1 {
				t.Fatalf("rejected command changed version: %d", gameActor.Snapshot().Version)
			}
		})
	}
}

func TestRuntimeDuplicateActionFromDifferentActorIsRejected(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	first := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "shared-action", "life.changed", map[string]any{"playerId": "p1", "life": 39}), "p1")
	if first.Err != nil {
		t.Fatalf("first failed: %v", first.Err)
	}

	duplicate := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "shared-action", "life.changed", map[string]any{"playerId": "p1", "life": 39}), "p2")
	if !errors.Is(duplicate.Err, ErrActorPermission) {
		t.Fatalf("duplicate err = %v, want %v", duplicate.Err, ErrActorPermission)
	}
	if gameActor.Snapshot().Version != 2 {
		t.Fatalf("rejected cross-actor duplicate changed version: %d", gameActor.Snapshot().Version)
	}
}

func TestGameConcedePayloadIncludesTurnWhenActivePlayerLeaves(t *testing.T) {
	game := testState()
	game.Turn = map[string]any{"activePlayerId": "p1", "phase": "main-1", "number": 3}
	gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())

	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "concede-active", "game.concede", map[string]any{"playerId": "p1"}), "p1")
	if result.Err != nil {
		t.Fatalf("concede failed: %v", result.Err)
	}

	turn, ok := result.Event.Payload["turn"].(map[string]any)
	if !ok {
		t.Fatalf("missing replayable turn payload: %#v", result.Event.Payload)
	}
	if turn["activePlayerId"] == "p1" {
		t.Fatalf("turn did not advance away from conceded player: %#v", turn)
	}
	if patch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "turn.set"); patch == nil {
		t.Fatalf("missing turn.set patch: %#v", result.Patches)
	}
}

func TestRevealTopEmitsGroupPatchWithCardKey(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "reveal", "library.reveal_top", map[string]any{"playerId": "p1", "count": 2, "visibleToMask": 3}), "p1")
	if result.Err != nil {
		t.Fatalf("reveal failed: %v", result.Err)
	}
	found := false
	for _, envelope := range result.Patches {
		if envelope.Visibility != "group:3" {
			continue
		}
		found = true
		cards := envelope.Ops[0].Data["cards"].([]map[string]any)
		if len(cards) != 2 || cards[0]["cardKey"] == nil {
			t.Fatalf("bad reveal cards: %#v", cards)
		}
	}
	if !found {
		t.Fatal("missing group reveal patch")
	}
}

func TestRevealTopAcceptsToAliasForPrivateViewerPatch(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "reveal-to", "library.reveal_top", map[string]any{"playerId": "p1", "count": 1, "to": []any{"p1"}}), "p1")
	if result.Err != nil {
		t.Fatalf("reveal failed: %v", result.Err)
	}
	patch := patchForVisibility(result.Patches, protocol.PlayerVisibility("p1"), "library.top.revealed")
	if patch == nil {
		t.Fatalf("missing private reveal patch: %#v", result.Patches)
	}
	cards := patch.Data["cards"].([]map[string]any)
	if len(cards) != 1 || cards[0]["cardKey"] == nil {
		t.Fatalf("bad reveal cards: %#v", cards)
	}
}

func TestLibraryDrawManyMetricsAndPatchRemoveThenAdd(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "draw-7", "library.draw_many", map[string]any{"playerId": "p1", "count": 2}), "p1")
	if result.Err != nil {
		t.Fatalf("draw many failed: %v", result.Err)
	}
	metrics := result.Event.Payload["metrics"].(map[string]any)
	if metrics["library.full_scan_count"] != 0 || metrics["library.reindex_count"] != 0 {
		t.Fatalf("unexpected library metrics: %#v", metrics)
	}
	var removeBeforeAdd bool
	for _, envelope := range result.Patches {
		if envelope.Visibility != "player:p1" || len(envelope.Ops) < 2 {
			continue
		}
		removeBeforeAdd = envelope.Ops[0].Op == "zone.cards.remove" && envelope.Ops[1].Op == "zone.cards.add"
	}
	if !removeBeforeAdd {
		t.Fatalf("missing private remove/add patch: %#v", result.Patches)
	}
}

func TestLibraryMoveTopToBottomUsesLibraryOps(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-bottom", "library.move_top", map[string]any{
		"playerId": "p1",
		"toZone":   "library",
		"position": "bottom",
		"count":    2,
	}), "p1")
	if result.Err != nil {
		t.Fatalf("move top bottom failed: %v", result.Err)
	}
	snapshot := gameActor.Snapshot()
	if got, want := joinStrings(snapshot.Zones["p1"].Library), "l3,l2,l1"; got != want {
		t.Fatalf("library got %s want %s", got, want)
	}
	metrics := result.Event.Payload["metrics"].(map[string]any)
	if metrics["library.full_scan_count"] != 0 || metrics["library.reindex_count"] != 0 {
		t.Fatalf("unexpected library metrics: %#v", metrics)
	}
}

func TestLibraryMoveTopToOpponentHandKeepsPatchPrivate(t *testing.T) {
	game := testState()
	game.Zones["p2"] = state.PlayerZones{}
	gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-hand", "library.move_top", map[string]any{
		"playerId":       "p1",
		"targetPlayerId": "p2",
		"toZone":         "hand",
		"count":          1,
	}), "p1")
	if result.Err != nil {
		t.Fatalf("move top hand failed: %v", result.Err)
	}
	snapshot := gameActor.Snapshot()
	if got, want := joinStrings(snapshot.Zones["p2"].Hand), "l3"; got != want {
		t.Fatalf("opponent hand got %s want %s", got, want)
	}
	for _, envelope := range result.Patches {
		if envelope.Visibility != "player:p2" {
			continue
		}
		cards := envelope.Ops[0].Data["cards"]
		if cards == nil {
			t.Fatalf("missing private target card patch: %#v", envelope)
		}
	}
}

func TestLibraryPutTopAndBottomCommands(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	top := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "put-top", "library.put_top", map[string]any{"playerId": "p1", "instanceId": "h1"}), "p1")
	if top.Err != nil {
		t.Fatalf("put top failed: %v", top.Err)
	}
	bottom := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "put-bottom", "library.put_bottom", map[string]any{"playerId": "p1", "instanceId": "h2"}), "p1")
	if bottom.Err != nil {
		t.Fatalf("put bottom failed: %v", bottom.Err)
	}
	snapshot := gameActor.Snapshot()
	if got, want := joinStrings(snapshot.Zones["p1"].Library), "h2,l1,l2,l3,h1"; got != want {
		t.Fatalf("library got %s want %s", got, want)
	}
}

func TestLibraryViewIsPrivateAndDoesNotMutateLibrary(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	before := append([]string(nil), gameActor.Snapshot().Zones["p1"].Library...)
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "view", "library.view", map[string]any{"playerId": "p1", "count": 2}), "p1")
	if result.Err != nil {
		t.Fatalf("view failed: %v", result.Err)
	}
	if got := joinStrings(gameActor.Snapshot().Zones["p1"].Library); got != joinStrings(before) {
		t.Fatalf("library mutated: %s", got)
	}
	privatePatch := patchForVisibility(result.Patches, protocol.PlayerVisibility("p1"), "library.top.viewed")
	if privatePatch == nil {
		t.Fatalf("view patch should include private top cards: %#v", result.Patches)
	}
	publicCount := patchForVisibility(result.Patches, protocol.VisibilityPublic, "zone.count.set")
	if publicCount == nil {
		t.Fatalf("view patch should include public count to advance non-owner viewers: %#v", result.Patches)
	}
	if publicCount.Data["playerId"] != "p1" || publicCount.Data["zone"] != state.ZoneLibrary || publicCount.Data["count"] != 3 {
		t.Fatalf("bad public count patch: %#v", publicCount.Data)
	}
	if _, leaked := publicCount.Data["cards"]; leaked {
		t.Fatalf("public view count leaked cards: %#v", publicCount.Data)
	}
	if _, leaked := publicCount.Data["instanceIds"]; leaked {
		t.Fatalf("public view count leaked instance ids: %#v", publicCount.Data)
	}
	if _, leaked := publicCount.Data["cardKey"]; leaked {
		t.Fatalf("public view count leaked cardKey: %#v", publicCount.Data)
	}
}

func TestLibraryReorderTopEmitsPrivateOrderAndPublicCount(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "reorder", "library.reorder_top", map[string]any{"playerId": "p1", "instanceIds": []string{"l2", "l3"}}), "p1")
	if result.Err != nil {
		t.Fatalf("reorder failed: %v", result.Err)
	}
	privatePatch := patchForVisibility(result.Patches, protocol.PlayerVisibility("p1"), "library.top.reordered")
	if privatePatch == nil {
		t.Fatalf("reorder patch should include private order: %#v", result.Patches)
	}
	publicCount := patchForVisibility(result.Patches, protocol.VisibilityPublic, "zone.count.set")
	if publicCount == nil {
		t.Fatalf("reorder patch should include public count to advance non-owner viewers: %#v", result.Patches)
	}
	if publicCount.Data["playerId"] != "p1" || publicCount.Data["zone"] != state.ZoneLibrary || publicCount.Data["count"] != 3 {
		t.Fatalf("bad public count patch: %#v", publicCount.Data)
	}
	if _, leaked := publicCount.Data["instanceIds"]; leaked {
		t.Fatalf("public reorder count leaked library order: %#v", publicCount.Data)
	}
	if _, leaked := publicCount.Data["cards"]; leaked {
		t.Fatalf("public reorder count leaked cards: %#v", publicCount.Data)
	}
	if _, leaked := publicCount.Data["cardKey"]; leaked {
		t.Fatalf("public reorder count leaked cardKey: %#v", publicCount.Data)
	}
}

func TestPrivateOnlyRuntimePatchAddsPublicVersionCarrier(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "face-private", "card.face.changed", map[string]any{
		"playerId":        "p1",
		"instanceId":      "h1",
		"activeFaceIndex": 1,
	}), "p1")
	if result.Err != nil {
		t.Fatalf("face change failed: %v", result.Err)
	}
	privatePatch := patchForVisibility(result.Patches, protocol.PlayerVisibility("p1"), "card.field.set")
	if privatePatch == nil {
		t.Fatalf("missing owner private patch: %#v", result.Patches)
	}
	publicCarrier := patchForVisibility(result.Patches, protocol.VisibilityPublic, versionAdvancePatchOp)
	if publicCarrier == nil {
		t.Fatalf("missing public version carrier for private-only patch: %#v", result.Patches)
	}
	if len(publicCarrier.Data) != 0 {
		t.Fatalf("version carrier should not carry private data: %#v", publicCarrier.Data)
	}
	encoded := fmt.Sprintf("%#v", publicCarrier)
	for _, leaked := range []string{"h1", "hand-1@1", "cardKey", "instanceId"} {
		if contains(encoded, leaked) {
			t.Fatalf("version carrier leaked %s: %s", leaked, encoded)
		}
	}
	if result.Patches[len(result.Patches)-1].Visibility != protocol.VisibilityPublic {
		t.Fatalf("public carrier should be emitted after private patches for same-version merge safety: %#v", result.Patches)
	}
}

func TestLibraryShuffleUsesCompactSeededPayloadAndPublicInvalidation(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	reveal := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "reveal-before-shuffle", "library.reveal_top", map[string]any{
		"playerId":      "p1",
		"count":         2,
		"visibleToMask": 3,
	}), "p1")
	if reveal.Err != nil {
		t.Fatalf("reveal failed: %v", reveal.Err)
	}

	shuffle := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "shuffle-compact", "library.shuffle", map[string]any{"playerId": "p1"}), "p1")
	if shuffle.Err != nil {
		t.Fatalf("shuffle failed: %v", shuffle.Err)
	}
	if _, leaked := shuffle.Event.Payload["libraryOrder"]; leaked {
		t.Fatalf("shuffle event must not persist full library order: %#v", shuffle.Event.Payload)
	}
	seed, ok := shuffle.Event.Payload["shuffleSeed"].(int)
	if !ok || seed < 0 {
		t.Fatalf("missing compact shuffle seed: %#v", shuffle.Event.Payload)
	}
	if got := shuffle.Event.Payload["shuffleAlgorithm"]; got != state.DeterministicShuffleAlgorithm {
		t.Fatalf("shuffle algorithm got %#v want %s", got, state.DeterministicShuffleAlgorithm)
	}
	metrics := shuffle.Event.Payload["metrics"].(map[string]any)
	if _, ok := metrics["library.shuffle_ms"]; !ok {
		t.Fatalf("missing shuffle metrics: %#v", metrics)
	}
	if patchForVisibility(shuffle.Patches, protocol.PlayerVisibility("p1"), "library.shuffled") != nil {
		t.Fatalf("shuffle invalidation should be public and compact, got private patch: %#v", shuffle.Patches)
	}
	public := patchForVisibility(shuffle.Patches, protocol.VisibilityPublic, "library.shuffled")
	if public == nil || public.Data["visibilityEpoch"] == nil {
		t.Fatalf("missing public shuffle invalidation: %#v", shuffle.Patches)
	}
	if encoded := fmt.Sprintf("%#v", shuffle.Patches); contains(encoded, "cardKey") || contains(encoded, "library-") {
		t.Fatalf("shuffle patch leaked card identity/order: %s", encoded)
	}

	replayed := testState()
	if err := ReplayEvent(&replayed, reveal.Event); err != nil {
		t.Fatalf("replay reveal failed: %v", err)
	}
	if err := ReplayEvent(&replayed, shuffle.Event); err != nil {
		t.Fatalf("replay shuffle failed: %v", err)
	}
	if !equalStrings(replayed.Zones["p1"].Library, gameActor.Snapshot().Zones["p1"].Library) {
		t.Fatalf("seeded replay order mismatch replayed=%#v current=%#v", replayed.Zones["p1"].Library, gameActor.Snapshot().Zones["p1"].Library)
	}
}

func TestLibraryCommandsAreIdempotentForRetry(t *testing.T) {
	tests := []struct {
		name        string
		commandType string
		payload     map[string]any
	}{
		{name: "draw", commandType: "library.draw", payload: map[string]any{"playerId": "p1"}},
		{name: "move-top-bottom", commandType: "library.move_top", payload: map[string]any{"playerId": "p1", "toZone": "library", "position": "bottom", "count": 1}},
		{name: "reorder-top", commandType: "library.reorder_top", payload: map[string]any{"playerId": "p1", "instanceIds": []string{"l2", "l3"}}},
		{name: "shuffle", commandType: "library.shuffle", payload: map[string]any{"playerId": "p1"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
			cmd := command("game-1", 1, "library-retry-"+tt.name, tt.commandType, tt.payload)
			first := gameActor.ApplyDirect(context.Background(), cmd, "p1")
			if first.Err != nil {
				t.Fatalf("first apply failed: %v", first.Err)
			}
			afterFirst := gameActor.Snapshot()

			retry := gameActor.ApplyDirect(context.Background(), cmd, "p1")
			if retry.Err != nil {
				t.Fatalf("retry failed: %v", retry.Err)
			}
			afterRetry := gameActor.Snapshot()

			if retry.Event.Version != first.Event.Version || afterRetry.Version != afterFirst.Version {
				t.Fatalf("retry was not idempotent: first=%d retry=%d state=%d", first.Event.Version, retry.Event.Version, afterRetry.Version)
			}
			if !equalStrings(afterRetry.Zones["p1"].Library, afterFirst.Zones["p1"].Library) {
				t.Fatalf("retry changed library: first=%#v retry=%#v", afterFirst.Zones["p1"].Library, afterRetry.Zones["p1"].Library)
			}
			if !equalStrings(afterRetry.Zones["p1"].Hand, afterFirst.Zones["p1"].Hand) {
				t.Fatalf("retry changed hand: first=%#v retry=%#v", afterFirst.Zones["p1"].Hand, afterRetry.Zones["p1"].Hand)
			}
		})
	}
}

func TestFaceDownPatchDoesNotExposeCardKey(t *testing.T) {
	game := testState()
	instance := game.Instances["i1"]
	instance.FaceDown = true
	game.Instances["i1"] = instance
	data := cardPatchData(&game, "p2", "i1")
	if _, leaked := data["cardKey"]; leaked {
		t.Fatal("faceDown patch leaked cardKey")
	}
	if data["hidden"] != true {
		t.Fatalf("faceDown patch should be hidden: %#v", data)
	}
}

func TestCardFaceDownRuntimeHidesPublicIdentityAndSendsPrivateOwnerPatch(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "face-down", "card.face_down.changed", map[string]any{
		"instanceId": "i1",
		"faceDown":   true,
	}), "p1")
	if result.Err != nil {
		t.Fatalf("faceDown failed: %v", result.Err)
	}
	public := patchForVisibility(result.Patches, protocol.VisibilityPublic, "card.field.set")
	if public == nil {
		t.Fatalf("missing public faceDown patch: %#v", result.Patches)
	}
	if _, leaked := public.Data["cardKey"]; leaked {
		t.Fatalf("public faceDown patch leaked cardKey: %#v", public.Data)
	}
	if public.Data["hidden"] != true || public.Data["faceDown"] != true {
		t.Fatalf("bad public faceDown patch: %#v", public.Data)
	}
	private := patchForVisibility(result.Patches, protocol.PlayerVisibility("p1"), "card.field.set")
	if private == nil || private.Data["cardKey"] != "card-a@1" {
		t.Fatalf("owner did not receive private identity patch: %#v", result.Patches)
	}
	if encoded := fmt.Sprintf("%#v", result.Patches); contains(encoded, "imageUris") || contains(encoded, "oracleText") || contains(encoded, "cardFaces") {
		t.Fatalf("static payload leaked in faceDown patch: %s", encoded)
	}
}

func TestCardRevealedRuntimeTargetsAuthorizedGroupOnly(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "reveal-card", "card.revealed", map[string]any{
		"instanceId":    "h1",
		"visibleToMask": 3,
	}), "p1")
	if result.Err != nil {
		t.Fatalf("reveal failed: %v", result.Err)
	}
	if patchForVisibility(result.Patches, protocol.VisibilityPublic, "card.field.set") != nil {
		t.Fatalf("private hand reveal must not be public: %#v", result.Patches)
	}
	group := patchForVisibility(result.Patches, protocol.GroupVisibility("3"), "card.field.set")
	if group == nil || group.Data["cardKey"] != "hand-1@1" {
		t.Fatalf("authorized group did not receive cardKey: %#v", result.Patches)
	}
}

func TestCardRevealedRuntimeCanRevealFaceDownIdentityOnlyToAuthorizedViewer(t *testing.T) {
	game := testState()
	instance := game.Instances["h1"]
	instance.FaceDown = true
	game.Instances["h1"] = instance
	gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())

	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "reveal-face-down", "card.revealed", map[string]any{
		"instanceId": "h1",
		"to":         []any{"p1"},
	}), "p1")
	if result.Err != nil {
		t.Fatalf("face-down reveal failed: %v", result.Err)
	}
	if patchForVisibility(result.Patches, protocol.VisibilityPublic, "card.field.set") != nil {
		t.Fatalf("face-down private reveal must not be public: %#v", result.Patches)
	}
	owner := patchForVisibility(result.Patches, protocol.PlayerVisibility("p1"), "card.field.set")
	if owner == nil || owner.Data["cardKey"] != "hand-1@1" {
		t.Fatalf("authorized owner did not receive face-down identity: %#v", result.Patches)
	}
	if patchForVisibility(result.Patches, protocol.PlayerVisibility("p2"), "card.field.set") != nil {
		t.Fatalf("unauthorized viewer received face-down identity patch: %#v", result.Patches)
	}
}

func TestControllerChangeOnPrivateCardDoesNotEmitPublicIdentity(t *testing.T) {
	game := testState()
	game.Zones["p2"] = state.PlayerZones{}
	gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "control-private", "card.controller.changed", map[string]any{
		"instanceId":     "h1",
		"targetPlayerId": "p2",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("controller change failed: %v", result.Err)
	}
	if patchForVisibility(result.Patches, protocol.VisibilityPublic, "card.field.set") != nil {
		t.Fatalf("private controller change must not be public: %#v", result.Patches)
	}
	if patchForVisibility(result.Patches, protocol.PlayerVisibility("p2"), "card.field.set") != nil {
		t.Fatalf("private controller change must not send private instanceId to new controller: %#v", result.Patches)
	}
	snapshot := gameActor.Snapshot()
	if snapshot.Instances["h1"].ControllerID != "p2" || snapshot.Loc["h1"].ControllerID != "p2" {
		t.Fatalf("controller not updated in state/loc: %#v %#v", snapshot.Instances["h1"], snapshot.Loc["h1"])
	}
	if encoded := fmt.Sprintf("%#v", result.Patches); contains(encoded, "hand-1@1") {
		t.Fatalf("private controller patch leaked cardKey: %s", encoded)
	}
}

func TestLibraryRevealRuntimeTargetsAuthorizedGroupAndNoStaticPayload(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "reveal-library", "library.reveal", map[string]any{
		"playerId":      "p1",
		"visibleToMask": 7,
	}), "p1")
	if result.Err != nil {
		t.Fatalf("library reveal failed: %v", result.Err)
	}
	if patchForVisibility(result.Patches, protocol.VisibilityPublic, "library.revealed.set") != nil {
		t.Fatalf("library reveal must not be public when group mask is provided: %#v", result.Patches)
	}
	group := patchForVisibility(result.Patches, protocol.GroupVisibility("7"), "library.revealed.set")
	if group == nil {
		t.Fatalf("missing group library reveal patch: %#v", result.Patches)
	}
	cards := group.Data["cards"].([]map[string]any)
	if len(cards) != 3 || cards[0]["cardKey"] == nil {
		t.Fatalf("bad library reveal cards: %#v", cards)
	}
	if encoded := fmt.Sprintf("%#v", result.Patches); contains(encoded, "imageUris") || contains(encoded, "oracleText") || contains(encoded, "cardFaces") {
		t.Fatalf("static payload leaked in library reveal: %s", encoded)
	}
}

func TestPlayTopRevealedRuntimeEmitsPublicTopWhenEnabled(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "play-top", "library.play_top_revealed", map[string]any{
		"playerId": "p1",
		"enabled":  true,
	}), "p1")
	if result.Err != nil {
		t.Fatalf("play top reveal failed: %v", result.Err)
	}
	set := patchForVisibility(result.Patches, protocol.VisibilityPublic, "library.play_top_revealed.set")
	reveal := patchForVisibility(result.Patches, protocol.VisibilityPublic, "library.top.revealed")
	if set == nil || set.Data["enabled"] != true || reveal == nil {
		t.Fatalf("missing play top public patches: %#v", result.Patches)
	}
	cards := reveal.Data["cards"].([]map[string]any)
	if len(cards) != 1 || cards[0]["instanceId"] != "l3" || cards[0]["cardKey"] != "library-3@1" {
		t.Fatalf("bad public top reveal: %#v", cards)
	}
}

func TestTokenCreateRuntimeEmitsCompactPayloadOnly(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "token-create", "card.token.created", map[string]any{
		"playerId": "p1",
		"quantity": 2,
		"card": map[string]any{
			"scryfallId": "token-scryfall",
			"name":       "Goblin",
			"imageUris":  map[string]any{"normal": "https://example.test/token.jpg"},
			"oracleText": "heavy rules text",
			"cardFaces":  []any{map[string]any{"name": "Face"}},
			"power":      1,
			"toughness":  1,
		},
	}), "p1")
	if result.Err != nil {
		t.Fatalf("token create failed: %v", result.Err)
	}
	patch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "zone.cards.add")
	if patch == nil {
		t.Fatalf("missing token add patch: %#v", result.Patches)
	}
	encoded := fmt.Sprintf("%#v", result.Patches)
	if contains(encoded, "oracleText") {
		t.Fatalf("rules payload leaked in token patch: %s", encoded)
	}
	cards := patch.Data["cards"].([]map[string]any)
	if len(cards) != 2 || cards[0]["isToken"] != true || cards[0]["name"] != "Goblin" {
		t.Fatalf("bad compact token cards: %#v", cards)
	}
	if cards[0]["cardKey"] != "token-scryfall:token" {
		t.Fatalf("token patch did not carry stable compact identity: %#v", cards[0])
	}
	if cards[0]["printId"] != "token-scryfall" {
		t.Fatalf("token patch did not carry real print identity: %#v", cards[0])
	}
	if cards[0]["language"] != "en" || cards[0]["viewerVisibility"] != "public" {
		t.Fatalf("token patch did not carry renderable identity fields: %#v", cards[0])
	}
	staticCards := patch.Data["staticCards"].(map[string]map[string]any)
	staticCard := staticCards["token-scryfall:token"]
	if staticCard["name"] != "Goblin" || staticCard["printId"] != "token-scryfall" || staticCard["viewerVisibility"] != "public" {
		t.Fatalf("token patch did not carry renderable static card: %#v", staticCard)
	}
	imageUris := staticCard["imageUris"].(map[string]string)
	if imageUris["normal"] != "https://example.test/token.jpg" {
		t.Fatalf("token static card did not carry image: %#v", staticCard)
	}
	if _, leaked := staticCard["oracleText"]; leaked {
		t.Fatalf("token static card leaked oracle text: %#v", staticCard)
	}
	eventTokens := result.Event.Payload["tokens"].([]map[string]any)
	if len(eventTokens) != 2 || eventTokens[0]["instanceId"] != cards[0]["instanceId"] || eventTokens[0]["cardKey"] != "token-scryfall:token" || eventTokens[0]["name"] != "Goblin" {
		t.Fatalf("token event did not carry replayable compact identity: %#v", result.Event.Payload)
	}
	eventStaticCards := result.Event.Payload["staticCards"].(map[string]map[string]any)
	if eventStaticCards["token-scryfall:token"]["name"] != "Goblin" {
		t.Fatalf("token event did not carry replayable static identity: %#v", result.Event.Payload)
	}
	if contains(fmt.Sprintf("%#v", result.Event.Payload), "oracleText") {
		t.Fatalf("token event leaked rules payload: %#v", result.Event.Payload)
	}
	metrics := result.Event.Payload["metrics"].(map[string]any)
	if metrics["edge.runtime_route"] != 1 || metrics["edge.patch_bytes"].(int) <= 0 {
		t.Fatalf("missing edge metrics: %#v", metrics)
	}
}

func TestTokenCreateRuntimeBuildsSyntheticRenderableStaticCard(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "token-create-synthetic", "card.token.created", map[string]any{
		"playerId": "p1",
		"quantity": 1,
		"name":     "Clue",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("token create failed: %v", result.Err)
	}
	patch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "zone.cards.add")
	if patch == nil {
		t.Fatalf("missing token add patch: %#v", result.Patches)
	}
	staticCards := patch.Data["staticCards"].(map[string]map[string]any)
	staticCard := staticCards["token:clue"]
	if staticCard["name"] != "Clue" || staticCard["name"] == "Card" || staticCard["printId"] != "token:clue" {
		t.Fatalf("synthetic token static card is not renderable: %#v", staticCard)
	}
	cards := patch.Data["cards"].([]map[string]any)
	if cards[0]["cardKey"] != "token:clue" || cards[0]["printId"] != "token:clue" {
		t.Fatalf("synthetic token card identity mismatch: %#v", cards[0])
	}
}

func TestTokenCopyRuntimeUsesCompactReference(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "token-copy", "card.token_copy.created", map[string]any{
		"instanceId":     "i1",
		"targetPlayerId": "p1",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("token copy failed: %v", result.Err)
	}
	snapshot := gameActor.Snapshot()
	if got, want := len(snapshot.Zones["p1"].Battlefield), 2; got != want {
		t.Fatalf("battlefield count got %d want %d", got, want)
	}
	patch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "zone.cards.add")
	if patch == nil {
		t.Fatalf("missing token copy patch: %#v", result.Patches)
	}
	encoded := fmt.Sprintf("%#v", result.Patches)
	if contains(encoded, "imageUris") || contains(encoded, "oracleText") || contains(encoded, "cardFaces") {
		t.Fatalf("static payload leaked in token copy patch: %s", encoded)
	}
	cards := patch.Data["cards"].([]map[string]any)
	meta := cards[0]["tokenMeta"].(map[string]any)
	if meta["copiedFromInstanceId"] != "i1" || meta["copiedFromCardKey"] != "card-a@1" || cards[0]["cardKey"] != "card-a@1" || cards[0]["isTokenCopy"] != true {
		t.Fatalf("bad token copy payload: %#v", cards[0])
	}
	eventTokens := result.Event.Payload["tokens"].([]map[string]any)
	if len(eventTokens) != 1 || eventTokens[0]["instanceId"] != cards[0]["instanceId"] || eventTokens[0]["cardKey"] != "card-a@1" || eventTokens[0]["isTokenCopy"] != true {
		t.Fatalf("token copy event did not carry replayable compact identity: %#v", result.Event.Payload)
	}
}

func TestTokenCopyRuntimeDoesNotLeakPrivateSourceIdentity(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "token-copy-private", "card.token_copy.created", map[string]any{
		"instanceId":     "h1",
		"targetPlayerId": "p1",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("token copy failed: %v", result.Err)
	}
	patch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "zone.cards.add")
	if patch == nil {
		t.Fatalf("missing token copy patch: %#v", result.Patches)
	}
	cards := patch.Data["cards"].([]map[string]any)
	meta := cards[0]["tokenMeta"].(map[string]any)
	if contains(fmt.Sprintf("%#v %#v", result.Patches, result.Event.Payload), "hand-1@1") {
		t.Fatalf("private source identity leaked through token copy: patches=%#v event=%#v", result.Patches, result.Event.Payload)
	}
	if cards[0]["cardKey"] == "hand-1@1" || meta["copiedFromCardKey"] != nil || result.Event.Payload["copiedFromCardKey"] != nil {
		t.Fatalf("private token copy retained source identity: card=%#v event=%#v", cards[0], result.Event.Payload)
	}
	if cards[0]["name"] != "Token Copy" || cards[0]["viewerVisibility"] != "public" {
		t.Fatalf("private token copy did not carry generic public identity: %#v", cards[0])
	}
}

func TestRandomPrivateZoneSelectionDoesNotLeakPublicIdentity(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "random-private", "zone.random_card.selected", map[string]any{
		"playerId": "p1",
		"zone":     "hand",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("random select failed: %v", result.Err)
	}
	public := patchForVisibility(result.Patches, protocol.VisibilityPublic, "zone.random_card.selected")
	private := patchForVisibility(result.Patches, protocol.PlayerVisibility("p1"), "zone.random_card.selected")
	if public == nil || private == nil {
		t.Fatalf("missing public/private random patches: %#v", result.Patches)
	}
	if _, leaked := public.Data["cardKey"]; leaked {
		t.Fatalf("public random patch leaked cardKey: %#v", public.Data)
	}
	if _, leaked := public.Data["instanceId"]; leaked {
		t.Fatalf("public random patch leaked instanceId: %#v", public.Data)
	}
	if private.Data["cardKey"] == nil || private.Data["instanceId"] == nil {
		t.Fatalf("owner did not receive selected card identity: %#v", private.Data)
	}
}

func TestDungeonMarkerAndFaceChangeRuntimePatches(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	marker := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "dungeon", "card.dungeon_marker.changed", map[string]any{
		"instanceId": "i1",
		"position":   map[string]any{"x": 0.25, "y": 0.75, "unit": "ratio"},
	}), "p1")
	if marker.Err != nil {
		t.Fatalf("dungeon marker failed: %v", marker.Err)
	}
	markerPatch := patchForVisibility(marker.Patches, protocol.VisibilityPublic, "card.field.set")
	if markerPatch == nil || markerPatch.Data["dungeonMarker"] == nil {
		t.Fatalf("missing dungeon marker patch: %#v", marker.Patches)
	}
	face := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "face", "card.face.changed", map[string]any{
		"instanceId": "i1",
		"faceIndex":  1,
	}), "p1")
	if face.Err != nil {
		t.Fatalf("face change failed: %v", face.Err)
	}
	facePatch := patchForVisibility(face.Patches, protocol.VisibilityPublic, "card.field.set")
	if facePatch == nil || facePatch.Data["activeFaceIndex"] != 1 {
		t.Fatalf("missing face patch: %#v", face.Patches)
	}
}

func TestEdgeCommandsReplayReconstructsState(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	token := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "token-create", "card.token.created", map[string]any{"playerId": "p1", "quantity": 1}), "p1")
	if token.Err != nil {
		t.Fatalf("token create failed: %v", token.Err)
	}
	random := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "random", "zone.random_card.selected", map[string]any{"playerId": "p1", "zone": "hand"}), "p1")
	if random.Err != nil {
		t.Fatalf("random failed: %v", random.Err)
	}
	face := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "face", "card.face.changed", map[string]any{"instanceId": "i1", "faceIndex": 1}), "p1")
	if face.Err != nil {
		t.Fatalf("face failed: %v", face.Err)
	}
	replayed, err := ReplayEvents(testState(), []protocol.EventPayloadV2{token.Event, random.Event, face.Event}, DefaultAppliers())
	if err != nil {
		t.Fatalf("replay failed: %v", err)
	}
	if got, want := len(replayed.Zones["p1"].Battlefield), len(gameActor.Snapshot().Zones["p1"].Battlefield); got != want {
		t.Fatalf("replayed battlefield count got %d want %d", got, want)
	}
	if replayed.Instances["i1"].ActiveFace != 1 {
		t.Fatalf("replayed active face mismatch: %#v", replayed.Instances["i1"])
	}
}

func TestSensitiveCommandsReplay(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	faceDown := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "face-down", "card.face_down.changed", map[string]any{"instanceId": "i1", "faceDown": true}), "p1")
	if faceDown.Err != nil {
		t.Fatalf("faceDown failed: %v", faceDown.Err)
	}
	controller := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "controller", "card.controller.changed", map[string]any{"instanceId": "i1", "targetPlayerId": "p2"}), "p1")
	if controller.Err != nil {
		t.Fatalf("controller failed: %v", controller.Err)
	}
	reveal := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "library-reveal", "library.reveal", map[string]any{"playerId": "p1", "visibleToMask": 3}), "p1")
	if reveal.Err != nil {
		t.Fatalf("library reveal failed: %v", reveal.Err)
	}
	replayed, err := ReplayEvents(testState(), []protocol.EventPayloadV2{faceDown.Event, controller.Event, reveal.Event}, DefaultAppliers())
	if err != nil {
		t.Fatalf("replay failed: %v", err)
	}
	if !replayed.Instances["i1"].FaceDown || replayed.Instances["i1"].ControllerID != "p2" || replayed.Visibility.InstanceMasks["l3"] != 3 {
		t.Fatalf("replay mismatch: faceDown=%v controller=%s masks=%#v", replayed.Instances["i1"].FaceDown, replayed.Instances["i1"].ControllerID, replayed.Visibility.InstanceMasks)
	}
}

func TestReplayLegacyMulliganKeepOps(t *testing.T) {
	game := testState()
	event := protocol.EventPayloadV2{
		GameID:  "game-1",
		Version: 2,
		Type:    "mulligan.keep",
		Payload: map[string]any{
			"replay": map[string]any{
				"ops": []any{
					map[string]any{
						"op":         "mulligan.player_state.set",
						"playerId":   "p1",
						"handIds":    []any{"p1-hand-0"},
						"libraryIds": []any{"p1-lib-0", "p1-lib-1"},
						"gamePhase":  "PLAYING",
					},
				},
			},
		},
	}

	if err := ReplayEventWithAppliers(&game, event, DefaultAppliers()); err != nil {
		t.Fatalf("replay legacy mulligan keep: %v", err)
	}
	if game.Phase != state.PhasePlaying {
		t.Fatalf("phase = %s, want PLAYING", game.Phase)
	}
	if got := game.Zones["p1"].Hand; len(got) != 1 || got[0] != "p1-hand-0" {
		t.Fatalf("hand = %#v", got)
	}
	if got := game.Zones["p1"].Library; len(got) != 2 || got[0] != "p1-lib-0" || got[1] != "p1-lib-1" {
		t.Fatalf("library = %#v", got)
	}
}

func TestDisconnectVoteOpenAndExpelEmitsSemanticPatches(t *testing.T) {
	initial := testState()
	initial.Players["p3"] = map[string]any{"life": 40, "status": "active"}
	gameActor := NewGameActor("game-1", initial, nil, 8, DefaultAppliers())
	openCommand := command("game-1", 1, "disconnect-open", "disconnect.vote", map[string]any{
		"targetPlayerId":   "p2",
		"status":           "offline",
		"connectedUserIds": []string{"p1"},
	})
	openCommand.Client = map[string]any{"source": "runtime_ws_presence"}
	open := gameActor.ApplyDirect(context.Background(), openCommand, "")
	if open.Err != nil {
		t.Fatalf("open disconnect vote failed: %v", open.Err)
	}
	openPatch := patchForVisibility(open.Patches, protocol.VisibilityPublic, "disconnect.vote.set")
	if openPatch == nil {
		t.Fatalf("missing disconnect.vote.set patch: %#v", open.Patches)
	}
	votes := openPatch.Data["disconnectVotes"].(map[string]any)
	vote := votes["p2"].(map[string]any)
	if vote["status"] != "open" || vote["targetPlayerId"] != "p2" {
		t.Fatalf("disconnect vote = %#v, want open for p2", vote)
	}

	expel := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "disconnect-expel", "disconnect.vote", map[string]any{
		"targetPlayerId":   "p2",
		"playerId":         "p1",
		"vote":             "expel",
		"connectedUserIds": []string{"p1"},
	}), "p1")
	if expel.Err != nil {
		t.Fatalf("expel disconnect vote failed: %v", expel.Err)
	}
	if patch := patchForVisibility(expel.Patches, protocol.VisibilityPublic, "player.status.set"); patch == nil {
		t.Fatalf("missing player.status.set patch after expel: %#v", expel.Patches)
	}
	snapshot := gameActor.Snapshot()
	if snapshot.Players["p2"]["status"] != "conceded" {
		t.Fatalf("p2 status = %#v, want conceded", snapshot.Players["p2"])
	}
	if snapshot.DisconnectVotes["p2"]["status"] != "resolved_expel" {
		t.Fatalf("disconnect vote status = %#v, want resolved_expel", snapshot.DisconnectVotes)
	}
}

func TestReplayAppliesDisconnectVoteLifecycleEvents(t *testing.T) {
	game := testState()
	event := protocol.EventPayloadV2{
		GameID:  "game-1",
		Version: 2,
		Type:    "disconnect.vote.updated",
		Payload: map[string]any{
			"targetPlayerId":   "p2",
			"status":           "offline",
			"connectedUserIds": []string{"p1"},
			"disconnectVotes": map[string]any{
				"p2": map[string]any{
					"targetPlayerId": "p2",
					"status":         "open",
					"openedAt":       "2026-01-01T00:00:00Z",
					"deadlineAt":     "2026-01-01T00:01:00Z",
					"cooldownUntil":  nil,
					"votes":          map[string]any{},
				},
			},
		},
	}

	replayed, err := ReplayEvents(game, []protocol.EventPayloadV2{event}, DefaultAppliers())
	if err != nil {
		t.Fatalf("disconnect vote replay failed: %v", err)
	}
	if replayed.Version != 2 || replayed.DisconnectVotes["p2"]["status"] != "open" || replayed.DisconnectVotes["p2"]["targetPlayerId"] != "p2" {
		t.Fatalf("replayed disconnect vote mismatch: version=%d vote=%#v", replayed.Version, replayed.DisconnectVotes)
	}
}

func TestDisconnectVotesRemainIndependentAndTimeoutUsesWaitReducer(t *testing.T) {
	initial := testState()
	initial.Players["p3"] = map[string]any{"life": 40, "status": "active"}
	gameActor := NewGameActor("game-1", initial, nil, 8, DefaultAppliers())

	open := func(actionID, targetPlayerID string, connected []string) CommandResult {
		command := command("game-1", gameActor.Version(), actionID, "disconnect.vote", map[string]any{
			"targetPlayerId":   targetPlayerID,
			"status":           "offline",
			"connectedUserIds": connected,
		})
		command.Client = map[string]any{"source": "runtime_ws_presence"}
		return gameActor.ApplyDirect(context.Background(), command, "")
	}

	if result := open("open-p2", "p2", []string{"p1", "p3"}); result.Err != nil {
		t.Fatalf("open p2 vote: %v", result.Err)
	}
	if result := open("open-p3", "p3", []string{"p1"}); result.Err != nil {
		t.Fatalf("open p3 vote: %v", result.Err)
	}
	if votes := gameActor.Snapshot().DisconnectVotes; len(votes) != 2 || votes["p2"]["status"] != "open" || votes["p3"]["status"] != "open" {
		t.Fatalf("independent votes = %#v", votes)
	}

	reconnect := command("game-1", gameActor.Version(), "reconnect-p2", "disconnect.vote", map[string]any{
		"targetPlayerId": "p2", "status": "online", "connectedUserIds": []string{"p1", "p2"},
	})
	reconnect.Client = map[string]any{"source": "runtime_ws_presence"}
	if result := gameActor.ApplyDirect(context.Background(), reconnect, ""); result.Err != nil {
		t.Fatalf("reconnect p2: %v", result.Err)
	}
	votes := gameActor.Snapshot().DisconnectVotes
	if votes["p2"]["status"] != "cancelled" || votes["p3"]["status"] != "open" {
		t.Fatalf("reconnect must only cancel p2 vote: %#v", votes)
	}

	timeout := command("game-1", gameActor.Version(), "timeout-p3", "disconnect.vote", map[string]any{"targetPlayerId": "p3", "status": "timeout"})
	timeout.Client = map[string]any{"source": "runtime_actor_tick"}
	if result := gameActor.ApplyDirect(context.Background(), timeout, ""); result.Err != nil {
		t.Fatalf("timeout p3: %v", result.Err)
	}
	votes = gameActor.Snapshot().DisconnectVotes
	if votes["p3"]["status"] != "resolved_wait" || votes["p3"]["votes"].(map[string]any)["p1"].(map[string]any)["vote"] != "wait" {
		t.Fatalf("timeout must materialize wait through vote state: %#v", votes["p3"])
	}
}

func TestDisconnectVoteDeadlineTickPublishesResolvedWaitPatch(t *testing.T) {
	initial := testState()
	initial.Players["p3"] = map[string]any{"life": 40, "status": "active"}
	gameActor := NewGameActor("game-1", initial, nil, 8, DefaultAppliers())
	open := command("game-1", 1, "open-p2", "disconnect.vote", map[string]any{
		"targetPlayerId": "p2", "status": "offline", "connectedUserIds": []string{"p1"},
	})
	open.Client = map[string]any{"source": "runtime_ws_presence"}
	if result := gameActor.ApplyDirect(context.Background(), open, ""); result.Err != nil {
		t.Fatalf("open vote: %v", result.Err)
	}
	gameActor.stateMu.Lock()
	gameActor.state.DisconnectVotes["p2"]["deadlineAt"] = "2000-01-01T00:00:00Z"
	gameActor.stateMu.Unlock()
	published := make(chan CommandResult, 1)
	gameActor.SetInternalResultPublisher(func(_ context.Context, result CommandResult) { published <- result })

	gameActor.resolveDueDisconnectVotes(context.Background())
	select {
	case result := <-published:
		if result.Err != nil || patchForVisibility(result.Patches, protocol.VisibilityPublic, "disconnect.vote.set") == nil {
			t.Fatalf("deadline patch result = %#v", result)
		}
	default:
		t.Fatal("deadline tick did not publish its compact patch")
	}
	if vote := gameActor.Snapshot().DisconnectVotes["p2"]; vote["status"] != "resolved_wait" {
		t.Fatalf("deadline vote status = %#v", vote)
	}
}

func TestDisconnectExpelKeepsActorUsableForRemainingPlayers(t *testing.T) {
	initial := testState()
	initial.Players["p3"] = map[string]any{"life": 40, "status": "active"}
	gameActor := NewGameActor("game-1", initial, nil, 8, DefaultAppliers())

	open := command("game-1", 1, "open-p2", "disconnect.vote", map[string]any{
		"targetPlayerId": "p2", "status": "offline", "connectedUserIds": []string{"p1"},
	})
	open.Client = map[string]any{"source": "runtime_ws_presence"}
	if result := gameActor.ApplyDirect(context.Background(), open, ""); result.Err != nil {
		t.Fatalf("open vote: %v", result.Err)
	}
	expel := command("game-1", gameActor.Version(), "expel-p2", "disconnect.vote", map[string]any{
		"targetPlayerId": "p2", "playerId": "p1", "vote": "expel", "connectedUserIds": []string{"p1"},
	})
	if result := gameActor.ApplyDirect(context.Background(), expel, "p1"); result.Err != nil {
		t.Fatalf("expel p2: %v", result.Err)
	}
	versionAfterExpel := gameActor.Version()
	for _, entry := range []struct {
		playerID, actionID string
		life               int
	}{
		{"p1", "p1-after-expel", 39},
		{"p3", "p3-after-expel", 38},
	} {
		result := gameActor.ApplyDirect(context.Background(), command("game-1", gameActor.Version(), entry.actionID, "life.changed", map[string]any{"playerId": entry.playerID, "life": entry.life}), entry.playerID)
		if result.Err != nil {
			t.Fatalf("remaining player %s action: %v", entry.playerID, result.Err)
		}
	}
	if gameActor.Version() != versionAfterExpel+2 || gameActor.Snapshot().Players["p2"]["status"] != "conceded" {
		t.Fatalf("expel must not stall stream: version=%d snapshot=%#v", gameActor.Version(), gameActor.Snapshot())
	}
}

func TestCardsMovedBatchUsesLocAndUpdatesZones(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move", "cards.moved", map[string]any{
		"playerId":    "p1",
		"fromZone":    "hand",
		"toZone":      "graveyard",
		"instanceIds": []string{"h1", "h2"},
	}), "p1")
	if result.Err != nil {
		t.Fatalf("move failed: %v", result.Err)
	}
	snapshot := gameActor.Snapshot()
	if len(snapshot.Zones["p1"].Hand) != 0 {
		t.Fatalf("hand not emptied: %#v", snapshot.Zones["p1"].Hand)
	}
	if got, want := len(snapshot.Zones["p1"].Graveyard), 2; got != want {
		t.Fatalf("graveyard got %d want %d", got, want)
	}
	if snapshot.Loc["h1"].Zone != state.ZoneGraveyard || snapshot.Loc["h2"].Index != 1 {
		t.Fatalf("loc not updated: %#v %#v", snapshot.Loc["h1"], snapshot.Loc["h2"])
	}
	metrics := result.Event.Payload["metrics"].(map[string]any)
	if metrics["movement.full_scan_count"] != 0 || metrics["movement.reindex_count"] != 0 {
		t.Fatalf("unexpected movement metrics: %#v", metrics)
	}
	if metrics["movement.cards_moved_count"] != 2 {
		t.Fatalf("cards moved metric mismatch: %#v", metrics)
	}
	if metrics["movement.patch_bytes"].(int) <= 0 {
		t.Fatalf("patch bytes not recorded: %#v", metrics)
	}
	private := patchForVisibility(result.Patches, "player:p1", "zone.cards.batchMove")
	if private == nil {
		t.Fatalf("missing private batchMove patch: %#v", result.Patches)
	}
	if _, ok := private.Data["moves"]; !ok {
		t.Fatalf("batchMove must use moves field: %#v", private.Data)
	}
	if _, leaked := private.Data["cards"]; leaked {
		t.Fatalf("batchMove leaked legacy cards field: %#v", private.Data)
	}
	publicAdd := patchForVisibility(result.Patches, "public", "zone.cards.add")
	if publicAdd == nil {
		t.Fatalf("public should see cards entering graveyard: %#v", result.Patches)
	}
	if encoded := fmt.Sprintf("%#v", result.Patches); contains(encoded, "imageUris") || contains(encoded, "oracleText") || contains(encoded, "cardFaces") {
		t.Fatalf("unexpected static payload leak in movement patch: %s", encoded)
	}
}

func TestCardMovedFromBattlefieldToGraveyardUsesPublicMovePatch(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-one", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "battlefield",
		"toZone":     "graveyard",
		"instanceId": "i1",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("move failed: %v", result.Err)
	}
	patch := patchForVisibility(result.Patches, "public", "zone.cards.move")
	if patch == nil {
		t.Fatalf("missing public move patch: %#v", result.Patches)
	}
	if patch.Data["instanceId"] != "i1" {
		t.Fatalf("bad move patch: %#v", patch.Data)
	}
	if err := state.ValidateInvariants(gameActor.Snapshot()); err != nil {
		t.Fatalf("invalid state after move: %v", err)
	}
}

func TestMoveHandToBattlefieldPreservesExplicitVisualPosition(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-position", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "hand",
		"toZone":     "battlefield",
		"instanceId": "h1",
		"position":   map[string]any{"x": 0.37, "y": 0.61, "unit": "ratio"},
	}), "p1")
	if result.Err != nil {
		t.Fatalf("move failed: %v", result.Err)
	}

	position := runtimePosition(t, gameActor.Snapshot(), "h1")
	if position["x"] != 0.37 || position["y"] != 0.61 || position["unit"] != "ratio" {
		t.Fatalf("position was not preserved: %#v", position)
	}
	patch := patchForVisibility(result.Patches, "player:p1", "zone.cards.move")
	if patch == nil {
		t.Fatalf("missing owner move patch: %#v", result.Patches)
	}
	card := patch.Data["card"].(map[string]any)
	if got := card["position"]; fmt.Sprintf("%#v", got) != fmt.Sprintf("%#v", position) {
		t.Fatalf("patch position got %#v want %#v", got, position)
	}

	replayed, err := ReplayEvents(testState(), []protocol.EventPayloadV2{result.Event}, DefaultAppliers())
	if err != nil {
		t.Fatalf("replay failed: %v", err)
	}
	if replayedPosition := runtimePosition(t, replayed, "h1"); fmt.Sprintf("%#v", replayedPosition) != fmt.Sprintf("%#v", position) {
		t.Fatalf("replayed position got %#v want %#v", replayedPosition, position)
	}
}

func TestMoveHandToBattlefieldWithoutPositionAssignsStableNonZeroVisualPosition(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-default-position", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "hand",
		"toZone":     "battlefield",
		"instanceId": "h1",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("move failed: %v", result.Err)
	}

	position := runtimePosition(t, gameActor.Snapshot(), "h1")
	if !nonZeroRatioPosition(position) {
		t.Fatalf("expected non-zero ratio position, got %#v", position)
	}
	patch := patchForVisibility(result.Patches, "public", "zone.cards.add")
	if patch == nil {
		t.Fatalf("missing public battlefield add patch: %#v", result.Patches)
	}
	cards := patch.Data["cards"].([]map[string]any)
	if !nonZeroRatioPosition(cards[0]["position"].(map[string]any)) {
		t.Fatalf("public patch did not carry valid battlefield position: %#v", cards[0])
	}
}

func TestBatchMoveToBattlefieldAssignsDistinctVisualPositions(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-batch-position", "cards.moved", map[string]any{
		"playerId":    "p1",
		"fromZone":    "hand",
		"toZone":      "battlefield",
		"instanceIds": []string{"h1", "h2"},
	}), "p1")
	if result.Err != nil {
		t.Fatalf("move failed: %v", result.Err)
	}

	first := runtimePosition(t, gameActor.Snapshot(), "h1")
	second := runtimePosition(t, gameActor.Snapshot(), "h2")
	if !nonZeroRatioPosition(first) || !nonZeroRatioPosition(second) {
		t.Fatalf("invalid positions: %#v %#v", first, second)
	}
	if first["x"] == second["x"] && first["y"] == second["y"] {
		t.Fatalf("batch battlefield positions overlapped: %#v %#v", first, second)
	}
}

func TestMoveAwayFromBattlefieldClearsVisualPositionAndReturnGetsNewPosition(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	toGraveyard := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-away-position", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "battlefield",
		"toZone":     "graveyard",
		"instanceId": "i1",
	}), "p1")
	if toGraveyard.Err != nil {
		t.Fatalf("move to graveyard failed: %v", toGraveyard.Err)
	}
	if position := gameActor.Snapshot().Instances["i1"].Position; position != nil {
		t.Fatalf("non-battlefield card kept visual position: %#v", position)
	}

	toBattlefield := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "return-position", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "graveyard",
		"toZone":     "battlefield",
		"instanceId": "i1",
	}), "p1")
	if toBattlefield.Err != nil {
		t.Fatalf("return to battlefield failed: %v", toBattlefield.Err)
	}
	if position := runtimePosition(t, gameActor.Snapshot(), "i1"); !nonZeroRatioPosition(position) {
		t.Fatalf("returned battlefield card did not get a valid position: %#v", position)
	}
}

func TestCommanderMoveFromCommandToBattlefieldIncrementsCastCount(t *testing.T) {
	gameActor := NewGameActor("game-1", testStateWithCommanderInCommand(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "cast-commander", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "command",
		"toZone":     "battlefield",
		"instanceId": "commander-1",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("commander move failed: %v", result.Err)
	}

	snapshot := gameActor.Snapshot()
	if got := snapshot.SharedCounters["commander:commander-1"]["casts"]; got != 1 {
		t.Fatalf("commander casts got %d want 1", got)
	}
	patch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "game.counters.set")
	if patch == nil {
		t.Fatalf("missing commander cast counter patch: %#v", result.Patches)
	}
	if patch.Data["scope"] != "commander:commander-1" {
		t.Fatalf("bad commander counter scope: %#v", patch.Data)
	}
	counters := patch.Data["counters"].(map[string]any)
	if counters["casts"] != 1 {
		t.Fatalf("bad commander counter patch: %#v", patch.Data)
	}
	movePatch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "zone.cards.move")
	if movePatch == nil {
		t.Fatalf("missing commander move patch: %#v", result.Patches)
	}
	card := movePatch.Data["card"].(map[string]any)
	if card["isCommander"] != true {
		t.Fatalf("commander move patch lost isCommander: %#v", card)
	}
	logPatch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "eventLog.append")
	if logPatch == nil {
		t.Fatalf("missing commander cast eventLog.append patch: %#v", result.Patches)
	}
	entries := logPatch.Data["entries"].([]map[string]any)
	if len(entries) != 1 || !strings.Contains(strings.ToLower(fmt.Sprint(entries[0]["message"])), "commander") || !strings.Contains(fmt.Sprint(entries[0]["message"]), "1") {
		t.Fatalf("bad commander cast log entry: %#v", entries)
	}
}

func TestCommanderCastDerivesMissingCommanderFlagFromCommandZone(t *testing.T) {
	game := testStateWithCommanderInCommand()
	commander := game.Instances["commander-1"]
	commander.IsCommander = false
	game.Instances["commander-1"] = commander
	gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())

	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "cast-command-zone-card-with-missing-flag", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "command",
		"toZone":     "battlefield",
		"instanceId": "commander-1",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("commander move failed: %v", result.Err)
	}

	snapshot := gameActor.Snapshot()
	if got := snapshot.SharedCounters["commander:commander-1"]["casts"]; got != 1 {
		t.Fatalf("commander casts got %d want 1", got)
	}
	if snapshot.Instances["commander-1"].IsCommander != true {
		t.Fatalf("runtime did not normalize missing commander flag: %#v", snapshot.Instances["commander-1"])
	}
	movePatch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "zone.cards.move")
	if movePatch == nil {
		t.Fatalf("missing commander move patch: %#v", result.Patches)
	}
	card := movePatch.Data["card"].(map[string]any)
	if card["isCommander"] != true {
		t.Fatalf("commander move patch did not normalize isCommander: %#v", card)
	}
}

func TestCardsMovedFromCommandZoneDerivesMissingCommanderFlagsAndCountsCasts(t *testing.T) {
	game := testStateWithCommanderInCommand()
	partner := game.Instances["commander-1"]
	partner.InstanceID = "commander-2"
	partner.IsCommander = false
	game.Instances["commander-2"] = partner
	game.Zones["p1"] = state.PlayerZones{Command: []string{"commander-1", "commander-2"}, Library: game.Zones["p1"].Library, Hand: game.Zones["p1"].Hand, Battlefield: game.Zones["p1"].Battlefield, Graveyard: game.Zones["p1"].Graveyard, Exile: game.Zones["p1"].Exile}
	first := game.Instances["commander-1"]
	first.IsCommander = false
	game.Instances["commander-1"] = first
	game.Loc["commander-2"] = state.Location{PlayerID: "p1", Zone: state.ZoneCommand, Index: 1, ControllerID: "p1"}

	gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "cast-commanders-batch", "cards.moved", map[string]any{
		"playerId":    "p1",
		"fromZone":    "command",
		"toZone":      "battlefield",
		"instanceIds": []any{"commander-1", "commander-2"},
	}), "p1")
	if result.Err != nil {
		t.Fatalf("commander batch move failed: %v", result.Err)
	}

	snapshot := gameActor.Snapshot()
	for _, instanceID := range []string{"commander-1", "commander-2"} {
		if got := snapshot.SharedCounters["commander:"+instanceID]["casts"]; got != 1 {
			t.Fatalf("%s casts got %d want 1", instanceID, got)
		}
		if snapshot.Instances[instanceID].IsCommander != true {
			t.Fatalf("%s missing normalized commander flag: %#v", instanceID, snapshot.Instances[instanceID])
		}
	}
}

func TestActorAcceptsBaseVersionAdvancedByExternalNoopEvent(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	gameActor := NewGameActor("game-1", testState(), store, 8, DefaultAppliers())
	external := protocol.EventPayloadV2{
		GameID:    "game-1",
		Version:   2,
		Type:      "chat.message",
		Payload:   map[string]any{"message": "control-plane isolation"},
		CreatedBy: "p2",
		CreatedAt: time.Now().UTC(),
	}
	if err := store.AppendEvent(context.Background(), external); err != nil {
		t.Fatalf("append external event: %v", err)
	}

	result := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "draw-after-external-chat", "library.draw", map[string]any{
		"playerId": "p1",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("runtime command after external event failed: %v", result.Err)
	}
	if result.Event.Version != 3 || gameActor.Snapshot().Version != 3 {
		t.Fatalf("version after catch-up got event=%d snapshot=%d want 3", result.Event.Version, gameActor.Snapshot().Version)
	}
}

func TestActorRecoversAuthoritativeVersionAfterInjectedAppendCollisionAndAcceptsNextCommand(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	gameActor := NewGameActor("game-1", testState(), store, 8, DefaultAppliers())
	if err := store.AppendEvent(context.Background(), protocol.EventPayloadV2{
		GameID:    "game-1",
		Version:   2,
		Type:      "chat.message",
		Payload:   map[string]any{"message": "control-plane isolation"},
		CreatedBy: "p2",
		CreatedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatalf("inject conflicting event: %v", err)
	}

	// OLD: the duplicate-version error escaped as COMMAND_FAILED and left the
	// actor on v1 forever. NEW: the failed mutation is rolled back, authoritative
	// v2 is recovered once, and the caller receives a semantic resync conflict.
	conflict := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "life-collides-v2", "life.changed", map[string]any{
		"playerId": "p1",
		"life":     37,
	}), "p1")
	if !errors.Is(conflict.Err, ErrVersionConflict) {
		t.Fatalf("collision error got %v want %v", conflict.Err, ErrVersionConflict)
	}
	if snapshot := gameActor.Snapshot(); snapshot.Version != 2 || snapshot.Players["p1"]["life"] != 40 {
		t.Fatalf("failed command leaked state or actor did not recover: version=%d player=%#v", snapshot.Version, snapshot.Players["p1"])
	}
	if _, ok, err := store.EventByClientActionID(context.Background(), "game-1", "life-collides-v2"); err != nil || ok {
		t.Fatalf("failed action was persisted: ok=%v err=%v", ok, err)
	}

	next := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "life-after-recovery", "life.changed", map[string]any{
		"playerId": "p1",
		"life":     36,
	}), "p1")
	if next.Err != nil {
		t.Fatalf("next command failed after recovery: %v", next.Err)
	}
	if snapshot := gameActor.Snapshot(); next.Event.Version != 3 || snapshot.Version != 3 || snapshot.Players["p1"]["life"] != 36 {
		t.Fatalf("next command mismatch: event=%d stateVersion=%d player=%#v", next.Event.Version, snapshot.Version, snapshot.Players["p1"])
	}
	events, err := store.EventsAfter(context.Background(), "game-1", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].Version != 2 || events[1].Version != 3 {
		t.Fatalf("stream versions got %#v want [2, 3]", events)
	}
}

func TestActorAcceptsStaleBaseVersionAfterPresenceOnlyVersionAdvance(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	gameActor := NewGameActor("game-1", testState(), store, 8, DefaultAppliers())
	presence := command("game-1", 1, "presence-online-p2", "disconnect.vote", map[string]any{
		"targetPlayerId":   "p2",
		"status":           "online",
		"connectedUserIds": []any{"p1", "p2"},
	})
	presence.Client = map[string]any{"source": "runtime_ws_presence"}

	presenceResult := gameActor.ApplyDirect(context.Background(), presence, "p2")
	if presenceResult.Err != nil {
		t.Fatalf("presence event failed: %v", presenceResult.Err)
	}
	if presenceResult.Event.Version != 2 || presenceResult.Event.Type != "disconnect.vote.updated" {
		t.Fatalf("presence event mismatch: %#v", presenceResult.Event)
	}

	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "draw-after-presence", "library.draw", map[string]any{
		"playerId": "p1",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("runtime command after presence-only version advance failed: %v", result.Err)
	}
	if result.Event.Version != 3 || gameActor.Snapshot().Version != 3 {
		t.Fatalf("version after stale-base accept got event=%d snapshot=%d want 3", result.Event.Version, gameActor.Snapshot().Version)
	}
}

func TestActorRejectsStaleBaseVersionAfterGameplayEvent(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	gameActor := NewGameActor("game-1", testState(), store, 8, DefaultAppliers())
	first := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "life-before-stale-draw", "life.changed", map[string]any{
		"playerId": "p1",
		"life":     37,
	}), "p1")
	if first.Err != nil {
		t.Fatalf("first gameplay command failed: %v", first.Err)
	}

	stale := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "stale-draw-after-life", "library.draw", map[string]any{
		"playerId": "p1",
	}), "p1")
	if !errors.Is(stale.Err, ErrVersionConflict) {
		t.Fatalf("stale command error got %v want %v", stale.Err, ErrVersionConflict)
	}
	if gameActor.Snapshot().Version != 2 {
		t.Fatalf("stale rejected command changed version to %d, want 2", gameActor.Snapshot().Version)
	}
}

func TestCommanderCastCountIsIdempotentForRetry(t *testing.T) {
	gameActor := NewGameActor("game-1", testStateWithCommanderInCommand(), nil, 8, DefaultAppliers())
	cmd := command("game-1", 1, "cast-commander", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "command",
		"toZone":     "battlefield",
		"instanceId": "commander-1",
	})

	first := gameActor.ApplyDirect(context.Background(), cmd, "p1")
	if first.Err != nil {
		t.Fatalf("commander move failed: %v", first.Err)
	}
	retry := gameActor.ApplyDirect(context.Background(), cmd, "p1")
	if retry.Err != nil {
		t.Fatalf("commander retry failed: %v", retry.Err)
	}

	snapshot := gameActor.Snapshot()
	if got := snapshot.SharedCounters["commander:commander-1"]["casts"]; got != 1 {
		t.Fatalf("retry duplicated commander casts: got %d want 1", got)
	}
	if retry.Event.Version != first.Event.Version || snapshot.Version != 2 {
		t.Fatalf("retry was not idempotent: first=%d retry=%d state=%d", first.Event.Version, retry.Event.Version, snapshot.Version)
	}
}

func TestCommanderCastCountReplayDoesNotDuplicate(t *testing.T) {
	initial := testStateWithCommanderInCommand()
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "cast-commander", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "command",
		"toZone":     "battlefield",
		"instanceId": "commander-1",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("commander move failed: %v", result.Err)
	}

	replayed, err := ReplayEvents(initial, []protocol.EventPayloadV2{result.Event}, DefaultAppliers())
	if err != nil {
		t.Fatalf("replay failed: %v", err)
	}
	if got := replayed.SharedCounters["commander:commander-1"]["casts"]; got != 1 {
		t.Fatalf("replay duplicated commander casts: got %d want 1", got)
	}
}

func TestMovingCommanderWithoutCastingDoesNotIncrementCastCount(t *testing.T) {
	gameActor := NewGameActor("game-1", testStateWithCommanderInCommand(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-commander", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "command",
		"toZone":     "graveyard",
		"instanceId": "commander-1",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("commander move failed: %v", result.Err)
	}

	if got := gameActor.Snapshot().SharedCounters["commander:commander-1"]["casts"]; got != 0 {
		t.Fatalf("non-cast commander move changed casts: got %d want 0", got)
	}
	if patch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "game.counters.set"); patch != nil {
		t.Fatalf("non-cast move emitted commander counter patch: %#v", patch)
	}
}

func TestCommanderCastCountsWhenBattlefieldTargetPlayerDiffersFromOwner(t *testing.T) {
	game := testStateWithCommanderInCommand()
	gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "cast-commander-target-battlefield", "card.moved", map[string]any{
		"playerId":       "p1",
		"fromZone":       "command",
		"toZone":         "battlefield",
		"targetPlayerId": "p2",
		"instanceId":     "commander-1",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("commander move failed: %v", result.Err)
	}

	snapshot := gameActor.Snapshot()
	if got := snapshot.SharedCounters["commander:commander-1"]["casts"]; got != 1 {
		t.Fatalf("commander casts got %d want 1", got)
	}
	if got := snapshot.Instances["commander-1"].ControllerID; got != "p2" {
		t.Fatalf("commander controller got %s want p2", got)
	}
}

func TestZoneMoveAllUsesBatchPatchAndKeepsLocConsistent(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-all", "zone.move_all", map[string]any{
		"playerId": "p1",
		"fromZone": "hand",
		"toZone":   "exile",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("move all failed: %v", result.Err)
	}
	snapshot := gameActor.Snapshot()
	if got, want := joinStrings(snapshot.Zones["p1"].Exile), "h1,h2"; got != want {
		t.Fatalf("exile got %s want %s", got, want)
	}
	if err := state.ValidateInvariants(snapshot); err != nil {
		t.Fatalf("invalid state after move all: %v", err)
	}
	if patch := patchForVisibility(result.Patches, "player:p1", "zone.cards.batchMove"); patch == nil {
		t.Fatalf("missing private batch move: %#v", result.Patches)
	}
}

func TestZoneReorderedByIdsEmitsSemanticPatch(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "reorder", "zone.reorderedByIds", map[string]any{
		"playerId":    "p1",
		"zone":        "battlefield",
		"instanceIds": []string{"i1"},
	}), "p1")
	if result.Err != nil {
		t.Fatalf("reorder failed: %v", result.Err)
	}
	if patch := patchForVisibility(result.Patches, "public", "zone.reordered"); patch == nil {
		t.Fatalf("missing zone.reordered patch: %#v", result.Patches)
	}
}

func TestMoveToPrivateZoneDoesNotExposeCardKeyPublicly(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-private", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "battlefield",
		"toZone":     "hand",
		"instanceId": "i1",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("move failed: %v", result.Err)
	}
	publicRemove := patchForVisibility(result.Patches, "public", "zone.cards.remove")
	if publicRemove == nil {
		t.Fatalf("public should only see removal from battlefield: %#v", result.Patches)
	}
	publicEncoded := fmt.Sprintf("%#v", patchesForVisibility(result.Patches, "public"))
	if contains(publicEncoded, "card-a@1") {
		t.Fatalf("public patch leaked private destination card key: %s", publicEncoded)
	}
	privateMove := patchForVisibility(result.Patches, "player:p1", "zone.cards.move")
	if privateMove == nil {
		t.Fatalf("owner missing private move patch: %#v", result.Patches)
	}
}

func TestMoveHandToLibraryTopAndBottomPreservesRuntimeOrder(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())

	top := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-top", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "hand",
		"toZone":     "library",
		"instanceId": "h1",
		"position":   "top",
	}), "p1")
	if top.Err != nil {
		t.Fatalf("move to library top failed: %v", top.Err)
	}

	bottom := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "move-bottom", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "hand",
		"toZone":     "library",
		"instanceId": "h2",
		"position":   "bottom",
	}), "p1")
	if bottom.Err != nil {
		t.Fatalf("move to library bottom failed: %v", bottom.Err)
	}

	snapshot := gameActor.Snapshot()
	if got, want := joinStrings(snapshot.Zones["p1"].Library), "h2,l1,l2,l3,h1"; got != want {
		t.Fatalf("library got %s want %s", got, want)
	}
	if topMetrics := top.Event.Payload["metrics"].(map[string]any); topMetrics["movement.full_scan_count"] != 0 || topMetrics["movement.reindex_count"] != 0 {
		t.Fatalf("unexpected top metrics: %#v", topMetrics)
	}
	if bottomMetrics := bottom.Event.Payload["metrics"].(map[string]any); bottomMetrics["movement.full_scan_count"] != 0 || bottomMetrics["movement.reindex_count"] != 0 {
		t.Fatalf("unexpected bottom metrics: %#v", bottomMetrics)
	}
}

func TestMoveLibraryTopToHandKeepsCardPrivateToOwner(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "library-hand", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "library",
		"toZone":     "hand",
		"instanceId": "l3",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("move library to hand failed: %v", result.Err)
	}

	snapshot := gameActor.Snapshot()
	if got, want := joinStrings(snapshot.Zones["p1"].Hand), "h1,h2,l3"; got != want {
		t.Fatalf("hand got %s want %s", got, want)
	}
	publicEncoded := fmt.Sprintf("%#v", patchesForVisibility(result.Patches, "public"))
	if contains(publicEncoded, "l3@1") {
		t.Fatalf("public patch leaked library hand card key: %s", publicEncoded)
	}
	privateMove := patchForVisibility(result.Patches, "player:p1", "zone.cards.move")
	if privateMove == nil || privateMove.Data["card"] == nil {
		t.Fatalf("owner missing private move patch with card data: %#v", result.Patches)
	}
}

func TestZoneReorderedByIdsRejectsForeignOrDuplicateIDs(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "bad-reorder", "zone.reorderedByIds", map[string]any{
		"playerId":    "p1",
		"zone":        "hand",
		"instanceIds": []string{"h1", "h1"},
	}), "p1")
	if result.Err == nil {
		t.Fatal("expected invalid reorder to fail")
	}
}

func TestBattlefieldUntapAllPatchesOnlyAffectedCards(t *testing.T) {
	game := testState()
	instance := game.Instances["i1"]
	instance.Tapped = true
	instance.Rotation = 90
	game.Instances["i1"] = instance
	gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "untap", "battlefield.untap_all", map[string]any{"playerId": "p1"}), "p1")
	if result.Err != nil {
		t.Fatalf("untap failed: %v", result.Err)
	}
	op := result.Patches[0].Ops[0]
	if op.Op != "card.field.set" || op.Data["instanceId"] != "i1" || op.Data["tapped"] != false || op.Data["rotation"] != 0 {
		t.Fatalf("unexpected untap patch: %#v", op)
	}
}

func TestBattlefieldUntapAllUsesControllerAcrossBattlefields(t *testing.T) {
	game := testState()
	controlled := state.CardInstanceRuntime{InstanceID: "borrowed-1", CardKey: "borrowed@1", OwnerID: "p2", ControllerID: "p1", Zone: state.ZoneBattlefield, Tapped: true, Rotation: 90}
	opponent := state.CardInstanceRuntime{InstanceID: "opponent-1", CardKey: "opponent@1", OwnerID: "p2", ControllerID: "p2", Zone: state.ZoneBattlefield, Tapped: true, Rotation: 90}
	game.Instances["borrowed-1"] = controlled
	game.Instances["opponent-1"] = opponent
	zones := game.Zones["p2"]
	zones.Battlefield = []string{"borrowed-1", "opponent-1"}
	game.Zones["p2"] = zones
	game.Loc["borrowed-1"] = state.Location{PlayerID: "p2", Zone: state.ZoneBattlefield, Index: 0, ControllerID: "p1"}
	game.Loc["opponent-1"] = state.Location{PlayerID: "p2", Zone: state.ZoneBattlefield, Index: 1, ControllerID: "p2"}

	initial := game.Clone()
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "untap-controller", "battlefield.untap_all", map[string]any{"playerId": "p1"}), "p1")
	if result.Err != nil {
		t.Fatalf("untap failed: %v", result.Err)
	}
	snapshot := gameActor.Snapshot()
	if snapshot.Instances["borrowed-1"].Tapped || snapshot.Instances["borrowed-1"].Rotation != 0 {
		t.Fatalf("controlled permanent was not untapped: %#v", snapshot.Instances["borrowed-1"])
	}
	if !snapshot.Instances["opponent-1"].Tapped || snapshot.Instances["opponent-1"].Rotation != 90 {
		t.Fatalf("opponent permanent was untapped: %#v", snapshot.Instances["opponent-1"])
	}
	patch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "card.field.set")
	if patch == nil || patch.Data["instanceId"] != "borrowed-1" || patch.Data["playerId"] != "p2" {
		t.Fatalf("bad controlled untap patch: %#v", result.Patches)
	}

	replayed, err := ReplayEvents(initial, []protocol.EventPayloadV2{result.Event}, DefaultAppliers())
	if err != nil {
		t.Fatalf("replay failed: %v", err)
	}
	if replayed.Instances["borrowed-1"].Tapped || replayed.Instances["borrowed-1"].Rotation != 0 {
		t.Fatalf("replay did not preserve untap all: %#v", replayed.Instances["borrowed-1"])
	}
	if !replayed.Instances["opponent-1"].Tapped || replayed.Instances["opponent-1"].Rotation != 90 {
		t.Fatalf("replay untapped opponent permanent: %#v", replayed.Instances["opponent-1"])
	}
}

func TestBattlefieldAndCountersRuntimeMetricsStayAtZeroFullScan(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())

	tap := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "tap", "card.tapped", map[string]any{"instanceId": "i1", "tapped": true}), "p1")
	if tap.Err != nil {
		t.Fatalf("tap failed: %v", tap.Err)
	}
	position := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "position", "cards.position.changed", map[string]any{
		"playerId": "p1",
		"positions": []map[string]any{
			{"instanceId": "i1", "position": map[string]any{"x": 0.7, "y": 0.3, "unit": "ratio"}},
		},
	}), "p1")
	if position.Err != nil {
		t.Fatalf("positions failed: %v", position.Err)
	}
	counter := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "counter", "counter.changed", map[string]any{"scope": "player:p1", "key": "poison", "value": 2}), "p1")
	if counter.Err != nil {
		t.Fatalf("counter failed: %v", counter.Err)
	}

	for _, result := range []CommandResult{tap, position, counter} {
		metrics := result.Event.Payload["metrics"].(map[string]any)
		for key, value := range metrics {
			if contains(key, "full_scan_count") && value != 0 {
				t.Fatalf("unexpected full scan metric %s=%v", key, value)
			}
		}
	}
}

func TestCounterAndCommanderDamagePatchesArePublicAndCompact(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())

	counter := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "poison", "counter.changed", map[string]any{
		"scope": "player:p1",
		"key":   "poison",
		"value": 4,
	}), "p1")
	if counter.Err != nil {
		t.Fatalf("player counter failed: %v", counter.Err)
	}
	damage := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "damage", "commander.damage.changed", map[string]any{
		"targetPlayerId":      "p1",
		"commanderInstanceId": "commander-1",
		"damage":              13,
	}), "p1")
	if damage.Err != nil {
		t.Fatalf("commander damage failed: %v", damage.Err)
	}

	counterPatch := patchForVisibility(counter.Patches, "public", "player.counters.set")
	if counterPatch == nil || counterPatch.Data["playerId"] != "p1" {
		t.Fatalf("missing player counter patch: %#v", counter.Patches)
	}
	damagePatch := patchForVisibility(damage.Patches, "public", "player.commanderDamage.set")
	if damagePatch == nil || damagePatch.Data["playerId"] != "p1" {
		t.Fatalf("missing commander damage patch: %#v", damage.Patches)
	}
}

func TestCardCounterChangedDoesNotMutateUnrelatedState(t *testing.T) {
	initial := stateIntegrityCounterState(t)
	before := initial.Clone()
	gameActor := NewGameActor("game-1", initial, nil, 8, DefaultAppliers())

	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "integrity-counter", "card.counter.changed", map[string]any{
		"instanceId": "i1",
		"counter":    "+1/+1",
		"value":      3,
	}), "p1")
	if result.Err != nil {
		t.Fatalf("counter failed: %v", result.Err)
	}

	op := patchForVisibility(result.Patches, protocol.VisibilityPublic, "card.counters.patch")
	if op == nil {
		t.Fatalf("missing card.counters.patch: %#v", result.Patches)
	}
	if _, leaked := op.Data["position"]; leaked {
		t.Fatalf("counter patch leaked position: %#v", op.Data)
	}
	if _, leaked := op.Data["tapped"]; leaked {
		t.Fatalf("counter patch leaked tapped: %#v", op.Data)
	}
	if _, leaked := op.Data["faceDown"]; leaked {
		t.Fatalf("counter patch leaked faceDown: %#v", op.Data)
	}
	logPatch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "eventLog.append")
	if logPatch == nil {
		t.Fatalf("missing eventLog.append patch: %#v", result.Patches)
	}
	entries := logPatch.Data["entries"].([]map[string]any)
	if len(entries) != 1 || entries[0]["type"] != "card.counter.changed" || entries[0]["version"] != int64(2) {
		t.Fatalf("bad counter log entry: %#v", logPatch.Data)
	}

	after := gameActor.Snapshot()
	assertStateIntegrityAroundCounter(t, before, after, 3)
}

func TestCardCounterChangedAcceptsLegacyKeyPayload(t *testing.T) {
	gameActor := NewGameActor("game-1", stateIntegrityCounterState(t), nil, 8, DefaultAppliers())

	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "legacy-counter", "card.counter.changed", map[string]any{
		"instanceId": "i1",
		"key":        "charge",
		"value":      2,
	}), "p1")
	if result.Err != nil {
		t.Fatalf("legacy key counter failed: %v", result.Err)
	}
	if got := gameActor.Snapshot().Instances["i1"].Counters["charge"]; got != 2 {
		t.Fatalf("counter got %d want 2", got)
	}
}

func TestCardCounterZeroPersistsUntilExplicitRemove(t *testing.T) {
	gameActor := NewGameActor("game-1", stateIntegrityCounterState(t), nil, 8, DefaultAppliers())

	zero := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "counter-zero", "card.counter.changed", map[string]any{
		"instanceId": "i1",
		"counter":    "charge",
		"value":      0,
	}), "p1")
	if zero.Err != nil {
		t.Fatalf("zero counter failed: %v", zero.Err)
	}
	if got, ok := gameActor.Snapshot().Instances["i1"].Counters["charge"]; !ok || got != 0 {
		t.Fatalf("zero counter was not persisted: %#v", gameActor.Snapshot().Instances["i1"].Counters)
	}
	patch := patchForVisibility(zero.Patches, protocol.VisibilityPublic, "card.counters.patch")
	if patch == nil || patch.Data["counters"].(map[string]any)["charge"] != 0 {
		t.Fatalf("zero counter missing from patch: %#v", zero.Patches)
	}

	life := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "life-after-zero-counter", "life.changed", map[string]any{
		"playerId": "p1",
		"delta":    -1,
	}), "p1")
	if life.Err != nil {
		t.Fatalf("life after zero counter failed: %v", life.Err)
	}
	if got, ok := gameActor.Snapshot().Instances["i1"].Counters["charge"]; !ok || got != 0 {
		t.Fatalf("zero counter evaporated after unrelated action: %#v", gameActor.Snapshot().Instances["i1"].Counters)
	}

	remove := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "counter-remove", "card.counter.changed", map[string]any{
		"instanceId": "i1",
		"counter":    "charge",
		"remove":     true,
	}), "p1")
	if remove.Err != nil {
		t.Fatalf("counter remove failed: %v", remove.Err)
	}
	if _, ok := gameActor.Snapshot().Instances["i1"].Counters["charge"]; ok {
		t.Fatalf("explicit remove did not delete counter: %#v", gameActor.Snapshot().Instances["i1"].Counters)
	}
}

func TestPowerToughnessCountersUpdateMutableStats(t *testing.T) {
	gameActor := NewGameActor("game-1", stateIntegrityCounterState(t), nil, 8, DefaultAppliers())

	plus := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "plus-counter", "card.counter.changed", map[string]any{
		"instanceId": "i1",
		"counter":    "+1/+1",
		"value":      1,
	}), "p1")
	if plus.Err != nil {
		t.Fatalf("+1/+1 counter failed: %v", plus.Err)
	}
	instance := gameActor.Snapshot().Instances["i1"]
	if instance.MutableStats["power"] != 6 || instance.MutableStats["toughness"] != 8 {
		t.Fatalf("+1/+1 did not update stats: %#v", instance.MutableStats)
	}
	plusPatch := patchForVisibility(plus.Patches, protocol.VisibilityPublic, "card.counters.patch")
	if plusPatch == nil || plusPatch.Data["power"] != 6 || plusPatch.Data["toughness"] != 8 {
		t.Fatalf("+1/+1 patch missing stats: %#v", plus.Patches)
	}

	minus := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "minus-counter", "card.counter.changed", map[string]any{
		"instanceId": "i1",
		"counter":    "-1/-1",
		"value":      1,
	}), "p1")
	if minus.Err != nil {
		t.Fatalf("-1/-1 counter failed: %v", minus.Err)
	}
	instance = gameActor.Snapshot().Instances["i1"]
	if instance.MutableStats["power"] != 5 || instance.MutableStats["toughness"] != 7 {
		t.Fatalf("-1/-1 did not update stats: %#v", instance.MutableStats)
	}
	minusPatch := patchForVisibility(minus.Patches, protocol.VisibilityPublic, "card.counters.patch")
	if minusPatch == nil || minusPatch.Data["power"] != 5 || minusPatch.Data["toughness"] != 7 {
		t.Fatalf("-1/-1 patch missing stats: %#v", minus.Patches)
	}
	if patch := patchForVisibility(minus.Patches, protocol.VisibilityPublic, "card.field.set"); patch != nil {
		t.Fatalf("counter stats must stay on card.counters.patch, got field patch: %#v", patch)
	}
}

func TestCardCounterChangedRejectsMissingOrConflictingCounterPayload(t *testing.T) {
	t.Run("missing counter", func(t *testing.T) {
		gameActor := NewGameActor("game-1", stateIntegrityCounterState(t), nil, 8, DefaultAppliers())
		result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "missing-counter", "card.counter.changed", map[string]any{
			"instanceId": "i1",
			"value":      2,
		}), "p1")
		if !errors.Is(result.Err, ErrMissingPayloadField) {
			t.Fatalf("err got %v want missing payload field", result.Err)
		}
	})

	t.Run("conflicting counter and key", func(t *testing.T) {
		gameActor := NewGameActor("game-1", stateIntegrityCounterState(t), nil, 8, DefaultAppliers())
		result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "conflicting-counter", "card.counter.changed", map[string]any{
			"instanceId": "i1",
			"counter":    "charge",
			"key":        "+1/+1",
			"value":      2,
		}), "p1")
		if result.Err == nil || !strings.Contains(result.Err.Error(), "conflicting payload fields") {
			t.Fatalf("err got %v want conflicting payload fields", result.Err)
		}
	})
}

func TestCardCounterReplayPreservesUnrelatedState(t *testing.T) {
	initial := stateIntegrityCounterState(t)
	before := initial.Clone()
	event := protocol.EventPayloadV2{
		GameID:         "game-1",
		Version:        2,
		Type:           "card.counter.changed",
		Payload:        map[string]any{"instanceId": "i1", "counter": "+1/+1", "value": 3},
		CreatedBy:      "p1",
		ClientActionID: "integrity-counter",
	}

	replayed, err := ReplayEvents(initial, []protocol.EventPayloadV2{event}, DefaultAppliers())
	if err != nil {
		t.Fatalf("replay failed: %v", err)
	}

	assertStateIntegrityAroundCounter(t, before, replayed, 3)
}

func TestCardCounterReplayPreservesZeroValueCounter(t *testing.T) {
	initial := stateIntegrityCounterState(t)
	event := protocol.EventPayloadV2{
		GameID:         "game-1",
		Version:        2,
		Type:           "card.counter.changed",
		Payload:        map[string]any{"instanceId": "i1", "counter": "charge", "value": 0},
		CreatedBy:      "p1",
		ClientActionID: "zero-counter",
	}

	replayed, err := ReplayEvents(initial, []protocol.EventPayloadV2{event}, DefaultAppliers())
	if err != nil {
		t.Fatalf("replay failed: %v", err)
	}
	if got, ok := replayed.Instances["i1"].Counters["charge"]; !ok || got != 0 {
		t.Fatalf("replay did not preserve zero counter: %#v", replayed.Instances["i1"].Counters)
	}
}

func TestCardCounterRollbackDoesNotClobberUnrelatedState(t *testing.T) {
	store := failingAppendStore{err: errors.New("append failed")}
	initial := stateIntegrityCounterState(t)
	before := initial.Clone()
	gameActor := NewGameActorWithSnapshotPolicy("game-1", initial, store, 8, DefaultAppliers(), SnapshotPolicy{})

	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "integrity-counter", "card.counter.changed", map[string]any{
		"instanceId": "i1",
		"counter":    "+1/+1",
		"value":      3,
	}), "p1")
	if !errors.Is(result.Err, store.err) {
		t.Fatalf("err got %v want %v", result.Err, store.err)
	}
	after := gameActor.Snapshot()
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("rollback changed state\nbefore=%#v\nafter=%#v", before, after)
	}
}

func TestCardPowerToughnessPatchUsesTopLevelFields(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "stats", "card.power_toughness.changed", map[string]any{
		"instanceId": "i1",
		"power":      7,
		"toughness":  8,
		"loyalty":    4,
	}), "p1")
	if result.Err != nil {
		t.Fatalf("stats failed: %v", result.Err)
	}
	op := result.Patches[0].Ops[0]
	if op.Op != "card.field.set" || op.Data["power"] != 7 || op.Data["toughness"] != 8 || op.Data["loyalty"] != 4 {
		t.Fatalf("unexpected stats patch: %#v", op)
	}
}

func TestStackAddRemoveUsesCompactPayload(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	add := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "stack-add", "stack.card_added", map[string]any{
		"playerId":   "p1",
		"instanceId": "i1",
		"text":       "Cast this spell",
	}), "p1")
	if add.Err != nil {
		t.Fatalf("stack add failed: %v", add.Err)
	}
	if len(gameActor.Snapshot().Stack) != 1 {
		t.Fatalf("stack not updated: %#v", gameActor.Snapshot().Stack)
	}
	addPatch := patchForVisibility(add.Patches, "public", "stack.item.add")
	if addPatch == nil {
		t.Fatalf("missing stack add patch: %#v", add.Patches)
	}
	encoded := fmt.Sprintf("%#v", add.Patches)
	if contains(encoded, "imageUris") || contains(encoded, "oracleText") || contains(encoded, "cardFaces") || contains(encoded, "card:") {
		t.Fatalf("stack patch duplicated static/card payload: %s", encoded)
	}
	metrics := add.Event.Payload["metrics"].(map[string]any)
	if metrics["stack.static_payload_bytes"] != 0 || metrics["stack.patch_bytes"].(int) <= 0 {
		t.Fatalf("unexpected stack metrics: %#v", metrics)
	}

	remove := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "stack-remove", "stack.item_removed", map[string]any{
		"stackId": "stack-stack-add",
	}), "p1")
	if remove.Err != nil {
		t.Fatalf("stack remove failed: %v", remove.Err)
	}
	if len(gameActor.Snapshot().Stack) != 0 {
		t.Fatalf("stack not removed: %#v", gameActor.Snapshot().Stack)
	}
	if patch := patchForVisibility(remove.Patches, "public", "stack.item.remove"); patch == nil {
		t.Fatalf("missing stack remove patch: %#v", remove.Patches)
	}
}

func TestRelationsCreateRemoveAndIndexesStayCompact(t *testing.T) {
	game := testStateWithTwoBattlefieldCards()
	gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())

	arrow := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "arrow-add", "arrow.created", map[string]any{
		"playerId":       "p1",
		"fromInstanceId": "i1",
		"toInstanceId":   "i2",
		"color":          "blue",
		"imageUris":      map[string]any{"normal": "bad"},
		"oracleText":     "bad",
		"cardFaces":      []any{"bad"},
		"card":           map[string]any{"name": "bad"},
	}), "p1")
	if arrow.Err != nil {
		t.Fatalf("arrow add failed: %v", arrow.Err)
	}
	snapshot := gameActor.Snapshot()
	if got := snapshot.Relations.Indexes.BySource["i1"]; len(got) != 1 || got[0] != "arrow-arrow-add" {
		t.Fatalf("bad source index: %#v", snapshot.Relations.Indexes)
	}
	if patch := patchForVisibility(arrow.Patches, "public", "arrow.add"); patch == nil {
		t.Fatalf("missing arrow add patch: %#v", arrow.Patches)
	}
	if encoded := fmt.Sprintf("%#v", arrow.Patches); contains(encoded, "imageUris") || contains(encoded, "oracleText") || contains(encoded, "cardFaces") || contains(encoded, "card:") {
		t.Fatalf("arrow patch leaked static/card payload: %s", encoded)
	}

	attachment := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "attachment-add", "attachment.created", map[string]any{
		"playerId":             "p1",
		"equipmentInstanceId":  "i2",
		"attachedToInstanceId": "i1",
	}), "p1")
	if attachment.Err != nil {
		t.Fatalf("attachment add failed: %v", attachment.Err)
	}
	if patch := patchForVisibility(attachment.Patches, "public", "attachment.add"); patch == nil {
		t.Fatalf("missing attachment add patch: %#v", attachment.Patches)
	}

	removeArrow := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "arrow-remove", "arrow.removed", map[string]any{"id": "arrow-arrow-add"}), "p1")
	if removeArrow.Err != nil {
		t.Fatalf("arrow remove failed: %v", removeArrow.Err)
	}
	removeAttachment := gameActor.ApplyDirect(context.Background(), command("game-1", 4, "attachment-remove", "attachment.removed", map[string]any{"id": "attachment-attachment-add"}), "p1")
	if removeAttachment.Err != nil {
		t.Fatalf("attachment remove failed: %v", removeAttachment.Err)
	}
	snapshot = gameActor.Snapshot()
	if len(snapshot.Relations.Arrows) != 0 || len(snapshot.Relations.Attachments) != 0 {
		t.Fatalf("relations not removed: %#v", snapshot.Relations)
	}
}

func TestHelpersCreateUpdateRemoveWithoutStaticPayload(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	create := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "helper-create", "helper.created", map[string]any{
		"playerId":      "p1",
		"template":      "emblem",
		"scope":         "player",
		"ownerPlayerId": "p1",
		"state":         map[string]any{"name": "Emblem"},
		"card": map[string]any{
			"scryfallId": "scryfall-1",
			"name":       "Emblem Card",
			"imageUris":  map[string]any{"normal": "bad"},
			"oracleText": "bad",
			"cardFaces":  []any{"bad"},
		},
	}), "p1")
	if create.Err != nil {
		t.Fatalf("helper create failed: %v", create.Err)
	}
	if patch := patchForVisibility(create.Patches, "public", "helper.add"); patch == nil {
		t.Fatalf("missing helper add patch: %#v", create.Patches)
	}
	if encoded := fmt.Sprintf("%#v", create.Patches); contains(encoded, "imageUris") || contains(encoded, "oracleText") || contains(encoded, "cardFaces") {
		t.Fatalf("helper patch leaked static payload: %s", encoded)
	}

	update := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "helper-update", "helper.updated", map[string]any{
		"entityId": "helper-helper-create",
		"state":    map[string]any{"name": "Updated"},
	}), "p1")
	if update.Err != nil {
		t.Fatalf("helper update failed: %v", update.Err)
	}
	if patch := patchForVisibility(update.Patches, "public", "helper.update"); patch == nil {
		t.Fatalf("missing helper update patch: %#v", update.Patches)
	}
	remove := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "helper-remove", "helper.removed", map[string]any{"entityId": "helper-helper-create"}), "p1")
	if remove.Err != nil {
		t.Fatalf("helper remove failed: %v", remove.Err)
	}
	if len(gameActor.Snapshot().Relations.Helpers) != 0 {
		t.Fatalf("helper not removed: %#v", gameActor.Snapshot().Relations.Helpers)
	}
}

func TestMovingCardPrunesRelationsIncrementally(t *testing.T) {
	game := testStateWithTwoBattlefieldCards()
	ops := state.NewRelationsOps()
	if err := ops.AddArrow(&game, state.Relation{ID: "arrow-1", SourceID: "i1", TargetID: "i2"}); err != nil {
		t.Fatalf("seed arrow failed: %v", err)
	}
	if err := ops.AddAttachment(&game, state.Relation{ID: "attachment-1", SourceID: "i2", TargetID: "i1"}); err != nil {
		t.Fatalf("seed attachment failed: %v", err)
	}
	gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
	move := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-prune", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "battlefield",
		"toZone":     "graveyard",
		"instanceId": "i1",
	}), "p1")
	if move.Err != nil {
		t.Fatalf("move failed: %v", move.Err)
	}
	snapshot := gameActor.Snapshot()
	if len(snapshot.Relations.Arrows) != 0 || len(snapshot.Relations.Attachments) != 0 {
		t.Fatalf("relations not pruned: %#v", snapshot.Relations)
	}
	if patchForVisibility(move.Patches, "public", "arrow.remove") == nil || patchForVisibility(move.Patches, "public", "attachment.remove") == nil {
		t.Fatalf("missing prune patches: %#v", move.Patches)
	}
}

func TestStackAndRelationsReplayReconstructsState(t *testing.T) {
	game := testStateWithTwoBattlefieldCards()
	gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
	stack := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "stack-add", "stack.card_added", map[string]any{"instanceId": "i1"}), "p1")
	if stack.Err != nil {
		t.Fatalf("stack failed: %v", stack.Err)
	}
	arrow := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "arrow-add", "arrow.created", map[string]any{"fromInstanceId": "i1", "toInstanceId": "i2"}), "p1")
	if arrow.Err != nil {
		t.Fatalf("arrow failed: %v", arrow.Err)
	}
	replayed := testStateWithTwoBattlefieldCards()
	if err := ReplayEventWithAppliers(&replayed, stack.Event, DefaultAppliers()); err != nil {
		t.Fatalf("replay stack failed: %v", err)
	}
	replayed.Version = stack.Event.Version
	if err := ReplayEventWithAppliers(&replayed, arrow.Event, DefaultAppliers()); err != nil {
		t.Fatalf("replay arrow failed: %v", err)
	}
	if len(replayed.Stack) != 1 || len(replayed.Relations.Arrows) != 1 {
		t.Fatalf("replay mismatch stack=%#v relations=%#v", replayed.Stack, replayed.Relations)
	}
}

func BenchmarkStackRelations4Players100(b *testing.B) {
	for _, scenario := range []struct {
		name    string
		command string
		payload map[string]any
	}{
		{name: "stack_add", command: "stack.card_added", payload: map[string]any{"instanceId": "bf00"}},
		{name: "stack_remove", command: "stack.item_removed", payload: map[string]any{"stackId": "stack-existing"}},
		{name: "arrows_20", command: "arrow.created", payload: map[string]any{"fromInstanceId": "bf00", "toInstanceId": "bf01", "color": "red"}},
		{name: "attachments_20", command: "attachment.created", payload: map[string]any{"equipmentInstanceId": "bf00", "attachedToInstanceId": "bf01"}},
		{name: "helper_update", command: "helper.updated", payload: map[string]any{"entityId": "helper-existing", "state": map[string]any{"value": 2}}},
	} {
		b.Run(scenario.name, func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				game := benchmarkRelationsState(100, 20)
				gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
				payload := cloneMap(scenario.payload)
				if scenario.name == "stack_add" {
					payload["stackId"] = "stack-bench"
				}
				if scenario.name == "arrows_20" {
					for n := 0; n < 20; n++ {
						payload["id"] = fmt.Sprintf("arrow-%02d", n)
						result := gameActor.ApplyDirect(context.Background(), command("game-1", int64(n+1), fmt.Sprintf("%s-%d", scenario.name, n), scenario.command, payload), "p1")
						if result.Err != nil {
							b.Fatal(result.Err)
						}
					}
					continue
				}
				if scenario.name == "attachments_20" {
					for n := 0; n < 20; n++ {
						payload["id"] = fmt.Sprintf("attachment-%02d", n)
						payload["equipmentInstanceId"] = fmt.Sprintf("bf%02d", n)
						payload["attachedToInstanceId"] = fmt.Sprintf("bf%02d", (n+1)%20)
						result := gameActor.ApplyDirect(context.Background(), command("game-1", int64(n+1), fmt.Sprintf("%s-%d", scenario.name, n), scenario.command, payload), "p1")
						if result.Err != nil {
							b.Fatal(result.Err)
						}
					}
					continue
				}
				result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, scenario.name, scenario.command, payload), "p1")
				if result.Err != nil {
					b.Fatal(result.Err)
				}
			}
		})
	}
}

func BenchmarkEdgeCommands4Players100(b *testing.B) {
	for _, scenario := range []struct {
		name    string
		command string
		payload map[string]any
	}{
		{name: "token_create_1", command: "card.token.created", payload: map[string]any{"playerId": "p1", "quantity": 1}},
		{name: "token_create_20", command: "card.token.created", payload: map[string]any{"playerId": "p1", "quantity": 20}},
		{name: "token_copy_1", command: "card.token_copy.created", payload: map[string]any{"instanceId": "bf00", "targetPlayerId": "p1"}},
		{name: "random_private_zone", command: "zone.random_card.selected", payload: map[string]any{"playerId": "p1", "zone": "hand"}},
		{name: "put_top", command: "library.put_top", payload: map[string]any{"playerId": "p1", "instanceId": "h000"}},
		{name: "put_bottom", command: "library.put_bottom", payload: map[string]any{"playerId": "p1", "instanceId": "h000"}},
	} {
		b.Run(scenario.name, func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				game := benchmarkMovementState(100, 20)
				gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
				result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, scenario.name, scenario.command, cloneMap(scenario.payload)), "p1")
				if result.Err != nil {
					b.Fatal(result.Err)
				}
			}
		})
	}
}

func TestLibraryReplayReconstructsDrawAndShuffleOrder(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	draw := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "draw", "library.draw_many", map[string]any{"playerId": "p1", "count": 2}), "p1")
	if draw.Err != nil {
		t.Fatalf("draw failed: %v", draw.Err)
	}
	shuffle := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "shuffle", "library.shuffle", map[string]any{"playerId": "p1"}), "p1")
	if shuffle.Err != nil {
		t.Fatalf("shuffle failed: %v", shuffle.Err)
	}

	replayed := testState()
	if err := ReplayEvent(&replayed, draw.Event); err != nil {
		t.Fatalf("replay draw failed: %v", err)
	}
	if err := ReplayEvent(&replayed, shuffle.Event); err != nil {
		t.Fatalf("replay shuffle failed: %v", err)
	}
	if got, want := len(replayed.Zones["p1"].Hand), len(gameActor.Snapshot().Zones["p1"].Hand); got != want {
		t.Fatalf("hand count got %d want %d", got, want)
	}
	if got, want := len(replayed.Zones["p1"].Library), len(gameActor.Snapshot().Zones["p1"].Library); got != want {
		t.Fatalf("library count got %d want %d", got, want)
	}
	if !equalStrings(replayed.Zones["p1"].Library, gameActor.Snapshot().Zones["p1"].Library) {
		t.Fatalf("library order mismatch replayed=%#v current=%#v", replayed.Zones["p1"].Library, gameActor.Snapshot().Zones["p1"].Library)
	}
}

func TestLibraryReplayReconstructsMoveAndPut(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	move := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move", "library.move_top", map[string]any{"playerId": "p1", "toZone": "library", "position": "bottom", "count": 1}), "p1")
	if move.Err != nil {
		t.Fatalf("move failed: %v", move.Err)
	}
	put := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "put", "library.put_top", map[string]any{"playerId": "p1", "instanceId": "h1"}), "p1")
	if put.Err != nil {
		t.Fatalf("put failed: %v", put.Err)
	}
	replayed := testState()
	if err := ReplayEvent(&replayed, move.Event); err != nil {
		t.Fatalf("replay move failed: %v", err)
	}
	replayed.Version = move.Event.Version
	if err := ReplayEvent(&replayed, put.Event); err != nil {
		t.Fatalf("replay put failed: %v", err)
	}
	if got, want := joinStrings(replayed.Zones["p1"].Library), joinStrings(gameActor.Snapshot().Zones["p1"].Library); got != want {
		t.Fatalf("replayed library got %s want %s", got, want)
	}
}

func TestCardsMovedBatchDoesNotTouchLargeLibraryOrder(t *testing.T) {
	game := benchmarkState(100)
	before := append([]string(nil), game.Zones["p1"].Library...)
	gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move", "cards.moved", map[string]any{
		"playerId":    "p1",
		"fromZone":    "hand",
		"toZone":      "graveyard",
		"instanceIds": []string{"h000", "h001", "h002"},
	}), "p1")
	if result.Err != nil {
		t.Fatalf("move failed: %v", result.Err)
	}
	after := gameActor.Snapshot().Zones["p1"].Library
	for index := range before {
		if before[index] != after[index] {
			t.Fatalf("library order changed at %d", index)
		}
	}
}

func TestMovementReplayReconstructsMovedCards(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	move := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move", "cards.moved", map[string]any{
		"playerId":    "p1",
		"fromZone":    "hand",
		"toZone":      "graveyard",
		"instanceIds": []string{"h1", "h2"},
	}), "p1")
	if move.Err != nil {
		t.Fatalf("move failed: %v", move.Err)
	}
	replayed := testState()
	if err := ReplayEventWithAppliers(&replayed, move.Event, DefaultAppliers()); err != nil {
		t.Fatalf("replay failed: %v", err)
	}
	if got, want := joinStrings(replayed.Zones["p1"].Graveyard), joinStrings(gameActor.Snapshot().Zones["p1"].Graveyard); got != want {
		t.Fatalf("replayed graveyard got %s want %s", got, want)
	}
}

func TestControlledPermanentMovesToOwnerGraveyardAndExile(t *testing.T) {
	for _, tt := range []struct {
		name string
		zone state.Zone
	}{
		{name: "graveyard", zone: state.ZoneGraveyard},
		{name: "exile", zone: state.ZoneExile},
	} {
		t.Run(tt.name, func(t *testing.T) {
			initial := testControlledPermanentState()
			gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
			result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-controlled-"+tt.name, "card.moved", map[string]any{
				"playerId":   "p2",
				"fromZone":   "battlefield",
				"toZone":     string(tt.zone),
				"instanceId": "i1",
			}), "p2")
			if result.Err != nil {
				t.Fatalf("move failed: %v", result.Err)
			}
			snapshot := gameActor.Snapshot()
			if got := joinStrings(testZoneIDs(snapshot.Zones["p1"], tt.zone)); got != "i1" {
				t.Fatalf("owner zone got %s want i1", got)
			}
			if got := joinStrings(testZoneIDs(snapshot.Zones["p2"], tt.zone)); got != "" {
				t.Fatalf("controller zone got %s want empty", got)
			}
			instance := snapshot.Instances["i1"]
			if instance.OwnerID != "p1" || instance.ControllerID != "p1" {
				t.Fatalf("controller did not return to owner: %#v", instance)
			}
			location := snapshot.Loc["i1"]
			if location.PlayerID != "p1" || location.Zone != tt.zone || location.ControllerID != "p1" {
				t.Fatalf("bad location after owner-zone move: %#v", location)
			}

			replayed, err := ReplayEvents(initial, []protocol.EventPayloadV2{result.Event}, DefaultAppliers())
			if err != nil {
				t.Fatalf("replay failed: %v", err)
			}
			if got := joinStrings(testZoneIDs(replayed.Zones["p1"], tt.zone)); got != "i1" {
				t.Fatalf("replayed owner zone got %s want i1", got)
			}
			if replayed.Instances["i1"].ControllerID != "p1" {
				t.Fatalf("replayed controller did not return to owner: %#v", replayed.Instances["i1"])
			}
		})
	}
}

func TestTokenLeavingBattlefieldEvaporatesInsteadOfEnteringDestinationZone(t *testing.T) {
	for _, tt := range []struct {
		name string
		zone state.Zone
	}{
		{name: "graveyard", zone: state.ZoneGraveyard},
		{name: "exile", zone: state.ZoneExile},
	} {
		t.Run(tt.name, func(t *testing.T) {
			initial := testState()
			token := initial.Instances["i1"]
			token.IsToken = true
			token.TokenMeta = map[string]any{"isCopy": false}
			initial.Instances["i1"] = token
			gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
			result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "token-evaporate-"+tt.name, "card.moved", map[string]any{
				"playerId":   "p1",
				"fromZone":   "battlefield",
				"toZone":     string(tt.zone),
				"instanceId": "i1",
			}), "p1")
			if result.Err != nil {
				t.Fatalf("token move failed: %v", result.Err)
			}

			snapshot := gameActor.Snapshot()
			if _, ok := snapshot.Instances["i1"]; ok {
				t.Fatalf("token remained in instances after evaporation: %#v", snapshot.Instances["i1"])
			}
			if _, ok := snapshot.Loc["i1"]; ok {
				t.Fatalf("token remained in loc after evaporation: %#v", snapshot.Loc["i1"])
			}
			if got := joinStrings(testZoneIDs(snapshot.Zones["p1"], tt.zone)); got != "" {
				t.Fatalf("token entered %s: %s", tt.zone, got)
			}
			remove := patchForVisibility(result.Patches, protocol.VisibilityPublic, "zone.cards.remove")
			if remove == nil {
				t.Fatalf("missing token remove patch: %#v", result.Patches)
			}
			if move := patchForVisibility(result.Patches, protocol.VisibilityPublic, "zone.cards.move"); move != nil {
				t.Fatalf("token emitted move patch instead of remove: %#v", move)
			}

			replayed, err := ReplayEvents(initial, []protocol.EventPayloadV2{result.Event}, DefaultAppliers())
			if err != nil {
				t.Fatalf("replay failed: %v", err)
			}
			if _, ok := replayed.Instances["i1"]; ok {
				t.Fatalf("replay reintroduced evaporated token: %#v", replayed.Instances["i1"])
			}
			if got := joinStrings(testZoneIDs(replayed.Zones["p1"], tt.zone)); got != "" {
				t.Fatalf("replay put token into %s: %s", tt.zone, got)
			}
		})
	}
}

func TestTokenCopyLeavingBattlefieldEvaporates(t *testing.T) {
	initial := testState()
	token := initial.Instances["i1"]
	token.IsToken = true
	token.TokenMeta = map[string]any{"isCopy": true, "copiedFromInstanceId": "source-1"}
	initial.Instances["i1"] = token
	gameActor := NewGameActor("game-1", initial.Clone(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "token-copy-evaporate", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "battlefield",
		"toZone":     "graveyard",
		"instanceId": "i1",
	}), "p1")
	if result.Err != nil {
		t.Fatalf("token copy move failed: %v", result.Err)
	}
	if _, ok := gameActor.Snapshot().Instances["i1"]; ok {
		t.Fatalf("token copy remained after evaporation")
	}
}

func TestBattlefieldExitResetsMutableStateAndPrunesRelations(t *testing.T) {
	game := testControlledPermanentState()
	game.Instances["i1"] = state.CardInstanceRuntime{
		InstanceID:    "i1",
		CardKey:       "card-a@1",
		OwnerID:       "p1",
		ControllerID:  "p2",
		Zone:          state.ZoneBattlefield,
		Tapped:        true,
		Rotation:      90,
		Counters:      map[string]int{"+1/+1": 3},
		MutableStats:  map[string]any{"power": 7, "toughness": 8, "loyalty": 2, "defense": 4, "saga": 3},
		Position:      map[string]any{"x": 0.7, "y": 0.4, "unit": "ratio"},
		FaceDown:      true,
		ActiveFace:    1,
		VisibleToMask: 3,
	}
	game.Visibility.InstanceMasks["i1"] = 3
	game.Relations = state.Relations{
		Arrows: map[string]state.Relation{
			"arrow-1": {ID: "arrow-1", SourceID: "i1", TargetID: "other-1"},
		},
		Attachments: map[string]state.Relation{
			"attachment-1": {ID: "attachment-1", SourceID: "equipment-1", TargetID: "i1"},
		},
		Helpers: map[string]state.Relation{},
		Indexes: state.RelationIndexes{
			BySource: map[string][]string{"i1": []string{"arrow-1"}, "equipment-1": []string{"attachment-1"}},
			ByTarget: map[string][]string{"other-1": []string{"arrow-1"}, "i1": []string{"attachment-1"}},
		},
	}
	game.Instances["other-1"] = state.CardInstanceRuntime{InstanceID: "other-1", CardKey: "other@1", OwnerID: "p2", ControllerID: "p2", Zone: state.ZoneBattlefield}
	game.Instances["equipment-1"] = state.CardInstanceRuntime{InstanceID: "equipment-1", CardKey: "equipment@1", OwnerID: "p2", ControllerID: "p2", Zone: state.ZoneBattlefield}
	zones := game.Zones["p2"]
	zones.Battlefield = []string{"i1", "other-1", "equipment-1"}
	game.Zones["p2"] = zones
	game.Loc["other-1"] = state.Location{PlayerID: "p2", Zone: state.ZoneBattlefield, Index: 1, ControllerID: "p2"}
	game.Loc["equipment-1"] = state.Location{PlayerID: "p2", Zone: state.ZoneBattlefield, Index: 2, ControllerID: "p2"}

	gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-reset", "card.moved", map[string]any{
		"playerId":   "p2",
		"fromZone":   "battlefield",
		"toZone":     "graveyard",
		"instanceId": "i1",
	}), "p2")
	if result.Err != nil {
		t.Fatalf("move failed: %v", result.Err)
	}
	snapshot := gameActor.Snapshot()
	instance := snapshot.Instances["i1"]
	if instance.Tapped || instance.Rotation != 0 || instance.FaceDown || instance.VisibleToMask != 0 || instance.ActiveFace != 0 {
		t.Fatalf("battlefield flags were not reset: %#v", instance)
	}
	if len(instance.Counters) != 0 || len(instance.MutableStats) != 0 || instance.Position != nil {
		t.Fatalf("battlefield mutable state was not reset: %#v", instance)
	}
	if _, ok := snapshot.Visibility.InstanceMasks["i1"]; ok {
		t.Fatalf("visibility mask remained after battlefield exit: %#v", snapshot.Visibility.InstanceMasks)
	}
	if len(snapshot.Relations.Arrows) != 0 || len(snapshot.Relations.Attachments) != 0 {
		t.Fatalf("relations were not pruned: %#v", snapshot.Relations)
	}
	if patchForVisibility(result.Patches, protocol.VisibilityPublic, "relation.remove") == nil {
		t.Fatalf("missing relation removal patch: %#v", result.Patches)
	}
}

func TestHandToBattlefieldFaceDownMoveStaysHidden(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move-face-down", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "hand",
		"toZone":     "battlefield",
		"instanceId": "h1",
		"faceDown":   true,
	}), "p1")
	if result.Err != nil {
		t.Fatalf("move failed: %v", result.Err)
	}
	snapshot := gameActor.Snapshot()
	if !snapshot.Instances["h1"].FaceDown {
		t.Fatalf("faceDown was not preserved on battlefield: %#v", snapshot.Instances["h1"])
	}
	publicAdd := patchForVisibility(result.Patches, protocol.VisibilityPublic, "zone.cards.add")
	if publicAdd == nil {
		t.Fatalf("missing public add patch: %#v", result.Patches)
	}
	cards := publicAdd.Data["cards"].([]map[string]any)
	if cards[0]["hidden"] != true || cards[0]["faceDown"] != true {
		t.Fatalf("public faceDown move was not hidden: %#v", cards[0])
	}
	if _, leaked := cards[0]["cardKey"]; leaked {
		t.Fatalf("public faceDown move leaked identity: %#v", cards[0])
	}

	replayed, err := ReplayEvents(testState(), []protocol.EventPayloadV2{result.Event}, DefaultAppliers())
	if err != nil {
		t.Fatalf("replay failed: %v", err)
	}
	if !replayed.Instances["h1"].FaceDown {
		t.Fatalf("replay did not preserve faceDown move: %#v", replayed.Instances["h1"])
	}
}

func TestLibraryViewAndTargetedRevealDoNotLeakFullLibraryOnMove(t *testing.T) {
	game := testState()
	game.Players["p3"] = map[string]any{"life": 40, "counters": map[string]any{}, "commanderDamage": map[string]any{}}
	gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
	view := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "view-library", "library.view", map[string]any{
		"playerId": "p1",
		"count":    2,
	}), "p1")
	if view.Err != nil {
		t.Fatalf("view failed: %v", view.Err)
	}
	if publicView := patchForVisibility(view.Patches, protocol.VisibilityPublic, "library.top.viewed"); publicView != nil {
		t.Fatalf("library view leaked public top cards: %#v", publicView)
	}

	reveal := gameActor.ApplyDirect(context.Background(), command("game-1", 2, "targeted-reveal", "library.reveal_top", map[string]any{
		"playerId": "p1",
		"count":    2,
		"viewers":  []any{"p2"},
	}), "p1")
	if reveal.Err != nil {
		t.Fatalf("targeted reveal failed: %v", reveal.Err)
	}
	snapshot := gameActor.Snapshot()
	if data := cardPatchData(&snapshot, "p3", "l1"); data["cardKey"] != nil {
		t.Fatalf("targeted reveal leaked to unauthorized viewer: %#v", data)
	}

	move := gameActor.ApplyDirect(context.Background(), command("game-1", 3, "move-viewed", "card.moved", map[string]any{
		"playerId":   "p1",
		"fromZone":   "library",
		"toZone":     "hand",
		"instanceId": "l1",
	}), "p1")
	if move.Err != nil {
		t.Fatalf("move failed: %v", move.Err)
	}
	for _, patch := range patchesForVisibility(move.Patches, protocol.VisibilityPublic) {
		for _, op := range patch.Ops {
			encoded := fmt.Sprintf("%#v", op.Data)
			for _, leaked := range []string{"library-2@1", "library-3@1", "cardKey"} {
				if contains(encoded, leaked) {
					t.Fatalf("public move patch leaked library data %s: %#v", leaked, op)
				}
			}
		}
	}
}

func testControlledPermanentState() state.GameState {
	game := testState()
	game.Players["p2"] = map[string]any{"life": 35, "counters": map[string]any{}, "commanderDamage": map[string]any{}}
	instance := game.Instances["i1"]
	instance.OwnerID = "p1"
	instance.ControllerID = "p2"
	instance.Zone = state.ZoneBattlefield
	game.Instances["i1"] = instance
	game.Zones["p1"] = state.PlayerZones{Library: game.Zones["p1"].Library, Hand: game.Zones["p1"].Hand}
	game.Zones["p2"] = state.PlayerZones{Battlefield: []string{"i1"}}
	game.Loc["i1"] = state.Location{PlayerID: "p2", Zone: state.ZoneBattlefield, Index: 0, ControllerID: "p2"}
	return game
}

func testZoneIDs(zones state.PlayerZones, zone state.Zone) []string {
	switch zone {
	case state.ZoneLibrary:
		return zones.Library
	case state.ZoneHand:
		return zones.Hand
	case state.ZoneBattlefield:
		return zones.Battlefield
	case state.ZoneGraveyard:
		return zones.Graveyard
	case state.ZoneExile:
		return zones.Exile
	case state.ZoneCommand:
		return zones.Command
	default:
		return nil
	}
}

func TestLegacyReplayOpsMoveKeepsBattlefieldCommandsRuntimeSafe(t *testing.T) {
	initial := testState()
	event := protocol.EventPayloadV2{
		GameID:  "game-1",
		Version: 1,
		Type:    "card.moved",
		Payload: map[string]any{
			"replay": map[string]any{
				"ops": []any{
					map[string]any{
						"op":         "zone.cards.move",
						"instanceId": "h1",
						"from":       map[string]any{"playerId": "p1", "zone": "hand"},
						"to":         map[string]any{"playerId": "p1", "zone": "battlefield", "index": 0},
						"card": map[string]any{
							"instanceId":   "h1",
							"ownerId":      "p1",
							"controllerId": "p1",
							"scryfallId":   "plains",
							"tapped":       false,
							"rotation":     0,
						},
					},
				},
			},
		},
	}

	if err := ReplayEventWithAppliers(&initial, event, DefaultAppliers()); err != nil {
		t.Fatalf("legacy replay op failed: %v", err)
	}
	if got, want := initial.Loc["h1"].Zone, state.ZoneBattlefield; got != want {
		t.Fatalf("location zone got %s want %s", got, want)
	}
	initial.Version = event.Version

	gameActor := NewGameActor("game-1", initial, nil, 8, DefaultAppliers())
	tap := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "tap", "card.tapped", map[string]any{"instanceId": "h1", "tapped": true}), "p1")
	if tap.Err != nil {
		t.Fatalf("tap after legacy replay op failed: %v", tap.Err)
	}
	if tap.Event.Payload["playerId"] != "p1" {
		t.Fatalf("tap event playerId got %#v want p1", tap.Event.Payload["playerId"])
	}
}

func BenchmarkLibraryDrawOne(b *testing.B) {
	for i := 0; i < b.N; i++ {
		game := benchmarkState(100)
		gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
		result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "draw", "library.draw", map[string]any{"playerId": "p1"}), "p1")
		if result.Err != nil {
			b.Fatal(result.Err)
		}
	}
}

func BenchmarkLibraryShuffle(b *testing.B) {
	for i := 0; i < b.N; i++ {
		game := benchmarkState(100)
		gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
		result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "shuffle", "library.shuffle", map[string]any{"playerId": "p1"}), "p1")
		if result.Err != nil {
			b.Fatal(result.Err)
		}
	}
}

func BenchmarkLibraryOps4Players100(b *testing.B) {
	for _, scenario := range []struct {
		name    string
		command string
		payload map[string]any
	}{
		{name: "draw_1", command: "library.draw", payload: map[string]any{"playerId": "p1"}},
		{name: "draw_7", command: "library.draw_many", payload: map[string]any{"playerId": "p1", "count": 7}},
		{name: "reveal_top_10", command: "library.reveal_top", payload: map[string]any{"playerId": "p1", "count": 10, "visibleToMask": 1}},
		{name: "reorder_top_10", command: "library.reorder_top", payload: map[string]any{"playerId": "p1", "instanceIds": []string{"l099", "l098", "l097", "l096", "l095", "l094", "l093", "l092", "l091", "l090"}}},
	} {
		b.Run(scenario.name, func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				game := benchmarkState4Players(100)
				gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
				result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, scenario.name, scenario.command, scenario.payload), "p1")
				if result.Err != nil {
					b.Fatal(result.Err)
				}
			}
		})
	}
}

func BenchmarkCardsMovedTen(b *testing.B) {
	for i := 0; i < b.N; i++ {
		game := benchmarkState(100)
		gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
		result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "move", "cards.moved", map[string]any{
			"playerId":    "p1",
			"fromZone":    "hand",
			"toZone":      "graveyard",
			"instanceIds": []string{"h000", "h001", "h002", "h003", "h004", "h005", "h006", "h007", "h008", "h009"},
		}), "p1")
		if result.Err != nil {
			b.Fatal(result.Err)
		}
	}
}

func BenchmarkMovementOps4Players100(b *testing.B) {
	for _, scenario := range []struct {
		name    string
		command string
		payload map[string]any
	}{
		{name: "move_1", command: "card.moved", payload: map[string]any{"playerId": "p1", "fromZone": "hand", "toZone": "graveyard", "instanceId": "h000"}},
		{name: "move_7", command: "cards.moved", payload: map[string]any{"playerId": "p1", "fromZone": "hand", "toZone": "battlefield", "instanceIds": []string{"h000", "h001", "h002", "h003", "h004", "h005", "h006"}}},
		{name: "move_all_battlefield_20", command: "zone.move_all", payload: map[string]any{"playerId": "p1", "fromZone": "battlefield", "toZone": "graveyard"}},
		{name: "reorder_20", command: "zone.reorderedByIds", payload: map[string]any{"playerId": "p1", "zone": "battlefield", "instanceIds": reverseIDs("bf", 20)}},
	} {
		b.Run(scenario.name, func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				game := benchmarkMovementState(100, 20)
				gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
				result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, scenario.name, scenario.command, scenario.payload), "p1")
				if result.Err != nil {
					b.Fatal(result.Err)
				}
			}
		})
	}
}

func BenchmarkBattlefieldAndCounters4Players100(b *testing.B) {
	for _, scenario := range []struct {
		name    string
		command string
		payload map[string]any
	}{
		{name: "tap_1", command: "card.tapped", payload: map[string]any{"instanceId": "bf00", "tapped": true}},
		{name: "counter_1", command: "card.counter.changed", payload: map[string]any{"instanceId": "bf00", "counter": "charge", "value": 2}},
		{name: "position_1", command: "card.position.changed", payload: map[string]any{"instanceId": "bf00", "position": map[string]any{"x": 0.4, "y": 0.2, "unit": "ratio"}}},
		{name: "position_batch_20", command: "cards.position.changed", payload: map[string]any{"playerId": "p1", "positions": benchmarkPositions(20)}},
		{name: "untap_all_20", command: "battlefield.untap_all", payload: map[string]any{"playerId": "p1"}},
		{name: "life", command: "life.changed", payload: map[string]any{"playerId": "p1", "delta": -1}},
		{name: "turn", command: "turn.changed", payload: map[string]any{"activePlayerId": "p2", "phase": "combat", "number": 3}},
	} {
		b.Run(scenario.name, func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				game := benchmarkMovementState(100, 20)
				gameActor := NewGameActor("game-1", game, nil, 8, DefaultAppliers())
				result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, scenario.name, scenario.command, scenario.payload), "p1")
				if result.Err != nil {
					b.Fatal(result.Err)
				}
			}
		})
	}
}

func benchmarkState(size int) state.GameState {
	game := testState()
	game.Instances = map[string]state.CardInstanceRuntime{"i1": game.Instances["i1"]}
	game.Zones["p1"] = state.PlayerZones{Battlefield: []string{"i1"}}
	game.Loc = map[string]state.Location{"i1": game.Loc["i1"]}
	for index := 0; index < size; index++ {
		libraryID := fmt.Sprintf("l%03d", index)
		handID := fmt.Sprintf("h%03d", index)
		game.Instances[libraryID] = state.CardInstanceRuntime{InstanceID: libraryID, CardKey: libraryID + "@1", OwnerID: "p1", ControllerID: "p1", Zone: state.ZoneLibrary}
		game.Instances[handID] = state.CardInstanceRuntime{InstanceID: handID, CardKey: handID + "@1", OwnerID: "p1", ControllerID: "p1", Zone: state.ZoneHand}
		zones := game.Zones["p1"]
		zones.Library = append(zones.Library, libraryID)
		zones.Hand = append(zones.Hand, handID)
		game.Zones["p1"] = zones
		game.Loc[libraryID] = state.Location{PlayerID: "p1", Zone: state.ZoneLibrary, Index: index, ControllerID: "p1"}
		game.Loc[handID] = state.Location{PlayerID: "p1", Zone: state.ZoneHand, Index: index, ControllerID: "p1"}
	}
	return game
}

func benchmarkState4Players(size int) state.GameState {
	game := state.GameState{
		GameID:    "game-1",
		Version:   1,
		Status:    "playing",
		Players:   map[string]map[string]any{},
		Turn:      map[string]any{"activePlayerId": "p1"},
		Instances: map[string]state.CardInstanceRuntime{},
		Zones:     map[string]state.PlayerZones{},
		Loc:       map[string]state.Location{},
		Visibility: state.VisibilityIndex{
			InstanceMasks:       map[string]uint64{},
			LibraryEpochByOwner: map[string]int64{},
			TopRevealWindows:    map[string]state.TopRevealWindow{},
		},
	}
	for player := 1; player <= 4; player++ {
		playerID := fmt.Sprintf("p%d", player)
		game.Players[playerID] = map[string]any{"life": 40}
		game.Zones[playerID] = state.PlayerZones{}
		for index := 0; index < size; index++ {
			instanceID := fmt.Sprintf("p%d-l%03d", player, index)
			if player == 1 {
				instanceID = fmt.Sprintf("l%03d", index)
			}
			game.Instances[instanceID] = state.CardInstanceRuntime{InstanceID: instanceID, CardKey: instanceID + "@1", OwnerID: playerID, ControllerID: playerID, Zone: state.ZoneLibrary}
			zones := game.Zones[playerID]
			zones.Library = append(zones.Library, instanceID)
			game.Zones[playerID] = zones
			game.Loc[instanceID] = state.Location{PlayerID: playerID, Zone: state.ZoneLibrary, Index: index, ControllerID: playerID}
		}
	}
	return game
}

func benchmarkMovementState(librarySize int, battlefieldSize int) state.GameState {
	game := benchmarkState4Players(librarySize)
	for player := 1; player <= 4; player++ {
		playerID := fmt.Sprintf("p%d", player)
		for index := 0; index < librarySize; index++ {
			handID := fmt.Sprintf("p%d-h%03d", player, index)
			if player == 1 {
				handID = fmt.Sprintf("h%03d", index)
			}
			game.Instances[handID] = state.CardInstanceRuntime{InstanceID: handID, CardKey: handID + "@1", OwnerID: playerID, ControllerID: playerID, Zone: state.ZoneHand}
			zones := game.Zones[playerID]
			zones.Hand = append(zones.Hand, handID)
			game.Zones[playerID] = zones
			game.Loc[handID] = state.Location{PlayerID: playerID, Zone: state.ZoneHand, Index: index, ControllerID: playerID}
		}
	}
	for index := 0; index < battlefieldSize; index++ {
		instanceID := fmt.Sprintf("bf%02d", index)
		game.Instances[instanceID] = state.CardInstanceRuntime{InstanceID: instanceID, CardKey: instanceID + "@1", OwnerID: "p1", ControllerID: "p1", Zone: state.ZoneBattlefield}
		zones := game.Zones["p1"]
		zones.Battlefield = append(zones.Battlefield, instanceID)
		game.Zones["p1"] = zones
		game.Loc[instanceID] = state.Location{PlayerID: "p1", Zone: state.ZoneBattlefield, Index: index, ControllerID: "p1"}
	}
	return game
}

func benchmarkRelationsState(librarySize int, battlefieldSize int) state.GameState {
	game := benchmarkMovementState(librarySize, battlefieldSize)
	game.Stack = []state.StackItem{{StackID: "stack-existing", SourceInstanceID: "bf00", ControllerID: "p1", CardKey: "bf00@1"}}
	game.Relations.Helpers = map[string]state.Relation{
		"helper-existing": {ID: "helper-existing", Meta: map[string]any{"template": "emblem", "scope": "player", "ownerPlayerId": "p1", "state": map[string]any{"value": 1}}},
	}
	return game
}

func testStateWithTwoBattlefieldCards() state.GameState {
	game := testState()
	game.Instances["i2"] = state.CardInstanceRuntime{
		InstanceID:   "i2",
		CardKey:      "card-b@1",
		OwnerID:      "p1",
		ControllerID: "p1",
		Zone:         state.ZoneBattlefield,
		Counters:     map[string]int{},
		Position:     map[string]any{"x": 0.2, "y": 0.2, "unit": "ratio"},
	}
	zones := game.Zones["p1"]
	zones.Battlefield = append(zones.Battlefield, "i2")
	game.Zones["p1"] = zones
	game.Loc["i2"] = state.Location{PlayerID: "p1", Zone: state.ZoneBattlefield, Index: 1, ControllerID: "p1"}
	return game
}

func stateIntegrityCounterState(t *testing.T) state.GameState {
	t.Helper()
	game := testStateWithTwoBattlefieldCards()
	game.Players["p1"]["life"] = 33
	game.Players["p2"]["life"] = 27
	game.Turn = map[string]any{"activePlayerId": "p2", "phase": "combat", "step": "declare_attackers", "number": 4}

	card := game.Instances["i1"]
	card.ControllerID = "p2"
	card.Tapped = true
	card.Rotation = 90
	card.FaceDown = true
	card.ActiveFace = 1
	card.Position = map[string]any{"x": 0.37, "y": 0.61, "unit": "ratio"}
	card.Counters = map[string]int{"shield": 1}
	card.MutableStats = map[string]any{"power": 5, "toughness": 7}
	game.Instances["i1"] = card
	location := game.Loc["i1"]
	location.ControllerID = "p2"
	game.Loc["i1"] = location

	ops := state.NewRelationsOps()
	if err := ops.AddArrow(&game, state.Relation{
		ID:       "arrow-1",
		SourceID: "i1",
		TargetID: "i2",
		Meta:     map[string]any{"ownerId": "p1", "color": "blue"},
	}); err != nil {
		t.Fatalf("arrow fixture failed: %v", err)
	}
	if err := ops.AddAttachment(&game, state.Relation{
		ID:       "attachment-1",
		SourceID: "i2",
		TargetID: "i1",
		Meta:     map[string]any{"ownerId": "p1"},
	}); err != nil {
		t.Fatalf("attachment fixture failed: %v", err)
	}

	return game
}

func assertStateIntegrityAroundCounter(t *testing.T, before state.GameState, after state.GameState, counterValue int) {
	t.Helper()
	beforeCard := before.Instances["i1"]
	afterCard := after.Instances["i1"]

	if afterCard.Counters["+1/+1"] != counterValue || afterCard.Counters["shield"] != beforeCard.Counters["shield"] {
		t.Fatalf("counter mismatch before=%#v after=%#v", beforeCard.Counters, afterCard.Counters)
	}
	if beforePower, ok := intFromAny(beforeCard.MutableStats["power"]); ok {
		if afterPower, ok := intFromAny(afterCard.MutableStats["power"]); !ok || afterPower != beforePower+counterValue {
			t.Fatalf("counter did not update power from %d by %d: %#v", beforePower, counterValue, afterCard.MutableStats)
		}
	}
	if beforeToughness, ok := intFromAny(beforeCard.MutableStats["toughness"]); ok {
		if afterToughness, ok := intFromAny(afterCard.MutableStats["toughness"]); !ok || afterToughness != beforeToughness+counterValue {
			t.Fatalf("counter did not update toughness from %d by %d: %#v", beforeToughness, counterValue, afterCard.MutableStats)
		}
	}
	beforeCard.Counters = nil
	afterCounters := afterCard.Counters
	afterCard.Counters = nil
	beforeCard.MutableStats = nil
	afterMutableStats := afterCard.MutableStats
	afterCard.MutableStats = nil
	if !reflect.DeepEqual(beforeCard, afterCard) {
		t.Fatalf("counter mutated unrelated card fields\nbefore=%#v\nafter=%#v", beforeCard, afterCard)
	}
	afterCard.Counters = afterCounters
	afterCard.MutableStats = afterMutableStats

	if !reflect.DeepEqual(before.Instances["i2"], after.Instances["i2"]) {
		t.Fatalf("counter mutated another card\nbefore=%#v\nafter=%#v", before.Instances["i2"], after.Instances["i2"])
	}
	if !reflect.DeepEqual(before.Players, after.Players) {
		t.Fatalf("counter mutated players/life\nbefore=%#v\nafter=%#v", before.Players, after.Players)
	}
	if !reflect.DeepEqual(before.Turn, after.Turn) {
		t.Fatalf("counter mutated turn\nbefore=%#v\nafter=%#v", before.Turn, after.Turn)
	}
	if !reflect.DeepEqual(before.Zones, after.Zones) {
		t.Fatalf("counter mutated zones\nbefore=%#v\nafter=%#v", before.Zones, after.Zones)
	}
	if !reflect.DeepEqual(before.Loc, after.Loc) {
		t.Fatalf("counter mutated loc\nbefore=%#v\nafter=%#v", before.Loc, after.Loc)
	}
	if !reflect.DeepEqual(before.Relations, after.Relations) {
		t.Fatalf("counter mutated relations\nbefore=%#v\nafter=%#v", before.Relations, after.Relations)
	}
}

func testStateWithCommanderInCommand() state.GameState {
	game := testState()
	game.Instances["commander-1"] = state.CardInstanceRuntime{
		InstanceID:   "commander-1",
		CardKey:      "commander-card@1",
		OwnerID:      "p1",
		ControllerID: "p1",
		Zone:         state.ZoneCommand,
		IsCommander:  true,
	}
	zones := game.Zones["p1"]
	zones.Command = []string{"commander-1"}
	game.Zones["p1"] = zones
	game.Loc["commander-1"] = state.Location{PlayerID: "p1", Zone: state.ZoneCommand, Index: 0, ControllerID: "p1"}
	game.SharedCounters["commander:commander-1"] = map[string]int{"casts": 0}
	return game
}

func reverseIDs(prefix string, count int) []string {
	ids := make([]string, 0, count)
	for index := count - 1; index >= 0; index-- {
		ids = append(ids, fmt.Sprintf("%s%02d", prefix, index))
	}
	return ids
}

func benchmarkPositions(count int) []map[string]any {
	out := make([]map[string]any, 0, count)
	for index := 0; index < count; index++ {
		out = append(out, map[string]any{
			"instanceId": fmt.Sprintf("bf%02d", index),
			"position":   map[string]any{"x": 0.5, "y": float64(index) / 100, "unit": "ratio"},
		})
	}
	return out
}

func runtimePosition(t *testing.T, game state.GameState, instanceID string) map[string]any {
	t.Helper()
	position := game.Instances[instanceID].Position
	if position == nil {
		t.Fatalf("missing position for %s", instanceID)
	}
	return position
}

func nonZeroRatioPosition(position map[string]any) bool {
	if position == nil || position["unit"] != "ratio" {
		return false
	}
	return toFloat(position["x"], 0) > 0 || toFloat(position["y"], 0) > 0
}

func requireRuntimeLogEntry(t *testing.T, result CommandResult) map[string]any {
	t.Helper()
	logPatch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "eventLog.append")
	if logPatch == nil {
		t.Fatalf("missing eventLog.append patch: %#v", result.Patches)
	}
	entries, ok := logPatch.Data["entries"].([]map[string]any)
	if !ok || len(entries) != 1 {
		t.Fatalf("bad log entries payload: %#v", logPatch.Data)
	}
	return entries[0]
}

func requireMap(t *testing.T, value any) map[string]any {
	t.Helper()
	typed, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("expected map[string]any, got %#v", value)
	}
	return typed
}

func requirePlayerRef(t *testing.T, entry map[string]any, playerID string) map[string]any {
	t.Helper()
	refs := requireMap(t, entry["refs"])
	players := requireMap(t, refs["players"])
	player := requireMap(t, players[playerID])
	if player["id"] != playerID || player["displayName"] == "" {
		t.Fatalf("bad player ref for %s: %#v", playerID, player)
	}
	return player
}

func requireCardRef(t *testing.T, entry map[string]any, instanceID string) map[string]any {
	t.Helper()
	refs := requireMap(t, entry["refs"])
	cards := requireMap(t, refs["cards"])
	card := requireMap(t, cards[instanceID])
	if card["instanceId"] != instanceID {
		t.Fatalf("bad card ref for %s: %#v", instanceID, card)
	}
	return card
}

func assertNoPrivateCardIdentity(t *testing.T, entry map[string]any) {
	t.Helper()
	encoded := fmt.Sprintf("%#v", entry)
	if contains(encoded, "cardKey") || contains(encoded, "library-") {
		t.Fatalf("log leaked private card identity: %s", encoded)
	}
}

func equalStrings(a []string, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for index := range a {
		if a[index] != b[index] {
			return false
		}
	}
	return true
}

func joinStrings(values []string) string {
	result := ""
	for index, value := range values {
		if index > 0 {
			result += ","
		}
		result += value
	}
	return result
}

func patchForVisibility(patches []protocol.PatchEnvelopeV2, visibility protocol.Visibility, op string) *protocol.PatchOp {
	for _, patch := range patches {
		if patch.Visibility != visibility {
			continue
		}
		for index := range patch.Ops {
			if patch.Ops[index].Op == op {
				return &patch.Ops[index]
			}
		}
	}
	return nil
}

func patchesForVisibility(patches []protocol.PatchEnvelopeV2, visibility protocol.Visibility) []protocol.PatchEnvelopeV2 {
	out := []protocol.PatchEnvelopeV2{}
	for _, patch := range patches {
		if patch.Visibility == visibility {
			out = append(out, patch)
		}
	}
	return out
}

func contains(value string, needle string) bool {
	for index := 0; index+len(needle) <= len(value); index++ {
		if value[index:index+len(needle)] == needle {
			return true
		}
	}
	return false
}
