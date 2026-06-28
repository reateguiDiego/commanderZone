import { Card } from '../../core/models/card.model';

export interface CardLegalityPill {
  readonly format: string;
  readonly label: string;
  readonly status: string;
}

export function isBattleCard(card: Card | null | undefined): boolean {
  return cardTypeLine(card).startsWith('battle');
}

export function cardRulesText(card: Card | null | undefined): string {
  if (!card) {
    return '';
  }

  const rootText = card.oracleText?.trim();
  if (rootText) {
    return rootText;
  }

  return (card.cardFaces ?? [])
    .map((face) => face.oracleText?.trim() ?? '')
    .filter(Boolean)
    .join('\n//\n');
}

export function cardLegalityPills(card: Card | null | undefined, legal: boolean): CardLegalityPill[] {
  if (!card) {
    return [];
  }

  return Object.entries(card.legalities ?? {})
    .filter(([, status]) => legal ? status === 'legal' : status !== 'legal')
    .map(([format, status]) => ({
      format,
      label: formatLabel(format),
      status,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function cardTypeLine(card: Card | null | undefined): string {
  const faceTypeLine = card?.cardFaces?.[0]?.typeLine?.trim().toLowerCase();
  if (faceTypeLine) {
    return faceTypeLine;
  }

  return card?.typeLine?.trim().toLowerCase() ?? '';
}

export function formatLabel(format: string): string {
  return format
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}
