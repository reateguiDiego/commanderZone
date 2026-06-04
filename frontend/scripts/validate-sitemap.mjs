import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  generateSeoSitemapXml,
  generateSitemapIndexXml,
  getSeoSitemapEntries,
  loadSeoSitemapConfig,
  SEO_SITEMAP_PUBLIC_PATH,
  SITEMAP_INDEX_PUBLIC_PATH,
  toSeoPath,
} from './seo-sitemap-generator.mjs';

const workspaceRoot = process.cwd();
const config = await loadSeoSitemapConfig(workspaceRoot);
const nonSeoLocaleCodes = ['ja', 'ko', 'zh-hans', 'zh-hant', 'nl', 'ca', 'ru'];
const nonSeoHreflangs = ['ja', 'ko', 'zh-Hans', 'zh-Hant', 'nl', 'ca', 'ru'];
const expectedIndexXml = generateSitemapIndexXml();
const expectedSeoXml = generateSeoSitemapXml(config);
const sitemapIndexPath = path.join(workspaceRoot, 'public', SITEMAP_INDEX_PUBLIC_PATH);
const seoSitemapPath = path.join(workspaceRoot, 'public', SEO_SITEMAP_PUBLIC_PATH);
const vercelConfigPath = path.join(workspaceRoot, 'vercel.json');
const actualIndexXml = await readFile(sitemapIndexPath, 'utf8');
const actualSeoXml = await readFile(seoSitemapPath, 'utf8');
const vercelConfig = JSON.parse(await readFile(vercelConfigPath, 'utf8'));

assertEqualXml(actualIndexXml, expectedIndexXml, SITEMAP_INDEX_PUBLIC_PATH);
assertEqualXml(actualSeoXml, expectedSeoXml, SEO_SITEMAP_PUBLIC_PATH);
assertSitemapIndex(actualIndexXml);
assertSeoSitemap(actualSeoXml, config, vercelConfig);

console.log('Sitemap validation passed.');

function assertEqualXml(actual, expected, publicPath) {
  if (actual !== expected) {
    throw new Error(`${publicPath} is stale. Run "npm run generate:sitemap".`);
  }
}

function assertSitemapIndex(xml) {
  if (!xml.includes('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')) {
    throw new Error('sitemap-index.xml must be a valid sitemap index.');
  }

  if (!xml.includes('<loc>https://www.commanderzone.com/sitemaps/sitemap-seo.xml</loc>')) {
    throw new Error('sitemap-index.xml must reference sitemap-seo.xml.');
  }
}

function assertSeoSitemap(xml, config, vercelConfig) {
  if (!xml.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"')) {
    throw new Error('sitemap-seo.xml must include the xhtml namespace for hreflang alternates.');
  }

  const expectedEntries = getSeoSitemapEntries(config);
  const expectedLocs = new Set(expectedEntries.map((entry) => entry.loc));
  const actualLocs = extractTagValues(xml, 'loc');

  if (actualLocs.length !== expectedEntries.length) {
    throw new Error(`sitemap-seo.xml must contain ${expectedEntries.length} URLs, got ${actualLocs.length}.`);
  }

  for (const loc of actualLocs) {
    if (!expectedLocs.has(loc)) {
      throw new Error(`sitemap-seo.xml contains an unexpected or mixed localized URL: ${loc}.`);
    }
  }

  if (!actualLocs.includes('https://www.commanderzone.com/')) {
    throw new Error('sitemap-seo.xml must include the root English home URL.');
  }

  if (actualLocs.includes('https://www.commanderzone.com/en/')) {
    throw new Error('sitemap-seo.xml must not include /en/ as an indexable home URL.');
  }

  assertNoRedirectedUrls(actualLocs, vercelConfig);
  assertNoPrivateRoutes(actualLocs);
  assertNoNonSeoLocales(xml);
  assertEveryExpectedUrlExists(expectedEntries, actualLocs);
  assertHreflangAlternates(xml, expectedEntries, config);
}

function assertNoPrivateRoutes(urls) {
  const privateFragments = [
    '/app',
    '/auth',
    '/cards',
    '/dashboard',
    '/decks',
    '/games',
    '/profile',
    '/rooms',
    '/settings',
    '/table-assistant',
    '/room/',
  ];
  const privateUrl = urls.find((url) => privateFragments.some((fragment) => url.includes(fragment)));

  if (privateUrl) {
    throw new Error(`Private/runtime route must not appear in sitemap: ${privateUrl}`);
  }
}

function assertNoRedirectedUrls(urls, vercelConfig) {
  const redirectedPaths = new Set(
    (vercelConfig.redirects ?? [])
      .filter((redirect) => redirect.permanent === true && redirect.has === undefined)
      .map((redirect) => redirect.source)
      .filter((source) => typeof source === 'string' && !source.includes(':') && !source.includes('*')),
  );
  const redirectedUrl = urls.find((url) => redirectedPaths.has(new URL(url).pathname));

  if (redirectedUrl) {
    throw new Error(`Redirected URL must not appear in sitemap: ${redirectedUrl}`);
  }
}

