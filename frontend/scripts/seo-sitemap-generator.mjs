import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

export const SITEMAP_BASE_URL = 'https://www.commanderzone.com';
export const SITEMAP_INDEX_PUBLIC_PATH = 'sitemap-index.xml';
export const SEO_SITEMAP_PUBLIC_PATH = 'sitemaps/sitemap-seo.xml';
export const COMMUNITY_PROFILES_SITEMAP_PUBLIC_PATH = 'sitemaps/community-profiles.xml';
export const COMMUNITY_COMMANDERS_SITEMAP_PUBLIC_PATH = 'sitemaps/community-commanders.xml';
export const COMMUNITY_CARDS_SITEMAP_PUBLIC_PATH = 'sitemaps/community-cards.xml';
const DEFAULT_COMMUNITY_INDEX_URL = 'http://localhost:8000/community/indexable';
const COMMUNITY_INDEX_OPTIONAL = process.env.COMMANDERZONE_COMMUNITY_INDEX_OPTIONAL === '1';
const COMMUNITY_DECK_SITEMAP_PAGE_SIZE = 5000;
const COMMUNITY_STATIC_PATHS = [
  '/community/',
  '/community/decks/',
  '/community/top-commanders/',
  '/community/top-cards/',
];

export async function loadSeoSitemapConfig(workspaceRoot = process.cwd()) {
  const localeConfigPath = path.join(workspaceRoot, 'src/app/core/localization/locale-config.ts');
  const seoRoutesPath = path.join(workspaceRoot, 'src/app/core/localization/seo-routes.ts');

  return {
    locales: extractSupportedLocales(await readSourceFile(localeConfigPath)),
    routes: extractSeoRoutes(await readSourceFile(seoRoutesPath)),
  };
}

export function generateSitemapIndexXml(communitySitemapPublicPaths = []) {
  const communitySitemaps = communitySitemapPublicPaths.length > 0
    ? communitySitemapPublicPaths.flatMap((publicPath) => [
      '  <sitemap>',
      `    <loc>${toAbsoluteUrl(`/${publicPath}`)}</loc>`,
      '  </sitemap>',
    ])
    : [];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <sitemap>',
    `    <loc>${toAbsoluteUrl(`/${SEO_SITEMAP_PUBLIC_PATH}`)}</loc>`,
    '  </sitemap>',
    ...communitySitemaps,
    '</sitemapindex>',
    '',
  ].join('\n');
}

export function generateSeoSitemapXml(config) {
  const entries = getSeoSitemapEntries(config);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ];

  for (const entry of entries) {
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(entry.loc)}</loc>`);

    for (const alternate of entry.alternates) {
      lines.push(`    <xhtml:link rel="alternate" hreflang="${escapeXml(alternate.hreflang)}" href="${escapeXml(alternate.href)}"/>`);
    }

    lines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(entry.xDefault)}"/>`);
    lines.push('  </url>');
  }

  lines.push('</urlset>', '');
  return lines.join('\n');
}

export async function writeSitemapFiles(workspaceRoot = process.cwd()) {
  const config = await loadSeoSitemapConfig(workspaceRoot);
  const communityIndex = await loadCommunityIndex();
  const communitySitemaps = generateCommunitySitemaps(communityIndex);
  const sitemapIndexPath = path.join(workspaceRoot, 'public', SITEMAP_INDEX_PUBLIC_PATH);
  const seoSitemapPath = path.join(workspaceRoot, 'public', SEO_SITEMAP_PUBLIC_PATH);
  const sitemapIndexXml = generateSitemapIndexXml(communitySitemaps.map((sitemap) => sitemap.publicPath));
  const seoSitemapXml = generateSeoSitemapXml(config);

  await mkdir(path.dirname(seoSitemapPath), { recursive: true });
  await writeFile(sitemapIndexPath, sitemapIndexXml, 'utf8');
  await writeFile(seoSitemapPath, seoSitemapXml, 'utf8');
  for (const sitemap of communitySitemaps) {
    const sitemapPath = path.join(workspaceRoot, 'public', sitemap.publicPath);
    await mkdir(path.dirname(sitemapPath), { recursive: true });
    await writeFile(sitemapPath, sitemap.xml, 'utf8');
  }

  return {
    routeCount: config.routes.length,
    localeCount: config.locales.length,
    urlCount: config.routes.length * config.locales.length + communityIndex.paths.length,
    sitemapIndexPath,
    seoSitemapPath,
    communitySitemapPaths: communitySitemaps.map((sitemap) => path.join(workspaceRoot, 'public', sitemap.publicPath)),
  };
}

