# Gameplay Sprint 2 Correctness and Lifecycle

## Release contract

Sprint 2 closes one server-authoritative correctness contract across Runtime Go, persisted events, Go/PHP replay, compact snapshot/bootstrap, Patch.v2 and the normalized frontend store. The release invariant is `live = refresh = reconnect = bootstrap = actor restart`; normal gameplay must not use `game_patch`, `resync_required`, legacy fallback or snapshot refetch as recovery.

## Commander Damage, life and elimination

`commander.damage.changed` validates the target, source and real commander instance. A positive absolute-damage delta subtracts the same amount of life; a zero or negative delta never restores life. Damage, life, elimination, turn/designation/result effects and GameLog share one authoritative version. Commander Damage at 21 or more eliminates with reason `commander_damage`; final life at zero or less eliminates with reason `life`. Retries by `clientActionId` copy the original receipt without repeating effects.

Players use canonical statuses `active`, `defeated` and `conceded`, with elimination reasons `life`, `commander_damage`, `concede` and `expelled`. `turnOrder` is the persisted seat order and never relies on map or lexical ID ordering. Succession scans forward once and ignores eliminated players. Monarch and initiative cannot remain assigned to an eliminated player. One remaining active player produces the durable survivor result without auto-closing the game.

Concede and applied expel share the lifecycle transition. `game.close` remains explicit, persists final status and phase, cancels incompatible control-plane state and blocks later gameplay. Lifecycle/game guards reject mutating commands from defeated/conceded actors or against a closed game without changing version, events or patches.

## Presence, disconnect vote and rematch projection

Disconnect is presence, not elimination. A player is connected while at least one valid session remains. Public presence exposes only player identity, connected state, active connection count and public timestamps; socket IDs, tickets, tokens and internal connection epochs are removed from WebSocket messages, snapshots, bootstrap and Patch.v2. An internal persisted epoch may still serialize session transitions but is never projected.

Disconnect vote uses a durable global active vote, frozen eligible voters and strict majority `floor(eligible / 2) + 1`. The 60-second timeout resolves to wait, never expel; non-expel resolution persists a target-scoped 300-second cooldown. Target reconnect cancels the vote deterministically. A passed vote atomically closes as executed and applies lifecycle expel, with no observable intermediate state. The existing rematch vote projection round-trips independently through snapshot/bootstrap/replay; full rematch creation and matchmaking remain outside Sprint 2.

## Dynamic Power/Toughness

Printed Power/Toughness is immutable and stored per face. Manual overrides are explicit per face and per axis; absence is distinct from explicit zero. Signed and decimal numeric values are preserved, while formulas and symbols such as `*`, `X`, `?` and `∞` are never coerced to zero or `NaN`. Counters remain separate. Effective numeric values are derived only when the base is evaluable and are not authoritative persisted state.

Quick controls change only a numeric axis and require an explicit override for formulas/symbols. DFC faces preserve independent overrides. Tokens freeze creation provenance; copies freeze the available printed/default base without inheriting mutable manual overrides or counters. Private projections and GameLog never reveal private formulas, overrides, provenance or card identity.

## Events, replay and legacy policy

Modern events persist final effects and replay copies them instead of rerunning domain rules:

- Commander Damage uses `effectVersion = 2`.
- Life/lifecycle elimination uses `effectVersion = 3`.
- Disconnect presence/vote/control-plane uses `effectVersion = 4`.
- Explicit P/T override events use their independent stats effect contract version `1`.

Legacy events retain historical semantics. In particular, legacy Commander Damage does not acquire retroactive life loss or defeat; legacy lifecycle does not invent eliminations; legacy disconnect votes do not recalculate quorum/deadlines; ambiguous legacy P/T zero over a formula is normalized as no override unless explicit evidence exists.

## Patch.v2 and error contracts

Patch.v2 emits final typed operations in one version for life/damage, lifecycle, turn/order, designations, result, presence/vote/cooldown/rematch, stats overrides, counters and GameLog. Reducers apply same-version effects without relying on fragile operation ordering. Stable errors are structured by command and domain; a rejected command leaves version, event count, state and patch count invariant and leaves no optimistic residue.

## Release-critical gates

`game-product-sprint2-correctness-lifecycle-gate.spec.ts` executes real isolated BrowserContext games from two through six players and composes Commander Damage, life, lifecycle, turn order, concede/expel, multi-session presence, disconnect vote, P/T, counters, privacy, bootstrap/event-store parity, Runtime metrics and actor restart. It runs serially with the Sprint 2 focused gates, Sprint 1 privacy continuity, gameplay semantics/state integrity, identity/privacy, movement authorization, zone visibility and sensitive Runtime gates.

Release requires full Go test/race/vet, a fresh-database complete PHPUnit suite, complete frontend tests/build, OpenAPI parse, WebSocket contract checks, all 11 locale bundles, health/ready for API/WebSocket/Runtime, Runtime readiness from API/WebSocket, clean generated artifacts and `git diff --check`.

## Explicit debt outside Sprint 2

Responsive redesign, grouped tokens, Oracle-text helpers, area selection, animations, cosmetics, a Magic rules engine, complete copy/layer rules, full rematch creation/matchmaking and non-blocking performance work are not part of this contract.
