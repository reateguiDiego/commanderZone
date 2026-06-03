import { GameCardInstance } from '../../../../core/models/game.model';

export type ManaPoolColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
export type ManaSourceSuggestionKind =
  | 'none'
  | 'fixed'
  | 'variable'
  | 'restricted'
  | 'tokenSource'
  | 'modifier'
  | 'grantsAbility';

export interface ManaAddition {
  readonly color: ManaPoolColor;
  readonly amount: number;
}

export type ManaProductionPart =
  | {
    readonly id: string;
    readonly kind: 'fixed';
    readonly label: string;
    readonly additions: readonly ManaAddition[];
  }
  | {
    readonly id: string;
    readonly kind: 'variable';
    readonly label: string;
    readonly amount: number;
    readonly colors: readonly ManaPoolColor[];
  };

export interface ManaAbilityOption {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly additions: readonly ManaAddition[];
  readonly colors: readonly ManaPoolColor[];
  readonly amount: number;
  readonly restriction: string | null;
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
  readonly abilityOptions?: readonly ManaAbilityOption[];
  readonly productionParts?: readonly ManaProductionPart[];
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
const ADD_CLAUSE_PATTERN = /\badd\b([^.\n]*)/gi;

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

  if (oracleText === '' && landColors(typeLine).length === 0) {
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

  const tapAbilityChoices = tapManaAbilityChoices(cardName, oracleText, typeLine, context);
  if (tapAbilityChoices.length > 1) {
    return abilityChoiceSuggestion(cardName, tapAbilityChoices);
  }

  const variable = variableSuggestion(cardName, oracleText, text, restriction);
  if (variable) {
    return variable;
  }

  const choiceColors = explicitChoiceColors(oracleText);
  if (choiceColors.length > 0) {
    return colorChoice(cardName, choiceColors, 1, restriction);
  }

  if (text.includes('any combination') || text.includes('choose a color')) {
    return none(cardName);
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

  const amount = wordAmount(text);
  if (text.includes('any color in your commander')) {
    return colorChoice(cardName, commanderColors(context), amount, restriction);
  }

  if (text.includes('any color') || text.includes('any one color')) {
    return colorChoice(cardName, COLORED_MANA, amount, restriction);
  }

  if (text.includes('any type that a land you control could produce')) {
    return colorChoice(cardName, COLOR_ORDER, amount, restriction);
  }

  const landTypeColors = landColors(typeLine);
  if (landTypeColors.length > 1) {
    return colorChoice(cardName, landTypeColors, 1, null);
  }

  if (landTypeColors.length === 1) {
    const landColor = landTypeColors[0] as ManaPoolColor;

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

export function automaticTapOnlyManaSourceSuggestion(
  card: GameCardInstance,
  context: ManaSourceDetectionContext = {},
): ManaSourceSuggestion {
  const { cardName, oracleText, typeLine } = activeCardText(card);
  const isLand = isLandType(typeLine);
  const isArtifact = isArtifactType(typeLine);
  if (!isLand && !isArtifact) {
    return none(cardName);
  }

  if (oracleText === '') {
    return isLand ? automaticEligibleSuggestion(cardName, detectManaSource(card, context)) : none(cardName);
  }

  if (!isSingleTapOnlyManaAbility(oracleText)) {
    return none(cardName);
  }

  return automaticEligibleSuggestion(cardName, detectManaSource(card, context));
}

function automaticEligibleSuggestion(cardName: string, suggestion: ManaSourceSuggestion): ManaSourceSuggestion {
  if (suggestion.manualOnly || suggestion.restriction !== null) {
    return none(cardName);
  }

  return suggestion.kind === 'fixed' || suggestion.kind === 'variable'
    ? suggestion
    : none(cardName);
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
  kind: Exclude<ManaSourceSuggestionKind, 'none' | 'fixed' | 'variable' | 'restricted'>,
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

function abilityChoiceSuggestion(cardName: string, options: readonly ManaAbilityOption[]): ManaSourceSuggestion {
  return {
    kind: 'variable',
    cardName,
    summary: 'Choose a mana ability.',
    additions: [],
    colors: [],
    amount: 1,
    restriction: null,
    manualOnly: false,
    abilityOptions: options,
  };
}

function tapManaAbilityChoices(
  cardName: string,
  oracleText: string,
  typeLine: string,
  context: ManaSourceDetectionContext,
): readonly ManaAbilityOption[] {
  const abilityTexts = tapActivatedAbilityTexts(oracleText);
  if (abilityTexts.length <= 1) {
    return [];
  }

  return abilityTexts
    .map((abilityText, index) => manaAbilityOption(cardName, abilityText, typeLine, context, index))
    .filter((option): option is ManaAbilityOption => option !== null);
}

function manaAbilityOption(
  cardName: string,
  abilityText: string,
  typeLine: string,
  context: ManaSourceDetectionContext,
  index: number,
): ManaAbilityOption | null {
  const suggestion = detectSingleManaText(cardName, abilityText, typeLine, context);
  if (suggestion.kind === 'none' || suggestion.manualOnly) {
    return null;
  }

  return {
    id: `tap-${index}`,
    label: optionLabel(suggestion),
    summary: suggestion.summary,
    additions: suggestion.additions,
    colors: suggestion.colors,
    amount: Math.max(1, suggestion.amount || 1),
    restriction: suggestion.restriction,
  };
}

function detectSingleManaText(
  cardName: string,
  oracleText: string,
  typeLine: string,
  context: ManaSourceDetectionContext,
): ManaSourceSuggestion {
  const text = normalizeOracle(oracleText);
  const restriction = restrictionText(oracleText);

  const variable = variableSuggestion(cardName, oracleText, text, restriction, { allowChooseColor: true });
  if (variable) {
    return variable;
  }

  const choiceColors = explicitChoiceColors(oracleText);
  if (choiceColors.length > 0) {
    return colorChoice(cardName, choiceColors, 1, restriction);
  }

  if (text.includes('any color in your commander')) {
    return colorChoice(cardName, commanderColors(context), wordAmount(text), restriction);
  }

  if (text.includes('any color') || text.includes('any one color')) {
    return colorChoice(cardName, COLORED_MANA, wordAmount(text), restriction);
  }

  if (text.includes('any type that a land you control could produce')) {
    return colorChoice(cardName, COLOR_ORDER, wordAmount(text), restriction);
  }

  if (text.includes('any combination') || text.includes('choose a color')) {
    return none(cardName);
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

  const landTypeColors = landColors(typeLine);
  if (landTypeColors.length > 1) {
    return colorChoice(cardName, landTypeColors, 1, null);
  }

  if (landTypeColors.length === 1) {
    const landColor = landTypeColors[0] as ManaPoolColor;

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

function tapActivatedAbilityTexts(oracleText: string): readonly string[] {
  const tapAbilityPattern = /(?:\{[^}]+\}\s*,\s*)*\{[^}]*T[^}]*\}\s*:/gi;
  const starts = Array.from(oracleText.matchAll(tapAbilityPattern), (match) => match.index ?? 0);
  if (starts.length <= 1) {
    return [];
  }

  return starts.map((start, index) => {
    const end = starts[index + 1] ?? oracleText.length;
    return oracleText
      .slice(start, end)
      .replace(/(?:\s*\/\s*)+$/g, '')
      .trim();
  }).filter((text) => text.length > 0);
}

function optionLabel(suggestion: ManaSourceSuggestion): string {
  if (suggestion.additions.length > 0) {
    return `Add ${formatAdditions(suggestion.additions)}`;
  }

  if (suggestion.colors.length > 0) {
    return suggestion.amount > 1
      ? `Add ${suggestion.amount} mana from ${suggestion.colors.map((color) => `{${color}}`).join(', ')}`
      : `Add one mana from ${suggestion.colors.map((color) => `{${color}}`).join(', ')}`;
  }

  return suggestion.summary;
}

function colorChoice(
  cardName: string,
  colors: readonly ManaPoolColor[],
  amount: number,
  restriction: string | null,
): ManaSourceSuggestion {
  const cleanColors = orderedUniqueColors(colors);
  if (cleanColors.length === 1 && cleanColors[0]) {
    const additions = [{ color: cleanColors[0], amount }];

    return {
      kind: restriction ? 'restricted' : 'fixed',
      cardName,
      summary: restriction ? `Add ${formatAdditions(additions)} with a restriction.` : `Add ${formatAdditions(additions)}.`,
      additions,
      colors: cleanColors,
      amount: 0,
      restriction,
      manualOnly: false,
    };
  }

  return {
    kind: restriction ? 'restricted' : 'variable',
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
  restriction: string | null,
  options: { readonly allowChooseColor?: boolean } = {},
): ManaSourceSuggestion | null {
  if (!hasVariableAmount(text)) {
    return null;
  }

  if (options.allowChooseColor && text.includes('choose a color')) {
    return {
      kind: restriction ? 'restricted' : 'variable',
      cardName,
      summary: 'Choose a color and mana amount after checking the board state.',
      additions: [],
      colors: COLORED_MANA,
      amount: 1,
      restriction,
      manualOnly: false,
    };
  }

  if (
    text.includes('any color')
    || text.includes('any one color')
    || text.includes('any combination')
    || text.includes('choose a color')
    || text.includes('commander')
    || explicitChoiceColors(oracleText).length > 0
  ) {
    return null;
  }

  const directColors = directSymbols(oracleText);
  const colors = directColors.length === 1 ? directColors : [];
  if (colors.length === 0) {
    return null;
  }

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

  for (const match of oracleText.matchAll(ADD_CLAUSE_PATTERN)) {
    const addClause = match[1] ?? '';
    if (!hasManaChoiceSeparator(addClause)) {
      continue;
    }

    for (const symbol of addClause.matchAll(MANA_SYMBOL_PATTERN)) {
      const color = symbol[1]?.toUpperCase() as ManaPoolColor | undefined;
      if (isManaColor(color)) {
        colors.push(color);
      }
    }
  }

  return orderedUniqueColors(colors);
}

function hasManaChoiceSeparator(addClause: string): boolean {
  return /(?:\{[WUBRGC]\}\s*,|\bor\s+\{[WUBRGC]\})/i.test(addClause);
}

function restrictionText(oracleText: string): string | null {
  const match = oracleText.match(/(Spend this mana only[^.]*\.?|Activate only[^.]*\.?)/i);
  return match?.[1]?.trim() || null;
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

function isSingleTapOnlyManaAbility(oracleText: string): boolean {
  const normalized = stripWrappingParentheses(oracleText.trim().replace(/\s+/g, ' '));
  const tapActivationCount = normalized.match(/\{[^}]*T[^}]*\}\s*:/gi)?.length ?? 0;
  const sentences = normalized
    .split(/(?<=\.)\s+/)
    .map((sentence) => stripWrappingParentheses(sentence.trim()))
    .filter((sentence) => sentence.length > 0);
  const activatedAbilityIndex = sentences.findIndex((sentence) => /\{[^}]*T[^}]*\}\s*:/i.test(sentence));
  const activatedAbility = activatedAbilityIndex >= 0 ? sentences[activatedAbilityIndex] : '';

  return tapActivationCount === 1
    && activatedAbilityIndex === sentences.length - 1
    && /^\{T\}: Add .+\.$/i.test(activatedAbility);
}

function stripWrappingParentheses(value: string): string {
  return value.startsWith('(') && value.endsWith(')') ? value.slice(1, -1).trim() : value;
}

function isLandType(typeLine: string): boolean {
  return /\bland\b/i.test(typeLine);
}

function isArtifactType(typeLine: string): boolean {
  return /\bartifact\b/i.test(typeLine);
}

function landColors(typeLine: string): readonly ManaPoolColor[] {
  const lowerType = typeLine.toLowerCase();
  const colors: ManaPoolColor[] = [];

  if (lowerType.includes('plains')) {
    colors.push('W');
  }
  if (lowerType.includes('island')) {
    colors.push('U');
  }
  if (lowerType.includes('swamp')) {
    colors.push('B');
  }
  if (lowerType.includes('mountain')) {
    colors.push('R');
  }
  if (lowerType.includes('forest')) {
    colors.push('G');
  }
  if (lowerType.includes('wastes')) {
    colors.push('C');
  }

  return orderedUniqueColors(colors);
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