export function getSeoSitemapEntries(config) {
  assertValidConfig(config);

  return config.routes.flatMap((route) => {
    const alternates = config.locales.map((locale) => ({
      hreflang: locale.hreflang,
      href: toAbsoluteUrl(toSeoPath(locale.code, route.slugs[locale.code], route.routeKey)),
    }));
    const xDefaultLocale = config.locales.find((locale) => locale.code === 'en');

    if (!xDefaultLocale) {
      throw new Error('SEO sitemap requires en locale as x-default.');
    }

    return config.locales.map((locale) => ({
      routeKey: route.routeKey,
      locale: locale.code,
      loc: toAbsoluteUrl(toSeoPath(locale.code, route.slugs[locale.code], route.routeKey)),
      alternates,
      xDefault: toAbsoluteUrl(toSeoPath(xDefaultLocale.code, route.slugs[xDefaultLocale.code], route.routeKey)),
    }));
  });
}

export function toSeoPath(locale, slug, routeKey) {
  if (routeKey === 'home' && locale === 'en') {
    return '/';
  }

  return slug ? `/${locale}/${slug}/` : `/${locale}/`;
}

export function toAbsoluteUrl(publicPath) {
  const normalizedPath = publicPath.startsWith('/') ? publicPath : `/${publicPath}`;
  return `${SITEMAP_BASE_URL}${normalizedPath}`;
}

export async function loadCommunityIndex(fetchImpl = globalThis.fetch, workspaceRoot = process.cwd()) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Community sitemap generation requires a fetch implementation.');
  }

  const url = communityIndexUrl();

  try {
    const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const communityIndex = normalizeCommunityIndex(await response.json());
    assertDynamicCommunityIndex(communityIndex, url);

    return communityIndex;
  } catch (error) {
    if (COMMUNITY_INDEX_OPTIONAL) {
      console.warn(
        `Community sitemap source ${url} unavailable; COMMANDERZONE_COMMUNITY_INDEX_OPTIONAL=1 allows static community URLs only. ${
          error instanceof Error ? error.message : ''
        }`.trim(),
      );
      return normalizeCommunityIndex(null);
    }

    const existingCommunityIndex = await loadCommunityIndexFromExistingSitemaps(workspaceRoot);
    if (existingCommunityIndex.paths.length > COMMUNITY_STATIC_PATHS.length) {
      console.warn(
        `Community sitemap source ${url} unavailable; using checked-in community sitemap files as dynamic fallback. ${
          error instanceof Error ? error.message : ''
        }`.trim(),
      );
      return existingCommunityIndex;
    }

    throw new Error(
      `Community sitemap source ${url} is required and did not return dynamic community URLs. ${
        error instanceof Error ? error.message : ''
      }`.trim(),
    );
  }
}

