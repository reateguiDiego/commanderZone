# Gameplay Selection and Marquee Contract

## Scope

Sprint 5B establishes viewer-local selection and rectangular marquee for the current actor's own battlefield. Selection is transient UI state: it is never stored in bootstrap, snapshots, replay, Patch.v2, GameLog, or runtime state. Runtime authorization remains authoritative when a later action sends instance IDs.

View X keeps its independent modal selection model. Sprint 5B does not add touch marquee, spatial arrow-key navigation, relation selection, advanced stack group expansion, or new batch commands.

## Selection regions and identity

A mutative selection belongs to exactly one player, zone, and visual region. It cannot span hands, battlefields, players, or opponent surfaces. Membership is instance-ID based with O(1) lookup and a stable ordered list for UI and command payloads. Duplicate IDs are discarded while the first visual order is retained.

The selected state tracks the focused and anchor instance, interaction revision, and last interaction type locally. No private identity is derived or materialized for selection. A face-down permanent is selectable only by its authorized controller using the reference already projected to that viewer.

Focusing an opponent battlefield clears the actor's mutative selection. Opponent cards remain hoverable and previewable but never become selected, marquee candidates, or batch command IDs.

## Click and modifier semantics

- A normal click on an unselected actionable card replaces the compatible selection.
- A normal click on an already-selected card preserves the complete compatible selection, so pointer drag can use that group.
- Ctrl/Cmd-click toggles one card.
- Shift-click toggles one card on battlefield and hand in Sprint 5B; it is not a DOM-order range.
- Ctrl/Cmd+Shift is the same explicit toggle.
- Alt has no selection meaning.
- A modifier click in a different player, zone, or region starts a new compatible selection.
- An idle click on empty own battlefield clears selection.
- Controls inside a card stop propagation and do not change selection.
- Opening a context menu on an unselected actionable card selects it as the sole context. Opening it on a selected card preserves the compatible group.

## Select All

Select All is safe for zero, one, or many cards and is idempotent.

Hand Select All selects the actionable cards in the actor's own hand in visual order. Battlefield Select All selects visible instances currently controlled by the actor in that battlefield, including controlled cards owned by another player, tokens, DFCs, face-down cards, and visible controlled attachments. It excludes cards controlled by another player, opponent permanents, virtual entities, stale references, and hidden members of a collapsed battlefield stack.

A collapsed stack contributes only its visual root. Hidden member IDs are not silently placed in the selection set. Command-time expansion or explicit group references remain a Sprint 5C/5D concern. Attachments remain independent candidates; selecting a target does not imply selecting its attachments.

Ctrl/Cmd+A is scoped by DOM focus to the actor's hand or battlefield region. It is not intercepted in inputs, textareas, selects, contenteditable surfaces, dialogs, menus, or chat.

## Marquee interaction

Marquee is rectangular, starts only from empty own-battlefield background with a primary mouse or pen pointer, and activates after a five CSS-pixel movement threshold. A card pointerdown remains a click/card-drag candidate and cannot start marquee. Touch does not start marquee in Sprint 5B.

The local interaction has one active state: idle, pointer-pending, or marquee for the battlefield surface, coordinated with the existing card drag, relation targeting, context menu, and modal state. It captures pointer ID, client-space start/current points, modifier mode, base selection, cached candidate bounds, candidate IDs, preview result, and an interaction revision. These values are destroyed on commit or cancellation.

Marquee modes are:

- no modifier: replace;
- Shift: add candidates to the base selection;
- Ctrl/Cmd: toggle candidates against the base selection;
- Alt: no special mode.

The preview renders the exact ordered selection that will be committed. Pointer up commits that local result and removes overlay, capture, listeners, and cached geometry. No command, normalized-store mutation, position update, relation update, or GameLog entry occurs during pointer movement or commit.

## Geometry and hit testing

