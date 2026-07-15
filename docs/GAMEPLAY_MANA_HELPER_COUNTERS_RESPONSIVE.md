# Gameplay Mana Helper & Responsive Card Counters

## Scope

This document closes the implementation contract for Gameplay 1.0 Sprint 3D. It covers only the viewer-local mana helper presentation and the responsive presentation of authoritative card counters. It does not change spatial coordinates, battlefield relations, privacy, Patch.v2, replay, the four-state responsive contract, or Magic rules.

## Previous state and root causes

The mana helper lived in the focused battlefield mana lane, near the upper-right area, and rendered its entries as a horizontal fixed-width grid. Its placement mixed lane offsets and a translation based on stack clearance, so short containers, the four responsive states, and effective browser space could distort or displace it. Colors with a pending or non-zero local value could also remain visible even when they were outside the player's effective commander color identity.

The card marker rail was rendered inside `.card-visual`, which deliberately clips card artwork. It used fixed marker dimensions and an unconnected compact input. Five markers could therefore exceed the effective card height under battlefield zoom, responsive card sizing, tapping, attachments, stacks, or corner placement; the fifth entry was clipped by the card shell.

## Mana helper contract

### Placement and layout

The helper is an absolutely positioned child of the focused battlefield content shell. Its anchor is the real battlefield content rectangle:

- left edge: the responsive safe gutter;
- vertical position: `top: 50%` plus a local `translateY(-50%)`;
- orientation: vertical in every responsive state;
- maximum height: the local content rectangle, with internal overflow only when required;
- state: viewer-local and never persisted;
- independence: browser zoom and battlefield zoom affect the available rendered space only; they are not explicit layout inputs and do not alter mana, card ratios, relations, or responsive state.

The helper remains available in `normal`, `compact`, `aggressive`, and `minimal`. The same four responsive states select CSS tokens for row size, gaps, padding, and control density. No breakpoint or fifth conceptual state was added. Space for the hide action is reserved separately so it cannot intercept the color row controls, including the single colorless row in `minimal`.

### Effective commander color identity

`resolveManaHelperColors` consumes the effective color identity already frozen in the game snapshot. It does not derive identity from the visible face, translated text, mana cost, frame, battlefield permanents, or Oracle text.

Rules:

- canonical order is `W`, `U`, `B`, `R`, `G`, then `C`;
- only valid, unique identity colors are rendered;
- colorless is always rendered;
- missing, empty, or invalid identity safely resolves to `C` only;
- mono-color, multi-color, WUBRG, colorless, combined partner/background identities, and DFC commanders all use the same snapshot field;
- responsive changes, browser zoom, battlefield zoom, resize, refresh, reconnect, and actor recovery never add colors or reorder the list.

Legacy local values for colors outside the current identity are neither migrated nor erased silently, but those colors are not exposed as usable rows.

### Mana state and accessibility

Mana values keep their pre-existing frontend-local contract. Increment, decrement, and reset do not send gameplay commands, do not participate in Patch.v2/bootstrap/replay, and reset on a full page reload. The existing store caps interactive values at 99; the layout still accommodates three-character values defensively. This sprint intentionally adds no persistence.

Each row has a non-color-only symbol, an accessible color name and current value, and named increment/decrement controls. Arrow keys navigate the vertical rows; Enter/Space and the native buttons remain operable; focus stays visible. Compact states may reduce visible labels without removing accessible names or hit regions.

## Card counter layout contract

`resolveCardCounterLayout` is a pure, viewer-local resolver. Its inputs are:

- effective card width and height;
- counter type count;
- one of the four responsive states;
- tapped state;
- relation role (`independent`, `attachment`, `stack-root`, or `stack-member`);
- local available rectangle.

It returns orientation, rows, columns, badge size, hit size, gap, font size, label mode, overflow strategy, and z-index. None of those outputs are persisted. The effective size is measured with `ResizeObserver`, so battlefield zoom and responsive sizing produce a fresh local projection without card movement, ratio rounding, relation commands, or drift.