async function loadCommunityIndexFromExistingSitemaps(workspaceRoot) {
  const sitemapDir = path.join(workspaceRoot, 'public', 'sitemaps');
  const payload = {
    decks: [],
    profiles: [],
    commanders: [],
    cards: [],
  };

  let filenames;
  try {
    filenames = await readdir(sitemapDir);
  } catch {
    return normalizeCommunityIndex(null);
  }

  const communitySitemapFiles = filenames
    .filter((filename) =>
      /^community-decks-\d+\.xml$/.test(filename)
      || filename === path.basename(COMMUNITY_PROFILES_SITEMAP_PUBLIC_PATH)
      || filename === path.basename(COMMUNITY_COMMANDERS_SITEMAP_PUBLIC_PATH)
      || filename === path.basename(COMMUNITY_CARDS_SITEMAP_PUBLIC_PATH)
    )
    .sort();

  for (const filename of communitySitemapFiles) {
    const xml = await readFile(path.join(sitemapDir, filename), 'utf8');
    for (const entry of communityEntriesFromSitemapXml(xml)) {
      if (entry.canonicalPath.startsWith('/community/decks/') && entry.canonicalPath !== '/community/decks/') {
        payload.decks.push(entry);
      } else if (entry.canonicalPath.startsWith('/community/profiles/')) {
        payload.profiles.push(entry);
      } else if (entry.canonicalPath.startsWith('/community/commanders/')) {
        payload.commanders.push(entry);
      } else if (entry.canonicalPath.startsWith('/community/cards/')) {
        payload.cards.push(entry);
      }
    }
  }

  return normalizeCommunityIndex(payload);
}

function communityEntriesFromSitemapXml(xml) {
  const entries = [];
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];

  for (const block of urlBlocks) {
    const loc = extractXmlTag(block, 'loc');
    if (!loc) {
      continue;
    }

    let pathname;
    try {
      pathname = new URL(loc).pathname;
    } catch {
      continue;
    }

    if (!pathname.startsWith('/community/') || !pathname.endsWith('/')) {
      continue;
    }

    entries.push({
      canonicalPath: pathname,
      updatedAt: extractXmlTag(block, 'lastmod'),
    });
  }

  return entries;
}

function extractXmlTag(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`));
  return match ? unescapeXml(match[1].trim()) : null;
}

function unescapeXml(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function communityIndexUrl() {
  const configuredUrl = process.env.COMMANDERZONE_COMMUNITY_INDEX_URL?.trim();
  return configuredUrl || DEFAULT_COMMUNITY_INDEX_URL;
}

function assertDynamicCommunityIndex(communityIndex, sourceUrl) {
  if (communityIndex.paths.length <= COMMUNITY_STATIC_PATHS.length) {
    throw new Error(`Community sitemap source ${sourceUrl} returned no dynamic community URLs.`);
  }
}

export function normalizeCommunityIndex(payload) {
  const groups = ['decks', 'profiles', 'commanders', 'cards'];
  const groupedEntries = {
    static: COMMUNITY_STATIC_PATHS.map((path) => ({ path, updatedAt: null })),
    decks: [],
    profiles: [],
    commanders: [],
    cards: [],
  };

  for (const group of groups) {
    const entries = Array.isArray(payload?.[group]) ? payload[group] : [];
    for (const entry of entries) {
      const canonicalPath = typeof entry?.canonicalPath === 'string' ? entry.canonicalPath.trim() : '';
      if (!canonicalPath.startsWith('/community/') || !canonicalPath.endsWith('/')) {
        continue;
      }

      groupedEntries[group].push({
        path: canonicalPath,
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
      });
    }
  }

  for (const group of Object.keys(groupedEntries)) {
    groupedEntries[group] = uniqueEntries(groupedEntries[group]);
  }

  const unique = new Map();
  for (const entry of Object.values(groupedEntries).flat()) {
    unique.set(entry.path, entry);
  }

  return {
    paths: [...unique.values()].sort((left, right) => left.path.localeCompare(right.path)),
    groups: groupedEntries,
  };
}

export function generateCommunitySitemaps(communityIndex) {
  const groups = communityIndex.groups ?? {
    static: COMMUNITY_STATIC_PATHS.map((path) => ({ path, updatedAt: null })),
    decks: communityIndex.paths.filter((entry) => entry.path.startsWith('/community/decks/') && entry.path !== '/community/decks/'),
    profiles: communityIndex.paths.filter((entry) => entry.path.startsWith('/community/profiles/')),
    commanders: communityIndex.paths.filter((entry) => entry.path.startsWith('/community/commanders/')),
    cards: communityIndex.paths.filter((entry) => entry.path.startsWith('/community/cards/')),
  };
  const deckChunks = groups.decks.length > 0 ? chunk(groups.decks, COMMUNITY_DECK_SITEMAP_PAGE_SIZE) : [[]];
  const deckSitemaps = deckChunks.map((entries, index) => {
    const sitemapEntries = index === 0 ? [...groups.static, ...entries] : entries;

    return {
      publicPath: `sitemaps/community-decks-${index + 1}.xml`,
      entries: sitemapEntries,
      xml: generateCommunitySitemapXml(sitemapEntries),
    };
  });
  const typedSitemaps = [
    {
      publicPath: COMMUNITY_PROFILES_SITEMAP_PUBLIC_PATH,
      entries: groups.profiles,
    },
    {
      publicPath: COMMUNITY_COMMANDERS_SITEMAP_PUBLIC_PATH,
      entries: groups.commanders,
    },
    {
      publicPath: COMMUNITY_CARDS_SITEMAP_PUBLIC_PATH,
      entries: groups.cards,
    },
  ]
    .filter((sitemap) => sitemap.entries.length > 0)
    .map((sitemap) => ({
      ...sitemap,
      xml: generateCommunitySitemapXml(sitemap.entries),
    }));

  return [...deckSitemaps, ...typedSitemaps];
}

export function generateCommunitySitemapXml(entries) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];

  for (const entry of entries) {
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(toAbsoluteUrl(entry.path))}</loc>`);
    if (entry.updatedAt) {
      lines.push(`    <lastmod>${escapeXml(entry.updatedAt)}</lastmod>`);
    }
    lines.push('  </url>');
  }

  lines.push('</urlset>', '');
  return lines.join('\n');
}

