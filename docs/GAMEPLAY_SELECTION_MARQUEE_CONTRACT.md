# Gameplay Selection and Marquee Contract

## Scope

Sprint 5B establishes viewer-local selection and rectangular marquee for the current actor's own battlefield. Sprint 5C extends that local contract with relation-aware group references, explicit touch marquee, spatial keyboard navigation, and hand ranges. Selection remains transient UI state: it is never stored in bootstrap, snapshots, replay, Patch.v2, GameLog, or runtime state. Runtime authorization remains authoritative when an action sends instance IDs.

View X keeps its independent modal selection model. Sprint 5C does not add new batch commands, a full batch toolbar, lasso, persistent selection, grouped tokens, automatic rules, or new responsive states.

## Selection identity and regions

A mutative selection belongs to exactly one player, zone, and visual region. It cannot span hands, battlefields, players, or opponent surfaces. Membership is instance-ID based with O(1) lookup and a stable ordered list. Duplicate IDs are discarded while first visual order is retained.

Collapsed battlefield stacks additionally use a viewer-local `battlefield-stack` group reference containing the relation ID, current visual root, player/zone, and member count. `selectedIds` contains at most the visible root; hidden members are never inserted for highlighting. Current members are resolved from the newest snapshot only when a drag requires authority validation. Group references are never persisted or projected.

Focusing an opponent battlefield clears instance and group selection and disables touch-select mode. Opponent cards remain hoverable, focusable for read-only preview, and non-actionable: Space, marquee, Ctrl/Cmd+A, and batch IDs are disabled.

## Click, keyboard modifiers, and ranges

- Normal click on an unselected actionable card replaces the compatible selection.
- Normal click on an already-selected card preserves the compatible group for drag.
- Ctrl/Cmd-click toggles one card.
- Shift-click toggles one battlefield card; battlefield never uses DOM range.
- Shift-click and Shift+Space in hand select an inclusive range from the local anchor using current visual hand order.
- Ctrl/Cmd+Shift adds the hand range. A missing or stale anchor falls back to the target.
- Alt has no selection meaning.
- A modifier in a different region starts a new compatible selection.
- Idle empty-background click clears selection; embedded card controls do not alter it.
- A context menu on an unselected card gives it explicit context; an existing compatible selection is preserved.

Space toggles the focused actionable card and Enter retains the existing primary/preview behavior. Ctrl/Cmd+A remains scoped to the actor's focused hand or battlefield. Shortcuts are not intercepted in inputs, textareas, selects, contenteditable surfaces, dialogs, menus, or chat.

## Select All

Select All is safe for zero, one, or many cards and is idempotent. Hand uses actionable own cards in visual order. Battlefield uses visible instances currently controlled by the actor, including borrowed controlled cards, tokens, DFCs, face-down cards, and visible controlled attachments.

It excludes opponent cards, cards whose controller is another player, virtual entities, stale references, and hidden collapsed-stack members. A collapsed stack contributes one visual root plus one local group reference. Selecting an attachment never implies its target and selecting a target never implies attached cards.

## Marquee and touch mode

Marquee is rectangular, starts only from empty own-battlefield background with a primary pointer, and activates after a five CSS-pixel threshold. Mouse and pen work directly. A card pointerdown remains a click/card-drag candidate.

Touch works only through the explicit **Select area** toggle. The control is available in the four responsive states when the actor/battlefield is actionable, is at least 44 CSS pixels, exposes `aria-pressed`, and is one-shot. Commit or cancellation turns it off. While enabled, one empty-background touch can marquee and temporarily uses `touch-action: none`; when disabled, scroll, long-press, context menu, and card drag keep their previous behavior. A second touch, pointer cancel, lost capture, modal/drawer activation, opponent focus, lifecycle block, or layout change cancels and disables the mode.

Modifier modes remain: no modifier replaces, Shift adds, Ctrl/Cmd toggles, and Alt has no special mode. Preview is the exact ordered result committed on pointerup. Pointer movement and commit emit no gameplay command, mutate no normalized state, and create no log entry.

## Shared geometry, overlap, and spatial navigation

