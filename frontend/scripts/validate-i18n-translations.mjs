import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDir, '..');
const appRoot = join(frontendRoot, 'src', 'app');
const i18nRoot = join(frontendRoot, 'src', 'assets', 'i18n');
const localeConfigPath = join(
  frontendRoot,
  'src',
  'app',
  'core',
  'localization',
  'locale-config.ts',
);
const backendAppRoot = resolve(frontendRoot, '..', 'backend', 'src');
const gameRuntimeRoot = resolve(frontendRoot, '..', 'game-runtime');
const catalogReferenceLocale = 'en';

const staticCopyDirectories = [
  'src/app/features/legal',
  'src/app/features/not-found',
  'src/app/features/seo-landings',
  'src/app/seo-landings',
];

const errors = [];

// These fragments are intentionally empty in the listed locales because the
// surrounding template composes a recipient or a mulligan count around them.
// Keep the exception scoped to the exact locale/key pairs: empty values remain
// invalid everywhere else.
const allowedEmptyTranslations = new Map([
  ['common.ui.messageTargetPrefix', new Set(['ja'])],
  [
    'common.ui.messageTargetSuffix',
    new Set(['ca', 'de', 'en', 'es', 'fr', 'it', 'nl', 'pt', 'ru', 'zh-hans']),
  ],
  ['game.mulliganOverlay.mulligansTakenSuffix', new Set(['ru'])],
]);

