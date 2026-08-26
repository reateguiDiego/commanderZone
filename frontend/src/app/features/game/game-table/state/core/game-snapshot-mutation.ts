import { GameCardInstance, GamePlayerState, GameSnapshot, GameZoneName } from '../../../../../core/models/game.model';

export interface GameSnapshotCardMutation {
  readonly playerId: string;
  readonly zone: GameZoneName;
  readonly instanceId: string;
  readonly update: (card: GameCardInstance) => GameCardInstance;
}

/**
 * Applies a player-local update while retaining every unrelated branch of the
 * snapshot. Snapshot consumers use OnPush inputs, so this is deliberately
 * narrower than cloning the complete table for a scalar gameplay change.
 */
export function updateGameSnapshotPlayer(
  snapshot: GameSnapshot,
  playerId: string,
  update: (player: GamePlayerState) => GamePlayerState,
): GameSnapshot {
  const player = snapshot.players[playerId];
  if (!player) {
    return snapshot;
  }

  const nextPlayer = update(player);
  if (nextPlayer === player) {
    return snapshot;
  }

  return {
    ...snapshot,
    players: {
      ...snapshot.players,
      [playerId]: nextPlayer,
    },
  };
}

/**
 * Batches updates by player and zone. A multi-card drag copies each affected
 * array once and retains references for untouched players, zones and cards.
 */
export function updateGameSnapshotCards(
  snapshot: GameSnapshot,
  mutations: readonly GameSnapshotCardMutation[],
): GameSnapshot {
  if (mutations.length === 0) {
    return snapshot;
  }

  const mutationsByPlayer = groupMutationsByPlayerAndZone(mutations);
  let nextPlayers: Record<string, GamePlayerState> | null = null;

  for (const [playerId, mutationsByZone] of mutationsByPlayer) {
    const player = snapshot.players[playerId];
    if (!player) {
      continue;
    }

    let nextZones = player.zones;
    for (const [zone, zoneMutations] of mutationsByZone) {
      const cards = player.zones[zone];
      const mutationsByInstanceId = groupMutationsByInstanceId(zoneMutations);
      let nextCards: GameCardInstance[] | null = null;

      for (let index = 0; index < cards.length; index += 1) {
        const card = cards[index];
        const cardMutations = mutationsByInstanceId.get(card.instanceId);
        if (!cardMutations) {
          continue;
        }

        const updatedCard = cardMutations.reduce((currentCard, mutation) => mutation.update(currentCard), card);
        if (updatedCard === card) {
          continue;
        }

        nextCards ??= [...cards];
        nextCards[index] = updatedCard;
      }

      if (nextCards) {
        nextZones = nextZones === player.zones
          ? { ...player.zones, [zone]: nextCards }
          : { ...nextZones, [zone]: nextCards };
      }
    }

    if (nextZones === player.zones) {
      continue;
    }

    nextPlayers ??= { ...snapshot.players };
    nextPlayers[playerId] = { ...player, zones: nextZones };
  }

  return nextPlayers ? { ...snapshot, players: nextPlayers } : snapshot;
}

function groupMutationsByPlayerAndZone(
  mutations: readonly GameSnapshotCardMutation[],
): Map<string, Map<GameZoneName, GameSnapshotCardMutation[]>> {
  const grouped = new Map<string, Map<GameZoneName, GameSnapshotCardMutation[]>>();
  for (const mutation of mutations) {
    const byZone = grouped.get(mutation.playerId) ?? new Map<GameZoneName, GameSnapshotCardMutation[]>();
    const zoneMutations = byZone.get(mutation.zone) ?? [];
    zoneMutations.push(mutation);
    byZone.set(mutation.zone, zoneMutations);
    grouped.set(mutation.playerId, byZone);
  }

  return grouped;
}

function groupMutationsByInstanceId(
  mutations: readonly GameSnapshotCardMutation[],
): Map<string, GameSnapshotCardMutation[]> {
  const grouped = new Map<string, GameSnapshotCardMutation[]>();
  for (const mutation of mutations) {
    const cardMutations = grouped.get(mutation.instanceId) ?? [];
    cardMutations.push(mutation);
    grouped.set(mutation.instanceId, cardMutations);
  }

  return grouped;
}
