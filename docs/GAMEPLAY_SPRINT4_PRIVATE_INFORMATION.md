# Gameplay Sprint 4 — Private Information

## Sprint 4A.1 blocker closure

### Library order and TopRevealWindow

The canonical library array is `bottom -> top`; the final array element is the next card drawn. Projection and modal display use top-first order, so an internal library `[a, b, c, d]` exposes `d` for top 1 and `[d, c]` for top 2.

`library.reveal_top` persists the exact authorized `instanceIds` in top-first order in `TopRevealWindow`. Viewer filtering checks those IDs, their order, the current library tail, the audience, and the library visibility epoch. It does not infer an existing window from `Index < count`.

Legacy count-only windows and events use the canonical tail. Recovery upgrades a count-only compact window to explicit IDs when the current library is sufficient; otherwise visibility fails closed. Historical events are not rewritten.

### Window invalidation

Any operation that changes library membership or top order invalidates the transient window: draw, reorder top, move top, put top/bottom, generic movement into or out of library, move-all, zone reorder, and shuffle. Live invalidation removes the window masks and emits the existing `private.cards.conceal` operation in the mutation version. Runtime epochs are zero-based: PHP preserves epoch `0` instead of normalizing it to `1`, and every later library mutation clears the matching reveal before advancing the epoch. PHP replay advances or restores the persisted visibility epoch, so live, refresh, reconnect, and actor recovery cannot authorize a different card.

### Public GameLog privacy

Public GameLog entries for private-zone or face-down cards are generic. They may retain actor, action type, source/destination zone, count, and `faceDown`, but omit real `instanceId`, `cardKey`, `cardRef`, `printId`, name, image/static fields, location, and `refs.cards`. No stable hash replaces the private ID.

Go sanitizes before `eventLog.append` is emitted and before its entry is persisted in the event payload. PHP applies the same recursive redaction when rebuilding historical events and at legacy hidden-card patch boundaries. Face-up cards in public zones may retain an explicitly public card reference.

### Responsive drawer and context menu

In compact, aggressive, and minimal states, opponent content is hidden, inert, and non-interactive while the drawer is closed. The accessible trigger remains visible and is the only way to open the drawer. An open drawer exposes real visible opponent boards inside the viewport; aggressive/minimal multi-player layouts use a denser two-column drawer grid when needed to keep every board reachable. Closing the drawer restores `aria-hidden`, `inert`, and non-interception.

Context submenus retain the existing design and use viewport collision detection. They can flip left/right and up/down, cap their scrollable height to the viewport, preserve the anchored action, focus the first enabled action, and close with Escape.

Responsive multi-player gates establish one connected browser context per player before layout assertions. Disconnect behavior remains durable and unchanged; the harness no longer creates an unrelated modal by omitting player presence.

### Permanent regression coverage

- Go: multi-card tail order, exact window IDs, legacy recovery, mutation invalidation, replay/idempotency, and recursive face-down GameLog privacy for hand/library singular and batch moves.
- PHP: tail-top order, all library mutation invalidation, legacy count replay, compact/bootstrap continuity, and historical GameLog redaction.
- Frontend: multi-card conceal without resync, drawer inert/open state, and submenu collision/focus behavior.
- Playwright: Sprint 4 blocker closure plus the existing Sprint 1 privacy and Sprint 3 spatial/responsive gates.

At the end of Sprint 4A.1 these features remained outside the blocker closure: View X multiselection, new library batches, hand reveal batch, eye/count, window tokens, and motion work.

## Sprint 4B View X modal and local multi-selection

### Transient modal contract

`library.view` remains an authoritative permission check, but the View X dialog and its selection are frontend-local and transient. The owner opens a fail-closed loading dialog, and the existing `library.view` command materializes the authorized post-command projection consumed by that dialog; no additional zone request, bootstrap, or refetch is part of the normal flow. Refresh never restores the dialog. A reconnect transition, missing snapshot, or a change to the authorized card IDs/order makes the view fail closed. Actor recovery preserves the library, not the UI. Separate tabs therefore keep separate visual selections while each responds independently to authoritative snapshot invalidation.

The opening lifecycle is `loading -> ready`. A rejected command becomes `error`; a changed window becomes `stale`. Error and stale transitions remove every card object, selected ID, preview reference, and rendered card before showing the status. They never retry automatically. Closing clears the component-local state and restores focus to the opener, or to the owner library/gameplay fallback when the opener no longer exists.

