import { GameCardInstance } from '../../../../core/models/game.model';

export type ManaPoolColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
export type ManaSourceSuggestionKind =
  | 'none'
  | 'fixed'
  | 'choice'
  | 'variable'
  | 'restricted'
  | 'tokenSource'
  | 'modifier'
  | 'grantsAbility';

export interface ManaAddition {
  readonly color: ManaPoolColor;
  readonly amount: number;
}

export interface ManaSourceSuggestion {
  readonly kind: ManaSourceSuggestionKind;
  readonly cardName: string;
  readonly summary: string;
  readonly additions: readonly ManaAddition[];
  readonly colors: readonly ManaPoolColor[];
  readonly amount: number;
  readonly restriction: string | null;
  readonly manualOnly: boolean;
}

export interface ManaSourceDetectionContext {
  readonly colorIdentity?: readonly string[] | null;
}

interface ManaSourceCardText {
  readonly cardName: string;
  readonly oracleText: string;
  readonly typeLine: string;
}

const COLOR_ORDER: readonly ManaPoolColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];
const COLORED_MANA: readonly ManaPoolColor[] = ['W', 'U', 'B', 'R', 'G'];
const MANA_SYMBOL_PATTERN = /\{([WUBRGC])\}/gi;
const DIRECT_ADD_PATTERN = /\badd\s+((?:\{[WUBRGC]\})+)/gi;
const ADD_OR_PATTERN = /\badd\s+\{([WUBRGC])\}(?:(?:,|\s+or)\s+\{([WUBRGC])\})+/gi;

const DEFAULT_NONE: Omit<ManaSourceSuggestion, 'cardName'> = {
  kind: 'none',
  summary: '',
  additions: [],
  colors: [],
  amount: 0,
  restriction: null,
  manualOnly: true,
};

export function detectManaSource(
  card: GameCardInstance,
  context: ManaSourceDetectionContext = {},
): ManaSourceSuggestion {
  const { cardName, oracleText, typeLine } = activeCardText(card);

  if (oracleText === '' && !basicLandColor(typeLine)) {
    return none(cardName);
  }

  const text = normalizeOracle(oracleText);
  const restriction = restrictionText(oracleText);

  if (isModifier(text, typeLine)) {
    return manualOnly(cardName, 'modifier', 'This card changes how other mana sources work.', restriction);
  }

  if (isAbilityGrant(text)) {
    return manualOnly(cardName, 'grantsAbility', 'This card gives another permanent a mana ability.', restriction);
  }

  if (isTokenSource(text)) {
    return manualOnly(cardName, 'tokenSource', 'This card creates mana-producing tokens. Use the pool manually after resolving it.', restriction);
  }

  const variable = variableSuggestion(cardName, oracleText, text, context, restriction);
  if (variable) {
    return variable;
  }

  const directAdditions = directSymbolAdditions(oracleText);
  if (directAdditions.length > 0) {
    return {
      kind: restriction ? 'restricted' : 'fixed',
      cardName,
      summary: restriction ? `Add ${formatAdditions(directAdditions)} with a restriction.` : `Add ${formatAdditions(directAdditions)}.`,
      additions: directAdditions,
      colors: directAdditions.map((addition) => addition.color),
      amount: 0,
      restriction,
      manualOnly: false,
    };
  }

  const choiceColors = explicitChoiceColors(oracleText);
  if (choiceColors.length > 0) {
    return choice(cardName, choiceColors, 1, restriction);
  }

  const amount = wordAmount(text);
  if (text.includes('any color in your commander')) {
    return choice(cardName, commanderColors(context), amount, restriction);
  }

  if (text.includes('any color') || text.includes('any one color')) {
    return choice(cardName, COLORED_MANA, amount, restriction);
  }

  if (text.includes('any type that a land you control could produce')) {
    return choice(cardName, COLOR_ORDER, amount, restriction);
  }

  const landColor = basicLandColor(typeLine);
  if (landColor) {
    return {
      kind: 'fixed',
      cardName,
      summary: `Add {${landColor}}.`,
      additions: [{ color: landColor, amount: 1 }],
      colors: [landColor],
      amount: 0,
      restriction: null,
      manualOnly: false,
    };
  }

  return none(cardName);
}

