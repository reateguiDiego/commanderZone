# Gameplay Command Routing Inventory

Scope: normal gameplay command routing for the final runtime path.

Evidence sources:
- Frontend command type union: `frontend/src/app/core/models/game.model.ts`.
- Frontend WebSocket migrated command set and special mulligan messages: `frontend/src/app/features/game/game-table/services/game-table-websocket-gameplay.service.ts`.
- PHP legacy handler: `backend/src/Application/Game/GameCommandHandler.php`.
- PHP WebSocket allowlist: `backend/src/Application/Game/WebSocket/GameWebsocketMessageHandler.php`.
- PHP runtime alias catalog: `backend/src/Application/Game/Runtime/GameplayCommandCatalog.php`.
- Go runtime appliers/catalog: `game-runtime/internal/actor/appliers.go` and `game-runtime/internal/actor/command_catalog.go`.
- Contract tests: `game-runtime/internal/actor/command_catalog_test.go`, `game-runtime/internal/actor/runtime_ops_test.go`, `game-runtime/internal/gateway/command_http_test.go`, `game-runtime/internal/gateway/websocket_test.go`, `backend/tests/Application/GameplayRuntimeRouterTest.php`, `backend/tests/Application/GameWebSocket/GameWebsocketCommandPatchServiceTest.php`.

Legend:
- `YES`: directly present in that layer.
- `ADAPTER`: accepted through an explicit alias or protocol adapter.
- `NO`: not emitted or not handled in that layer.
- `N/A`: not privacy-sensitive.
- `NO VERIFICABLE`: no dedicated test was found or added in this scope.

## Execution Routes And Fallbacks

| Route | Entrypoint | Runtime final | Legacy handler | Snapshot load | DB lock | Automatic fallback | Enablement / flag | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Runtime WebSocket final hot path | Go `game-runtime` `/ws` `command.v2` | YES | NO | NO | NO | NO | Runtime ticket from Symfony, `GAME_RUNTIME_ENABLED`, `GAMEPLAY_V2_COMMANDS_ALLOWLIST`, frontend gameplay v2 | Normal migrated gameplay commands execute in the runtime actor and emit `patch.v2`. Reconnect replay uses `lastAppliedVersion`; resync is exceptional. Signed ticket `playerId` is the actor id; player-scoped and hidden-zone commands are rejected when they target another player. |
| Runtime HTTP internal command path | Go `game-runtime` `/commands` | YES | NO | NO | NO | NO | Internal Symfony client, `GAME_RUNTIME_ENABLED`; `GAME_RUNTIME_ALLOW_INITIAL_STATE_COMMANDS` only enables rejected legacy migration payloads for controlled tests/migration | Direct runtime command endpoint for Symfony/runtime tests and internal dispatch. It rejects `initialState` unless the explicit env flag is enabled. Actor-level checks reject mismatched `actorId` for player-scoped commands. |
| PHP WebSocket runtime-final path | `GameWebsocketCommandPatchService::runtimeFinalPathResult()` | YES | NO | NO | NO | NO | `GAME_RUNTIME_ENABLED`, `GAMEPLAY_V2_COMMANDS_ALLOWLIST`, V2 patch protocol, signed WS ticket with `command` permission | Used after runtime WS ticket auth. It requires ticket claims and never falls back to legacy, even if `GAMEPLAY_EMERGENCY_LEGACY_FALLBACK` is enabled. `game.close` additionally requires signed `game.close`; player-scoped payloads must match the signed `ticketPlayerId`. |
| PHP WebSocket legacy-compatible path | `GameWebsocketCommandPatchService::apply()` after Doctrine lookup | Optional primary/shadow | YES when legacy/shadow/fallback | YES | YES | Only when `GAMEPLAY_EMERGENCY_LEGACY_FALLBACK=true` and no version divergence | `GAME_RUNTIME_ENABLED`, `SHADOW_COMPARE_ENABLED`, `GAMEPLAY_V2_COMMANDS_ALLOWLIST`, `GAMEPLAY_EMERGENCY_LEGACY_FALLBACK` | Retained for legacy clients, shadow compare, chat stream commands, disconnect vote service path, and explicit emergency fallback. Fallback metrics include `gameplay.runtime_fallback_reason` (`runtime_gateway_error` or `runtime_patch_contract_error`). |
| Legacy HTTP command endpoint | `POST /games/{id}/commands` | NO | YES for legacy-only commands | YES | YES | NO | Always registered; runtime-primary commands are rejected when `GameplayRuntimeRouter` returns `RuntimePrimary` | This endpoint is no longer an automatic fallback for migrated runtime-primary commands. It records `http_runtime_primary_rejected` with `gameplay.legacy_route_reject_reason=runtime_primary_requires_websocket`. |
| Chat stream path | WebSocket/HTTP `chat.message`, `chat.reaction.toggled` | NO | NO normal game snapshot command when streams enabled | YES for access context | Transaction, no gameplay snapshot write | NO | `GAMEPLAY_STREAMS_ENABLED` | Explicitly outside the gameplay actor; stored in activity streams and projected as chat/log patches. |
| Disconnect vote path | WebSocket/HTTP `disconnect.vote` plus disconnect orchestrator | NO | Dedicated `GameDisconnectVoteService` | YES | YES | NO | Explicit non-runtime command | Destructive effect is constrained by open vote rules; it is not a runtime fallback. |
| Rematch vote path | `POST /games/{id}/rematch-vote` | NO | Dedicated `GameRematchService` | YES | YES | NO | Always registered | Control-plane flow after/near game end; may return room to waiting when rematch is ready. |
| Concede/close lifecycle runtime path | `game.concede`, `game.close` | YES when allowlisted | Legacy only outside runtime-primary or emergency PHP path | Runtime-final: NO; PHP compatible path: YES | Runtime-final: NO; PHP compatible path: YES | Runtime-final: NO; PHP compatible path: explicit emergency only | `GAME_RUNTIME_ENABLED`, `GAMEPLAY_V2_COMMANDS_ALLOWLIST` | `game.concede` requires the signed `command` permission and runtime actor validation for self-concede. `game.close` requires signed `game.close` permission in the final path and owner validation in legacy/PHP paths. |