### Five-counter guarantee

For up to five counter types:

- `normal` uses a full vertical rail when space permits;
- compact or constrained cards use a contained grid, normally three rows by two columns;
- `aggressive` keeps values and accessible identifiers while abbreviating visual labels;
- `minimal` may use accessibility-only labels, while values and all five interactive slots remain available;
- tapped and stack-member projections prefer the contained layout when the vertical axis is constrained.

The rail now sits outside the artwork clipping shell. Artwork remains clipped, while only cards with markers and explicit relation projections allow the rail to extend into its controlled local overlay. Badge and font sizes are clamped, and the control hit size has a 22 px floor. Three-digit values fit without changing authoritative data. Long labels use a visual abbreviation plus the full label in `title` and the accessible name.

### Relations, P/T, DFC, and face-down cards

Attachments and stacks keep their authoritative graph, member order, and local offsets. Relation role influences only the counter projection and z-index. Target, attachment, stack-root, and stack-member counters remain distinct; detach, reorder, and dissolve do not rewrite counter state.

Counters remain separate from dynamic power/toughness, formulas, and manual overrides. The layout does not calculate or rewrite P/T and cannot convert formulas to numbers. DFC presentation uses the current authorized card view while retaining the same counter state. Face-down and private-zone rendering continues to consume the existing redacted snapshot, so no printed identity, stats, override, name, or print is introduced by the marker rail.

Readonly viewers receive non-interactive markers; controller actions keep the existing authorization and optimistic/error flow. No backend, Runtime, WebSocket, OpenAPI, Patch.v2, bootstrap, replay, authorization, or privacy contract changed in Sprint 3D.

## Automated QA

The dedicated Playwright gate is `frontend/e2e/game-product-mana-helper-counters-responsive-gate.spec.ts`. It uses isolated controller, small-viewer/BF70, and large-viewer/BF140 browser contexts. Its pairwise matrix covers 2–6 players, every responsive state, BF zoom 70/100/140, identities W/UR/WUBRG/colorless/combined partners, a DFC commander, five authoritative counter types with values 1/9/10/99/100, tapping, face-down cards, attachments, explicit stacks, authorization, refresh, reconnect, and Runtime actor recovery.

The gate asserts canonical identity filtering, mandatory `C`, vertical left-side placement, local mana continuity through layout changes, five visible and accessible counters, readonly viewers, authoritative counter propagation, unchanged relations and ratios, no global overflow, no forbidden position/relation traffic, no `game_patch`, no `resync_required`, and no public `Unknown Card` leak.

## Manual headed QA

Chrome for Windows version 150.0.7871.115 is installed. Real headed native-browser QA could not be executed in this run because the selected Chrome profile did not have the required ChatGPT Chrome Extension/native host available. The browser controller was retried and its prescribed troubleshooting checks confirmed the missing extension/host. Browser zoom was not simulated with CSS, viewport changes, device scale factor, or battlefield zoom, and the matrix is therefore not claimed as manually certified.

Pending manual certification:

- native browser zoom 80%, 100%, 125%, and 150%;
- BF zoom 70%, 100%, and 140%;
- all four responsive states and 2–6 player layouts where reachable;
- identities W, UR, WUBRG, colorless, combined partners/backgrounds, DFC, and invalid/missing fallback;
- counter counts 1/3/5, long labels, 1/10/100, corners, tapped cards, 1/2/5 attachments, 2/4/8 stack members, face-down cards, P/T formula/override, keyboard focus, clipping, hit testing, overflow, and return to 100%.

## Remaining debt

- complete the real headed Chrome zoom matrix after enabling the ChatGPT Chrome Extension/native host;
- broader 2/4/8-member manual stack density certification remains part of that manual pass;
- Oracle devotion/per-each helpers, area selection, grouped tokens, animation, visual polish, and automatic Magic rules remain explicitly out of scope;
- persistent mana is not introduced; any future persistence proposal requires a separate product and synchronization contract.
