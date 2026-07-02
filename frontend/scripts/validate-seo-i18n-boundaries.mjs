import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDir, '..');
const appRoot = join(frontendRoot, 'src', 'app');
const i18nRoot = join(frontendRoot, 'src', 'assets', 'i18n');
const localeConfigPath = join(frontendRoot, 'src', 'app', 'core', 'localization', 'locale-config.ts');

const localeCodes = readSupportedLocaleCodes();

const runtimeNamespaces = [
  'common',
  'navigation',
  'auth',
  'rooms',
  'game',
  'deckBuilder',
  'tableAssistant',
  'profile',
  'settings',
  'forms',
  'errors',
  'modals',
  'toasts',
  'emptyStates',
  'onboarding',
];

const runtimePageComponents = [
  'src/app/features/auth/auth-page/auth-page.component',
  'src/app/features/auth/email-verification-page/email-verification-page.component',
  'src/app/features/auth/password-reset-page/password-reset-page.component',
  'src/app/features/cards/card-detail/card-detail.component',
  'src/app/features/cards/card-search/card-search.component',
  'src/app/features/dashboard/dashboard-home/dashboard-home.component',
  'src/app/features/decks/deck-editor/deck-editor.component',
  'src/app/features/decks/deck-list/deck-list.component',
  'src/app/features/game/game-table/game-table.component',
  'src/app/features/rooms/rooms/rooms.component',
  'src/app/features/rooms/waiting-room/waiting-room.component',
  'src/app/features/table-assistant/table-assistant-page/table-assistant-page.component',
  'src/app/features/table-assistant/table-assistant-room/table-assistant-room.component',
];

const seoStaticDirectories = [
  'src/app/features/seo-landings',
  'src/app/seo-landings',
];

const errors = [];

function fail(message) {
  errors.push(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readSupportedLocaleCodes() {
  const localeConfig = readFileSync(localeConfigPath, 'utf8');
  const supportedLocalesMatch = localeConfig.match(/SUPPORTED_LOCALES\s*=\s*\[([\s\S]*?)\]\s*as const/);

  if (!supportedLocalesMatch) {
    throw new Error(`Could not read SUPPORTED_LOCALES from ${normalizePath(localeConfigPath)}.`);
  }

  const codes = [...supportedLocalesMatch[1].matchAll(/code:\s*'([^']+)'/g)]
    .map((match) => match[1]);

  if (codes.length === 0) {
    throw new Error(`SUPPORTED_LOCALES has no locale codes in ${normalizePath(localeConfigPath)}.`);
  }

  return codes;
}

function flattenKeys(value, prefix = '', out = []) {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenKeys(child, fullKey, out);
    } else {
      out.push(fullKey);
    }
  }

  return out.sort();
}

function getValueByKey(value, key) {
  return key.split('.').reduce((current, part) => current?.[part], value);
}

function walkFiles(dir, extensions, out = []) {
  if (!existsSync(dir)) {
    return out;
  }

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      walkFiles(fullPath, extensions, out);
      continue;
    }

    if (extensions.includes(extname(fullPath))) {
      out.push(fullPath);
    }
  }

  return out;
}

function normalizePath(path) {
  return relative(frontendRoot, path).replaceAll('\\', '/');
}

const translationsByLocale = new Map(
  localeCodes.map((locale) => {
    const file = join(i18nRoot, `${locale}.json`);
    if (!existsSync(file)) {
      fail(`Missing locale JSON: ${normalizePath(file)}`);
      return [locale, {}];
    }

    return [locale, readJson(file)];
  }),
);

const baseLocale = localeCodes[0];
const baseTranslations = translationsByLocale.get(baseLocale) ?? {};
const baseKeys = flattenKeys(baseTranslations);
const baseKeySet = new Set(baseKeys);

for (const locale of localeCodes.slice(1)) {
  const localeKeys = flattenKeys(translationsByLocale.get(locale) ?? {});
  const localeKeySet = new Set(localeKeys);
  const missing = baseKeys.filter((key) => !localeKeySet.has(key));
  const extra = localeKeys.filter((key) => !baseKeySet.has(key));

  if (missing.length > 0 || extra.length > 0) {
    fail(`${locale}.json key structure differs from ${baseLocale}.json. Missing: ${missing.join(', ') || 'none'}. Extra: ${extra.join(', ') || 'none'}.`);
  }
}

