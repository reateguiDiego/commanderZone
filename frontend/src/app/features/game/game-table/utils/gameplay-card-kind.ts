import { GameCardInstance } from '../../../../core/models/game.model';

export type GameplayCardKind = 'emblem' | 'dungeon';

const OFFICIAL_DUNGEON_CARD_NAMES = new Set([
  'dungeon of the mad mage',
  'lost mine of phandelver',
  'the undercity',
  'tomb of annihilation',
]);

export function isEmblemCard(card: GameCardInstance | null | undefined): boolean {
  const layout = card?.layout?.trim().toLowerCase() ?? '';
  const typeLine = card?.typeLine?.trim().toLowerCase() ?? '';

  return layout === 'emblem'
    || typeLine === 'emblem'
    || typeLine.startsWith('emblem ');
}

export function isDungeonCard(card: Pick<GameCardInstance, 'layout' | 'typeLine' | 'name'> | null | undefined): boolean {
  const layout = card?.layout?.trim().toLowerCase() ?? '';
  const typeLine = card?.typeLine?.trim().toLowerCase() ?? '';
  const name = card?.name?.trim().toLowerCase() ?? '';

  return layout === 'dungeon'
    || typeLine === 'dungeon'
    || typeLine.startsWith('dungeon ')
    || OFFICIAL_DUNGEON_CARD_NAMES.has(name);
}

export function gameplayCardKind(card: GameCardInstance | null | undefined): GameplayCardKind | null {
  if (isEmblemCard(card)) {
    return 'emblem';
  }

  return isDungeonCard(card) ? 'dungeon' : null;
}

export function isGameplayCard(card: GameCardInstance | null | undefined): boolean {
  return gameplayCardKind(card) !== null;
}

export function isGameplayCardTapLocked(card: GameCardInstance | null | undefined): boolean {
  return isGameplayCard(card);
}
