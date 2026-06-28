package actor

import (
	"context"
	"fmt"
	"testing"

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
	if secondConcede.Err == nil {
		t.Fatal("second concede with a new action id should not create a lifecycle transition")
	}
	if gameActor.Snapshot().Version != 2 {
		t.Fatalf("rejected second concede changed version: %d", gameActor.Snapshot().Version)
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

func TestGameCloseEmitsGameStatusPatchWithoutSnapshotWrite(t *testing.T) {
	gameActor := NewGameActor("game-1", testState(), nil, 8, DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), command("game-1", 1, "close-1", "game.close", map[string]any{}), "p1")
	if result.Err != nil {
		t.Fatalf("close failed: %v", result.Err)
	}
	metrics := result.Event.Payload["metrics"].(map[string]any)
	if metrics["lifecycle.snapshot_write_count"] != 0 {
		t.Fatalf("unexpected snapshot write metrics: %#v", metrics)
	}
	snapshot := gameActor.Snapshot()
	if snapshot.Status != "finished" || snapshot.Phase != state.PhaseFinished {
		t.Fatalf("game status not closed: status=%s phase=%s", snapshot.Status, snapshot.Phase)
	}
	patch := patchForVisibility(result.Patches, protocol.VisibilityPublic, "game.status.set")
	if patch == nil {
		t.Fatalf("missing game.status.set patch: %#v", result.Patches)
	}
	if patch.Data["status"] != "finished" || patch.Data["phase"] != state.PhaseFinished {
		t.Fatalf("bad close patch: %#v", patch)
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
	if len(result.Patches) != 1 || result.Patches[0].Visibility != "player:p1" || result.Patches[0].Ops[0].Op != "library.top.viewed" {
		t.Fatalf("view patch should be private: %#v", result.Patches)
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
	if contains(encoded, "imageUris") || contains(encoded, "oracleText") || contains(encoded, "cardFaces") {
		t.Fatalf("static payload leaked in token patch: %s", encoded)
	}
	cards := patch.Data["cards"].([]map[string]any)
	if len(cards) != 2 || cards[0]["isToken"] != true || cards[0]["name"] != "Goblin" {
		t.Fatalf("bad compact token cards: %#v", cards)
	}
	if cards[0]["cardKey"] != "token-scryfall:token" {
		t.Fatalf("token patch did not carry stable compact identity: %#v", cards[0])
	}
	eventTokens := result.Event.Payload["tokens"].([]map[string]any)
	if len(eventTokens) != 2 || eventTokens[0]["instanceId"] != cards[0]["instanceId"] || eventTokens[0]["cardKey"] != "token-scryfall:token" || eventTokens[0]["name"] != "Goblin" {
		t.Fatalf("token event did not carry replayable compact identity: %#v", result.Event.Payload)
	}
	metrics := result.Event.Payload["metrics"].(map[string]any)
	if metrics["edge.runtime_route"] != 1 || metrics["edge.patch_bytes"].(int) <= 0 {
		t.Fatalf("missing edge metrics: %#v", metrics)
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

func TestReplayIgnoresDisconnectVoteLifecycleEvents(t *testing.T) {
	game := testState()
	event := protocol.EventPayloadV2{
		GameID:  "game-1",
		Version: 2,
		Type:    "disconnect.vote.updated",
		Payload: map[string]any{"targetPlayerId": "p2", "vote": "kick"},
	}

	if err := ReplayEventWithAppliers(&game, event, DefaultAppliers()); err != nil {
		t.Fatalf("disconnect vote replay should be ignored by gameplay actor: %v", err)
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
