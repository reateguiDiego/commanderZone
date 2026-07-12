# Gameplay 1.0 Sprint 1 — Privacy, Authority & Continuity

## Release contract

Sprint 1 closes one server-authoritative contract across Runtime Go, event persistence, PHP replay/bootstrap, WebSocket routing, Patch.v2 and the normalized frontend store:

```text
live = refresh = reconnect = PHP bootstrap = Go actor restart/replay
```

The compact bootstrap and Patch.v2 remain the only normal hydration and live synchronization paths. `game_patch`, `resync_required`, snapshot refetch and legacy fallback are release failures during normal gameplay.

## Audience

- Public audiences are canonical `public`; targeted audiences are canonical ordered player sets.
- Single-viewer routing uses `player:<id>` and multiviewer routing uses `group:<viewerMask>` generated only by the server.
- `viewerMask`, `visibleToMask`, visibility indexes and runtime locations are internal and never part of a viewer projection.
- Card reveals are cumulative. A reveal adds its audience; conceal/revoke removes only the addressed audience. Public reveal covers every current player.
- `library.reveal_top` is a single transient window: a subsequent reveal replaces the previous window and audience.
- Client payloads may select product targets (`to`) but cannot submit canonical audiences, viewers or masks.

## Private placeholders

- Unauthorized hand/library projections use stable opaque placeholders based on owner, zone and ordinal. They never contain the real private `instanceId` or card identity/static fields.
- `private.cards.materialize` atomically replaces addressed placeholders with authorized real instances.
- `private.cards.conceal` atomically restores placeholders and removes the real instance from the visible zone projection.
- Materialization/concealment preserve order and counts and do not require bootstrap, refetch or resync.
- Private to public movement publishes the real public instance. Public to private movement restores viewer-specific placeholder/materialization state.

## Stateful replay

Replay parity covers:

- `cards.moved`, including per-item/legacy root `faceDown` normalization;
- `library.reorder_top`, `library.move_top`, `library.put_top`, `library.put_bottom`;
- `stack.card_added`, `stack.item_removed`;
- `card.dungeon_marker.changed`, including explicit `null` removal.

`library.view` is private and transient. It can emit a live private view operation and an audit event, but never changes authoritative library order or reconstructed viewer state.

## Authority and atomicity

- Visibility never grants mutation authority.
- Private zones and non-battlefield owner zones require the owner unless a command has a narrower explicit contract.
- Battlefield movement, position, tap, counters, stats and face changes require the current controller.
- An owner who is not the current controller cannot manipulate that battlefield permanent.
- Every referenced instance is resolved and prevalidated before mutation, version increment, event append or patch emission.
- Mixed-authority, missing, duplicate and stale-zone batches fail atomically.
- Authorization rejection cannot fall through to PHP/legacy execution.

Stable authorization error codes currently asserted by release gates:

- `INSTANCE_NOT_FOUND`
- `INSTANCE_NOT_CONTROLLED`
- `INSTANCE_NOT_OWNED`
- `ZONE_MISMATCH`
- `MIXED_AUTHORITY_BATCH`
- `DUPLICATE_INSTANCE`
- `PERMISSION_DENIED`

Errors include command type and only the submitted/safe instance and item index. They never include private card identity.

## Privacy invariants

Unauthorized projections, Patch.v2 operations, bootstraps and GameLog entries must not expose:

- real private instance IDs;
- `cardKey`, `cardRef`, `printId` or private card name;
- `imageUris`, `cardFaces` or unauthorized static bundles;
- runtime `loc`, `visibilityIndex`, `viewerMask` or `visibleToMask`.

Face-down public shells remain addressable gameplay entities but do not expose card identity. GameLog describes private movement and reveal activity generically. Chat and reactions remain separate from GameLog.

## Integrated release gate

`frontend/e2e/game-product-sprint1-privacy-continuity-gate.spec.ts` runs one serial three-player game with isolated browser contexts. It captures sent `command.v2`, accepted Patch.v2 acknowledgements, rejected `command_ack`, per-viewer Patch.v2, recovery requests, legacy routes, browser errors, versions, database event counts and runtime metrics.

Normal hand-to-battlefield movement uses the product context-menu UI. Browser-side direct runtime commands are limited to deterministic setup/exercise of multiviewer audiences, exact stateful batches, idempotent retry and negative authorization payloads that the UI does not expose as a stable single action.

The gate covers audience/materialization, concealment, private/public transitions, face-down hand/library batches, all stateful library operations, transient `library.view`, stack net state and retry, dungeon marker set/update/remove, owner/controller authority, atomic rejects, refresh, reconnect and actor restart.

## Release-critical gates

- Sprint 1 integrated privacy/continuity
- visibility audience and placeholder materialization
- private replay parity
- batch authorization
- identity runtime
- zone visibility
- state integrity
- movement/position
- sensitive runtime privacy
- Go test/race/vet, PHPUnit, frontend unit/build, and API/WebSocket/Runtime health/readiness

## Outside Sprint 1

Responsive redesign, GSAP/visual animation, View X UX, commander damage changes, grouped tokens, text-driven helpers, premium cosmetics, advanced selection UX and performance optimization remain outside this release contract.