for (const [locale, translations] of translationsByLocale) {
  for (const key of flattenKeys(translations)) {
    const value = getValueByKey(translations, key);

    if (typeof value !== 'string') {
      fail(`${locale}.json has non-string translation value for ${key}.`);
      continue;
    }

    if (value.trim() === '') {
      fail(`${locale}.json has an empty translation value for ${key}.`);
    }

    if (value === key) {
      fail(`${locale}.json renders the raw translation key for ${key}.`);
    }
  }
}

for (const componentPath of runtimePageComponents) {
  const tsPath = join(frontendRoot, `${componentPath}.ts`);
  const htmlPath = join(frontendRoot, `${componentPath}.html`);
  const tsText = existsSync(tsPath) ? readFileSync(tsPath, 'utf8') : '';
  const htmlText = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : '';

  if (!tsText && !htmlText) {
    fail(`Runtime-i18n page component is missing: ${componentPath}`);
    continue;
  }

  if (!tsText.includes('RuntimeTranslatePipe') && !htmlText.includes('runtimeTranslate')) {
    fail(`Runtime-i18n page does not use runtime translation: ${componentPath}`);
  }
}

const sourceFiles = walkFiles(appRoot, ['.ts', '.html'])
  .filter((file) => !file.endsWith('.spec.ts'))
  .filter((file) => !normalizePath(file).startsWith('src/app/core/localization/runtime-translation-fallbacks.ts'));

const namespacePattern = runtimeNamespaces.join('|');
const translationKey = `((?:${namespacePattern})\\.[A-Za-z0-9][A-Za-z0-9.-]*)`;
const explicitRuntimeTranslatePattern = new RegExp(`['"]${translationKey}['"]\\s*\\|\\s*runtimeTranslate`, 'g');
const explicitFallbackPattern = new RegExp(`runtimeTranslationFallback\\(\\s*['"]${translationKey}['"]`, 'g');
const visiblePropertyPattern = new RegExp(`(?:title|label|tooltip|message|description|placeholder|ariaLabel|menuLabel|cancelLabel|confirmLabel)\\s*:\\s*['"]${translationKey}['"]`, 'g');
const translatedInputDefaultPattern = new RegExp(`input\\(\\s*['"]${translationKey}['"]`, 'g');
const usedKeys = new Set();

for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');

  for (const pattern of [
    explicitRuntimeTranslatePattern,
    explicitFallbackPattern,
    visiblePropertyPattern,
    translatedInputDefaultPattern,
  ]) {
    for (const match of text.matchAll(pattern)) {
      usedKeys.add(match[1]);
    }
  }
}

for (const key of [...usedKeys].sort()) {
  if (!baseKeySet.has(key)) {
    fail(`Translation key used in runtime source is missing from ${baseLocale}.json: ${key}`);
  }

  for (const locale of localeCodes) {
    if (getValueByKey(translationsByLocale.get(locale) ?? {}, key) === undefined) {
      fail(`Translation key ${key} is missing from ${locale}.json.`);
    }
  }
}

for (const seoDir of seoStaticDirectories) {
  const absoluteSeoDir = join(frontendRoot, seoDir);
  const seoFiles = walkFiles(absoluteSeoDir, ['.ts', '.html']);

  for (const file of seoFiles) {
    const text = readFileSync(file, 'utf8');
    const forbiddenMatches = [
      '@ngx-translate/core',
      'TranslatePipe',
      'TranslateService',
      'RuntimeTranslatePipe',
      'runtimeTranslate',
      'assets/i18n',
      'RuntimeTranslationLoader',
    ].filter((forbidden) => text.includes(forbidden));

    if (forbiddenMatches.length > 0) {
      fail(`SEO-static file ${normalizePath(file)} uses forbidden runtime i18n: ${forbiddenMatches.join(', ')}.`);
    }
  }
}

if (errors.length > 0) {
  console.error('SEO/i18n boundary validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`SEO/i18n boundary validation passed (${localeCodes.length} locales, ${baseKeys.length} keys, ${usedKeys.size} runtime keys checked).`);
