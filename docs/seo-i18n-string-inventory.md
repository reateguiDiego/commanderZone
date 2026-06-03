# CommanderZone SEO/i18n string inventory

Scope: Phase 5 of `docs/commanderzone-seo-i18n-plan.md`.

This inventory classifies production user-visible strings before migration. It does not change code, routes, translations, SEO metadata, sitemap, or runtime behavior.

## Classification rules

| Classification | Target translation system | Applies to |
| --- | --- | --- |
| `seo-static` | Static localized SEO content files | Future public SEO landings only. None exist in the current app code. |
| `runtime-i18n` | `ngx-translate` JSON | Existing internal/non-indexable app UI. |
| `out-of-scope` | None | Debug/demo pages and non-production-visible UI. |
| `do-not-translate` | None | Technical constants, routes, API payloads, enum values, class names, selectors, import paths, asset paths, logs, test names, IDs. |

## SEO-static inventory

No current production component contains approved SEO landing content. The 10 SEO pages from Phase 1 are future public landings and must receive static localized content in later phases, not `ngx-translate`.

| String | Current file | Component/page | Classification | Target translation system | Suggested key | Suggested content file |
| --- | --- | --- | --- | --- | --- | --- |
| Future home landing copy | Not created yet | `home` | `seo-static` | Static SEO content | N/A | `seo-landings/content/{locale}/home` |
| Future play Commander online landing copy | Not created yet | `playCommanderOnline` | `seo-static` | Static SEO content | N/A | `seo-landings/content/{locale}/play-commander-online` |
| Future play Magic online with friends landing copy | Not created yet | `playMagicOnlineWithFriends` | `seo-static` | Static SEO content | N/A | `seo-landings/content/{locale}/play-magic-online-with-friends` |
| Future create Commander room landing copy | Not created yet | `createCommanderRoom` | `seo-static` | Static SEO content | N/A | `seo-landings/content/{locale}/create-commander-room` |
| Future import Commander deck landing copy | Not created yet | `importCommanderDeck` | `seo-static` | Static SEO content | N/A | `seo-landings/content/{locale}/import-commander-deck` |
| Future Commander deck builder landing copy | Not created yet | `commanderDeckBuilder` | `seo-static` | Static SEO content | N/A | `seo-landings/content/{locale}/commander-deck-builder` |
| Future Asistente de mesa landing copy | Not created yet | `tableAssistant` | `seo-static` | Static SEO content | N/A | `seo-landings/content/{locale}/table-assistant` |
| Future ways to play Commander landing copy | Not created yet | `waysToPlayCommanderOnline` | `seo-static` | Static SEO content | N/A | `seo-landings/content/{locale}/ways-to-play-commander-online` |
| Future how to play Commander landing copy | Not created yet | `howToPlayCommanderOnline` | `seo-static` | Static SEO content | N/A | `seo-landings/content/{locale}/how-to-play-commander-online` |
| Future FAQ/help landing copy | Not created yet | `faq` | `seo-static` | Static SEO content | N/A | `seo-landings/content/{locale}/faq` |

## Runtime-i18n inventory

Suggested keys are domain prefixes. During Phase 6 each string should receive a stable, explicit key under the same namespace instead of using generated wording blindly.