// The reference catalog deliberately uses the same English word in these
// distinct UI contexts. Translation keys cannot always be shared: some
// locales require a contextual or grammatical variant. Exact groups are
// allowlisted so any new duplicate still fails validation and needs review.
const allowedReferenceValueDuplicates = new Map([
  ['Top', ['common.ui.top', 'game.gameTable.libraryPlacementTop']],
  ['Bottom', ['common.ui.bottom', 'game.gameTable.libraryPlacementBottom']],
  ['Delete', ['common.actions.delete', 'shared.text.delete']],
  ['Support', ['admin.users.roles.support', 'shared.text.support']],
  ['Admin', ['admin.users.roles.admin', 'shared.text.admin']],
  ['Owner', ['admin.users.roles.owner', 'shared.text.owner']],
  ['Players', ['rooms.setup.gameSetupSeatsControl.seats', 'shared.text.players']],
  ['Leave room', ['rooms.roomRow.leave', 'shared.text.leaveRoom']],
  ['Colors', ['community.user.filterColors', 'shared.text.colors']],
  ['Monarch', ['game.specialHelpers.labels.monarch', 'shared.text.monarch']],
  ['Text', ['deckBuilder.cards.cardSearch.details.oracleText', 'shared.text.text']],
  [
    'No commander assigned yet.',
    ['deckBuilder.deckEditor.noCommanderAssignedYet', 'shared.text.noCommanderAssignedYet'],
  ],
  ['No', ['deckBuilder.advancedAnalysis.common.no', 'shared.text.noLabel']],
  ['Yes', ['deckBuilder.advancedAnalysis.common.yes', 'shared.text.yesLabel']],
  [
    'Good',
    [
      'deckBuilder.advancedAnalysis.status.good',
      'deckBuilder.advancedAnalysis.quality.good',
      'shared.text.good',
    ],
  ],
  ['Warning', ['deckBuilder.advancedAnalysis.status.warning', 'shared.text.warning']],
  ['Draw', ['deckBuilder.advancedAnalysis.health.cards.draw', 'shared.text.draw']],
  [
    'Ramp',
    [
      'deckBuilder.advancedAnalysis.health.cards.ramp',
      'deckBuilder.advancedAnalysis.roles.cards.ramp',
      'shared.text.ramp',
    ],
  ],
  [
    'Sacrifice',
    [
      'deckBuilder.advancedAnalysis.health.cards.sacrifice',
      'deckBuilder.advancedAnalysis.roles.cards.sacrifice',
      'shared.text.sacrifice',
    ],
  ],
  [
    'Stax',
    [
      'deckBuilder.advancedAnalysis.health.cards.stax',
      'deckBuilder.advancedAnalysis.metrics.stax',
      'deckBuilder.advancedAnalysis.roles.cards.stax',
      'shared.text.stax',
    ],
  ],
  [
    'Tutors',
    [
      'deckBuilder.advancedAnalysis.health.cards.tutors',
      'deckBuilder.advancedAnalysis.roles.cards.tutors',
      'shared.text.tutors',
    ],
  ],
  [
    'Wincons',
    [
      'deckBuilder.advancedAnalysis.health.cards.wincons',
      'deckBuilder.advancedAnalysis.metrics.wincons',
      'shared.text.wincons',
    ],
  ],
  [
    'Wipes',
    [
      'deckBuilder.advancedAnalysis.health.cards.wipes',
      'deckBuilder.advancedAnalysis.roles.cards.wipes',
      'shared.text.wipes',
    ],
  ],
  ['Burst mana', ['deckBuilder.advancedAnalysis.metrics.burstMana', 'shared.text.burstMana']],
  [
    'Complete combos',
    [
      'deckBuilder.advancedAnalysis.metrics.completeCombos',
      'deckBuilder.advancedAnalysis.combos.summary.complete',
      'shared.text.completeCombos',
    ],
  ],
  [
    'Conditional wipes',
    [
      'deckBuilder.advancedAnalysis.metrics.conditionalWipes',
      'deckBuilder.advancedAnalysis.boardWipes.stats.conditionalWipes',
      'shared.text.conditionalWipes',
    ],
  ],
  [
    'Fast mana',
    [
      'deckBuilder.advancedAnalysis.metrics.fastMana',
      'deckBuilder.advancedAnalysis.mana.fastMana',
      'shared.text.fastMana',
    ],
  ],
  [
    'Keepable hands',
    [
      'deckBuilder.advancedAnalysis.metrics.keepableHands',
      'deckBuilder.advancedAnalysis.consistency.metrics.keepableHands',
      'shared.text.keepableHands',
    ],
  ],
  [
    'Mass bounce',
    [
      'deckBuilder.advancedAnalysis.metrics.massBounce',
      'deckBuilder.advancedAnalysis.boardWipes.stats.massBounce',
      'shared.text.massBounce',
    ],
  ],
  [
    'One-shot mana',
    ['deckBuilder.advancedAnalysis.metrics.oneShotMana', 'shared.text.oneShotMana'],
  ],
  [
    'Permanent ramp',
    ['deckBuilder.advancedAnalysis.metrics.permanentRamp', 'shared.text.permanentRamp'],
  ],
  [
    'Pseudo wipes',
    [
      'deckBuilder.advancedAnalysis.metrics.pseudoWipes',
      'deckBuilder.advancedAnalysis.boardWipes.stats.pseudoTotal',
      'shared.text.pseudoWipes',
    ],
  ],
  ['Rituals', ['deckBuilder.advancedAnalysis.metrics.rituals', 'shared.text.rituals']],
  ['Cards', ['deckBuilder.advancedAnalysis.cardResolution.cards', 'shared.text.cards']],
  [
    'Infinite mana',
    [
      'deckBuilder.advancedAnalysis.combos.summary.infiniteMana',
      'deckBuilder.advancedAnalysis.combos.badges.infiniteMana',
      'shared.text.infiniteMana',
    ],
  ],
  [
    'Medium',
    [
      'deckBuilder.advancedAnalysis.quality.medium',
      'shared.text.medium',
      'bracket.confidence.medium',
    ],
  ],
  ['Premium', ['deckBuilder.advancedAnalysis.quality.premium', 'shared.text.premium']],
  [
    'Average mana value',
    [
      'deckBuilder.advancedAnalysis.mana.averageManaValue',
      'deckBuilder.advancedAnalysis.boardWipes.stats.averageManaValue',
      'shared.text.averageManaValue',
    ],
  ],
  [
    'Colorless utility lands',
    [
      'deckBuilder.advancedAnalysis.mana.colorlessUtilityLands',
      'shared.text.colorlessUtilityLands',
    ],
  ],
  ['Black', ['deckBuilder.advancedAnalysis.mana.colors.black', 'shared.text.black']],
  ['Blue', ['deckBuilder.advancedAnalysis.mana.colors.blue', 'shared.text.blue']],
  ['Colorless', ['deckBuilder.advancedAnalysis.mana.colors.colorless', 'shared.text.colorless']],
  ['Green', ['deckBuilder.advancedAnalysis.mana.colors.green', 'shared.text.green']],
  ['Red', ['deckBuilder.advancedAnalysis.mana.colors.red', 'shared.text.red']],
  ['White', ['deckBuilder.advancedAnalysis.mana.colors.white', 'shared.text.white']],
  ['Fetchlands', ['deckBuilder.advancedAnalysis.mana.fetchlands', 'shared.text.fetchlands']],
  [
    'Answers indestructible',
    [
      'deckBuilder.advancedAnalysis.boardWipes.stats.answersIndestructible',
      'deckBuilder.advancedAnalysis.boardWipes.badges.answersIndestructible',
    ],
  ],
  [
    'Opponent compensation',
    [
      'deckBuilder.advancedAnalysis.boardWipes.stats.opponentCompensationWipes',
      'shared.text.opponentCompensation',
    ],
  ],
  ['Exile', ['deckBuilder.advancedAnalysis.boardWipes.badges.exile', 'shared.text.exile']],
  ['High', ['shared.text.high', 'bracket.confidence.high']],
  ['Low', ['shared.text.low', 'bracket.confidence.low']],
]);

