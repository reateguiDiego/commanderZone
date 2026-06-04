import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const workspaceRoot = process.cwd();
const angularConfigPath = join(workspaceRoot, 'angular.json');
const appRoot = join(workspaceRoot, 'src', 'app');
const seoLandingRoot = join(appRoot, 'features', 'seo-landings');
const seoRoutesPath = join(seoLandingRoot, 'seo-landing.routes.ts');
const sitemapPath = join(workspaceRoot, 'public', 'sitemaps', 'sitemap-seo.xml');
const browserOutputRoot = join(workspaceRoot, 'dist', 'frontend', 'browser');
const publicRoot = join(workspaceRoot, 'public');
const criticalResourceBudgetBytes = 500 * 1024;
const publicSeoImageBudgetBytes = 250 * 1024;
const provisionalOgAssetAllowlist = new Set([
  'public/assets/og/404-og.png',
  'public/assets/og/default-og.png',
  'public/assets/og/create-room-og.png',
  'public/assets/og/deck-builder-og.png',
  'public/assets/og/faq-og.png',
  'public/assets/og/home-og.png',
  'public/assets/og/import-deck-og.png',
  'public/assets/og/play-commander-og.png',
  'public/assets/og/table-assistant-og.png',
  'public/assets/og/ways-to-play-og.png',
]);
const errors = [];

assertCriticalCssIsEnabled();
assertSeoRoutesAreLazyLoaded();
assertSeoLandingSourcesStayLight();
assertPublicSeoImagesAreBudgeted();
assertRenderedSeoPagesStayFast();

