import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadSeoSitemapConfig, toSeoPath } from './seo-sitemap-generator.mjs';

const workspaceRoot = process.cwd();
const canonicalOrigin = 'https://www.commanderzone.com';
const canonicalHost = new URL(canonicalOrigin).host;
const alternateHost = 'commanderzone.com';
const alternateOrigin = `https://${alternateHost}`;
const legacySeoSlugRedirects = [
  ['/es/jugar-magic-online-amigos/', '/es/jugar-magic-online-con-amigos/'],
  ['/es/crear-sala-commander-online/', '/es/crear-sala-commander/'],
  ['/es/importar-mazo-commander-mtg/', '/es/importar-mazo-commander/'],
  ['/es/deck-builder-commander-mtg/', '/es/deck-builder-commander/'],
  ['/es/asistente-de-mesa-magic/', '/es/contador-vidas-commander/'],
  ['/es/asistente-mesa-commander/', '/es/contador-vidas-commander/'],
  ['/es/formas-de-jugar-commander-online/', '/es/formas-jugar-commander-online/'],
  ['/en/import-mtg-commander-deck/', '/en/import-commander-deck/'],
  ['/en/mtg-commander-deck-builder/', '/en/commander-deck-builder/'],
  ['/en/commander-table-assistant/', '/en/commander-life-counter/'],
  ['/de/mtg-commander-deck-importieren/', '/de/commander-deck-importieren/'],
  ['/de/mtg-commander-deck-builder/', '/de/commander-deck-builder/'],
  ['/de/commander-tischassistent/', '/de/commander-life-counter/'],
  ['/de/mtg-life-counter/', '/de/commander-life-counter/'],
  ['/de/commander-online-spielarten/', '/de/commander-online-spielen-moeglichkeiten/'],
  ['/de/commander-online-anleitung/', '/de/commander-online-spielen-anleitung/'],
  ['/fr/jouer-magic-en-ligne-amis/', '/fr/jouer-magic-en-ligne-avec-des-amis/'],
  ['/fr/creer-salon-commander/', '/fr/creer-salle-commander/'],
  ['/fr/importer-deck-commander-mtg/', '/fr/importer-deck-commander/'],
  ['/fr/constructeur-deck-commander/', '/fr/deck-builder-commander/'],
  ['/fr/deck-builder-commander-mtg/', '/fr/deck-builder-commander/'],
  ['/fr/assistant-table-commander/', '/fr/compteur-vie-commander/'],
  ['/fr/compteur-vie-mtg/', '/fr/compteur-vie-commander/'],
  ['/fr/facons-de-jouer-commander-en-ligne/', '/fr/facons-jouer-commander-en-ligne/'],
  ['/pt/jogar-magic-online-amigos/', '/pt/jogar-magic-online-com-amigos/'],
  ['/pt/importar-deck-commander-mtg/', '/pt/importar-deck-commander/'],
  ['/pt/construtor-deck-commander/', '/pt/deck-builder-commander/'],
  ['/pt/deck-builder-commander-mtg/', '/pt/deck-builder-commander/'],
  ['/pt/assistente-mesa-commander/', '/pt/contador-vida-commander/'],
  ['/pt/contador-vida-mtg/', '/pt/contador-vida-commander/'],
  ['/pt/formas-de-jogar-commander-online/', '/pt/formas-jogar-commander-online/'],
  ['/it/giocare-magic-online-amici/', '/it/giocare-magic-online-con-amici/'],
  ['/it/importare-mazzo-commander-mtg/', '/it/importare-mazzo-commander/'],
  ['/it/deck-builder-commander-mtg/', '/it/deck-builder-commander/'],
  ['/it/assistente-tavolo-commander/', '/it/contatore-vite-commander/'],
  ['/it/contatore-vite-mtg/', '/it/contatore-vite-commander/'],
  ['/it/modi-per-giocare-commander-online/', '/it/modi-giocare-commander-online/'],
];
const legacySeoSlugSources = new Set(legacySeoSlugRedirects.map(([source]) => source));
const finalSeoSlugDestinations = new Set(legacySeoSlugRedirects.map(([, destination]) => destination));

const vercelConfig = JSON.parse(await readWorkspaceFile('vercel.json'));
const seoService = await readWorkspaceFile('src/app/core/seo/seo.service.ts');
const robots = await readWorkspaceFile('public/robots.txt');
const sitemapIndex = await readWorkspaceFile('public/sitemap-index.xml');
const seoSitemap = await readWorkspaceFile('public/sitemaps/sitemap-seo.xml');
const sitemapConfig = await loadSeoSitemapConfig(workspaceRoot);

