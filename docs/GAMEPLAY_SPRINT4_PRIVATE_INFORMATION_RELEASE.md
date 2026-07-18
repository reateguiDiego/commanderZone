# Gameplay Sprint 4 — Private Information Release

## Release scope

Sprint 4 closes the private-library and active hand-reveal experience without changing the canonical audience authority, the compact bootstrap, or Patch.v2 recovery semantics. The release covers View X, authoritative library windows, atomic library batches, hand reveal/revoke batches, viewer-local reveal indicators, the read-only reveal panel, state-first motion, and continuity across live play and recovery.

The product remains a manual Commander table. Sprint 4 does not introduce rules automation, grouped tokens, selection areas, cosmetic systems, or a fifth responsive state.

## TopRevealWindow and library order

- Library storage is bottom-to-top; the top is the final array element.
- UI windows expose cards top-first.
- `TopRevealWindow` authorizes the exact persisted instance IDs, not an ad-hoc index comparison.
- Legacy count-only reconstruction uses the correct end of the library and fails closed when identity cannot be proven.
- Shuffle, reorder, move, put-top/put-bottom, and any relevant library epoch change invalidate stale authorization.

## View X and local selection

- View X is a transient, owner-only accessible dialog.
- It provides focus containment and return, keyboard grid navigation, touch selection, Select All/Clear All, DFC preview, no-image fallback, and internal scrolling.
- Selection is tab-local, non-persistent, and distinct from battlefield or hand selection.
- Refresh, reconnect, actor recovery, window invalidation, or close removes the modal and local selection; no bootstrap/refetch is used as the normal flow.

## LibraryWindow, epoch, and batch actions

- The runtime creates an owner-scoped `windowId` bound to a library epoch and an ordered top-first instance list.
- Opening a new window invalidates the previous one across owner tabs.
- Top X and Selected X are separate intents: Top X accepts a count; Selected X accepts an ordered subset proven to belong to the active window.
- Supported selected destinations are hand, graveyard, exile, battlefield face-up, battlefield face-down, top, and bottom. Top X face-down is a separate action.
- Every batch is fully prevalidated, idempotent by `clientActionId`, persisted as one event/version, and rejected without partial state, patch, or GameLog effects.
- Battlefield entries persist deterministic finite ratio coordinates; replay copies those final ratios without viewport recomputation.

## Face-down privacy and GameLog

- Owners retain authorized identity while other viewers receive opaque face-down shells.
- Public GameLog entries contain action and count only; they do not contain instance IDs, card references, print identity, names, order, recipients, or stable private correlations.
- Replay and bootstrap sanitize historical public projections without rewriting the event store.

### Face-down counter projection integrity

- Counters remain public dynamic battlefield state, including on an opaque face-down shell, but `card.counters.patch` is routed per viewer whenever the instance is face-down.
- Owners, current controllers, and explicitly authorized viewers receive the canonical instance ID; unauthorized viewers receive the opaque placeholder ID already present in their projection.
- The runtime resolves that reference through one shared viewer-projection function. It never publishes a canonical face-down ID, embeds it in a placeholder, or uses bootstrap/refetch/resync as normal counter delivery.
- `private.cards.conceal` preserves only the shell-safe dynamic state already visible to that viewer: owner/controller, tapped/rotation, ratio position, and counters. It never carries card/static identity, printed stats, or manual overrides.
- Replay and compact persistence continue to store canonical counter state internally. Live Patch.v2, refresh, reconnect, and actor restart project that same state through the viewer-specific identity contract; historical events are not rewritten.

## Hand reveal and revoke

- `hand.cards.reveal` and `hand.cards.revoke` support ordered batches and single, multiviewer, or all audiences.
- Reveal audience accumulates; revoke may remove selected viewers or the complete audience.
- Materialization/concealment is atomic, preserves hand order, and invalidates when a card leaves hand.
- The owner receives authoritative shared-card state; targets receive only identities authorized to them; third viewers retain placeholders.
- Audience expansion sends final reveal metadata inside `private.cards.materialize` to newly authorized viewers. Standalone field updates are limited to retained viewers so a same-version op cannot target a card before materialization.

