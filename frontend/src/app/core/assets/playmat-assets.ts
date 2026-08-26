export const PLAYMAT_BASE_PATH = '/assets/images/playmat/';
export const DEFAULT_PLAYMAT_NAME = 'free_0';

const COMBINATION_PLAYMAT_NAMES = [
  'azorius_1', 'dimir_1', 'rakdos_1', 'gruul_1', 'selesnya_1', 'orzhov_1', 'izzet_1', 'golgari_1', 'boros_1', 'simic_1',
  'bant_1', 'esper_1', 'grixis_1', 'jund_1', 'naya_1', 'abzan_1', 'jeskai_1', 'sultai_1', 'mardu_1', 'temur_1',
  'dune_1', 'glint_1', 'ink_1', 'witch_1', 'yore_1', 'yore_2', 'penta_1', 'penta_2',
] as const;

export const PLAYMAT_NAMES: readonly string[] = [
  DEFAULT_PLAYMAT_NAME,
  ...numberedPlaymatNames('free', 5),
  ...['w', 'u', 'b', 'r', 'g', 'n'].flatMap((color) => numberedPlaymatNames(`free_${color}`, 3)),
  ...['w', 'u', 'b', 'r', 'g'].flatMap((color) => numberedPlaymatNames(color, 10)),
  ...numberedPlaymatNames('n', 11),
  ...numberedPlaymatNames('o', 11),
  ...COMBINATION_PLAYMAT_NAMES,
];

const PLAYMAT_NAME_SET = new Set(PLAYMAT_NAMES);

export function isSupportedPlaymatName(name: string): boolean {
  return PLAYMAT_NAME_SET.has(name);
}

export function playmatImageUrl(name: string): string {
  return `${PLAYMAT_BASE_PATH}${name}.webp`;
}

function numberedPlaymatNames(prefix: string, maximum: number): readonly string[] {
  return Array.from({ length: maximum }, (_, index) => `${prefix}_${index + 1}`);
}
