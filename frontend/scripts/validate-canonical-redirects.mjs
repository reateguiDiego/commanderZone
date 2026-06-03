import { readFile } from 'node:fs/promises';
import path from 'node:path';

const workspaceRoot = process.cwd();
const canonicalOrigin = 'https://www.commanderzone.com';
const canonicalHost = new URL(canonicalOrigin).host;
const alternateHost = 'commanderzone.com';
const alternateOrigin = `https://${alternateHost}`;

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