## Active reveal indicator and panel

- Rival eye/count values are derived from hand cards currently authorized to the viewer.
- Owner count is the number of unique own hand cards shared with at least one viewer.
- Library windows and library reveals never contribute to these counts.
- The panel is transient and read-only for targets, uses existing authorized state without fetches, and exposes recipients only to the owner.
- Revoke or movement removes cards immediately, stabilizes focus, and closes the panel when its count reaches zero.

## Motion and reduced motion

- State is applied before motion; animation never delays acknowledgements or authorizes identity.
- Live materialize/conceal transitions are deduplicated by authoritative effect/version identity.
- Bootstrap, refresh, reconnect hydration, actor recovery, and idempotent retry do not replay historical motion.
- Batch effects use a bounded grouped sequence rather than independent uncontrolled pipelines.
- Reduced-motion mode removes flip, large translation, and stagger while preserving state, focus, and announcements.
- Component destruction, reconnect, conceal, and panel closure cancel and clean motion targets without retaining private snapshots.

## Privacy matrix

| Operation | Owner | Authorized target | Third/unauthorized viewer |
|---|---|---|---|
| View X | Exact identities and top-first order | No window or identities | No window or identities |
| Selected face-down | Identity | Opaque shell | Opaque shell |
| Selected face-up | Public identity | Public identity | Public identity per game policy |
| Hand reveal | Identity and recipients | Authorized identity | Placeholder |
| Partial revoke | Identity and remaining recipients | Placeholder when removed | State according to its own audience |
| Eye/count | Unique shared-card count | Viewer-local authorized count | No unrelated count or panel |

Private IDs, card identity, image/static data, viewer masks, recipients, and library window data are prohibited from unauthorized Patch.v2 envelopes, bootstrap, GameLog, frontend state, DOM metadata, accessibility text, and motion bookkeeping.

## Multiple tabs and continuity

- Modal, selection, preview, and reveal-panel state are local to each tab.
- Authoritative window invalidation, library batches, reveal/revoke, movement, and counts update every connected tab.
- A stale tab cannot mutate an invalidated window.
- Refresh and reconnect restore authoritative library/reveal state but not transient UI and do not trigger historical animation.
- Actor restart recovers replay/bootstrap-equivalent state and accepts the next valid action without normal-flow recovery.

## Responsive and accessibility contract

- The existing normal, compact, aggressive, and minimal states remain the only responsive states.
- View X, confirmation, audience/revoke dialogs, indicators, and reveal panels remain within the usable viewport for 2–6 players.
- Dialogs expose accessible names, deterministic initial focus, Escape, focus return, keyboard navigation, internal scroll, and usable touch targets.
- Native Chrome zoom at 80%, 100%, 125%, and 150% remains an opt-in manual gate; it is not simulated with CSS.

## Release-critical regression gates

`game-product-sprint4-private-information-gate.spec.ts` is the integrated Sprint 4 release gate. It runs stateful scenarios serially and verifies:

- 2–6-player responsive behavior;
- View X/window invalidation, atomic face-down library movement, and private shells;
- hand reveal expansion, partial/full revoke, target and owner indicators/panels;
- full/reduced motion, retry deduplication, and hydration suppression;
- owner/target multiple tabs;
- refresh, reconnect, runtime restart, lifecycle/game-close rejection, health/readiness, metrics, GameLog privacy, and zero unexpected recovery.

The integrated gate is accompanied by the focused Sprint 4 gates plus Sprint 1 privacy, Sprint 3 spatial/responsive, identity, zone visibility, sensitive privacy, lifecycle, and disconnect gates.

## Debt outside Sprint 4

- Selection area and grouped-token workflows.
- Oracle/text helpers and rules automation.
- Playmats, sleeves, cosmetics, and broad visual polish.
- Generalized performance work not required by a measured release failure.
- Browser zoom beyond the certified 80–150% range and unsupported viewport/engine behavior.