### Dialog, focus and input

The modal is a named `role="dialog"` with `aria-modal="true"`, an explicit description, locked document scrolling, internal card scrolling, Escape close, an inert backdrop, and a focus trap. Initial focus goes to the first top-first card, with the close button as the empty/error fallback. The close control is at least 44 by 44 CSS pixels. Focus returns to the trigger after close.

The grid uses roving focus and its current visual DOM order for ArrowLeft/Right/Up/Down, Home, and End. Space toggles the focused card. Enter activates the local preview only and performs no library mutation. Pointer and touch taps toggle selection; Shift adds the inclusive visual range from the last anchor. Ctrl/Cmd use the same non-destructive toggle semantics as an ordinary tap. Focused items are scrolled into the modal viewport. DFC face toggles are separate native buttons, so changing preview face does not change selection or card state.

### Local selection model

The dialog owns `selectedIds`, `selectionOrder`, `anchorId`, `focusedId`, `lastInteractionType`, and a per-opening `selectionRevision`. Only currently visible authorized instance IDs can enter the set. `selectionOrder` records interaction order independently of top-first library order. Select All uses visible top-first order; Clear All removes the set and anchor. Reconciliation prunes stale IDs, and a different revision clears the model completely. This state is not placed in the normalized game store, the global battlefield/hand selection, the backend, Patch.v2, replay, or bootstrap.

The toolbar exposes visible/selected counts, Select All, Clear All, Close, and—only where the existing top reorder is available—an explicit Select/Reorder mode switch. Selection and drag reorder are mutually exclusive. Entering either mode clears local selection. A completed existing reorder invalidates the current view; Sprint 4B adds no new reorder or batch mutation contract.

### Responsive and card rendering

The existing four states remain the only states. Normal, compact, aggressive, and minimal adjust the same dialog/card CSS variables and toolbar density; minimal uses the available viewport with a wrapping toolbar and internal scroll. No breakpoint contract or fifth state is introduced. Browser zoom is handled through real viewport geometry. The permanent 4B gate has a headed, opt-in native Chrome pass (`E2E_MANUAL_VIEW_X_ZOOM=1`) for View X at 80/100/125/150%; CSS zoom and viewport emulation are not accepted by that pass. Unsupported resolution keeps its existing lock, while Escape and Close remain available for the View X dialog.

Authorized DFCs retain a keyboard-accessible face preview. Missing images render a text fallback, and long localized names retain their full accessible name/title with wrapping fallback text. No face change mutates library state. Non-authorized viewers receive neither dialog state, selection state, private IDs/order, nor rendered residual nodes.

### Reserved for Sprint 4C

Sprint 4B intentionally provides no Play Selected/Top X, move-to-zone, face-down batch, final put top/bottom UX, new reorder batch, cross-tab window token, backend selection persistence, or new Patch.v2 operation. Those actions require explicit confirmation plus authoritative complete-batch epoch validation in Sprint 4C.

## Sprint 4C private library batch actions

### Authoritative window and epoch

`library.view` now creates one server-owned `LibraryWindow` per owner/game with a cryptographically random `windowId`, exact authorized top-first `instanceIds`, `expectedEpoch`, `openedAtVersion`, creator player/session metadata and `active` status. The owner-private `library.top.viewed` Patch.v2 operation carries the safe window metadata together with the already-authorized card projection. Selection remains local to the 4B dialog and is never persisted.

Opening another window replaces the active window and emits owner-private `library.window.invalidated` with `stale/replaced`; all owner tabs therefore clean their modal independently. Draw, shuffle, reorder, move top, put top/bottom, generic movement into/out of library, library zone reorder, successful batch, and game close invalidate or consume it. The public-safe `library.epoch.set` (or the epoch on `library.shuffled`) lets every tab detect stale state without card IDs. Refresh/reconnect do not restore the modal, while actor recovery may retain the authority record solely to reject a stale tab safely.

Stable rejection codes include `LIBRARY_WINDOW_NOT_FOUND`, `LIBRARY_WINDOW_STALE`, `LIBRARY_WINDOW_CONSUMED`, `LIBRARY_EPOCH_MISMATCH`, `LIBRARY_SELECTION_MISMATCH`, `LIBRARY_ORDER_MISMATCH`, `INSTANCE_NOT_IN_WINDOW`, `DUPLICATE_INSTANCE`, `INVALID_LIBRARY_BATCH`, `INVALID_DESTINATION`, and `INVALID_FACE_DOWN_MOVE`. The authenticated owner may receive window/epoch/count/invalid-index metadata, never card identity. A rejection produces no event, version, Patch.v2, GameLog, fallback, or automatic refetch.

