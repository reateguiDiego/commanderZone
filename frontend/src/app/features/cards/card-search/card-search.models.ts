import { CardSearchFilters } from '../../../core/api/cards.api';

export type CardSearchViewMode = 'list' | 'spoiler';
export type CardColor = 'W' | 'U' | 'B' | 'R' | 'G';
export type CardRarity = 'mythic' | 'rare' | 'uncommon' | 'common';
export type TextMatchMode = 'and' | 'or';
export type ColorMatchMode = 'all' | 'any' | 'exact';
export type CardSearchSort =
  | 'name_asc'
  | 'name_desc'
  | 'mana_value_asc'
  | 'mana_value_desc';
export type CardSearchFilterKey =
  | 'name'
  | 'text'
  | 'types'
  | 'subtypes'
  | 'sets'
  | 'rarities'
  | 'colors'
  | 'costs'
  | 'stats'
  | 'formats';

export type CardSearchEnabledFilters = Record<CardSearchFilterKey, boolean>;

export interface CardAdvancedSearchFormValue {
  enabledFilters: CardSearchEnabledFilters;
  query: string;
  oracleTextA: string;
  oracleTextB: string;
  oracleTextMode: TextMatchMode;
  types: string[];
  subtypes: string[];
  sets: string[];
  rarities: CardRarity[];
  colors: CardColor[];
  colorMatchMode: ColorMatchMode;
  artifact: boolean;
  multicolor: boolean;
  land: boolean;
  basic: boolean;
  legendary: boolean;
  manaValueMin: number | null;
  manaValueMax: number | null;
  manaCost: string;
  powerMin: number | null;
  powerMax: number | null;
  toughnessMin: number | null;
  toughnessMax: number | null;
  includeVariablePower: boolean;
  includeVariableToughness: boolean;
  formats: string[];
  viewMode: CardSearchViewMode;
  sort: CardSearchSort;
}

export interface CardAdvancedSearchSubmit {
  query: string;
  filters: CardSearchFilters;
  viewMode: CardSearchViewMode;
}

export interface CardSearchChoice {
  code: string;
  name: string;
}

export const CARD_COLOR_CHOICES: readonly CardSearchChoice[] = [
  { code: 'W', name: 'White' },
  { code: 'U', name: 'Blue' },
  { code: 'B', name: 'Black' },
  { code: 'R', name: 'Red' },
  { code: 'G', name: 'Green' },
];

export const CARD_MANA_COST_SYMBOLS: readonly string[] = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'X',
  'W',
  'U',
  'B',
  'R',
  'G',
  'C',
  'W/U',
  'U/B',
  'B/R',
  'R/G',
  'G/W',
  'W/B',
  'U/R',
  'B/G',
  'R/W',
  'G/U',
];

export const DEFAULT_CARD_SEARCH_ENABLED_FILTERS: CardSearchEnabledFilters = {
  name: false,
  text: false,
  types: false,
  subtypes: false,
  sets: false,
  rarities: false,
  colors: false,
  costs: false,
  stats: false,
  formats: false,
};

export const DEFAULT_CARD_SEARCH_FORM_VALUE: CardAdvancedSearchFormValue = {
  enabledFilters: DEFAULT_CARD_SEARCH_ENABLED_FILTERS,
  query: '',
  oracleTextA: '',
  oracleTextB: '',
  oracleTextMode: 'and',
  types: [],
  subtypes: [],
  sets: [],
  rarities: [],
  colors: [],
  colorMatchMode: 'any',
  artifact: false,
  multicolor: false,
  land: false,
  basic: false,
  legendary: false,
  manaValueMin: null,
  manaValueMax: null,
  manaCost: '',
  powerMin: null,
  powerMax: null,
  toughnessMin: null,
  toughnessMax: null,
  includeVariablePower: true,
  includeVariableToughness: true,
  formats: [],
  viewMode: 'list',
  sort: 'name_asc',
};

export function createDefaultCardSearchFormValue(): CardAdvancedSearchFormValue {
  return {
    ...DEFAULT_CARD_SEARCH_FORM_VALUE,
    enabledFilters: { ...DEFAULT_CARD_SEARCH_ENABLED_FILTERS },
    types: [],
    subtypes: [],
    sets: [],
    rarities: [],
    colors: [],
    formats: [],
  };
}
