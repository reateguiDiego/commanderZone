import { Card } from '../../core/models/card.model';

const TOKEN_LAYOUTS = new Set(['token', 'double_faced_token']);
const EMBLEM_LAYOUTS = new Set(['emblem']);
const SCHEME_LAYOUTS = new Set(['scheme']);

export function isTokenCard(card: Pick<Card, 'layout' | 'typeLine'>): boolean {
  const normalizedLayout = card.layout.trim().toLowerCase();
  if (TOKEN_LAYOUTS.has(normalizedLayout)) {
    return true;
  }

  const normalizedTypeLine = (card.typeLine ?? '').trim().toLowerCase();
  return normalizedTypeLine.includes('token');
}

export function isEmblemCard(card: Pick<Card, 'layout' | 'typeLine'>): boolean {
  const normalizedLayout = card.layout.trim().toLowerCase();
  if (EMBLEM_LAYOUTS.has(normalizedLayout)) {
    return true;
  }

  const normalizedTypeLine = (card.typeLine ?? '').trim().toLowerCase();
  return normalizedTypeLine.includes('emblem');
}

export function isSchemeCard(card: Pick<Card, 'layout' | 'typeLine'>): boolean {
  const normalizedLayout = card.layout.trim().toLowerCase();
  if (SCHEME_LAYOUTS.has(normalizedLayout)) {
    return true;
  }

  const normalizedTypeLine = (card.typeLine ?? '').trim().toLowerCase();
  return normalizedTypeLine.includes('scheme');
}
