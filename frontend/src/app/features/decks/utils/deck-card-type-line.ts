import { Card, CardFace } from '../../../core/models/card.model';
import { DeckCard } from '../../../core/models/deck.model';

const TYPE_LINE_ALIAS_REPLACEMENTS: ReadonlyArray<readonly [alias: string, canonical: string]> = [
  ['magica instantanea', 'instant'],
  ['magia instantanea', 'instant'],
  ['tierra basica', 'basic land'],
  ['terrain de base', 'basic land'],
  ['terra base', 'basic land'],
  ['terreno basico', 'basic land'],
  ['standardland', 'basic land'],
  ['artefacto', 'artifact'],
  ['artefact', 'artifact'],
  ['artefakt', 'artifact'],
  ['artefatto', 'artifact'],
  ['artefato', 'artifact'],
  ['batalla', 'battle'],
  ['bataille', 'battle'],
  ['schlacht', 'battle'],
  ['battaglia', 'battle'],
  ['batalha', 'battle'],
  ['criatura', 'creature'],
  ['kreatur', 'creature'],
  ['creatura', 'creature'],
  ['encantamiento', 'enchantment'],
  ['enchantement', 'enchantment'],
  ['verzauberung', 'enchantment'],
  ['incantesimo', 'enchantment'],
  ['encantamento', 'enchantment'],
  ['instantaneo', 'instant'],
  ['instantanea', 'instant'],
  ['ephemere', 'instant'],
  ['spontanzauber', 'instant'],
  ['istantaneo', 'instant'],
  ['conjuro', 'sorcery'],
  ['rituel', 'sorcery'],
  ['hexerei', 'sorcery'],
  ['stregoneria', 'sorcery'],
  ['feitico', 'sorcery'],
  ['tierra', 'land'],
  ['terrain', 'land'],
  ['terra', 'land'],
  ['terreno', 'land'],
  ['legendario', 'legendary'],
  ['legendaire', 'legendary'],
  ['legendare', 'legendary'],
  ['leggendario', 'legendary'],
  ['lendario', 'legendary'],
  ['caminante de planos', 'planeswalker'],
  ['basico', 'basic'],
  ['basique', 'basic'],
  ['nevado', 'snow'],
  ['enneige', 'snow'],
  ['verschneite', 'snow'],
  ['nevosa', 'snow'],
  ['nevado', 'snow'],
  ['llanura', 'plains'],
  ['plaine', 'plains'],
  ['ebene', 'plains'],
  ['pianura', 'plains'],
  ['isla', 'island'],
  ['ile', 'island'],
  ['insel', 'island'],
  ['isola', 'island'],
  ['ilha', 'island'],
  ['pantano', 'swamp'],
  ['marais', 'swamp'],
  ['sumpf', 'swamp'],
  ['palude', 'swamp'],
  ['montana', 'mountain'],
  ['montagne', 'mountain'],
  ['gebirge', 'mountain'],
  ['montagna', 'mountain'],
  ['montanha', 'mountain'],
  ['bosque', 'forest'],
  ['foret', 'forest'],
  ['wald', 'forest'],
  ['foresta', 'forest'],
  ['floresta', 'forest'],
] as const;

const ORDERED_TYPE_LINE_ALIASES = [...TYPE_LINE_ALIAS_REPLACEMENTS]
  .sort(([left], [right]) => right.length - left.length);

export function resolveCardTypeLine(card: Card, preferredFace: CardFace | null = null): string | null {
  return preferredFace?.typeLine
    ?? card.typeLine
    ?? card.cardFaces?.[0]?.typeLine
    ?? null;
}

export function resolvedDeckCardTypeLine(entry: DeckCard): string {
  return normalizedDeckTypeLine(resolveCardTypeLine(entry.card));
}

export function normalizedCardTypeLine(card: Card, preferredFace: CardFace | null = null): string {
  return normalizedDeckTypeLine(resolveCardTypeLine(card, preferredFace));
}

export function normalizedDeckTypeLine(typeLine: string | null | undefined): string {
  let normalized = normalizeDeckTypeText(typeLine ?? '');
  for (const [alias, canonical] of ORDERED_TYPE_LINE_ALIASES) {
    normalized = replaceWholeDeckTypeWord(normalized, alias, canonical);
  }

  return normalized
    .replace(/\s*\/\/\s*/g, ' // ')
    .replace(/\s*(?:-|\u2013|\u2014)\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDeckTypeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function replaceWholeDeckTypeWord(value: string, alias: string, canonical: string): string {
  const pattern = new RegExp(`(^|[^a-z])${escapeRegExp(alias)}(?=$|[^a-z])`, 'g');

  return value.replace(pattern, (_match, prefix: string) => `${prefix}${canonical}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
