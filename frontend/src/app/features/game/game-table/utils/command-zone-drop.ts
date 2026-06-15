import { GameCardInstance, GamePlayerState, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';

export const COMMAND_ZONE_DROP_ERROR = 'Only commanders can be moved to the command zone.';

export function canDropCardOnZone(
  zone: GameZoneName,
  card: GameCardInstance | null,
  knownCommanderInstanceIds?: ReadonlySet<string>,
): boolean {
  return zone !== 'command' || isKnownCommanderCard(card, knownCommanderInstanceIds);
}

export function canDropCardsOnZone(
  zone: GameZoneName,
  cards: readonly GameCardInstance[],
  knownCommanderInstanceIds?: ReadonlySet<string>,
): boolean {
  return zone !== 'command' || cards.length > 0 && cards.every((card) => isKnownCommanderCard(card, knownCommanderInstanceIds));
}

export function isKnownCommanderCard(
  card: GameCardInstance | null,
  knownCommanderInstanceIds?: ReadonlySet<string>,
): boolean {
  return card?.isCommander === true || (card ? knownCommanderInstanceIds?.has(card.instanceId) === true : false);
}

export function knownCommanderInstanceIds(snapshot: GameSnapshot | null): ReadonlySet<string> {
  const commanderIds = new Set<string>();
  if (!snapshot) {
    return commanderIds;
  }

  for (const player of Object.values(snapshot.players)) {
    addKnownPlayerCommanderIds(commanderIds, player);
  }

  for (const scope of Object.keys(snapshot.counters ?? {})) {
    if (scope.startsWith('commander:')) {
      commanderIds.add(scope.slice('commander:'.length));
    }
  }

  return commanderIds;
}

export function knownCommanderInstanceIdsFromPlayerState(player: GamePlayerState | null | undefined): ReadonlySet<string> {
  const commanderIds = new Set<string>();
  addKnownPlayerCommanderIds(commanderIds, player);

  return commanderIds;
}

function addKnownPlayerCommanderIds(commanderIds: Set<string>, player: GamePlayerState | null | undefined): void {
  if (!player) {
    return;
  }

  for (const cards of Object.values(player.zones)) {
    for (const card of cards) {
      if (card.isCommander === true) {
        commanderIds.add(card.instanceId);
      }
    }
  }

  for (const instanceId of Object.keys(player.commanderDamage ?? {})) {
    commanderIds.add(instanceId);
  }

  for (const scope of Object.keys(player.counters ?? {})) {
    if (scope.startsWith('commander:')) {
      commanderIds.add(scope.slice('commander:'.length));
    }
  }
}