assertSeoServiceCanonicalOrigin(seoService);
assertVercelRedirects(vercelConfig, sitemapConfig);
assertPublicSeoAssetsUseCanonicalOrigin(robots, sitemapIndex, seoSitemap);
assertSitemapUrlsUseTrailingSlash(seoSitemap);

console.log('Canonical and redirect validation passed.');

async function readWorkspaceFile(relativePath) {
  return readFile(path.join(workspaceRoot, relativePath), 'utf8');
}

function assertSeoServiceCanonicalOrigin(source) {
  if (!source.includes(`SEO_CANONICAL_ORIGIN = '${canonicalOrigin}'`)) {
    throw new Error(`SeoService must use ${canonicalOrigin} as the production canonical origin.`);
  }

  if (source.includes('document.location.origin}/') || source.includes('this.currentOrigin()')) {
    throw new Error('SEO metadata must not derive canonical URLs from the current browser origin.');
  }
}

function assertVercelRedirects(config, seoConfig) {
  if (config.trailingSlash !== true) {
    throw new Error('vercel.json must enforce trailingSlash: true for SEO URLs.');
  }

  const headers = config.headers?.flatMap((entry) => entry.headers ?? []) ?? [];
  if (!headers.some((header) => header.key === 'Strict-Transport-Security' && header.value.includes('max-age='))) {
    throw new Error('vercel.json must send Strict-Transport-Security on production responses.');
  }

  const redirects = config.redirects ?? [];
  const finalSeoPaths = getFinalSeoPaths(seoConfig);

  assertEnglishHomeRedirect(redirects, finalSeoPaths);
  assertLegacySeoSlugRedirects(redirects, finalSeoPaths);
  assertNoFinalSeoSlugRedirectsBackToLegacy(redirects);
  assertNoSeoRedirectDestinationOutsideSeoRoutes(redirects, finalSeoPaths);

  const alternateRootToCanonical = redirects.find((redirect) => {
    const hostRule = redirect.has?.find((rule) => rule.type === 'host');
    return hostRule?.value === alternateHost
      && redirect.source === '/'
      && redirect.destination === `${canonicalOrigin}/`
      && redirect.permanent === true;
  });

  if (!alternateRootToCanonical) {
    throw new Error(`vercel.json must permanently redirect ${alternateHost}/ to ${canonicalOrigin}/.`);
  }

  const alternatePathsToCanonical = redirects.find((redirect) => {
    const hostRule = redirect.has?.find((rule) => rule.type === 'host');
    return hostRule?.value === alternateHost
      && redirect.source === '/:path*'
      && redirect.destination === `${canonicalOrigin}/:path*`
      && redirect.permanent === true;
  });

  if (!alternatePathsToCanonical) {
    throw new Error(`vercel.json must permanently redirect ${alternateHost} paths to ${canonicalOrigin}.`);
  }

  const loop = redirects.find((redirect) => {
    const hostRule = redirect.has?.find((rule) => rule.type === 'host');
    return hostRule?.value === canonicalHost && redirect.destination?.startsWith(canonicalOrigin);
  });

  if (loop) {
    throw new Error('vercel.json must not redirect the canonical host back to itself.');
  }

  const redirectsToAlternate = redirects.find((redirect) => redirect.destination?.startsWith(alternateOrigin));
  if (redirectsToAlternate) {
    throw new Error(`vercel.json must not redirect production traffic to the non-canonical host ${alternateHost}.`);
  }
}

function assertNoFinalSeoSlugRedirectsBackToLegacy(redirects) {
  for (const redirect of redirects) {
    if (!redirect.permanent || typeof redirect.source !== 'string' || typeof redirect.destination !== 'string') {
      continue;
    }

    const destinationPath = new URL(redirect.destination, canonicalOrigin).pathname;

    if (finalSeoSlugDestinations.has(redirect.source) && legacySeoSlugSources.has(destinationPath)) {
      throw new Error(`Final SEO slug ${redirect.source} must not redirect back to legacy slug ${destinationPath}.`);
    }

    if (legacySeoSlugSources.has(destinationPath)) {
      throw new Error(`Redirect ${redirect.source} must not target legacy SEO slug ${destinationPath}.`);
    }
  }
}