| String / string group | Current file | Component/page | Classification | Target translation system | Suggested key | Suggested content file |
| --- | --- | --- | --- | --- | --- | --- |
| `Loading` | `frontend/src/app/app/app.html` | App shell | `runtime-i18n` | `ngx-translate` JSON | `common.loading` | N/A |
| App shell labels: `Menu`, `Header menu`, `User menu`, `Settings`, `Fullscreen`, `Language`, `Language options`, `Log off`, `Flag of`, `Cancel`, `Save`, `Back to settings`, `Predefined avatars`, `Upload image`, `General`, `Game`, `Card language`, `App language` | `frontend/src/app/core/localization/app-shell-i18n.service.ts` | App shell i18n | `runtime-i18n` | `ngx-translate` JSON | `navigation.*`, `settings.*`, `common.*` | N/A |
| Runtime language names: `English`, `Spanish`, `French`, `German`, `Italian`, `Portuguese`, `Japanese`, `Korean`, `Chinese (Simplified)`, `Chinese (Traditional)`, `Dutch`, `Catalan`, `Russian` and current Spanish labels | `frontend/src/app/core/localization/app-shell-i18n.service.ts`, `frontend/src/app/core/localization/language-preferences.ts`, `frontend/src/app/core/localization/locale-config.ts` | Language selectors/settings | `runtime-i18n` | `ngx-translate` JSON | `settings.language.*` | N/A |
| Auth form labels/status: `Login`, `Register`, `Email`, `Password`, `Confirmar password`, `User name`, availability messages, validation messages, forgotten password link | `frontend/src/app/features/auth/auth-page/auth-page.component.html`, `frontend/src/app/features/auth/auth-password-policy.ts`, `frontend/src/app/core/auth/auth.store.ts` | Auth pages | `runtime-i18n` | `ngx-translate` JSON | `auth.login.*`, `auth.register.*`, `auth.validation.*` | N/A |
| Password reset labels/messages: `Recuperar contrasena`, `Email`, `Nueva contrasena`, `Confirmar contrasena`, `Volver al login`, success/info text | `frontend/src/app/features/auth/password-reset-page/password-reset-page.component.html` | Password reset | `runtime-i18n` | `ngx-translate` JSON | `auth.passwordReset.*` | N/A |
| Email verification labels/messages: `Verificar email`, `Token de verificacion`, `Reenviar verificacion (email)`, `Volver al login`, success/info text | `frontend/src/app/features/auth/email-verification-page/email-verification-page.component.html` | Email verification | `runtime-i18n` | `ngx-translate` JSON | `auth.emailVerification.*` | N/A |
| Dashboard welcome copy: `Tu comandante ha llegado`, `Qué bueno verte de nuevo`, dashboard intro copy, `Planeswalker` fallback | `frontend/src/app/features/dashboard/dashboard-home/dashboard-home.component.html`, `frontend/src/app/features/dashboard/dashboard-home/dashboard-home.component.ts` | Dashboard home | `runtime-i18n` | `ngx-translate` JSON | `navigation.dashboard.*` | N/A |
| Dashboard shell/navigation labels: `CommanderZone dashboard`, `Primary`, `Decks`, `Rooms`, `Asistente de Mesa`, `Page summary`, `Player` | `frontend/src/app/features/dashboard/dashboard-shell/**/*.html`, `frontend/src/app/features/dashboard/dashboard-shell/**/*.ts` | Dashboard shell/header | `runtime-i18n` | `ngx-translate` JSON | `navigation.*` | N/A |
| Header/friends controls: `Friends`, `Online friends`, `Pending friend requests` | `frontend/src/app/features/dashboard/dashboard-shell/components/dashboard-header-controls/dashboard-header-controls.component.html` | Header controls | `runtime-i18n` | `ngx-translate` JSON | `navigation.friends.*` | N/A |
| Settings modal labels/status: `Avatar`, `Name`, `Email`, `User name`, `Cancel`, availability/validation messages, delete account copy | `frontend/src/app/features/dashboard/dashboard-shell/components/dashboard-header-controls/components/dashboard-settings-modal/dashboard-settings-modal.component.html` | Settings modal | `runtime-i18n` | `ngx-translate` JSON | `settings.profile.*`, `settings.account.*` | N/A |
| Avatar editor/upload labels: `Initial avatar customization`, `Letters`, `Main color`, `Secondary color`, upload/editor controls | `frontend/src/app/features/dashboard/settings/**/*.html`, `frontend/src/app/features/dashboard/settings/**/*.ts` | Settings avatar components | `runtime-i18n` | `ngx-translate` JSON | `settings.avatar.*` | N/A |
| Preset avatar display names: `Abyssal Overlord`, `Arcane Duelist`, `Black-Clad Mage`, `Chaos Court Mage`, `Crimson Patriarch`, `Dragonblood Shaman`, `Elder Dragon Tyrant`, `Friendly Robot`, `Radiant Paladin`, etc. | `frontend/src/app/features/dashboard/settings/settings-avatar-editor/preset-avatars.ts` | Avatar presets | `runtime-i18n` | `ngx-translate` JSON | `settings.avatar.presets.*` | N/A |
| Card search/detail UI: `Cards`, `Search`, `Search library`, `Searching cards...`, `No cards found.`, `Back to search`, `Color identity:`, `Commander:`, `Loading card...` | `frontend/src/app/features/cards/**/*.html`, `frontend/src/app/shared/components/card-autocomplete/*` | Cards feature | `runtime-i18n` | `ngx-translate` JSON | `deckBuilder.cards.*` | N/A |
| Deck list UI: deck actions, folder actions, import/export labels, empty states, visibility labels, loading/saving/deleting messages | `frontend/src/app/features/decks/deck-list/**/*` | Deck list | `runtime-i18n` | `ngx-translate` JSON | `deckBuilder.list.*` | N/A |
| Deck editor UI: commander selection, card sections, missing cards, analysis, mana curve/balance, import/export, validation messages, save states | `frontend/src/app/features/decks/deck-editor/**/*` | Deck editor | `runtime-i18n` | `ngx-translate` JSON | `deckBuilder.editor.*`, `deckBuilder.analysis.*` | N/A |
| Deck import/export service messages and validation errors | `frontend/src/app/features/decks/services/**/*.ts`, `frontend/src/app/features/decks/data-access/**/*.ts` | Deck data access/services | `runtime-i18n` | `ngx-translate` JSON | `deckBuilder.errors.*`, `deckBuilder.toasts.*` | N/A |
| Rooms browser/create UI: room list labels, `Public`, `Private`, create/join/leave actions, invite controls, current room banner, empty/loading states | `frontend/src/app/features/rooms/rooms/**/*.html`, `frontend/src/app/features/rooms/shared/**/*.html` | Rooms | `runtime-i18n` | `ngx-translate` JSON | `rooms.browser.*`, `rooms.create.*`, `rooms.invites.*` | N/A |
| Waiting room UI/log/deck selector: `Waiting room`, ready state, turn roll/tie-break copy, player cards, deck selector states, room share link | `frontend/src/app/features/rooms/waiting-room/**/*.html`, `frontend/src/app/features/rooms/waiting-room/**/*.ts` | Waiting room | `runtime-i18n` | `ngx-translate` JSON | `rooms.waiting.*` | N/A |
| Game table header/menu labels: player/menu/fullscreen/language/roll/settings/log off controls | `frontend/src/app/features/game/game-table/components/game-table-header/**/*` | Game table header | `runtime-i18n` | `ngx-translate` JSON | `game.header.*` | N/A |
| Game table zones/card actions: `Hand`, `Library`, `Graveyard`, `Battlefield`, `Exile`, move/draw/reveal/search/shuffle/tap/untap/attach/detach/counter commands | `frontend/src/app/features/game/game-table/**/*.html`, `frontend/src/app/features/game/game-table/**/*.ts` | Game table | `runtime-i18n` | `ngx-translate` JSON | `game.table.*`, `game.actions.*`, `game.zones.*` | N/A |
| Game table dialogs/modals: context menu, quantity stepper, mana action dialog, power/toughness dialog, arrow target dialog, token search modal, rematch modal, disconnect vote modal | `frontend/src/app/features/game/game-table/components/**/*dialog*`, `frontend/src/app/features/game/game-table/components/**/*modal*`, `frontend/src/app/features/game/game-table/components/context-menu/**/*` | Game dialogs | `runtime-i18n` | `ngx-translate` JSON | `game.modals.*`, `game.contextMenu.*` | N/A |
| Game chat/log/toast/errors: chat recipient labels, game log labels, error/toast strings from store/services | `frontend/src/app/features/game/game-table/state/**/*`, `frontend/src/app/features/game/game-table/services/**/*`, `frontend/src/app/features/game/game-table/components/*log*` | Game state/services | `runtime-i18n` | `ngx-translate` JSON | `game.toasts.*`, `game.errors.*`, `game.log.*`, `game.chat.*` | N/A |
| Game turn/phase controls: `Untap`, `Upkeep`, `Draw`, `Main 1`, `Combat`, `Main 2`, `End`, player order labels | `frontend/src/app/features/game/game-table/components/turn-phase-panel/**/*` | Turn phase panel | `runtime-i18n` | `ngx-translate` JSON | `game.turns.*` | N/A |
| Mana/accessibility labels: `White mana`, `Blue mana`, `Black mana`, `Red mana`, `Green mana`, generic mana labels, `Tap`, `Untap`, `Energy counter`, land type labels | `frontend/src/app/shared/mana/mana-symbol.service.ts` | Mana symbols | `runtime-i18n` | `ngx-translate` JSON | `common.mana.*` | N/A |
| Shared UI labels: `Back`, `Cancel`, `OK`, `Close modal`, `Extra actions`, `Open extra actions`, `Player`, `Search cards`, `Select`, visibility copy | `frontend/src/app/shared/**/*.html`, `frontend/src/app/shared/**/*.ts`, `frontend/src/app/core/ui/roll-modal/*` | Shared UI | `runtime-i18n` | `ngx-translate` JSON | `common.*`, `forms.*`, `modals.*` | N/A |
| Roll modal labels: `Tipo de tirada`, `Tirar dado`, `Cerrar tirada`, `Moneda`, `Cara`, `Cruz`, `Dado de 4/6/10/20 caras` | `frontend/src/app/core/ui/roll-modal/**/*` | Roll modal | `runtime-i18n` | `ngx-translate` JSON | `modals.roll.*` | N/A |
| Footer legal/disclaimer visible copy and brand/legal names | `frontend/src/app/shared/components/footer-disclaimer/footer-disclaimer.component.html` | Footer disclaimer | `runtime-i18n` | `ngx-translate` JSON | `common.footerDisclaimer.*` | N/A |
| Table assistant landing-like internal page copy: `Asistente de Mesa`, `Mesa manual de Commander`, `Setup rapido`, `Beneficios`, `Todo lo necesario para seguir una partida física`, `40 vidas iniciales`, `Daño de comandante activo` | `frontend/src/app/features/table-assistant/table-assistant-page/**/*` | Internal table assistant app page | `runtime-i18n` | `ngx-translate` JSON | `tableAssistant.page.*` | N/A |
| Table assistant setup/table menu: `Configura la mesa`, `Nueva partida`, `Reglas de mesa`, `Opciones de partida`, `Pantalla completa`, `Salir al dashboard`, `Seguir jugando`, `Tirar dado` | `frontend/src/app/features/table-assistant/table-assistant-setup/**/*`, `frontend/src/app/features/table-assistant/table-assistant-table-menu/**/*` | Table assistant setup/menu | `runtime-i18n` | `ngx-translate` JSON | `tableAssistant.setup.*`, `tableAssistant.menu.*` | N/A |
| Table assistant room UI: `Cargando sala...`, `Codigo de sala`, `Copiar enlace de sala`, `Jugadores`, `Trackers de jugador`, `Trackers globales`, `Daño de comandante`, `Letal`, rotate-device copy | `frontend/src/app/features/table-assistant/table-assistant-room/**/*` | Table assistant room | `runtime-i18n` | `ngx-translate` JSON | `tableAssistant.room.*` | N/A |
| Table assistant timer/turn/replay labels: `Temporizador`, `Sin timer`, `Por turno`, `Por fase`, `Duracion por turno`, `Iniciar`, `Pausar`, `Reanudar`, `Siguiente`, `Turno activo`, replay configuration labels | `frontend/src/app/features/table-assistant/table-assistant-timer-settings/**/*`, `frontend/src/app/features/table-assistant/table-assistant-turn-controls/**/*`, `frontend/src/app/features/table-assistant/table-assistant-replay-modal/**/*` | Table assistant controls | `runtime-i18n` | `ngx-translate` JSON | `tableAssistant.timer.*`, `tableAssistant.turns.*`, `tableAssistant.replay.*` | N/A |
| Table assistant counters/phases/color labels: `Commander damage`, `Commander tax`, `Poison`, `Energy`, `Experience`, `Storm`, `Monarch`, `Initiative`, phase labels, color/guild/shard names | `frontend/src/app/features/table-assistant/domain/table-assistant-state.ts`, `frontend/src/app/features/table-assistant/domain/table-assistant-colors.ts` | Table assistant domain labels | `runtime-i18n` | `ngx-translate` JSON | `tableAssistant.trackers.*`, `tableAssistant.colors.*`, `tableAssistant.phases.*` | N/A |
| Onboarding public-but-not-SEO copy: current guest onboarding headings, descriptions, CTAs, feature labels, demo room entry copy | `frontend/src/app/features/onboarding/onboarding-page/**/*` | Current onboarding route | `runtime-i18n` | `ngx-translate` JSON | `navigation.onboarding.*` | N/A |

