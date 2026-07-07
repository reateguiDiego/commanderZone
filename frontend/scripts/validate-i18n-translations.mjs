import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDir, '..');
const i18nRoot = join(frontendRoot, 'src', 'assets', 'i18n');
const localeConfigPath = join(frontendRoot, 'src', 'app', 'core', 'localization', 'locale-config.ts');

const errors = [];

function fail(message) {
  errors.push(message);
}

function normalizePath(path) {
  return relative(frontendRoot, path).replaceAll('\\', '/');
}

function readUtf8(path) {
  const raw = readFileSync(path, 'utf8');

  if (raw.charCodeAt(0) === 0xfeff) {
    fail(`${normalizePath(path)} starts with a BOM. Save it as plain UTF-8 without BOM.`);
  }

  return raw;
}

function readJson(path) {
  const raw = readUtf8(path);

  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`${normalizePath(path)} is not valid JSON: ${error.message}`);
    return {};
  }
}

function readLocaleConfig() {
  if (!existsSync(localeConfigPath)) {
    return { configuredLocales: [], baseLocale: undefined };
  }

  const localeConfig = readUtf8(localeConfigPath);
  const supportedLocalesMatch = localeConfig.match(/SUPPORTED_LOCALES\s*=\s*\[([\s\S]*?)\]\s*as const/);
  const configuredLocales = supportedLocalesMatch
    ? [...supportedLocalesMatch[1].matchAll(/code:\s*'([^']+)'/g)].map((match) => match[1])
    : [];
  const defaultIndexMatch = localeConfig.match(/DEFAULT_LOCALE\s*=\s*SUPPORTED_LOCALES\[(\d+)\]/);
  const defaultLiteralMatch = localeConfig.match(/DEFAULT_LOCALE(?:_CODE)?\s*=\s*['"]([^'"]+)['"]/);
  const baseLocale = defaultLiteralMatch?.[1]
    ?? (defaultIndexMatch ? configuredLocales[Number(defaultIndexMatch[1])] : undefined)
    ?? configuredLocales[0];

  return { configuredLocales, baseLocale };
}

function listLocaleFiles() {
  if (!existsSync(i18nRoot) || !statSync(i18nRoot).isDirectory()) {
    fail(`Missing i18n directory: ${normalizePath(i18nRoot)}`);
    return [];
  }

  return readdirSync(i18nRoot)
    .filter((file) => extname(file) === '.json')
    .sort();
}

function flattenValues(value, prefix = '', out = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value);

    for (const [key, child] of entries) {
      flattenValues(child, prefix ? `${prefix}.${key}` : key, out);
    }

    return out;
  }

  out[prefix] = value;
  return out;
}

function valueType(value) {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  return typeof value;
}

function extractPlaceholders(value) {
  if (typeof value !== 'string') {
    return [];
  }

  const placeholders = new Set();
  const patterns = [
    ['double', /\{\{\s*([A-Za-z_$][\w$]*)\s*\}\}/g],
    ['percent', /%\{\s*([A-Za-z_$][\w$]*)\s*\}/g],
    ['single', /(?<!\{)\{\s*([A-Za-z_$][\w$]*)\s*\}(?!\})/g],
  ];

  for (const [kind, pattern] of patterns) {
    for (const match of value.matchAll(pattern)) {
      placeholders.add(`${kind}:${match[1]}`);
    }
  }

  return [...placeholders].sort();
}

function hasSuspiciousReplacementQuestionMark(value) {
  return /\p{L}\?\p{L}/u.test(value);
}

function validateTranslationValue(locale, key, value) {
  const location = `${locale}.json:${key}`;
  const type = valueType(value);

  if (type !== 'string') {
    fail(`${location} must be a string translation value, got ${type}.`);
    return;
  }

  if (value.trim() === '') {
    fail(`${location} is empty.`);
  }

  if (/\b(?:TODO|TRANSLATE_ME|FIXME)\b/.test(value)) {
    fail(`${location} contains a placeholder marker: ${value}`);
  }

  if (value.includes('\uFFFD')) {
    fail(`${location} contains the replacement character U+FFFD.`);
  }

  if (value.includes('CZPH')) {
    fail(`${location} contains an unresolved temporary placeholder token.`);
  }

  if (hasSuspiciousReplacementQuestionMark(value)) {
    fail(`${location} contains a suspicious replacement question mark inside a word: ${value}`);
  }
}

const { configuredLocales, baseLocale: configuredBaseLocale } = readLocaleConfig();
const localeFiles = listLocaleFiles();
const localeCodes = localeFiles.map((file) => file.slice(0, -'.json'.length));
const baseLocale = configuredBaseLocale && localeCodes.includes(configuredBaseLocale)
  ? configuredBaseLocale
  : (localeCodes.includes('en') ? 'en' : localeCodes[0]);

if (!baseLocale) {
  fail('No locale JSON files found.');
}

for (const configuredLocale of configuredLocales) {
  if (!localeCodes.includes(configuredLocale)) {
    fail(`Locale ${configuredLocale} is configured but missing ${configuredLocale}.json.`);
  }
}

for (const localeCode of localeCodes) {
  if (configuredLocales.length > 0 && !configuredLocales.includes(localeCode)) {
    fail(`${localeCode}.json exists but is not listed in SUPPORTED_LOCALES.`);
  }
}

const translationsByLocale = new Map();

for (const file of localeFiles) {
  const locale = file.slice(0, -'.json'.length);
  translationsByLocale.set(locale, readJson(join(i18nRoot, file)));
}

const baseTranslations = translationsByLocale.get(baseLocale) ?? {};
const baseValues = flattenValues(baseTranslations);
const baseKeys = Object.keys(baseValues).sort();
const baseKeySet = new Set(baseKeys);

for (const locale of localeCodes) {
  const translations = translationsByLocale.get(locale) ?? {};
  const values = flattenValues(translations);
  const keys = Object.keys(values).sort();
  const keySet = new Set(keys);
  const missing = baseKeys.filter((key) => !keySet.has(key));
  const extra = keys.filter((key) => !baseKeySet.has(key));

  if (missing.length > 0) {
    fail(`${locale}.json is missing ${missing.length} key(s) from ${baseLocale}.json: ${missing.join(', ')}`);
  }

  if (extra.length > 0) {
    fail(`${locale}.json has ${extra.length} extra key(s) not present in ${baseLocale}.json: ${extra.join(', ')}`);
  }

  for (const key of keys) {
    validateTranslationValue(locale, key, values[key]);

    if (!baseKeySet.has(key)) {
      continue;
    }

    const basePlaceholders = extractPlaceholders(baseValues[key]);
    const localePlaceholders = extractPlaceholders(values[key]);

    if (basePlaceholders.join('|') !== localePlaceholders.join('|')) {
      fail(
        `${locale}.json:${key} placeholders differ from ${baseLocale}.json. `
        + `Expected [${basePlaceholders.join(', ') || 'none'}], got [${localePlaceholders.join(', ') || 'none'}].`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error('i18n translation validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`i18n translation validation passed (${localeCodes.length} locales, base ${baseLocale}, ${baseKeys.length} keys).`);