Current fallback policy:
- Migrated commands routed through runtime-final WebSocket must fail closed on runtime/patch-contract errors; they cannot silently execute `GameCommandHandler`.
- Legacy HTTP `/games/{id}/commands` must reject runtime-primary command types instead of acting as a hidden frontend fallback.
- The only remaining automatic legacy fallback is the explicit PHP WebSocket emergency path behind `GAMEPLAY_EMERGENCY_LEGACY_FALLBACK=true`; it records `runtime_fallback`, `gameplay.runtime_fallback_count=1`, `command.legacy_fallback_count=1`, and `gameplay.runtime_fallback_reason`.

## Audit 4 Alignment And Permission Notes

Catalog alignment:
- PHP `GameplayCommandCatalog::finalRuntimeCommands()` and Go `actor.FinalGameplayCommandTypes()` both contain 52 canonical runtime-primary commands.
- Alias maps match in PHP and Go: `zone.changed -> zone.reorderedByIds`, `mulligan.scry_confirm -> mulligan.scry.confirm`.
- Frontend `GameCommandType` and WebSocket migrated command sets are covered by Go runtime appliers or the explicit non-runtime list (`chat.message`, `chat.reaction.toggled`, `disconnect.vote`).
- Runtime-only commands remain intentionally absent from the public frontend union where they are produced by runtime services or protocol adapters: `library.put_top`, `library.put_bottom`, `mulligan.cards_bottomed`, `mulligan.ready`, `mulligan.completed`, `game.phase.set`.
- Go runtime WS rejects direct client use of internal-only lifecycle commands `game.phase.set` and `mulligan.completed`; they remain available to internal runtime/replay paths.

Runtime-primary permission policy:
- `game.close`: requires signed `game.close` permission in PHP final path and Go runtime WS. Legacy/PHP compatible paths still validate room ownership.
- `game.concede`: requires signed `command` permission and self-concede only (`payload.playerId` must match the signed player/actor).
- Player-scoped commands: PHP final runtime payload validation and Go actor validation reject mismatched `playerId`, `targetPlayerId` for commander damage, player counter scopes, helper owner scopes, and runtime relation owner scopes.
- Hidden-zone commands: Go actor validation rejects attempts to operate on another player's hand/library as the source player. `library.shuffle` keeps the explicit `reason=revealed-library-closed` exception so a revealed library can be closed without becoming a hidden-zone control path.
- Public battlefield/table commands remain manual-table operations. The runtime validates the actor-owned subject when the command payload or source instance identifies one, but it does not implement Magic legal-play validation.

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
