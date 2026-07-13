# Gameplay Lifecycle Contract

## Canonical state

Players have exactly one lifecycle status: `active`, `defeated`, or `conceded`. Eliminated players retain their seat and private state. Their player record persists `eliminationReason` (`life`, `commander_damage`, `concede`, or `expelled`), `eliminatedAtVersion`, and source/commander context when applicable. Disconnect is presence only.

`turnOrder` is the persisted table-seat order for two to six players. It is never derived from map iteration or lexical player IDs during normal runtime. Legacy snapshots derive it once from the serialized player-object order; recovery then persists it. `nextActivePlayer` starts after the current seat, walks at most one complete cycle, skips non-active players, and returns no player only when none is active.

## Atomic elimination

Life lethal, Commander Damage lethal, concede, and applied expel use the same domain transition. It writes status and elimination metadata, advances only `activePlayerId` when needed, preserves turn phase and number, transfers monarch/initiative, derives result state, appends semantic GameLog entries, and emits one Patch.v2 version. It never emits secondary gameplay commands.

Commander Damage retains Sprint 2B semantics: positive delta reduces life, non-positive delta never restores life, and new effect-version events persist final effects. Legacy events keep historical replay behavior and never gain retroactive defeat.

## Designations and result

Monarch and initiative remain existing helper entities. If their owner is eliminated, ownership passes first to the current active player when eligible; otherwise it passes to the next active seat in `turnOrder`. The helper is removed only when no active player remains. No unsupported Magic rules are inferred.

Exactly one active player yields `winnerPlayerId`, `resultState: survivor`, and `finishedReason: last_active`; turn is frozen on that survivor. Zero active players yields `resultState: no_active_players`, `finishedReason: no_active_players`, no winner, and no active turn. Neither state automatically closes the game.

## Close and guards

`game.close` explicitly persists final game status and phase. Closed or resolved games reject normal gameplay. Defeated and conceded actors cannot mutate movement, position, tap, counters, stats, faces, controller, life, Commander Damage, libraries, stack, relations, helpers, or mulligan state. Read, presence/disconnect, and authorized control-plane commands remain separate.

## Event, replay, bootstrap, and Patch.v2

Authoritative lifecycle payloads use `effectVersion: 3` and persist final player metadata, previous/current turn, `turnOrder`, designation before/after values, winner/result before/after values, and GameLog entries. Go and PHP replay copy these effects; they do not rerun succession rules. Bootstrap exposes the same player metadata, turn order, and result fields.

One public Patch.v2 version may include `player.status.set`, `player.elimination.set`, `turn.set`, `turn.order.set`, `helper.update`/`helper.remove`, `game.result.set`, game status/phase ops, and `eventLog.append`. Operation order is not a source of truth.

## Deferred debt

Durable disconnect voting, timeouts/cooldowns, and rematch lifecycle remain deferred. An applied expel uses this lifecycle contract, but Sprint 2C does not redesign the vote that initiates it.
