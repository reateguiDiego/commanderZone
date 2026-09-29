const HOMOGLYPH_REPLACEMENTS: Readonly<Record<string, string>> = {
  'а': 'a',
  'е': 'e',
  'і': 'i',
  'о': 'o',
  'р': 'p',
  'с': 'c',
  'х': 'x',
  'у': 'y',
  'ѕ': 's',
  'ս': 'u',
};

const HOMOGLYPH_PATTERN = /[аеіорсхуѕս]/gu;
const COMBINING_MARKS_AND_FORMAT_CONTROLS_PATTERN = /[\u00AD\u0300-\u036f\u180E\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\u3099-\u309A\uFEFF]/gu;

export function normalizeContentSafetyText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS_AND_FORMAT_CONTROLS_PATTERN, '')
    .replace(HOMOGLYPH_PATTERN, (character) => HOMOGLYPH_REPLACEMENTS[character] ?? character)
    .replace(/[@4]/gu, 'a')
    .replace(/3/gu, 'e')
    .replace(/[1!|]/gu, 'i')
    .replace(/0/gu, 'o')
    .replace(/[$5]/gu, 's')
    .replace(/[7+]/gu, 't')
    .replace(/(.)\1{2,}/gu, '$1');
}