function assertNoNonSeoLocales(xml) {
  for (const locale of nonSeoLocaleCodes) {
    if (xml.includes(`/${locale}/`)) {
      throw new Error(`sitemap-seo.xml must not include non-SEO locale URLs for ${locale}.`);
    }
  }

  for (const hreflang of nonSeoHreflangs) {
    if (xml.includes(`hreflang="${hreflang}"`)) {
      throw new Error(`sitemap-seo.xml must not include non-SEO hreflang ${hreflang}.`);
    }
  }
}

function assertEveryExpectedUrlExists(expectedEntries, actualLocs) {
  const actualLocSet = new Set(actualLocs);
  const missing = expectedEntries.find((entry) => !actualLocSet.has(entry.loc));

  if (missing) {
    throw new Error(`sitemap-seo.xml is missing expected SEO URL: ${missing.loc}`);
  }
}

function assertHreflangAlternates(xml, expectedEntries, config) {
  const expectedByLoc = new Map(expectedEntries.map((entry) => [entry.loc, entry]));
  const expectedLocs = new Set(expectedEntries.map((entry) => entry.loc));

  for (const urlBlock of extractUrlBlocks(xml)) {
    const loc = extractTagValues(urlBlock, 'loc')[0];
    const expectedEntry = expectedByLoc.get(loc);

    if (!expectedEntry) {
      throw new Error(`Unexpected sitemap URL block: ${loc ?? '(missing loc)'}`);
    }

    const alternates = extractAlternateLinks(urlBlock);
    const expectedAlternates = new Map(expectedEntry.alternates.map((alternate) => [alternate.hreflang, alternate.href]));
    const expectedHreflangs = [...config.locales.map((locale) => locale.hreflang), 'x-default'];
    const actualHreflangs = alternates.map((alternate) => alternate.hreflang);

    if (alternates.length !== expectedHreflangs.length) {
      throw new Error(`${loc} must contain exactly ${expectedHreflangs.length} hreflang alternates, got ${alternates.length}.`);
    }

    if (new Set(actualHreflangs).size !== actualHreflangs.length) {
      throw new Error(`${loc} contains duplicated hreflang alternates.`);
    }

    for (const alternate of alternates) {
      if (!expectedHreflangs.includes(alternate.hreflang)) {
        throw new Error(`${loc} contains unexpected hreflang ${alternate.hreflang}.`);
      }

      if (!expectedLocs.has(alternate.href)) {
        throw new Error(`${loc} hreflang ${alternate.hreflang} points to a URL outside the sitemap: ${alternate.href}.`);
      }
    }

    for (const locale of config.locales) {
      const href = expectedAlternates.get(locale.hreflang);
      if (!alternates.some((alternate) => alternate.hreflang === locale.hreflang && alternate.href === href)) {
        throw new Error(`Missing hreflang ${locale.hreflang} for ${loc}.`);
      }
    }

    if (!alternates.some((alternate) => alternate.href === loc)) {
      throw new Error(`Missing self-referencing hreflang for ${loc}.`);
    }

    if (!alternates.some((alternate) => alternate.hreflang === 'x-default' && alternate.href === expectedEntry.xDefault)) {
      throw new Error(`Missing x-default hreflang for ${loc}.`);
    }

    for (const alternate of alternates.filter((candidate) => candidate.hreflang !== 'x-default')) {
      const reciprocalEntry = expectedByLoc.get(alternate.href);
      if (!reciprocalEntry?.alternates.some((candidate) => candidate.href === loc)) {
        throw new Error(`${loc} hreflang ${alternate.hreflang} is not reciprocal from ${alternate.href}.`);
      }
    }
  }

  assertNoMixedLocaleSlug(config);
}

function assertNoMixedLocaleSlug(config) {
  for (const route of config.routes) {
    for (const locale of config.locales) {
      const expectedPath = toSeoPath(locale.code, route.slugs[locale.code], route.routeKey);

      if (route.routeKey === 'home' && locale.code === 'en') {
        if (expectedPath !== '/') {
          throw new Error(`English home must be the root path, got ${expectedPath}.`);
        }
        continue;
      }

      if (!expectedPath.startsWith(`/${locale.code}/`)) {
        throw new Error(`Mixed localized slug detected for ${route.routeKey}: ${expectedPath}`);
      }
    }
  }
}

function extractUrlBlocks(xml) {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => match[1]);
}

function extractTagValues(xml, tagName) {
  return [...xml.matchAll(new RegExp(`<${tagName}>(.*?)</${tagName}>`, 'g'))].map((match) => match[1]);
}

function extractAlternateLinks(xml) {
  return [...xml.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"\/>/g)]
    .map((match) => ({
      hreflang: match[1],
      href: match[2],
    }));
}
