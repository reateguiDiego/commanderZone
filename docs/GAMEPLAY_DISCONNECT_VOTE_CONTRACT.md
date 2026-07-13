# Gameplay disconnect vote contract

## Authority and presence

The Go game actor is the single writer for the live disconnect control plane. The WebSocket gateway owns socket/session observation and submits signed internal presence transitions; PHP persists and replays the same effect-versioned projection. A player is connected while at least one valid game connection remains. Presence never changes lifecycle status, ownership, zones, controllers, private information, or `turnOrder`.

The public durable projection stores `connected`, `activeConnectionCount`, `disconnectedAt`, and `lastSeenAt`. A monotonic `connectionEpoch` may remain in authoritative persisted state for session serialization, but projection removes it. Socket IDs, tickets, tokens, epochs, and infrastructure identity are never emitted to gameplay viewers. Runtime process loss does not synthesize offline transitions, so restart cannot make every player immediately expellable.

## Vote state and quorum

Only one vote may be open globally. `disconnect.vote.open` (including the gateway's grace-qualified internal open) derives the opener, target, `voteId`, ordered `eligibleVoterIds`, and `requiredVotes`; clients cannot supply authority or quorum. Eligible voters are active and connected players other than the disconnected active target. The list is frozen at open and strict majority is `floor(eligible / 2) + 1`.

The durable state contains `voteId`, target/opener, status, frozen voters, required votes, immutable votes by player, `openedAt`, `expiresAt`, `resolvedAt`, `cooldownUntil`, resolution, and `effectVersion = 4`. Canonical terminal statuses are `rejected`, `cancelled`, `expired`, and `executed`; `passed` is represented by the persisted `passedAt` inside the atomic transition that finishes as `executed`.

## Voting, timeout, cooldown, and reconnect

`disconnect.vote.cast` accepts only `voteId` and `decision` (`expel` or `wait`) from an authenticated frozen voter. A voter has one effective vote. `clientActionId` retry returns the original receipt; another action ID is `DUPLICATE_VOTE`. Presence changes never recalculate quorum.

Votes expire 60 seconds after `openedAt`. Timeout resolves to `expired/wait`, never expel. `expiresAt` is persisted; a gateway timer is rearmed from recovered state and every actor load checks the same absolute deadline. Duplicate timer delivery is idempotent through the stable timeout action ID and terminal-state validation.

Every non-expel resolution starts a target-scoped 300-second durable cooldown. Reconnect serializes through the actor, persists presence online, cancels the open vote as `cancelled/reconnected`, preserves its history, starts the normal cooldown, and never eliminates the target. Whichever of reconnect or the final expel vote reaches the actor first is authoritative.

## Expel and lifecycle invalidation

Majority expel closes the vote as `executed` and calls the Sprint 2C common elimination transition in the same version. It sets target status `conceded`, reason `expelled`, turn/designation/result effects, gameplay guards, GameLog, and the existing rematch `leave` projection. It does not remove the seat or private state and does not auto-close the game.

Target/opener elimination and explicit game close cancel an otherwise open vote. A resolved vote cannot accept further votes. Closed/result games, non-active actors, active targets, connected targets, stale vote IDs, cooldowns, duplicates, and non-eligible voters reject without version, event, patch, replay, or bootstrap mutation.

## Persistence, replay, bootstrap, and Patch.v2

New semantic events are `player.presence.changed`, `disconnect.vote.opened`, `disconnect.vote.cast`, `disconnect.vote.resolved`, `disconnect.vote.cancelled`, and `disconnect.vote.expired`. They persist final vote, presence, cooldown, rematch, lifecycle effects, GameLog entries, timestamps, and `effectVersion = 4`. Go and PHP replay copy those effects and never recalculate quorum, deadlines, succession, or expel. Legacy `disconnect.vote.updated` events retain their historical semantics.

Compact snapshots and Bootstrap V2 round-trip `presence`, `disconnectVote`, `disconnectCooldowns`, and the existing `rematch` projection. Patch.v2 uses `player.presence.set`, `disconnect.vote.set`, `disconnect.cooldown.set`, existing lifecycle/designation/result ops, `rematch.set`, and `eventLog.append`. Same-version application is final-state based and never requires refetch.

## Modal and remaining debt

The existing modal uses authoritative vote state, frozen quorum, own vote, and `expiresAt`. Only eligible active viewers receive controls; no optimistic expel is applied. Refresh/reconnect/restart hydrate the same modal state, and terminal vote state closes it. General responsive redesign and full rematch creation/acceptance/matchmaking remain outside this sprint.
