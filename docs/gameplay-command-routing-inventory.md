# Gameplay Command Routing Inventory

Scope: normal gameplay command routing for the final runtime path.

Evidence sources:
- Frontend command type union: `frontend/src/app/core/models/game.model.ts`.
- Frontend WebSocket migrated command set and special mulligan messages: `frontend/src/app/features/game/game-table/services/game-table-websocket-gameplay.service.ts`.
- PHP legacy handler: `backend/src/Application/Game/GameCommandHandler.php`.
- PHP WebSocket allowlist: `backend/src/Application/Game/WebSocket/GameWebsocketMessageHandler.php`.
- PHP runtime alias catalog: `backend/src/Application/Game/Runtime/GameplayCommandCatalog.php`.
- Go runtime appliers/catalog: `game-runtime/internal/actor/appliers.go` and `game-runtime/internal/actor/command_catalog.go`.
- Contract tests: `game-runtime/internal/actor/command_catalog_test.go`, `game-runtime/internal/gateway/command_http_test.go`, `game-runtime/internal/gateway/websocket_test.go`, `backend/tests/Application/GameplayRuntimeRouterTest.php`.

Legend:
- `YES`: directly present in that layer.
- `ADAPTER`: accepted through an explicit alias or protocol adapter.
- `NO`: not emitted or not handled in that layer.
- `N/A`: not privacy-sensitive.
- `NO VERIFICABLE`: no dedicated test was found or added in this scope.

| Command type | Alias | Frontend emits | PHP accepts | Go accepts | Patch V2 exists | Tests | Privacy tests | Replay tests | Status |
|---|---:|---:|---:|---:|---:|---|---|---|---|
| life.changed | - | YES | YES | YES | YES | catalog, gateway | N/A | applier replay path | OK |
| turn.changed | - | YES | YES | YES | YES | catalog, gateway | N/A | applier replay path | OK |
| dice.rolled | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| card.tapped | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| card.face_down.changed | - | YES | YES | YES | YES | catalog, existing sensitive tests | YES | applier replay path | OK |
| card.revealed | - | YES | YES | YES | YES | catalog, existing sensitive tests | YES | applier replay path | OK |
| card.controller.changed | - | YES | YES | YES | YES | catalog, existing sensitive tests | YES | applier replay path | OK |
| cards.position.changed | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| card.counter.changed | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| counter.changed | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| commander.damage.changed | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| card.power_toughness.changed | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| card.position.changed | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| library.draw | - | YES | YES | YES | YES | catalog, existing library tests | YES | existing replay tests | OK |
| library.draw_many | - | YES | YES | YES | YES | catalog, existing library tests | YES | existing replay tests | OK |
| library.reveal_top | - | YES | YES | YES | YES | catalog, existing library tests | YES | existing replay tests | OK |
| library.reveal | - | YES | YES | YES | YES | catalog, existing sensitive tests | YES | applier replay path | OK |
| library.play_top_revealed | - | YES | YES | YES | YES | catalog, existing sensitive tests | YES | applier replay path | OK |
| library.reorder_top | - | YES | YES | YES | YES | catalog, existing library tests | YES | existing replay tests | OK |
| library.move_top | - | YES | YES | YES | YES | catalog, existing library tests | YES | existing replay tests | OK |
| library.put_top | - | NO | PHP WS allowlist only | YES | YES | catalog, existing runtime ops tests | YES | existing replay path | OK runtime-only |
| library.put_bottom | - | NO | PHP WS allowlist only | YES | YES | catalog, existing runtime ops tests | YES | existing replay path | OK runtime-only |
| library.view | - | YES | YES | YES | YES | catalog, existing library tests | YES | existing replay tests | OK |
| library.shuffle | - | YES | YES | YES | YES | catalog, existing library tests | YES | existing replay tests | OK |
| card.token.created | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| card.token_copy.created | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| zone.random_card.selected | - | YES | YES | YES | YES | catalog | YES | applier replay path | OK |
| card.dungeon_marker.changed | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| card.face.changed | - | YES | YES | YES | YES | catalog, existing sensitive tests | YES | applier replay path | OK |
| card.moved | - | YES | YES | YES | YES | catalog | mixed visibility | applier replay path | OK |
| cards.moved | - | YES | YES | YES | YES | catalog | mixed visibility | applier replay path | OK |
| zone.reorderedByIds | zone.changed | ADAPTER | ADAPTER | YES | YES | catalog, PHP router, Go WS alias | YES | applier replay path | OK with explicit alias |
| zone.move_all | - | YES | YES | YES | YES | catalog | mixed visibility | applier replay path | OK |
| battlefield.untap_all | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| stack.card_added | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| stack.item_removed | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| arrow.created | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| arrow.removed | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| attachment.created | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| attachment.removed | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| helper.created | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| helper.updated | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| helper.removed | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| game.concede | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| game.close | - | YES | YES | YES | YES | catalog | N/A | applier replay path | OK |
| mulligan.take | - | YES special message | YES | YES | YES | catalog, existing mulligan tests | YES | existing mulligan replay tests | OK |
| mulligan.keep | - | YES special message | YES | YES | YES | catalog, existing mulligan tests | YES | existing mulligan replay tests | OK |
| mulligan.cards_bottomed | - | NO | NO legacy normal command | YES | YES | catalog, existing mulligan tests | YES | existing mulligan replay tests | OK runtime-only |
| mulligan.scry.confirm | mulligan.scry_confirm | YES special message | ADAPTER | YES | YES | catalog, PHP router, existing mulligan tests | YES | existing mulligan replay tests | OK with explicit alias |
| mulligan.ready | - | NO | NO legacy normal command | YES | YES | catalog | YES | NO VERIFICABLE | OK runtime-only |
| mulligan.completed | - | NO | NO legacy normal command | YES | YES | catalog, existing mulligan tests | YES | existing mulligan replay tests | OK runtime-only |
| game.phase.set | - | NO | NO legacy normal command | YES | YES | catalog, existing normalized store tests | N/A | existing mulligan replay tests | OK runtime-only |
| chat.message | - | YES | YES stream path | Explicitly disabled | NO actor patch | frontend catalog test | N/A | N/A | Explicitly disabled |
| chat.reaction.toggled | - | YES | YES stream path | Explicitly disabled | NO actor patch | frontend catalog test | N/A | N/A | Explicitly disabled |
| disconnect.vote | - | YES | YES service path | Explicitly disabled | NO actor patch | frontend catalog test | N/A | runtime replay ignored | Explicitly disabled |
