import { CardPreviewItem } from '../../core/models/card-preview.model';
import { CardFaceImageSource } from './card-faces';

const CARD_TYPE_ICON_NAMES = new Set([
  'artifact',
  'battle',
  'creature',
  'enchantment',
  'instant',
  'land',
  'planeswalker',
  'sorcery',
  'multiple',
]);

export function resolveCardPreviewTypeIcon(item: Pick<CardPreviewItem, 'cardType' | 'cardTypeIcon'>): string | null {
  const normalizedPrimaryType = normalizeText(primaryCardPreviewTypeLabel(item));
  const derivedIcon = firstTypeIconToken(normalizedPrimaryType);
  if (derivedIcon) {
    return derivedIcon;
  }

  const explicitIcon = normalizeToken(item.cardTypeIcon);
  if (explicitIcon && CARD_TYPE_ICON_NAMES.has(explicitIcon)) {
    return explicitIcon;
  }

  const normalizedType = normalizeText(item.cardType);
  if (normalizedType === '') {
    return null;
  }

  for (const icon of ['battle', 'creature', 'artifact', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery'] as const) {
    if (normalizedType.includes(icon)) {
      return icon;
    }
  }

  return 'multiple';
}

export function sortCardPreviewItemsByTimesPlayed<T extends CardPreviewItem>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => (
    (right.timesPlayed ?? Number.MIN_SAFE_INTEGER) - (left.timesPlayed ?? Number.MIN_SAFE_INTEGER)
    || (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER)
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id)
  ));
}

export function primaryCardPreviewTypeLabel(item: Pick<CardPreviewItem, 'cardType'>): string | null {
  const typeLine = item.cardType?.trim() ?? '';
  if (typeLine === '') {
    return null;
  }

  return typeLine.split('-')[0]?.trim() || typeLine;
}

export function cardPreviewFaceSource(item: CardPreviewItem): CardFaceImageSource {
  return {
    name: item.name,
    imageUris: item.imageUris ?? {},
    cardFaces: item.cardFaces ? [...item.cardFaces] : [],
  };
}

export function isBattleCardPreview(item: Pick<CardPreviewItem, 'cardType' | 'cardTypeIcon'>): boolean {
  return resolveCardPreviewTypeIcon(item) === 'battle';
}

function normalizeToken(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function firstTypeIconToken(normalizedType: string): string | null {
  if (normalizedType === '') {
    return null;
  }

  for (const token of normalizedType.split(/[\s/]+/)) {
    if (CARD_TYPE_ICON_NAMES.has(token) && token !== 'multiple') {
      return token;
    }
  }

  return null;
}
