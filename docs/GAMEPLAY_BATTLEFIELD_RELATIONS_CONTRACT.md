# Gameplay Battlefield Relations Contract

## Scope and terminology

This contract closes Gameplay 1.0 Sprint 3B for two battlefield-only relations:

- An **attachment** is one battlefield card (the source/equipment) explicitly related to one battlefield permanent (the target). One source has at most one target; one target may have multiple ordered attachments.
- A **battlefield stack** is an explicit ordered visual group of battlefield permanents, currently `land` or `generic`. It is not discovered from card proximity.
- The **game/action stack** (`stack.card_added`, `stack.item_removed`) represents pending spells/actions and is a separate Sprint 1 contract.

This remains a manual Commander table. These relations do not implement Magic legality, priority, or a rules engine.

## Previous state and root cause

Attachments already persisted source and target instance ids, but their children also kept independent rendered positions. The renderer could therefore have two competing authorities: the relation and the child position.

Land stacks existed only as local visual inference. `land-stack.ts` reconstructed them from hard-coded rendered offsets of 10/18 px, historical 10/28 and 10/20 variants, and 10/8 px matching tolerances. Pixel rounding, card size, viewport and local battlefield/browser zoom could make two viewers infer a different group or order. DOM order then influenced z-index and hit testing. PHP had no authoritative battlefield-stack graph to replay.

Those tolerances no longer create state. Proximity remains only a pre-command drop suggestion; the accepted command always carries explicit instance ids.

## Authoritative schema

Attachments use:

```json
{
  "id": "attachment-<clientActionId>",
  "relationType": "attachment",
  "equipmentInstanceId": "source-instance-id",
  "attachedToInstanceId": "target-instance-id",
  "ownerPlayerId": "source-authority-at-creation",
  "order": 1,
  "effectVersion": 1,
  "createdAtVersion": 42
}
```

Battlefield stacks use:

```json
{
  "id": "battlefield-stack-<clientActionId>",
  "relationType": "battlefield_stack",
  "rootInstanceId": "root-instance-id",
  "orderedMemberIds": ["root-instance-id", "member-2"],
  "stackKind": "land",
  "createdByPlayerId": "player-id",
  "effectVersion": 1,
  "createdAtVersion": 42
}
```

All references are authoritative `instanceId` values. Relation ids and members are unique; root must be a member; a source cannot attach to itself; attachment chains cannot cycle; a source has at most one target; a card belongs to at most one battlefield stack; nested stacks and mixed attachment/stack membership are rejected. All members must be on battlefield and all validation completes before mutation.

No relation stores pixels, card dimensions, DOM rectangles, pointer coordinates, viewport, browser zoom, battlefield zoom, `devicePixelRatio`, z-index or a derived bounding box.

## Commands, events, and final effects

The semantic commands/events are:

- `attachment.created`, `attachment.reordered`, `attachment.removed`
- `battlefield.stack.created`, `battlefield.stack.member_added`, `battlefield.stack.member_removed`, `battlefield.stack.reordered`, `battlefield.stack.dissolved`

Create uses explicit source/target or `orderedInstanceIds`. Attachment reorder supplies the exact ordered relation ids for one target. Stack reorder supplies the exact member set and explicit/unchanged root. Add rejects duplicates and incompatible membership.

Detach/member remove includes the detached card's final canonical `{x,y,unit:"ratio"}`. Dissolve includes one final canonical ratio for every member. Runtime validates all final positions before deleting or changing the relation, then persists one event/version atomically. Replay copies those final effects and never reconstructs them from a viewport.

All commands are idempotent by `clientActionId`. A rejection leaves version, event count, relation graph, positions and emitted patches unchanged.

## Position and local geometry

The target/root ratio is the only active shared position for a related visual group. Moving it emits one `card.position.changed` for that root; children are not rewritten with redundant offsets. A complete selected group is reduced to its root for movement, avoiding doubled deltas and cumulative drift.

Frontend selectors resolve the ordered relation graph first. Pure layout functions derive local child offsets from ordered index and the effective local card width/height. Attachment and land-stack offsets scale proportionally with card size; z-index, hit regions and preview anchors are derived locally. Resize, browser zoom, battlefield zoom, tap/rotation, hover/focus and render order may change local CSS pixels but cannot change membership, order or ratios.

Detaching materializes exactly the client-proposed ratio corresponding to the visual release point. Dissolving materializes all final ratios atomically and preserves spatial order instead of accumulating every member at the root.

## Authorization and lifecycle

Creating/removing/reordering an attachment requires authority over its source; a public foreign target is permitted and does not grant authority to its controller. Battlefield-stack create/add/remove/reorder/dissolve and group movement require current control of every affected member. Mixed authority is rejected before mutation. Owner identity alone does not authorize a card controlled by another player.

