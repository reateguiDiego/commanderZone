# Gameplay 1.0 — Placeholder materialization contract

## Scope

This contract applies to Patch.v2 projections of private zones represented by synthetic placeholders. It does not change the canonical visibility audience contract, bootstrap shape, event persistence, or runtime authority.

## Correlation key

Hand placeholders use `ownerId-hidden-hand-<ordinal>`. The ordinal is the canonical zone position and is stable across live patches, refresh, reconnect, and replay projection. Library uses the single opaque handle `ownerId-hidden-library-top` for its projected top window. Neither form contains or derives from the real `instanceId`.

## Materialization

The server emits one audience-routed operation before any compatible library reveal operation:

```json
{
  "op": "private.cards.materialize",
  "playerId": "owner-id",
  "zone": "hand",
  "entries": [
    {
      "placeholderId": "owner-id-hidden-hand-0",
      "index": 0,
      "card": {
        "instanceId": "real-instance-id",
        "cardKey": "print-id:card",
        "ownerId": "owner-id",
        "controllerId": "owner-id",
        "zone": "hand",
        "hidden": false,
        "revealedTo": ["viewer-id"]
      }
    }
  ]
}
```

`entries` is a batch and is applied atomically. A hand entry must replace the exact placeholder or already be materialized. A library batch replaces the top placeholder with its first card and inserts subsequent cards by projected index. Materialization does not change `zoneCounts` because it changes only the viewer projection, not canonical zone membership.

The runtime derives audiences, placeholder IDs, ordinals, and card identity. Clients cannot submit this operation or choose its audience. Static card hydration may be supplied by the PHP bridge or resolved through the existing authenticated card catalog path.

## Concealment

Revocation uses `private.cards.conceal` with only `instanceId`, opaque `placeholderId`, and projected `index`. Non-owner viewers replace the materialized card with the placeholder and discard unreferenced static identity. The owner projection is unchanged. Concealment is idempotent when the placeholder is already present.

## Ordering and recovery

For library reveal operations, materialization precedes `library.top.revealed` or `library.revealed.set` in the same visibility envelope and version. The reducer accepts the visibility operations in same-version merges, but normal handling does not require bootstrap, refetch, `game_patch`, or `resync_required`.