if (errors.length > 0) {
  console.error('SEO performance validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('SEO performance validation passed.');

function assertCriticalCssIsEnabled() {
  const angularConfig = JSON.parse(readFileSync(angularConfigPath, 'utf8'));
  const inlineCritical = angularConfig.projects?.frontend?.architect?.build?.configurations?.production?.optimization?.styles?.inlineCritical;

  if (inlineCritical !== true) {
    errors.push('Production build must keep optimization.styles.inlineCritical enabled for SEO landings.');
  }
}

function assertSeoRoutesAreLazyLoaded() {
  const routes = readFileSync(seoRoutesPath, 'utf8');

  if (!routes.includes('loadComponent')) {
    errors.push('SEO landing routes must stay lazy-loaded with loadComponent.');
  }

  if (/import\s*\{\s*SeoLandingRouteComponent\s*\}/.test(routes)) {
    errors.push('SEO landing route component must not be eagerly imported by seo-landing.routes.ts.');
  }
}

function assertSeoLandingSourcesStayLight() {
  const files = walkFiles(seoLandingRoot, ['.ts', '.html'])
    .filter((file) => !file.endsWith('.spec.ts'));

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const normalizedPath = relative(workspaceRoot, file).replaceAll('\\', '/');

    const forbiddenFragments = [
      '@ngx-translate/core',
      'RuntimeTranslatePipe',
      'runtimeTranslate',
      'HttpClient',
      'gsap',
      'lucide-angular',
      'setTimeout',
      'setInterval',
      'requestAnimationFrame',
      'IntersectionObserver',
      'window.',
      'localStorage',
      'sessionStorage',
    ];

    for (const fragment of forbiddenFragments) {
      if (text.includes(fragment)) {
        errors.push(`${normalizedPath} uses performance-sensitive or runtime-only API: ${fragment}.`);
      }
    }

    if (/<script\b(?![^>]*type=["']application\/ld\+json["'])/i.test(text)) {
      errors.push(`${normalizedPath} must not include executable scripts in SEO landing templates.`);
    }
  }
}

function assertPublicSeoImagesAreBudgeted() {
  const publicImages = walkFiles(publicRoot, ['.avif', '.gif', '.jpg', '.jpeg', '.png', '.webp'])
    .map((file) => ({
      file,
      normalizedPath: relative(workspaceRoot, file).replaceAll('\\', '/'),
      size: statSync(file).size,
    }))
    .filter((image) => !provisionalOgAssetAllowlist.has(image.normalizedPath));

  for (const image of publicImages) {
    if (image.size > publicSeoImageBudgetBytes) {
      errors.push(`${image.normalizedPath} is ${(image.size / 1024).toFixed(1)} KiB and exceeds the 250 KiB public SEO image budget.`);
    }
  }
}

function assertRenderedSeoPagesStayFast() {
  if (!existsSync(browserOutputRoot)) {
    errors.push('dist/frontend/browser is missing. Run npm run build:prod before validate:seo-performance.');
    return;
  }

  const urls = extractSitemapUrls();
  for (const url of urls) {
    const htmlPath = getRenderedHtmlPath(url);
    if (!existsSync(htmlPath)) {
      errors.push(`${url} is missing prerendered HTML at ${relative(workspaceRoot, htmlPath).replaceAll('\\', '/')}.`);
      continue;
    }

    const html = readFileSync(htmlPath, 'utf8');
    validateCriticalResourceBudget(url, html);
    validateHeroImage(url, html);
    validateImagePreloads(url, html);
    validateRenderedImageBudgets(url, html);
  }
}

function validateCriticalResourceBudget(url, html) {
  const criticalResourceHrefs = [
    ...extractAttributeValues(html, /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, 'href'),
    ...extractAttributeValues(html, /<link\b[^>]*rel=["']modulepreload["'][^>]*>/gi, 'href'),
    ...extractAttributeValues(html, /<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>/gi, 'src'),
  ];
  const uniqueResources = [...new Set(criticalResourceHrefs)];
  const totalBytes = uniqueResources.reduce((total, href) => total + getBrowserAssetSize(href), 0);

  if (totalBytes > criticalResourceBudgetBytes) {
    errors.push(`${url} loads ${(totalBytes / 1024).toFixed(1)} KiB of critical JS/CSS resources, above the 500 KiB budget.`);
  }
}

function validateHeroImage(url, html) {
  const heroFigure = html.match(/<figure\b[^>]*class=["'][^"']*\blanding-hero__media\b[^"']*["'][^>]*>[\s\S]*?<\/figure>/i)?.[0];
  if (!heroFigure) {
    errors.push(`${url} must render a reserved landing hero media figure.`);
    return;
  }

  const heroImage = heroFigure.match(/<img\b[\s\S]*?>/i)?.[0];
  if (!heroImage) {
    errors.push(`${url} must render a hero image.`);
    return;
  }

  if (!hasAttribute(heroImage, 'width') || !hasAttribute(heroImage, 'height')) {
    errors.push(`${url} hero image must render explicit width and height attributes.`);
  }

  if (/loading=["']lazy["']/i.test(heroImage)) {
    errors.push(`${url} hero image must not use loading="lazy".`);
  }

  if (!/loading=["']eager["']/i.test(heroImage)) {
    errors.push(`${url} hero image must use loading="eager" for stable LCP.`);
  }

  if (!/fetchpriority=["']high["']/i.test(heroImage)) {
    errors.push(`${url} hero image must be the high-priority image.`);
  }

  if (!/decoding=["']async["']/i.test(heroImage)) {
    errors.push(`${url} hero image must use decoding="async".`);
  }

  const alt = getAttributeValue(heroImage, 'alt')?.trim() ?? '';
  if (alt.length < 12 || /^commanderzone$/i.test(alt) || /^hero image$/i.test(alt)) {
    errors.push(`${url} hero image alt must be descriptive and localized.`);
  }

  const highPriorityImages = [...html.matchAll(/<img\b[\s\S]*?fetchpriority=["']high["'][\s\S]*?>/gi)];
  if (highPriorityImages.length !== 1) {
    errors.push(`${url} must render exactly one high-priority image, got ${highPriorityImages.length}.`);
  }
}

function validateImagePreloads(url, html) {
  const imagePreloadTags = [...html.matchAll(/<link\b[^>]*rel=["']preload["'][^>]*as=["']image["'][^>]*>/gi)]
    .map((match) => match[0]);

  if (imagePreloadTags.length > 1) {
    errors.push(`${url} must not preload more than one image, got ${imagePreloadTags.length}.`);
  }

  for (const tag of imagePreloadTags) {
    const href = getAttributeValue(tag, 'href');
    if (!href) {
      errors.push(`${url} renders an image preload without href.`);
      continue;
    }

    const localPath = toLocalAssetPath(href);
    if (!localPath || !html.includes(`src="${localPath}"`)) {
      errors.push(`${url} preloads image ${href} but does not render it as an image source.`);
    }

    if (!/fetchpriority=["']high["']/i.test(tag)) {
      errors.push(`${url} hero image preload must use fetchpriority="high".`);
    }
  }
}

function validateRenderedImageBudgets(url, html) {
  const imageSources = extractAttributeValues(html, /<img\b[\s\S]*?>/gi, 'src');

  for (const src of imageSources) {
    const localPath = toLocalAssetPath(src);
    if (!localPath || isProvisionalOgAsset(localPath)) {
      continue;
    }

    const filePath = join(browserOutputRoot, localPath.replace(/^\//, '').split(/[?#]/, 1)[0]);
    if (!existsSync(filePath)) {
      errors.push(`${url} renders image ${src}, but the built asset is missing.`);
      continue;
    }

    const size = statSync(filePath).size;
    if (size > publicSeoImageBudgetBytes) {
      errors.push(`${url} renders ${src} at ${(size / 1024).toFixed(1)} KiB, above the 250 KiB SEO image budget.`);
    }
  }
}

function extractSitemapUrls() {
  const sitemap = readFileSync(sitemapPath, 'utf8');

  return [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

function getRenderedHtmlPath(url) {
  const { pathname } = new URL(url);

  if (pathname === '/') {
    return join(browserOutputRoot, 'index.html');
  }

  return join(browserOutputRoot, ...pathname.replace(/^\/|\/$/g, '').split('/'), 'index.html');
}

function extractAttributeValues(html, tagRegex, attribute) {
  return [...html.matchAll(tagRegex)]
    .map((match) => getAttributeValue(match[0], attribute))
    .filter((value) => typeof value === 'string' && value.length > 0);
}

function getBrowserAssetSize(href) {
  const assetPath = href.replace(/^\//, '').split(/[?#]/, 1)[0];
  const filePath = join(browserOutputRoot, assetPath);

  if (!existsSync(filePath)) {
    return 0;
  }

  return statSync(filePath).size;
}

function toLocalAssetPath(href) {
  if (href.startsWith('https://www.commanderzone.com/')) {
    return new URL(href).pathname;
  }

  if (href.startsWith('/')) {
    return href;
  }

  return null;
}

function isProvisionalOgAsset(localPath) {
  return provisionalOgAssetAllowlist.has(`public${localPath}`);
}

function hasAttribute(tag, attribute) {
  return new RegExp(`\\s${attribute}\\s*=`, 'i').test(tag);
}

function getAttributeValue(tag, attribute) {
  return tag.match(new RegExp(`\\s${attribute}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] ?? null;
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