function uniqueEntries(entries) {
  const unique = new Map();
  for (const entry of entries) {
    unique.set(entry.path, entry);
  }

  return [...unique.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function chunk(entries, size) {
  const chunks = [];
  for (let index = 0; index < entries.length; index += size) {
    chunks.push(entries.slice(index, index + size));
  }

  return chunks;
}

async function readSourceFile(filePath) {
  const sourceText = await readFile(filePath, 'utf8');
  return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
}

function extractSupportedLocales(sourceFile) {
  const supportedLocalesDeclaration = findVariableDeclaration(sourceFile, 'SUPPORTED_LOCALES');
  const seoLocaleCodesDeclaration = findVariableDeclaration(sourceFile, 'SEO_LOCALE_CODES');
  const supportedLocalesArray = unwrapAsConstArray(supportedLocalesDeclaration.initializer);
  const seoLocaleCodes = unwrapAsConstArray(seoLocaleCodesDeclaration.initializer).elements.map((element) => {
    if (!ts.isStringLiteralLike(element)) {
      throw new Error('SEO_LOCALE_CODES must contain string literals.');
    }

    return element.text;
  });
  const supportedLocales = new Map();

  for (const element of supportedLocalesArray.elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      throw new Error('SUPPORTED_LOCALES must contain object literals.');
    }

    const code = getStringProperty(element, 'code');
    const hreflang = getStringProperty(element, 'hreflang');

    if (!code || !hreflang) {
      throw new Error('Every supported locale must define code and hreflang.');
    }

    supportedLocales.set(code, { code, hreflang });
  }

  return seoLocaleCodes.map((code) => {
    const locale = supportedLocales.get(code);

    if (!locale) {
      throw new Error(`SEO locale ${code} is not defined in SUPPORTED_LOCALES.`);
    }

    return locale;
  });
}

function extractSeoRoutes(sourceFile) {
  const declaration = findVariableDeclaration(sourceFile, 'SEO_ROUTES');
  const objectLiteral = unwrapSatisfiesObject(declaration.initializer);
  const routes = [];

  for (const routeProperty of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(routeProperty)) {
      continue;
    }

    const routeKey = propertyNameToString(routeProperty.name);
    const routeConfig = unwrapSatisfiesObject(routeProperty.initializer);
    const explicitRouteKey = getStringProperty(routeConfig, 'routeKey');
    const slugsProperty = routeConfig.properties.find((property) =>
      ts.isPropertyAssignment(property) && propertyNameToString(property.name) === 'slugs'
    );

    if (explicitRouteKey !== routeKey) {
      throw new Error(`SEO route ${routeKey} must keep routeKey in sync.`);
    }

    if (!slugsProperty || !ts.isPropertyAssignment(slugsProperty)) {
      throw new Error(`SEO route ${routeKey} must define slugs.`);
    }

    const slugsObject = unwrapSatisfiesObject(slugsProperty.initializer);
    routes.push({ routeKey, slugs: extractSlugRecord(slugsObject, routeKey) });
  }

  return routes;
}