### Top X and Selected X

The intents are deliberately separate:

- `library.selection.move` requires `windowId`, `expectedEpoch`, a unique ordered subset of exact window IDs, destination, and only destination-relevant options.
- `library.top.play_face_down` requires the active `windowId`, `expectedEpoch`, and `count`; it selects canonical top X on the server and never accepts client card IDs.

Selected movement supports hand, graveyard, exile, battlefield face-up, battlefield face-down, library top, and library bottom. Top insertion preserves selection order as top-first while converting to internal bottom-to-top storage; bottom insertion preserves the submitted selection order as bottom-first. The existing reorder mode remains isolated from selection and no new reorder command was introduced.

### Atomic final effects and positions

The runtime prevalidates owner/game lifecycle, active window, epoch, exact current top order, full selected subset, duplicates, source zone, destination, and face-down constraints before changing state. Success performs one command, one persisted event, one version, and an all-or-nothing `MoveMany`; `clientActionId` retry returns the stored result without reapplying effects. Successful selected actions consume the window, while direct top X invalidates it.

Battlefield batches use the existing purely logical deterministic ratio grid. Each final `{x,y,unit: ratio}` is persisted per move and replay copies it literally; refresh, reconnect, compact snapshots, actor recovery, responsive state, BF zoom, and browser zoom never recalculate positions from a viewport.

The versioned final-effects payload (`effectVersion: 1`) stores window/epoch metadata, original ordered selection, destination/faceDown intent, previous/final library counts, final per-card move locations/positions/faceDown, visibility epochs, and `clientActionId` through the event envelope. Go and PHP replay consume the final `moves`; legacy events retain their existing semantics and no event-store migration is required.

### Patch.v2, privacy, and GameLog

One batch version may contain typed zone batch movement, count changes, owner-private real movement, public opaque face-down shells, visibility materialization/concealment, `library.window.invalidated`, `library.epoch.set`, positions, and one `eventLog.append`. Reducers merge same-version envelopes independently of routing order. The owner ignores its own public opaque shell and applies the private real instance; rivals never receive the real ID in public or localized viewer overlays.

Face-up battlefield transitions become public normally. Hand and library remain owner-private; top/bottom expose counts only. Face-down battlefield cards project as non-correlating opaque shells to B/C/spectators, while owner/controller retain identity. Runtime patches, PHP replay/bootstrap, normalized store, rendered DOM, and public GameLog are recursively checked for real `instanceId`, card/static identity and names.

Semantic GameLog keys cover selected-to-hand/graveyard/exile/battlefield, selected face-down, selected top/bottom, generic selected movement, and top X face-down. Public entries contain actor, action, count, destination and faceDown only. The centralized PHP sanitizer preserves these safe semantic keys while recursively redacting historical unsafe identity. All eleven locale bundles and runtime fallbacks carry the keys.

### Confirmation, multiple tabs, responsive and gates

Every mutation begins in a nested accessible `role="alertdialog"` summary with action and count. Enter on a card never submits; the user must activate Confirm. Escape cancels the confirmation and returns focus to its action trigger. Pending disables repeat submission and keeps cards/selection until authoritative ack; success closes and clears the modal, while non-stale errors remain local and stale errors fail closed without refetch.

The existing normal, compact, aggressive, and minimal states are unchanged. The batch toolbar scrolls internally when necessary, scrolls every focused action fully into its horizontal viewport, stays inside the dialog, and keeps 44px essential targets, keyboard/touch access, internal body lock, long-label support, DFC preview separation, and no global overflow. The permanent Playwright gate covers three isolated viewers, all destinations, selected/top distinction, stale replacement across two tabs, rejection atomicity, face-down privacy, deterministic ratios, refresh/reconnect/restart parity, the four responsive states, and an opt-in headed native zoom pass (`E2E_MANUAL_LIBRARY_BATCH_ZOOM=1`).

Sprint 4D is responsible for hand reveal batch, active reveal model, and batch revoke. Eye/count and reveal motion remain reserved for Sprint 4E; Sprint 4C adds none of those contracts.

## Sprint 4D hand reveal batch and atomic revoke

### Commands, audience, and atomicity