Pointer and card geometry use the same viewport CSS coordinate space: `clientX`/`clientY` and `getBoundingClientRect()`. The normalized rectangle supports all four drag directions. A visible actionable card is a candidate when its rendered visual center is inside the normalized rectangle, including boundary points. Any-overlap and full-containment rules are intentionally not used.

Each independent overlapping card is evaluated separately. Visible controlled attachments are independent. A collapsed stack exposes only its root candidate. Tapped/rotated cards use the browser's rendered bounds. Marquee never reads or changes canonical ratio positions and never persists pixels, viewport, browser zoom, battlefield zoom, or pointer coordinates.

Candidate bounds are read once when the pointer crosses the threshold and reused for that interaction. Preview updates are limited to one `requestAnimationFrame` callback. Layout-changing events cancel instead of using stale geometry.

## Cancel and Escape priority

Cancellation restores the base selection, emits no command, and removes all transient interaction state. It occurs on Escape, pointer cancel, lost pointer capture, window blur, structural scroll, resize, browser/battlefield zoom change, responsive-state change, focused-player change, relation/snapshot layout change, modal/context-menu activation, lifecycle closure, or component destruction.

Escape priority is:

1. close the active modal;
2. close the context menu;
3. cancel marquee, card drag, or relation targeting;
4. clear selection only when interaction state is idle;
5. otherwise no-op.

One keypress never both cancels an interaction and clears its base selection.

## Deterministic reconciliation

Every applied snapshot reconciles selection against the viewer's current actionable state. It removes IDs that disappeared, moved zone/region, lost controller authority, became hidden/non-actionable, or became hidden members of a collapsed stack. Valid remaining entries keep relative order and are refreshed to the newest card object.

Controller loss and zone movement prune only affected cards. Action rejection preserves the remaining valid selection. Full selection is cleared by load/rebootstrap, explicit refetch, interruption of a previously live runtime connection, opponent focus, game finish, defeat/concession, leave/logout, and absent hydration. Selection is never restored after refresh, reconnect, or actor reconstruction.

## Accessibility and minimal UI

Selectable hand and battlefield cards expose an accessible name plus `aria-selected` and `aria-pressed`; selected styling is not the only signal. Keyboard focus has a visible ring. Space toggles a focused actionable card. Enter retains the existing primary/preview behavior. Spatial arrow navigation is deferred.

When selection is non-empty, a four-state-responsive status shows the selected count and an accessible Clear Selection button. The polite live region announces the committed count, not every pointermove preview. The marquee overlay is `aria-hidden`, not focusable, and does not intercept pointer events.

## Responsive, zoom, touch, privacy, and performance

The existing normal, compact, aggressive, and minimal responsive states are unchanged. Marquee is clipped to the playable battlefield content and disabled when that region is not actionable. Stable zoom/responsive changes preserve ordinary selection; a change during marquee cancels the interaction without commit.

Mouse and pen support direct marquee. Touch retains the current scroll, drag, and long-press behavior; an explicit touch selection mode is reserved for Sprint 5C. A touch or multitouch pointer cancels a pending marquee gesture.

Selection state is never projected to other viewers. Opponent DOM, patches, acknowledgements, logs, and debug surfaces receive no selected IDs. The existing face-down placeholder and privacy contracts remain unchanged.

The component regression target is 100 rendered candidates with one bounds capture, 101 maximum layout reads (root plus candidates), at most one preview calculation per animation frame, no commands, and complete cleanup after repeated commit/cancel gestures. The stateful browser gate renders 100 battlefield cards and observes 98 actionable candidates, 99 layout reads, one bounds capture, and zero gameplay commands across 20 marquee gestures. No spatial index is introduced without measured evidence.

## Deferred to Sprint 5C/5D

Sprint 5C owns touch selection mode, spatial keyboard navigation, richer overlap/relation affordances, and explicit stack member/group selection. Sprint 5D owns the full batch toolbar, action availability, batch context actions, pending/error UX, and any command-time group expansion. New backend selection state or Patch.v2 selection operations are not planned.