function fail(message) {
  errors.push(message);
}

function isAllowedEmptyTranslation(locale, key) {
  return allowedEmptyTranslations.get(key)?.has(locale) ?? false;
}

function isAllowedReferenceValueDuplicate(value, keys) {
  const allowedKeys = allowedReferenceValueDuplicates.get(value);

  return (
    allowedKeys !== undefined &&
    allowedKeys.length === keys.length &&
    allowedKeys.every((key) => keys.includes(key))
  );
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
  const supportedLocalesMatch = localeConfig.match(
    /SUPPORTED_LOCALES\s*=\s*\[([\s\S]*?)\]\s*as const/,
  );
  const configuredLocales = supportedLocalesMatch
    ? [...supportedLocalesMatch[1].matchAll(/code:\s*'([^']+)'/g)].map((match) => match[1])
    : [];
  const defaultIndexMatch = localeConfig.match(/DEFAULT_LOCALE\s*=\s*SUPPORTED_LOCALES\[(\d+)\]/);
  const defaultLiteralMatch = localeConfig.match(/DEFAULT_LOCALE(?:_CODE)?\s*=\s*['"]([^'"]+)['"]/);
  const baseLocale =
    defaultLiteralMatch?.[1] ??
    (defaultIndexMatch ? configuredLocales[Number(defaultIndexMatch[1])] : undefined) ??
    configuredLocales[0];

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

function walkFiles(dir, extension, out = []) {
  if (!existsSync(dir)) {
    return out;
  }

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      walkFiles(path, extension, out);
      continue;
    }

    if (extname(path) === extension) {
      out.push(path);
    }
  }

  return out;
}

function isStaticCopyFile(path) {
  const normalized = normalizePath(path);

  return staticCopyDirectories.some((directory) => normalized.startsWith(directory));
}

function isTranslationKey(value) {
  return /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9-]+)+$/.test(value);
}

function isAllowedLiteral(value) {
  return /^(?:https?:\/\/\S+|mailto:\S+|D\d+|-|x|s)$/i.test(value);
}

function isKnownNonCopyLiteral(value) {
  return /^(?:CommanderZone|MTG|UNKNOWN_ERROR)$/i.test(value);
}

function validateExpressionLiterals(location, expression) {
  const stringLiteralPattern = /'(?:\\.|[^'\\\r\n])*'|"(?:\\.|[^"\\\r\n])*"/g;

  for (const match of expression.matchAll(stringLiteralPattern)) {
    const value = match[0].slice(1, -1).trim();

    if (
      value === '' ||
      !/[\p{L}]/u.test(value) ||
      isTranslationKey(value) ||
      isAllowedLiteral(value) ||
      isKnownNonCopyLiteral(value)
    ) {
      continue;
    }

    const isKnownUiTerm =
      /^(?:add|cancel|close|confirm|copied|delete|deleting|leave|leaving|loading|offline|online|remove|save|saving|send|yes|no)$/i.test(
        value,
      );
    if (!/\s/u.test(value) && !/^[A-ZÁÀÄÂÇÉÈËÊÍÌÏÎÑÓÒÖÔÚÙÜÛ]/u.test(value) && !isKnownUiTerm) {
      continue;
    }

    fail(`${location} contains hardcoded runtime UI copy in an Angular expression: ${value}`);
  }
}

