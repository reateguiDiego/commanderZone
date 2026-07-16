# Gameplay Sprint 3 — Spatial, Relations and Responsive

## Scope

Sprint 3 closes the release-critical interaction between canonical battlefield positions, explicit battlefield relations, the four-state responsive system, the mana helper and responsive card counters. CommanderZone remains a manual online Commander table; none of these contracts implement Magic rules enforcement.

The integrated release gate is:

`frontend/e2e/game-product-sprint3-spatial-responsive-gate.spec.ts`

It runs serially and composes the focused Sprint 3 gates instead of replacing them.

## Canonical positions and drag

- New battlefield writes use `{ x, y, unit: "ratio" }`.
- `x` and `y` are finite numbers in `[0, 1]`.
- The canonical anchor is the card's top-left point inside the battlefield content rect.
- Single and batch drag use the same canonical representation.
- Batch movement is atomic and preserves internal distances through collective clamping.
- Browser zoom, battlefield zoom, viewport, DOM offsets, device pixel ratio and rendered card dimensions are never persisted.
- Resize, responsive transitions and local zoom changes must not emit position commands.
- Controller authority, rejection invariants and replay continuity remain authoritative Runtime concerns.

Viewer CSS coordinates may differ. Shared ratios, versions and logical geometry may not.

## Battlefield relations

Attachments and battlefield stacks are explicit authoritative relations.

Attachments preserve relation id, source, target and order. Battlefield stacks preserve an explicit root and `orderedMemberIds`; a card belongs to at most one stack. Relation geometry is viewer-local and deterministic. Local offsets, rows, card dimensions and z-index are not persisted.

The UI must not infer attachment or stack membership from proximity. Resize and zoom cannot auto-stack, auto-unstack, reorder or mutate a relation. Detach, dissolve, controller changes and zone exits use Runtime commands and leave valid independent ratio positions where required.

## Four responsive states

The only responsive states are:

1. `normal`
2. `compact`
3. `aggressive`
4. `minimal`

TypeScript owns the resolver result and exposes it through `data-responsive-state`; CSS consumes that same value. `data-responsive-supported` reports whether the useful game-table rect meets the supported minimum. Below 480×360 the state remains `minimal` and the unsupported-resolution lock is shown. No fifth state is introduced.

The resolver considers useful container width and height, player count, orientation and visible panels. Battlefield zoom is not a resolver input. Hysteresis prevents state oscillation around thresholds.

## Browser and battlefield zoom

Certified browser zoom levels are 80%, 100%, 125% and 150% in headed Chrome. Each is combined with battlefield zoom 70%, 100% and 140%.

Native browser zoom is verified through device pixel ratio and the resulting CSS viewport. CSS transforms, viewport resizing and `deviceScaleFactor` are not substitutes for this certification.

Battlefield zoom is a viewer-local render preference. It does not alter the responsive state directly and is not part of shared gameplay state.

Returning to browser zoom 100% and battlefield zoom 100% must preserve positions, relations, counters, controller state and logical geometry without cumulative drift.

## Player panels and battlefields, 2–6 players

The owner battlefield retains drag, batch selection, zones, battlefield zoom, mana helper, counters, attachments, stacks and previews. Opponent battlefields project the same ratios and relation graph with viewer-local geometry and correct read-only authority.

Player panels keep current turn, lifecycle status, presence, life, commander damage and available resource counters accessible. Long names truncate accessibly. Defeated and conceded players remain represented without producing global overflow or broken gaps.

## Zones, mulligan and modals

Hand, library, graveyard, exile and command zone remain accessible in all four responsive states. Counts and hit targets remain visible; zone modals fit the useful viewport and use internal scrolling when required.

Existing London, Vancouver, Paris and Generous mulligan rules are not changed. Battlefield zoom does not affect mulligan layout or authority.

Disconnect, lifecycle/result, stats, counters, confirmation, zone and mulligan modals retain visible headers, footers and close actions. Opening a modal must not create responsive oscillation or global body overflow.

## Aside, Chat and GameLog

