import { GameCardInstance } from '../../../../core/models/game.model';
import {
  automaticTapOnlyManaSourceSuggestion,
  detectManaSource,
  ManaAddition,
  ManaPoolColor,
  ManaProductionPart,
  ManaSourceDetectionContext,
  ManaSourceSuggestion,
} from './mana-source-detector';

interface ActiveCardText {
  readonly cardName: string;
  readonly oracleText: string;
  readonly typeLine: string;
}

interface AttachedManaEffect {
  readonly part: ManaProductionPart;
}

const COLOR_ORDER: readonly ManaPoolColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];
const MANA_SYMBOL_PATTERN = /\{([WUBRGC])\}/gi;
const DIRECT_ADD_PATTERN = /\badd(?:s)?(?:\s+an?\s+additional)?\s+((?:\{[WUBRGC]\})+)/gi;

export function detectManaSourceWithAttachments(
  card: GameCardInstance,
  attachedCards: readonly GameCardInstance[],
  context: ManaSourceDetectionContext = {},
): ManaSourceSuggestion {
  return mergeAttachedManaSourceSuggestion(card, detectManaSource(card, context), attachedCards);
}

export function automaticTapOnlyManaSourceSuggestionWithAttachments(
  card: GameCardInstance,
  attachedCards: readonly GameCardInstance[],
  context: ManaSourceDetectionContext = {},
): ManaSourceSuggestion {
  const automaticBase = automaticTapOnlyManaSourceSuggestion(card, context);
  if (attachedCards.length === 0) {
    return automaticBase;
  }

  const fallbackBase = automaticBase.kind === 'none' ? detectManaSource(card, context) : automaticBase;
  const merged = mergeAttachedManaSourceSuggestion(card, fallbackBase, attachedCards);

  return merged === fallbackBase ? automaticBase : merged;
}

export function mergeAttachedManaSourceSuggestion(
  card: GameCardInstance,
  baseSuggestion: ManaSourceSuggestion,
  attachedCards: readonly GameCardInstance[],
): ManaSourceSuggestion {
  if (attachedCards.length === 0 || !isLandPermanent(card)) {
    return baseSuggestion;
  }

  const baseColors = suggestionColors(baseSuggestion);
  const baseParts = productionPartsFromSuggestion(baseSuggestion);
  const effects = attachedCards
    .map((attachedCard) => detectAttachedManaEffect(attachedCard))
    .filter((effect): effect is AttachedManaEffect => effect !== null);

  if (effects.length === 0) {
    return baseSuggestion;
  }

  const colors = orderedUniqueColors([
    ...baseColors,
    ...baseParts.flatMap(productionPartColors),
    ...effects.flatMap((effect) => productionPartColors(effect.part)),
  ]);
  const safeColors = colors.length > 0 ? colors : COLOR_ORDER;
  const productionParts = orderProductionParts([
    ...baseParts,
    ...effects.map((effect) => effect.part),
  ]);

  return {
    kind: 'variable',
    cardName: baseSuggestion.cardName,
    summary: safeColors.length === 1
      ? `Add {${safeColors[0]}}`
      : 'Add mana from attached sources.',
    additions: [],
    colors: safeColors,
    amount: 1,
    restriction: baseSuggestion.restriction,
    manualOnly: false,
    productionParts,
  };
}

function detectAttachedManaEffect(card: GameCardInstance): AttachedManaEffect | null {
  const { cardName, oracleText, typeLine } = activeCardText(card);
  if (!oracleText) {
    return null;
  }

  const text = normalizeOracle(oracleText);
  if (!isRelevantAttachedManaText(text, typeLine)) {
    return null;
  }

  const part = attachedManaPart(card.instanceId, cardName, oracleText, text);
  return part ? { part } : null;
}

function activeCardText(card: GameCardInstance): ActiveCardText {
  if (card.faceDown || card.hidden) {
    return {
      cardName: card.name,
      oracleText: '',
      typeLine: '',
    };
  }

  const faces = card.cardFaces ?? [];
  if (faces.length === 0) {
    return {
      cardName: card.name,
      oracleText: card.oracleText?.trim() ?? '',
      typeLine: card.typeLine?.trim() ?? '',
    };
  }

  const requestedIndex = Number.isInteger(card.activeFaceIndex) ? Number(card.activeFaceIndex) : 0;
  const activeIndex = Math.max(0, Math.min(faces.length - 1, requestedIndex));
  const activeFace = faces[activeIndex];

  return {
    cardName: activeFace?.name?.trim() || card.name,
    oracleText: activeFace?.oracleText?.trim() ?? '',
    typeLine: activeFace?.typeLine?.trim() ?? '',
  };
}

