# Gameplay visibility audience contract

Sprint 1A defines one server-owned audience contract for `card.revealed`, `library.reveal`, and `library.reveal_top` without changing Patch.v2 transport semantics.

## Audited pre-Sprint 1A flow

```text
client command (`to`, `viewers`, or `visibleToMask`)
→ Go inferred a mask from the order of the submitted viewers
→ event persisted `viewers` plus `visibleToMask`
→ Patch.v2 emitted `public`, `player:<id>`, or `group:<mask>`
→ runtime tickets carried player identity but no viewer mask
→ normal tickets could receive public/player envelopes but not group envelopes
→ PHP replay decoded masks using snapshot player order
→ bootstrap/frontend represented visibility as `revealedTo`
```

That flow had three incompatible sources of truth. A client could submit a mask, Go and PHP could assign different players to the same mask, and `to: all` was public in the live envelope while its live `revealedTo` was empty. PHP replay then reconstructed the same event as `revealedTo: ['all']`.

## Canonical contract

### Client command

Clients may submit only:

- `to: "all"`
- `to: "<playerId>"`
- `to: ["<playerId>", ...]`

The runtime rejects client-supplied `audience`, `viewers`, and `visibleToMask`. Every player id must exist in the actor state. Duplicate ids are removed and canonical order comes from the server-owned `viewerBits` mapping.

### Persisted event

New reveal events persist a canonical audience:

```json
{ "audience": { "scope": "public" } }
```

or:

```json
{ "audience": { "scope": "players", "playerIds": ["player-a", "player-b"] } }
```

`viewers` and `visibleToMask` remain in new event payloads only as replay compatibility fields. They are derived by the server and are never trusted as command input. Existing events that contain only those legacy fields remain replayable.

### Patch.v2 and WebSocket routing

The runtime derives the Patch.v2 envelope from the canonical audience:

| Canonical audience | Patch.v2 visibility |
| --- | --- |
| `public` | `public` |
| one player | `player:<id>` |
| multiple, but not all, players | `group:<mask>` |
| every current player | `public` |

`group:<mask>` is a positive decimal bitmask. The signed WebSocket ticket carries the server-derived `viewerMask`; a connection receives a group envelope only when `groupMask & viewerMask != 0`. Roles supplied by a client do not grant group membership.

### PHP bridge, bootstrap, and frontend

PHP treats the canonical persisted audience as authoritative and retains legacy fallbacks for old events. Bootstrap and Patch operations expose the same viewer-facing representation:

| Canonical audience | `revealedTo` |
| --- | --- |
| `public` | `["all"]` |
| selected players | exact canonical player ids |
| hidden/unrevealed | `[]` |

The frontend does not calculate masks or filter secret identities. It consumes only already-projected Patch.v2 operations and viewer-specific bootstrap data.

## End-to-end flow

```text
command `to`
→ Go validates players and resolves canonical audience from `viewerBits`
→ event persists canonical `audience` plus derived compatibility fields
→ Patch.v2 derives public/player/group visibility
→ WebSocket routes with signed ticket `viewerMask`
→ PHP replay reads canonical audience (legacy fields only as fallback)
→ bootstrap/Patch ops expose consistent `revealedTo`
→ frontend applies the viewer-projected state without inventing audience
```

Masks are internal routing/index data. They are not product-facing quantities and are not accepted from clients.