When an attachment endpoint leaves battlefield, the relation is removed. When a stack member leaves battlefield, it is removed; a departing root promotes the first remaining ordered member, and fewer than two remaining members dissolve the stack. Controller changes preserve a compatible relation and deterministically dissolve an incompatible stack. `faceDown`, tap, counters and P/T state do not reorder or reveal a relation. Closing/eliminating a game does not rewrite relation geometry.

## Privacy

The public relation graph contains relation ids, already-public instance ids, order and public effect metadata only. It never contains card keys, refs, print ids, names, images, faces, printed stats, overrides, location indexes, masks or hidden-zone identities. Card projection remains viewer-specific: an unauthorized face-down member is an opaque shell even though its public battlefield instance participates in a relation. A relation is removed before a member becomes a hidden-zone identity, so stable relation ids cannot reveal hand/library contents.

## Persistence, replay, bootstrap, and legacy

Compact snapshots persist `attachments` and `battlefieldStacks`; PHP hydration, runtime snapshot recovery, event replay and Gameplay v2 bootstrap preserve graph, order, root, controller/face-down card state and canonical ratios. Live patch, refresh, reconnect, bootstrap and actor restart therefore converge on the same logical graph.

Legacy attachment aliases (`sourceId`/`targetId`, `ownerId`) are normalized only when enough information exists. Historical pixel positions remain read-only under the Sprint 3A contract and become ratio on the next explicit move. Historical visual land stacks that never had a persisted relation cannot be reconstructed safely and remain independent cards until a user creates an explicit stack. No destructive bulk migration or proximity guess is performed.

## Patch.v2 and frontend flow

Typed operations are:

- `attachment.set`, `attachment.remove`, `attachment.order.set`
- `battlefield.stack.set`, `battlefield.stack.remove`, `battlefield.stack.order.set`
- `card.position.set` for detach/member removal and `cards.position.set` for dissolve final effects

The normalized and snapshot reducers apply these operations idempotently, including multiple operations at the same event version. Selectors reject malformed/orphan graphs instead of inventing membership.

```text
user action
-> semantic command with explicit instance ids
-> Go runtime validation and relation mutation
-> versioned event with final effects
-> typed Patch.v2
-> normalized/snapshot reducer
-> pure relation selectors
-> deterministic local geometry
-> rendered cards
```

## Cross-viewer invariants and QA

All authorized viewers receive the same relation ids, root/source/target, ordered member ids and shared ratios. CSS positions and effective card sizes may differ. A resize or browser/battlefield zoom change emits no relation or position command, does not auto-stack/unstack and does not accumulate drift.

### Real browser zoom QA

- Environment: Google Chrome for Testing 147.0.7727.15, Microsoft Windows 11 Pro 64-bit 10.0.26200 (build 26200).
- Players/viewers: three isolated browser contexts. A used 1440x900 and BF zoom 70/100/140%; B remained at 800x700 and BF zoom 70%; C remained at 1920x1080 and BF zoom 140%.
- Browser zoom was applied through native Chrome UI shortcuts at 80/100/125/150% and returned to 100%. The gate observed the corresponding real `devicePixelRatio` transition before accepting each row. It did not use CSS transforms, `deviceScaleFactor`, viewport mutation or shared-state changes.
- Result: all 12 browser/BF combinations passed: 80x(70/100/140), 100x(70/100/140), 125x(70/100/140) and 150x(70/100/140).
- Coverage: 1/2/5 ordered attachments and 2/4/8 ordered stack members; long real card images/names; target tap; four corners; visible/clickable regions; hover preview; right-click context menu; reorder; detach/remove/add; dissolve; controller change; proportional geometry in all viewers; return to 100% without jump.
- Invariants observed: identical relation graph and ratios in A/B/C; no relation or position command caused by zoom; no accidental stack/unstack; no complete clipping, anomalous overflow or cumulative drift. Local CSS coordinates and card sizes varied as expected.
- Refresh, reconnect, bootstrap and actor restart are covered by the same three-viewer integrated gate outside the native-zoom loop; graph/order/ratios survived and a valid subsequent action was accepted.

Two product bugs were reproduced and fixed during headed QA. First, relation offsets used a hard-coded 116x162 card size, so BF 70/100/140 viewers produced different normalized geometry; offsets now derive from each viewer's effective local card size. Second, a dense top-edge stack could choose its fan direction from viewport-local space and be occluded by the focused-player summary in the 800x700 viewer; direction now derives from the shared root ratio and the complete group receives a local, non-persisted translation around that measured overlay. Focused regressions cover effective zoom scaling, cross-viewport direction and the top-left occlusion. No known Sprint 3B relation defect remains.

## Deferred to Sprint 3C

Full four-state responsive layout, selection area, grouped tokens with quantity, responsive counters, mana helper, animations, cosmetics and new breakpoints remain out of scope. Maximum eight-member visual usability is a QA bound, not a Magic rule.