function isRelevantAttachedManaText(text: string, typeLine: string): boolean {
  const lowerTypeLine = typeLine.toLowerCase();
  const looksAttached = lowerTypeLine.includes('aura')
    || lowerTypeLine.includes('fortification')
    || text.includes('enchanted land')
    || text.includes('enchanted forest')
    || text.includes('enchanted permanent')
    || text.includes('fortified land');

  return looksAttached
    && (
      /whenever enchanted (?:land|forest|permanent) is tapped for mana/.test(text)
      || /enchanted (?:land|forest|permanent) has "\{t\}: add/.test(text)
      || /fortified land has "\{t\}: add/.test(text)
    );
}

function attachedManaPart(
  id: string,
  label: string,
  oracleText: string,
  text: string,
): ManaProductionPart | null {
  const fixedAdditions = directSymbolAdditions(oracleText);
  if (fixedAdditions.length > 0 && !text.includes('chosen color')) {
    return {
      id: `attachment-${id}`,
      kind: 'fixed',
      label,
      additions: fixedAdditions,
    };
  }

  if (
    text.includes('any color')
    || text.includes('any one color')
    || text.includes('chosen color')
  ) {
    return null;
  }

  if (text.includes('any combination of colors')) {
    return null;
  }

  if (text.includes('any type that') || text.includes('a type that')) {
    return null;
  }

  return null;
}

function productionPartsFromSuggestion(suggestion: ManaSourceSuggestion): readonly ManaProductionPart[] {
  if (suggestion.additions.length > 0) {
    return [{
      id: 'base',
      kind: 'fixed',
      label: suggestion.cardName,
      additions: suggestion.additions,
    }];
  }

  if (suggestion.colors.length === 0) {
    return [];
  }

  if (suggestion.kind === 'variable') {
    return [{
      id: 'base',
      kind: 'variable',
      label: suggestion.cardName,
      amount: Math.max(1, suggestion.amount),
      colors: suggestion.colors,
    }];
  }

  return [];
}

function productionPartColors(part: ManaProductionPart): readonly ManaPoolColor[] {
  return part.kind === 'fixed'
    ? part.additions.map((addition) => addition.color)
    : part.colors;
}

function orderProductionParts(parts: readonly ManaProductionPart[]): readonly ManaProductionPart[] {
  return [...parts].sort((left, right) => productionPartOrder(left) - productionPartOrder(right));
}

function productionPartOrder(part: ManaProductionPart): number {
  return part.kind === 'fixed' ? 0 : 1;
}

function directSymbolAdditions(oracleText: string): readonly ManaAddition[] {
  const groups = Array.from(oracleText.matchAll(DIRECT_ADD_PATTERN), (match) => additionsFromSymbols(match[1] ?? ''));
  if (groups.length === 0) {
    return [];
  }

  return groups.sort((left, right) => totalAmount(right) - totalAmount(left))[0] ?? [];
}

function additionsFromSymbols(value: string): readonly ManaAddition[] {
  const counts = new Map<ManaPoolColor, number>();
  for (const symbol of value.matchAll(MANA_SYMBOL_PATTERN)) {
    const color = symbol[1]?.toUpperCase() as ManaPoolColor | undefined;
    if (isManaColor(color)) {
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }

  return COLOR_ORDER
    .map((color) => ({ color, amount: counts.get(color) ?? 0 }))
    .filter((addition) => addition.amount > 0);
}

function suggestionColors(suggestion: ManaSourceSuggestion): readonly ManaPoolColor[] {
  return orderedUniqueColors([
    ...suggestion.colors,
    ...suggestion.additions.map((addition) => addition.color),
  ]);
}

function isLandPermanent(card: GameCardInstance): boolean {
  return /\bland\b/i.test(activeCardText(card).typeLine || card.typeLine || '');
}

function normalizeOracle(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ');
}

function orderedUniqueColors(colors: readonly ManaPoolColor[]): readonly ManaPoolColor[] {
  const set = new Set(colors.filter(isManaColor));
  return COLOR_ORDER.filter((color) => set.has(color));
}

function isManaColor(value: string | undefined): value is ManaPoolColor {
  return value === 'W' || value === 'U' || value === 'B' || value === 'R' || value === 'G' || value === 'C';
}

function totalAmount(additions: readonly ManaAddition[]): number {
  return additions.reduce((total, addition) => total + addition.amount, 0);
}