function assertEnglishHomeRedirect(redirects, finalSeoPaths) {
  const redirect = redirects.find((candidate) =>
    candidate.source === '/en/'
    && candidate.destination === `${canonicalOrigin}/`
    && candidate.permanent === true
    && candidate.has === undefined
  );

  if (!redirect) {
    throw new Error(`vercel.json must permanently redirect ${canonicalOrigin}/en/ to ${canonicalOrigin}/.`);
  }

  if (!finalSeoPaths.has('/')) {
    throw new Error('SEO_ROUTES must keep English home canonicalized as /.');
  }
}

function assertLegacySeoSlugRedirects(redirects, finalSeoPaths) {
  const alternateHostWildcardIndex = redirects.findIndex((redirect) => {
    const hostRule = redirect.has?.find((rule) => rule.type === 'host');
    return hostRule?.value === alternateHost && redirect.source === '/:path*';
  });

  for (const [source, destinationPath] of legacySeoSlugRedirects) {
    const redirectIndex = redirects.findIndex((redirect) =>
      redirect.source === source
      && redirect.destination === `${canonicalOrigin}${destinationPath}`
      && redirect.permanent === true
      && redirect.has === undefined
    );

    if (redirectIndex === -1) {
      throw new Error(`vercel.json must permanently redirect ${source} to ${canonicalOrigin}${destinationPath}.`);
    }

    if (!finalSeoPaths.has(destinationPath)) {
      throw new Error(`Legacy SEO redirect ${source} targets ${destinationPath}, which is not in SEO_ROUTES.`);
    }

    if (alternateHostWildcardIndex !== -1 && redirectIndex > alternateHostWildcardIndex) {
      throw new Error(`Legacy SEO redirect ${source} must run before the alternate-host wildcard redirect.`);
    }
  }
}

function assertNoSeoRedirectDestinationOutsideSeoRoutes(redirects, finalSeoPaths) {
  const seoRedirectSources = new Set(['/en/', ...legacySeoSlugSources]);

  for (const redirect of redirects) {
    if (!seoRedirectSources.has(redirect.source) || typeof redirect.destination !== 'string') {
      continue;
    }

    const destinationPath = new URL(redirect.destination, canonicalOrigin).pathname;
    if (!finalSeoPaths.has(destinationPath)) {
      throw new Error(`SEO redirect ${redirect.source} targets ${destinationPath}, which is not in SEO_ROUTES.`);
    }
  }
}

function getFinalSeoPaths(config) {
  return new Set(config.routes.flatMap((route) =>
    config.locales.map((locale) => toSeoPath(locale.code, route.slugs[locale.code], route.routeKey)),
  ));
}

function assertPublicSeoAssetsUseCanonicalOrigin(robots, sitemapIndex, seoSitemap) {
  const expectedSitemapUrl = `${canonicalOrigin}/sitemap-index.xml`;
  const expectedSeoSitemapUrl = `${canonicalOrigin}/sitemaps/sitemap-seo.xml`;

  if (!robots.includes(`Sitemap: ${expectedSitemapUrl}`)) {
    throw new Error(`robots.txt must reference ${expectedSitemapUrl}.`);
  }

  if (!sitemapIndex.includes(`<loc>${expectedSeoSitemapUrl}</loc>`)) {
    throw new Error(`sitemap-index.xml must reference ${expectedSeoSitemapUrl}.`);
  }

  const urlValues = [
    ...extractTagValues(seoSitemap, 'loc'),
    ...extractAttributeValues(seoSitemap, 'href'),
  ];

  for (const url of urlValues) {
    if (!url.startsWith(`${canonicalOrigin}/`)) {
      throw new Error(`Sitemap URL must use the canonical origin: ${url}`);
    }

    if (url.startsWith('http://') || url.startsWith(`${alternateOrigin}/`)) {
      throw new Error(`Sitemap URL must use HTTPS and the canonical host: ${url}`);
    }
  }
}

function assertSitemapUrlsUseTrailingSlash(seoSitemap) {
  const urls = [
    ...extractTagValues(seoSitemap, 'loc'),
    ...extractAttributeValues(seoSitemap, 'href').filter((url) => !url.endsWith('/sitemap-index.xml')),
  ];
  const nonCanonicalSlashUrl = urls.find((url) => !url.endsWith('/'));

  if (nonCanonicalSlashUrl) {
    throw new Error(`SEO URLs must use trailing slash: ${nonCanonicalSlashUrl}`);
  }
}

function extractTagValues(xml, tagName) {
  return [...xml.matchAll(new RegExp(`<${tagName}>(.*?)</${tagName}>`, 'g'))].map((match) => match[1]);
}

function extractAttributeValues(xml, attributeName) {
  return [...xml.matchAll(new RegExp(`${attributeName}="([^"]+)"`, 'g'))].map((match) => match[1]);
}