function extractSlugRecord(objectLiteral, routeKey) {
  const slugs = {};

  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    const locale = propertyNameToString(property.name);
    if (!ts.isStringLiteralLike(property.initializer)) {
      throw new Error(`SEO route ${routeKey} slug for ${locale} must be a string literal.`);
    }

    slugs[locale] = property.initializer.text;
  }

  return slugs;
}

function assertValidConfig(config) {
  const localeCodes = config.locales.map((locale) => locale.code);
  const expectedUrlCount = config.locales.length * config.routes.length;
  const urlPaths = [];

  for (const route of config.routes) {
    for (const locale of localeCodes) {
      if (route.slugs[locale] === undefined) {
        throw new Error(`SEO route ${route.routeKey} must define a slug for SEO locale ${locale}.`);
      }

      const path = toSeoPath(locale, route.slugs[locale], route.routeKey);
      urlPaths.push(path);

      if (route.routeKey === 'home' && locale === 'en') {
        if (path !== '/') {
          throw new Error(`English home must be the root path, got ${path}.`);
        }
        continue;
      }

      if (!path.startsWith(`/${locale}/`)) {
        throw new Error(`SEO route ${route.routeKey} mixes locale and slug in ${path}.`);
      }
    }
  }

  if (urlPaths.length !== expectedUrlCount) {
    throw new Error(`Expected ${expectedUrlCount} sitemap URLs, got ${urlPaths.length}.`);
  }

  if (new Set(urlPaths).size !== urlPaths.length) {
    throw new Error('SEO sitemap URLs must be unique.');
  }
}

function findVariableDeclaration(sourceFile, variableName) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === variableName) {
        return declaration;
      }
    }
  }

  throw new Error(`Could not find ${variableName}.`);
}

function unwrapAsConstArray(expression) {
  if (ts.isSatisfiesExpression(expression)) {
    return unwrapAsConstArray(expression.expression);
  }

  if (ts.isAsExpression(expression) && ts.isArrayLiteralExpression(expression.expression)) {
    return expression.expression;
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return expression;
  }

  throw new Error('Expected an array literal.');
}

function unwrapSatisfiesObject(expression) {
  if (ts.isSatisfiesExpression(expression)) {
    return unwrapSatisfiesObject(expression.expression);
  }

  if (ts.isAsExpression(expression)) {
    return unwrapSatisfiesObject(expression.expression);
  }

  if (ts.isParenthesizedExpression(expression)) {
    return unwrapSatisfiesObject(expression.expression);
  }

  if (ts.isObjectLiteralExpression(expression)) {
    return expression;
  }

  throw new Error('Expected an object literal.');
}

function getStringProperty(objectLiteral, propertyName) {
  const property = objectLiteral.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate) && propertyNameToString(candidate.name) === propertyName
  );

  if (!property || !ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.initializer)) {
    return undefined;
  }

  return property.initializer.text;
}

function propertyNameToString(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
    return name.text;
  }

  throw new Error('Only identifier and string literal property names are supported.');
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