`hand.cards.reveal` and `hand.cards.revoke` are distinct owner-only runtime commands. Both require `playerId`, `expectedZone: hand`, a non-empty ordered unique `orderedInstanceIds`, a canonical `to` audience, and the envelope `clientActionId`. The list is sent in current visual hand order. The runtime prevalidates owner, lifecycle, game state, complete zone/location membership, duplicates, and audience before mutating. Success is one command, event, version, Patch.v2 transition, and aggregate GameLog entry; retry returns the original durable result. Rejection is all-or-nothing and exposes only safe code/count/index metadata.

The Sprint 1 audience contract remains authoritative: one player becomes `player:<id>`, a strict multiviewer subset becomes `group:<mask>`, and `all` is public. Reveal unions the command audience into every selected card. Revoke subtracts it. Revoking a viewer absent from a selected card is an accepted idempotent no-op for that card, which lets one batch operate over the union of recipients without partial failure. `all` revokes every non-owner authorization.

The public boundary is explicit. Partial-to-all emits public batch materialization so spectators receive the public reveal. All-to-partial emits public concealment followed by final-group rematerialization, so spectators and revoked players fail closed while retained players keep identity. No client mask, recipient list, private ID, or placeholder mapping enters a public GameLog entry.

### Active reveal state, order, and invalidation

The source of truth remains per-card visibility plus a server-only `visibility.handRevealStates` lifecycle record. It records owner, hand zone, active status, final mask/audience, first revealed version, last changed version, source command, and source client action. It is preserved by compact snapshots and final-effects replay but removed from viewer projections. Frontend selectors derive only from already-authorized hand instances; there is no redundant counter or parallel public table.

`revealedHandCardsForViewer`, `sharedHandCardsByOwner`, `viewersForSharedCard`, `revealedHandCountForViewer`, `sharedHandUniqueCount`, and `isHandCardRevealedToViewer` work over snapshot or normalized state. They exclude concealed placeholders, revoked cards, and cards outside hand and support `revealedTo: ["all"]`. Sprint 4E may consume them for eye/count without changing privacy authority.

Materialize/conceal entries preserve the submitted visual-hand order and stable opaque ordinal. Existing viewers receive metadata only, newly authorized viewers receive one batch materialization per audience envelope, and revoked viewers receive one batch concealment. Hand count never changes. Any transition into or out of hand clears the reveal mask and marks the active record inactive; a subsequent stale mixed-zone batch is rejected without adding access to the remaining cards.

### Event, replay, GameLog, UI, and tabs

The command type is also the canonical versioned event type. `effectVersion: 1` persists zone, ordered IDs, common canonical audience, previous/final audience and mask per card, materialized/concealed viewer deltas, final `revealedTo`, reveal lifecycle state, count, and the envelope action identity. Go recovery and PHP replay copy final effects; they do not recompute accumulation. Legacy singular `card.revealed` keeps its Sprint 1 semantics. Viewer-specific bootstrap is produced from the same replayed final audience.

Patch.v2 uses existing `private.cards.materialize`, `private.cards.conceal`, owner/final-audience `card.field.set`, invariant hand count, and one `eventLog.append` in the same version. Semantic keys `gameLog.hand.revealed` and `gameLog.hand.revoked` contain actor, count, and audience scope only. All eleven locales and runtime fallbacks include the aggregate copy.

Bootstrap and the persisted activity/log stream apply the same centralized PHP redaction boundary when projecting historical entries. Legacy event-store rows are not rewritten, but private instance IDs, card refs, names, print data, and ordered selections cannot reappear in a public bootstrap, `/games/{id}/log`, or merged activity response.

The hand context action opens a local accessible audience dialog for the selected visual-order hand batch. It offers active non-owner players, multiselect or All, explicit Reveal/Revoke modes, and for revoke only the union of recipients actually active on the selected cards (or All for a public reveal). It traps focus, locks body scroll, supports Escape/cancel, uses explicit confirmation, disables duplicate submission while pending, returns focus, and clears global hand selection only after ack. Reconnect or a moved selected card closes fail-closed without refetch. Two owner tabs share only authoritative visibility patches; their selection/dialog state remains local.

Normal, compact, aggressive, and minimal remain the only responsive states. The dialog uses internal scrolling, wrapping controls and 44px essential targets; no new breakpoint or motion system was added. Eye/count, the read-only reveal panel, GSAP, and reveal choreography remain reserved for Sprint 4E.
