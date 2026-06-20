import { GameCardInstance } from '../../../../core/models/game.model';

export type GameplayCardKind = 'monarch' | 'initiative' | 'emblem' | 'dungeon';

const OFFICIAL_DUNGEON_CARD_NAMES = new Set([
  'dungeon of the mad mage',
  'lost mine of phandelver',
  'the undercity',
  'tomb of annihilation',
]);
const THE_RING_SCRYFALL_ID = '7215460e-8c06-47d0-94e5-d1832d0218af';
const THE_RING_CARD_NAMES = new Set([
  'the ring',
  'the ring // the ring tempts you',
]);

export function isTheRingCard(card: Pick<GameCardInstance, 'layout' | 'name' | 'scryfallId'> | null | undefined): boolean {
  const layout = card?.layout?.trim().toLowerCase() ?? '';
  if (layout !== 'double_faced_token') {
    return false;
  }

  const scryfallId = card?.scryfallId?.trim().toLowerCase() ?? '';
  if (scryfallId === THE_RING_SCRYFALL_ID) {
    return true;
  }

  const name = card?.name?.trim().toLowerCase() ?? '';
  return THE_RING_CARD_NAMES.has(name);
}

export function isEmblemCard(card: GameCardInstance | null | undefined): boolean {
  if (isTheRingCard(card)) {
    return false;
  }

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

export function isDayNightCard(card: Pick<GameCardInstance, 'layout' | 'name'> | null | undefined): boolean {
  return card?.name?.trim() === 'Day // Night'
    && card.layout?.trim().toLowerCase() === 'double_faced_token';
}

export function isBattleCard(
  card: Pick<GameCardInstance, 'typeLine' | 'cardFaces' | 'activeFaceIndex'> | null | undefined,
): boolean {
  return activeCardTypeLine(card).startsWith('battle');
}

export function isSagaCard(
  card: Pick<GameCardInstance, 'typeLine' | 'cardFaces' | 'activeFaceIndex'> | null | undefined,
): boolean {
  return activeCardTypeLine(card).includes('saga');
}

export function isMonarchCard(card: Pick<GameCardInstance, 'layout'> | null | undefined): boolean {
  return card?.layout?.trim().toLowerCase() === 'monarch';
}

export function isInitiativeCard(card: Pick<GameCardInstance, 'layout'> | null | undefined): boolean {
  return card?.layout?.trim().toLowerCase() === 'initiative';
}

export function gameplayCardKind(card: GameCardInstance | null | undefined): GameplayCardKind | null {
  if (isMonarchCard(card)) {
    return 'monarch';
  }

  if (isInitiativeCard(card)) {
    return 'initiative';
  }

  if (isEmblemCard(card)) {
    return 'emblem';
  }

  return isDungeonCard(card) ? 'dungeon' : null;
}

export function isGameplayCard(card: GameCardInstance | null | undefined): boolean {
  return gameplayCardKind(card) !== null;
}

export function isGameplayCardTapLocked(card: GameCardInstance | null | undefined): boolean {
  return isGameplayCard(card) || isDayNightCard(card) || isTheRingCard(card);
}

export function isBattlefieldMechanicOverlayCard(card: GameCardInstance | null | undefined): boolean {
  return isDayNightCard(card)
    || isMonarchCard(card)
    || isInitiativeCard(card)
    || isEmblemCard(card);
}

function activeCardTypeLine(card: Pick<GameCardInstance, 'typeLine' | 'cardFaces' | 'activeFaceIndex'> | null | undefined): string {
  const faces = card?.cardFaces ?? [];
  if (faces.length > 0) {
    const requestedIndex = Number.isInteger(card?.activeFaceIndex) ? Number(card?.activeFaceIndex) : 0;
    const activeIndex = Math.max(0, Math.min(faces.length - 1, requestedIndex));
    const faceTypeLine = faces[activeIndex]?.typeLine?.trim().toLowerCase();
    if (faceTypeLine) {
      return faceTypeLine;
    }

    return '';
  }

  return card?.typeLine?.trim().toLowerCase() ?? '';
}
