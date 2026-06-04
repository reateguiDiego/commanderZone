import { readFile } from 'node:fs/promises';
import path from 'node:path';

const workspaceRoot = process.cwd();
const canonicalOrigin = 'https://www.commanderzone.com';
const canonicalHost = new URL(canonicalOrigin).host;
const alternateHost = 'commanderzone.com';
const alternateOrigin = `https://${alternateHost}`;
const legacySeoSlugRedirects = [
  ['/es/jugar-magic-online-con-amigos/', '/es/jugar-magic-online-amigos/'],
  ['/es/crear-sala-commander-online/', '/es/crear-sala-commander/'],
  ['/es/importar-mazo-commander/', '/es/importar-mazo-commander-mtg/'],
  ['/es/deck-builder-commander/', '/es/deck-builder-commander-mtg/'],
  ['/es/asistente-de-mesa-magic/', '/es/asistente-mesa-commander/'],
  ['/es/formas-de-jugar-commander-online/', '/es/formas-jugar-commander-online/'],
  ['/en/import-commander-deck/', '/en/import-mtg-commander-deck/'],
  ['/en/commander-deck-builder/', '/en/mtg-commander-deck-builder/'],
  ['/en/commander-life-counter/', '/en/commander-table-assistant/'],
  ['/de/commander-deck-importieren/', '/de/mtg-commander-deck-importieren/'],
  ['/de/commander-deck-builder/', '/de/mtg-commander-deck-builder/'],
  ['/de/mtg-life-counter/', '/de/commander-tischassistent/'],
  ['/de/commander-online-spielarten/', '/de/commander-online-spielen-moeglichkeiten/'],
  ['/de/commander-online-anleitung/', '/de/commander-online-spielen-anleitung/'],
  ['/fr/jouer-magic-en-ligne-avec-des-amis/', '/fr/jouer-magic-en-ligne-amis/'],
  ['/fr/creer-salon-commander/', '/fr/creer-salle-commander/'],
  ['/fr/importer-deck-commander/', '/fr/importer-deck-commander-mtg/'],
  ['/fr/constructeur-deck-commander/', '/fr/deck-builder-commander-mtg/'],
  ['/fr/compteur-vie-mtg/', '/fr/assistant-table-commander/'],
  ['/fr/facons-de-jouer-commander-en-ligne/', '/fr/facons-jouer-commander-en-ligne/'],
  ['/pt/jogar-magic-online-com-amigos/', '/pt/jogar-magic-online-amigos/'],
  ['/pt/importar-deck-commander/', '/pt/importar-deck-commander-mtg/'],
  ['/pt/construtor-deck-commander/', '/pt/deck-builder-commander-mtg/'],
  ['/pt/contador-vida-mtg/', '/pt/assistente-mesa-commander/'],
  ['/pt/formas-de-jogar-commander-online/', '/pt/formas-jogar-commander-online/'],
  ['/it/giocare-magic-online-con-amici/', '/it/giocare-magic-online-amici/'],
  ['/it/importare-mazzo-commander/', '/it/importare-mazzo-commander-mtg/'],
  ['/it/deck-builder-commander/', '/it/deck-builder-commander-mtg/'],
  ['/it/contatore-vite-mtg/', '/it/assistente-tavolo-commander/'],
  ['/it/modi-per-giocare-commander-online/', '/it/modi-giocare-commander-online/'],
];

const vercelConfig = JSON.parse(await readWorkspaceFile('vercel.json'));
const seoService = await readWorkspaceFile('src/app/core/seo/seo.service.ts');
const robots = await readWorkspaceFile('public/robots.txt');
const sitemapIndex = await readWorkspaceFile('public/sitemap-index.xml');
const seoSitemap = await readWorkspaceFile('public/sitemaps/sitemap-seo.xml');

assertSeoServiceCanonicalOrigin(seoService);
assertVercelRedirects(vercelConfig);
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

function assertVercelRedirects(config) {
  if (config.trailingSlash !== true) {
    throw new Error('vercel.json must enforce trailingSlash: true for SEO URLs.');
  }

  const headers = config.headers?.flatMap((entry) => entry.headers ?? []) ?? [];
  if (!headers.some((header) => header.key === 'Strict-Transport-Security' && header.value.includes('max-age='))) {
    throw new Error('vercel.json must send Strict-Transport-Security on production responses.');
  }

  const redirects = config.redirects ?? [];
  assertEnglishHomeRedirect(redirects);
  assertLegacySeoSlugRedirects(redirects);

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

function assertEnglishHomeRedirect(redirects) {
  const redirect = redirects.find((candidate) =>
    candidate.source === '/en/'
    && candidate.destination === `${canonicalOrigin}/`
    && candidate.permanent === true
    && candidate.has === undefined
  );

  if (!redirect) {
    throw new Error(`vercel.json must permanently redirect ${canonicalOrigin}/en/ to ${canonicalOrigin}/.`);
  }
}

function assertLegacySeoSlugRedirects(redirects) {
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

    if (alternateHostWildcardIndex !== -1 && redirectIndex > alternateHostWildcardIndex) {
      throw new Error(`Legacy SEO redirect ${source} must run before the alternate-host wildcard redirect.`);
    }
  }
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