function activeCardText(card: GameCardInstance): ManaSourceCardText {
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

function none(cardName: string): ManaSourceSuggestion {
  return { cardName, ...DEFAULT_NONE };
}

function manualOnly(
  cardName: string,
  kind: Exclude<ManaSourceSuggestionKind, 'none' | 'fixed' | 'choice' | 'variable' | 'restricted'>,
  summary: string,
  restriction: string | null,
): ManaSourceSuggestion {
  return {
    kind,
    cardName,
    summary,
    additions: [],
    colors: [],
    amount: 0,
    restriction,
    manualOnly: true,
  };
}

function choice(
  cardName: string,
  colors: readonly ManaPoolColor[],
  amount: number,
  restriction: string | null,
): ManaSourceSuggestion {
  const cleanColors = orderedUniqueColors(colors);

  return {
    kind: restriction ? 'restricted' : 'choice',
    cardName,
    summary: `Choose ${amount === 1 ? 'one mana' : `${amount} mana`} from ${cleanColors.map((color) => `{${color}}`).join(', ')}.`,
    additions: [],
    colors: cleanColors,
    amount,
    restriction,
    manualOnly: false,
  };
}

function variableSuggestion(
  cardName: string,
  oracleText: string,
  text: string,
  context: ManaSourceDetectionContext,
  restriction: string | null,
): ManaSourceSuggestion | null {
  if (!hasVariableAmount(text)) {
    return null;
  }

  const explicitColors = explicitChoiceColors(oracleText);
  const directColors = directSymbols(oracleText);
  const colors = explicitColors.length > 0
    ? explicitColors
    : directColors.length > 0
      ? directColors
      : text.includes('commander')
        ? commanderColors(context)
        : text.includes('any color') || text.includes('any combination')
          ? COLORED_MANA
          : COLOR_ORDER;

  return {
    kind: 'variable',
    cardName,
    summary: 'Variable mana amount. Choose the color and quantity after checking the board state.',
    additions: [],
    colors: orderedUniqueColors(colors),
    amount: 1,
    restriction,
    manualOnly: false,
  };
}

function normalizeOracle(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ');
}

function isModifier(text: string, typeLine: string): boolean {
  return text.includes('lands you control have "{t}: add')
    || text.includes('each land is a swamp')
    || text.includes('each land is a forest')
    || text.includes('whenever a player taps an island for mana')
    || text.includes('adds an additional')
    || text.includes('add an additional')
    || (typeLine.toLowerCase().includes('enchantment') && text.includes('whenever enchanted land is tapped for mana'));
}

function isAbilityGrant(text: string): boolean {
  return text.includes('equipped creature has "{t}: add')
    || text.includes('enchanted creature has "{t}: add')
    || text.includes('creatures you control have "{t}: add')
    || text.includes('foods you control have "{t}')
    || text.includes('lands you control have "{t}: add two');
}

function isTokenSource(text: string): boolean {
  return text.includes('treasure token')
    || text.includes('gold token')
    || text.includes('powerstone token')
    || text.includes('eldrazi spawn')
    || text.includes('eldrazi scion');
}

function hasVariableAmount(text: string): boolean {
  return /\bfor each\b/.test(text)
    || /\bequal to\b/.test(text)
    || /\badd x\b/.test(text)
    || /\bwhere x is\b/.test(text)
    || /\bdevotion\b/.test(text)
    || /\bthat much mana\b/.test(text)
    || /\bany combination\b/.test(text)
    || /\bfor every\b/.test(text);
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

function directSymbols(oracleText: string): readonly ManaPoolColor[] {
  return orderedUniqueColors(Array.from(oracleText.matchAll(MANA_SYMBOL_PATTERN), (match) => match[1]?.toUpperCase() as ManaPoolColor));
}

function explicitChoiceColors(oracleText: string): readonly ManaPoolColor[] {
  const colors: ManaPoolColor[] = [];
  for (const match of oracleText.matchAll(ADD_OR_PATTERN)) {
    for (const value of match.slice(1)) {
      const color = value?.toUpperCase() as ManaPoolColor | undefined;
      if (isManaColor(color)) {
        colors.push(color);
      }
    }
  }

  return orderedUniqueColors(colors);
}

function wordAmount(text: string): number {
  if (/\bthree mana\b/.test(text)) {
    return 3;
  }
  if (/\btwo mana\b/.test(text)) {
    return 2;
  }

  return 1;
}

function restrictionText(oracleText: string): string | null {
  const match = oracleText.match(/(Spend this mana only[^.]*\.?|Activate only[^.]*\.?)/i);
  return match?.[1]?.trim() || null;
}

function basicLandColor(typeLine: string): ManaPoolColor | null {
  const lowerType = typeLine.toLowerCase();
  if (lowerType.includes('plains')) {
    return 'W';
  }
  if (lowerType.includes('island')) {
    return 'U';
  }
  if (lowerType.includes('swamp')) {
    return 'B';
  }
  if (lowerType.includes('mountain')) {
    return 'R';
  }
  if (lowerType.includes('forest')) {
    return 'G';
  }
  if (lowerType.includes('wastes')) {
    return 'C';
  }

  return null;
}

function commanderColors(context: ManaSourceDetectionContext): readonly ManaPoolColor[] {
  const colors = orderedUniqueColors((context.colorIdentity ?? []).map((color) => color.toUpperCase() as ManaPoolColor));
  return colors.length > 0 ? colors : COLORED_MANA;
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

function formatAdditions(additions: readonly ManaAddition[]): string {
  return additions.flatMap((addition) => Array.from({ length: addition.amount }, () => `{${addition.color}}`)).join('');
}