Normal may keep the aside persistent. Compact, aggressive and minimal may use a drawer or overlay. A closed drawer must not intercept battlefield, mana-helper or counter hit targets.

Responsive transitions do not mark messages read, destroy an active chat draft or mutate shared gameplay state. Counter, lifecycle and gameplay actions remain visible in GameLog according to their existing contracts.

## Mana helper and commander identity

The mana helper is viewer-local, vertical, aligned to the left edge of the useful battlefield and vertically centered.

Rows are the effective frozen commander color identity plus colorless, in canonical filtered order `W-U-B-R-G-C`:

- W → W+C
- UR → U+R+C
- WUBRG → W+U+B+R+G+C
- colorless → C
- partners/backgrounds → combined identity+C
- DFC commander → canonical game identity, independent of visible face
- missing or invalid identity → C

Responsive transitions and zoom do not alter the row list or create backend mana state. Mana values remain frontend-local and may reset on reload under the current contract.

Pointer, keyboard and icon-only controls retain accessible names and visible focus. Closed drawers may not intercept the helper.

## Responsive card counters

Counter state remains authoritative and independent from layout. Counter layout derives locally from effective card size, responsive state, counter count, tapped state, relation role and available rect.

Five counter types are guaranteed visible or directly accessible. Values through three digits remain legible; labels may abbreviate with accessible names. Hit areas do not shrink below their functional minimum.

Counters remain independent for attachment targets/sources and stack roots/members. Detach, dissolve, face changes and controller changes preserve counter state. Counter patches do not rewrite printed or manual P/T state and must never produce `NaN`.

## P/T, DFC and faceDown

Printed formulas and per-face manual overrides remain separate from counters. Responsive layout never converts a symbolic formula into a numeric stored value.

FaceDown projections use an opaque shell for unauthorized viewers. Counters and public relations follow their existing privacy contract without revealing static identity, print metadata, printed stats or overrides. DFC state and per-face overrides survive responsive transitions, refresh, reconnect and Runtime restart.

## Privacy and authorization

Patches, bootstraps, normalized stores and DOM projections must not expose private card identity, print references, image metadata, private printed stats, private overrides, visibility masks, socket ids or connection epochs.

Rejected position, batch, relation, counter, controller, movement and lifecycle commands leave version, event count, positions, relations, counters and patch count invariant. Optimistic UI rolls back without fallback or refetch.

## Refresh, reconnect and Runtime restart

The integrated 6-player scenario captures a dense state containing ratio positions, attachments, an eight-member stack, five counters, formula P/T with an override and a faceDown card. It then performs owner refresh, viewer reconnect, viewer close/reopen and a real Runtime restart.

After recovery, versions and canonical shared state must be equivalent, local responsive state is recalculated, commander color identity is unchanged and a valid later action must be accepted. Frontend-local mana values are excluded from persistence equivalence.

## Release-critical gates

The integrated gate is run in series with:

- spatial cross-viewer;
- attachments/stacks cross-viewer;
- four-state responsive;
- mana helper/counters responsive;
- dynamic P/T;
- Sprint 2 lifecycle/correctness;
- Sprint 1 privacy continuity;
- movement/authorization;
- state integrity;
- identity and zone visibility;
- sensitive privacy;
- mulligan;
- Chat/GameLog;
- disconnect/lifecycle.

Global release assertions include zero legacy `game_patch`, unexpected `resync_required`, `target_not_found`, fallback/recovery, invalid responsive states, layout-triggered position/relation commands, new pixel positions, persisted viewport/zoom, relation cycles, orphan relations, duplicate stack membership, global horizontal overflow, critical clipping, inaccessible essential controls, `NaN`, public `Unknown Card` and privacy leaks.

Final execution evidence:

- integrated Sprint 3 gate: 5 passed, 1 externally certified manual case skipped, 3.2 minutes;
- final RC/overlay regression selection: 3 passed, 2.6 minutes;
- Four-State Responsive plus Chat/GameLog: 6 passed, 1 manual case skipped, 2.4 minutes;
- frontend unit suite: 261 files and 2469 tests passed;
- frontend production build: 348 routes prerendered, with only the six pre-existing SCSS budget warnings;
- Go Runtime: `go test ./...`, `go test -race ./...` and `go vet ./...` passed;
- focused PHP Runtime/Patch suite: 34 tests and 159 assertions passed;
- full PHPUnit: 1313 tests and 13917 assertions passed in 16:52.801 with exit code 0;
- WebSocket/relations/contracts: 331 tests and 3995 assertions passed;
- OpenAPI parse, 11-locale i18n validation, service health/ready and Runtime routing readiness passed.

## Manual QA

The native zoom certification used Chrome 150.0.7871.115 headed on Microsoft Windows 11 Pro 10.0.26200 (build 26200), with a 1920×1080 primary display. Zoom was applied as Chrome native page zoom and verified through `window.devicePixelRatio` and the resulting CSS viewport; no CSS transform, viewport substitution or `deviceScaleFactor` was used.

The real-game headed fixture had three players. The owner/controller surface was inspected manually while the isolated-viewer, 2–6-player and four-state coverage was exercised by the serial integrated and focused Playwright gates.

| Browser zoom | DPR | CSS viewport | Responsive state | Battlefield zoom | Result |
| --- | ---: | --- | --- | --- | --- |
| 80% | 0.80 | 2400×1068 | `normal` | 70%, 100%, 140% | PASS |
| 100% | 1.00 | 1920×855 initially; 1920×911 on final return | `normal` | 70%, 100%, 140% | PASS |
| 125% | 1.25 | 1536×684 | `compact` | 70%, 100%, 140% | PASS |
| 150% | 1.50 | 1280×570 | `aggressive` | 70%, 100%, 140% | PASS |

Across all 12 native combinations there was no global overflow, helper/card overlap or hidden control. The mana helper stayed visible, vertical and centered with canonical W-U-B-R-G-C order and hit-testable rows. All five counter controls stayed visible and hit-testable with values 4, 10, 99, 100 and 10. Attachment target/source, stack root/member and faceDown fixtures remained present. Returning browser and battlefield zoom to 100% restored `normal`, preserved counter values and relation roles, and produced no visible drift.

The `minimal` state and the complete 2–6-player matrix are covered by the real-product Playwright scenarios at their contract viewports. The fixed 1920×1080 native-zoom window reached `normal`, `compact` and `aggressive`; changing viewport was deliberately not presented as browser-zoom evidence.

Screenshots are temporary evidence only and are not kept in the worktree unless documenting a reproduced bug.

## Bugs and fixes

The integrated gate reproduced two responsive integration bugs:

1. At 479×359 the unsupported-resolution lock remained above the leave-table modal because two equal-specificity selectors competed and the later `display: grid` rule won. The fix excludes `.has-table-exit-modal` from the unsupported-lock display selector. The lifecycle and RC-final regressions now exercise the contract minimum at 479×359.
2. In compact/aggressive/minimal layouts, the closed Opponents drawer had a higher stacking level than an expanded Chat/GameLog panel, so its handle could intercept `chat-send`. The closed drawer now stays above the battlefield but below the player strip; the open drawer retains its overlay priority. The integrated gate clicks `chat-send` with Opponents explicitly closed in every 2–6-player scenario.

The RC-final regression was also aligned with closed contracts: it opens the Opponents drawer before selecting an off-screen player, uses the current controller for battlefield zone exits, and asserts P/T overrides by face instead of treating them as cross-face top-level values.

No spatial, relation, mana-helper, counter, privacy, authority or restart regression was found.

## Debt outside Sprint 3

The following remain outside this contract:

- selection area and grouped tokens;
- Oracle-derived helpers;
- View X redesign;
- reveal animations and general Sprint 8 visual polish;
- playmats, sleeves and cosmetics;
- deep cursor/IME work not regressed by Sprint 3;
- browser zoom 200%;
- full Magic rules, priority, stack and legal-play validation.