function validateRuntimeTemplateCopy() {
  const attributePattern =
    /\b(?:actionLabel|alt|aria-label|ariaLabel|cancelLabel|confirmLabel|data-label|fallback|label|menuLabel|message|placeholder|primaryLabel|secondaryLabel|text|title|tooltip)\s*=\s*(["'])(.*?)\1/g;
  const boundAttributePattern =
    /\[(?:actionLabel|alt|aria-label|ariaLabel|cancelLabel|confirmLabel|data-label|fallback|label|menuLabel|message|placeholder|primaryLabel|secondaryLabel|text|title|tooltip)\]\s*=\s*(["'])(.*?)\1/g;
  const textNodePattern = />([^<]+)</g;
  const interpolationPattern = /\{\{([\s\S]*?)\}\}/g;

  for (const path of walkFiles(appRoot, '.html')) {
    if (isStaticCopyFile(path)) {
      continue;
    }

    const text = readFileSync(path, 'utf8');
    const location = normalizePath(path);

    for (const match of text.matchAll(attributePattern)) {
      const value = match[2].trim();
      if (value === '' || isTranslationKey(value) || isAllowedLiteral(value)) {
        continue;
      }

      fail(`${location} contains hardcoded runtime UI attribute copy: ${value}`);
    }

    for (const match of text.matchAll(boundAttributePattern)) {
      validateExpressionLiterals(location, match[2]);
    }

    for (const match of text.matchAll(interpolationPattern)) {
      validateExpressionLiterals(location, match[1]);
    }

    for (const match of text.matchAll(textNodePattern)) {
      const value = match[1]
        .replace(/\{\{[\s\S]*?\}\}/g, '')
        .replace(/&[A-Za-z]+;/g, '')
        .trim();

      if (
        value === '' ||
        !/[\p{L}]/u.test(value) ||
        isAllowedLiteral(value) ||
        /[{}@=()[\]]/.test(value)
      ) {
        continue;
      }

      fail(`${location} contains hardcoded runtime UI text: ${value}`);
    }
  }
}

function validateRuntimeErrorMessages() {
  const errorSetterPattern =
    /(?:\b(?:this|self|context|core)(?:\.[A-Za-z_$][\w$]*)*\.error\.set)\(\s*(?:'((?:\\.|[^'\\\r\n])*)'|"((?:\\.|[^"\\\r\n])*)")\s*\)/g;

  for (const path of walkFiles(appRoot, '.ts')) {
    if (path.endsWith('.spec.ts')) {
      continue;
    }

    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(errorSetterPattern)) {
      const value = match[1] ?? match[2];
      if (!isTranslationKey(value)) {
        fail(`${normalizePath(path)} sends hardcoded UI copy to an error state: ${value}`);
      }
    }
  }
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

  if (value.trim() === '' && !isAllowedEmptyTranslation(locale, key)) {
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

function validateCatalogUsageAndSharedCopy(translationsByLocale) {
  const referenceTranslations = translationsByLocale.get(catalogReferenceLocale);
  if (!referenceTranslations) {
    fail(`Missing ${catalogReferenceLocale}.json catalog reference.`);
    return;
  }

  const referenceValues = flattenValues(referenceTranslations);
  const usageSources = [
    ...walkFiles(appRoot, '.ts').filter((path) => !path.endsWith('.spec.ts')),
    ...walkFiles(appRoot, '.html'),
    ...walkFiles(backendAppRoot, '.php'),
    ...walkFiles(gameRuntimeRoot, '.ts'),
  ]
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  const valuesToKeys = new Map();
  const sharedTextReferences = new Set(
    [...usageSources.matchAll(/['"](shared\.text\.[A-Za-z0-9.-]+)['"]/g)].map((match) => match[1]),
  );

  for (const key of sharedTextReferences) {
    if (!Object.hasOwn(referenceValues, key)) {
      fail(
        `${catalogReferenceLocale}.json is missing shared text referenced by the application: ${key}.`,
      );
    }
  }

  for (const [key, value] of Object.entries(referenceValues)) {
    if (!usageSources.includes(key)) {
      fail(
        `${catalogReferenceLocale}.json:${key} is not referenced by the application or game event contracts.`,
      );
    }

    const matchingKeys = valuesToKeys.get(value) ?? [];
    matchingKeys.push(key);
    valuesToKeys.set(value, matchingKeys);
  }

  for (const [value, keys] of valuesToKeys) {
    if (keys.length > 1 && !isAllowedReferenceValueDuplicate(value, keys)) {
      fail(
        `${catalogReferenceLocale}.json repeats the value ${JSON.stringify(value)} in ${keys.length} keys. ` +
          `Move it to shared.text and reuse that key: ${keys.join(', ')}`,
      );
    }
  }
}

const { configuredLocales, baseLocale: configuredBaseLocale } = readLocaleConfig();
const localeFiles = listLocaleFiles();
const localeCodes = localeFiles.map((file) => file.slice(0, -'.json'.length));
const baseLocale =
  configuredBaseLocale && localeCodes.includes(configuredBaseLocale)
    ? configuredBaseLocale
    : localeCodes.includes('en')
      ? 'en'
      : localeCodes[0];

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
    fail(
      `${locale}.json is missing ${missing.length} key(s) from ${baseLocale}.json: ${missing.join(', ')}`,
    );
  }

  if (extra.length > 0) {
    fail(
      `${locale}.json has ${extra.length} extra key(s) not present in ${baseLocale}.json: ${extra.join(', ')}`,
    );
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
        `${locale}.json:${key} placeholders differ from ${baseLocale}.json. ` +
          `Expected [${basePlaceholders.join(', ') || 'none'}], got [${localePlaceholders.join(', ') || 'none'}].`,
      );
    }
  }
}

validateCatalogUsageAndSharedCopy(translationsByLocale);
validateRuntimeTemplateCopy();
validateRuntimeErrorMessages();

if (errors.length > 0) {
  console.error('i18n translation validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `i18n translation validation passed (${localeCodes.length} locales, base ${baseLocale}, ${baseKeys.length} keys).`,
);