## Out-of-scope inventory

| String / string group | Current file | Component/page | Classification | Target translation system | Suggested key | Suggested content file |
| --- | --- | --- | --- | --- | --- | --- |
| Demo room UI/copy | `frontend/src/app/features/onboarding/demo-room-page/**/*` | Demo room route `/room/:id` | `out-of-scope` | None | N/A | N/A |
| Game debug page labels/metrics/status strings | `frontend/src/app/features/game/game-debug/**/*` | Game debug route `/games/:id/debug` | `out-of-scope` | None | N/A | N/A |

## Do-not-translate inventory

| String / string group | Current file | Component/page | Classification | Target translation system | Suggested key | Suggested content file |
| --- | --- | --- | --- | --- | --- | --- |
| Angular imports, local import paths, `templateUrl`, `styleUrl`, selectors, CSS class names | `frontend/src/app/**/*.ts` | Technical Angular metadata | `do-not-translate` | None | N/A | N/A |
| Route paths and route metadata: `auth/login`, `auth/register`, `games/:id`, `rooms/:id/waiting`, redirects, route component imports | `frontend/src/app/app.routes.ts` | Router config | `do-not-translate` | None | N/A | N/A |
| API URLs, HTTP method names, query param keys, request/response field names | `frontend/src/app/core/api/**/*.ts` | API clients | `do-not-translate` | None | N/A | N/A |
| Domain model enum values and protocol/event operation names: zones, command types, realtime patch ops, payload keys | `frontend/src/app/core/models/**/*.ts`, `frontend/src/app/features/game/game-table/models/**/*.ts` | Models/contracts | `do-not-translate` | None | N/A | N/A |
| CSS values, color constants, animation class names, DOM selectors and role selectors used for behavior | `frontend/src/app/**/*.ts`, `frontend/src/app/**/*.scss` | Styling/behavior | `do-not-translate` | None | N/A | N/A |
| Magic card names, type lines, oracle text, image URLs and user/deck/room names returned by API | Runtime data | API/user content | `do-not-translate` | None | N/A | N/A |
| Test names, mocks, fixtures, assertions | `frontend/src/**/*.spec.ts`, `frontend/e2e/**/*` | Tests | `do-not-translate` | None | N/A | N/A |

## Extraction notes

- Production scan covered `frontend/src/app/**/*.html` and `frontend/src/app/**/*.ts`, excluding `*.spec.ts`.
- Candidate scan found 1,330 visible or potentially visible entries grouped across 198 production files/components before manual grouping.
- No SEO landing components exist yet, so all current production-visible UI strings are classified as `runtime-i18n` unless explicitly listed as `out-of-scope` or `do-not-translate`.
- Some strings in the current app are generated dynamically from card/user/deck/room data. Those are not translation source strings and must not be moved into JSON.
- The internal `table-assistant` UI remains `runtime-i18n`; it is not the future SEO landing for `tableAssistant`.