Pointer and card geometry use viewport CSS coordinates from `clientX`/`clientY` and `getBoundingClientRect()`. The center of a visual target must fall inside the normalized rectangle. Any-intersection and full-containment are not used.

Marquee and spatial keyboard navigation consume the same captured visual-target projection. A target exposes rendered bounds/center, instance ID, kind (`card`, `attachment`, `stack-group`, or visible `stack-member`), optional group ID, actionability, z-index, and accessible label. Hidden collapsed members, disabled elements, and zero-size elements are excluded.

Independent overlapping cards are evaluated individually; pointer click/context menu still uses the browser's topmost hit target. Visible controlled attachments are individual targets. A collapsed stack exposes one root/group target. Tapped/rotated cards use rendered bounds.

Arrow keys choose a deterministic candidate in the requested visual half-plane by primary-axis distance, perpendicular deviation, z-index tie-break, then instance ID. Hand navigation uses rendered centers across wrapped rows. Home/End choose deterministic visual edges. Focus uses local `scrollIntoView({block:'nearest', inline:'nearest'})` and does not mutate selection by itself.

Geometry is captured once per marquee interaction and invalidated by relation, controller, collapse, size, scroll, responsive, or zoom changes. Preview is limited to one requestAnimationFrame update per frame.

## Attachments, stacks, and drag

Visible controlled attachments are selected and focused individually. Target selection does not add equipment and equipment selection does not add its target. Detach keeps an explicitly selected attachment when it remains actionable; controller or zone loss prunes it.

A collapsed stack defaults to group selection and exposes a distinct outline, count badge, localized stack label, and group count. Its context menu provides explicit **Select stack** and **Select root only** actions. No expanded member UI exists in Sprint 5C, so hidden members remain unavailable for individual selection.

Dragging a selected stack resolves its current members immediately before the command to validate existence, controller, and zone, then persists the current root position under the Sprint 3 relation contract. Mixed selections resolve members for validation but emit positions only for independent cards and relation roots. A selected target plus all selected attachments likewise emits the target once. IDs are deduplicated. A rejected command preserves valid selection; success uses the existing action-consumption cleanup.

## Cancellation and deterministic cleanup

Escape priority is modal, context menu, marquee/drag/relation interaction, touch-select mode, idle selection, then no-op. One keypress never both cancels an interaction and clears the base selection.

Every applied snapshot reconciles instance and group selection against current viewer actionability. It removes disappeared cards, zone/player/controller changes, hidden/non-actionable cards, collapsed members, and dissolved relations while retaining valid relative order. Root promotion rewrites the group root without exposing members. Detach, dissolve, reorder, conceal/materialize, lifecycle closure, defeat/concession, leave, refresh/rebootstrap, reconnect reconstruction, and actor restart use the same deterministic pruning/clear contract. Focus moves to a valid target or falls back to the region.

## Accessibility, responsive behavior, privacy, and performance

Cards expose accessible names, `aria-selected`, and a visible focus ring. Group selection has a non-color-only outline/badge and safe localized labels such as “Stack of 4 cards selected”; face-down labels never expose concealed identity. Touch mode uses `aria-pressed`. Selection and group counts announce only committed results through the polite live region. The marquee overlay is `aria-hidden` and not focusable.

Normal, compact, aggressive, and minimal remain the only responsive states. Browser zoom and battlefield zoom change rendered geometry only. A layout change during interaction cancels without stale commit, position command, or relation command; stable selection outside the interaction is preserved.

Selection never materializes hidden identity or enters backend, patches, acknowledgements, logs, or shared debug state. Runtime continues to prevalidate every later ID.

The regression target is 100 rendered targets, one bounds capture, at most root-plus-N layout reads, one preview calculation per animation frame, and complete cleanup after repeated gestures. Spatial lookup is a bounded linear scan with deterministic scoring; tests cover 100 targets and 50 navigation steps. Relation tests cover overlaps, attachments, and stacks of four/eight without duplicate positions. No spatial index is introduced without measured evidence.

## Deferred to Sprint 5D

Sprint 5D owns the full batch toolbar, action availability, new batch actions, pending/error presentation, and relation-specific action menus. Expanded stack-member UI remains deferred until product evidence requires it. Backend selection state and Patch.v2 selection operations are not planned.
