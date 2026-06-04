import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSeoSitemapEntries, loadSeoSitemapConfig } from './seo-sitemap-generator.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDir, '..');
const appRoot = join(frontendRoot, 'src', 'app');
const seoLandingRoot = join(appRoot, 'features', 'seo-landings');
const distBrowserRoot = join(frontendRoot, 'dist', 'frontend', 'browser');
const sitemapPath = join(frontendRoot, 'public', 'sitemaps', 'sitemap-seo.xml');

const allowedTemplateComponentNames = new Set([
  'ComparisonLandingTemplateComponent',
  'FaqLandingTemplateComponent',
  'GuideLandingTemplateComponent',
  'ProductLandingTemplateComponent',
  'SeoLandingTemplateRendererComponent',
]);
const forbiddenSeoI18nMarkers = [
  '@ngx-translate/core',
  'TranslatePipe',
  'TranslateService',
  'RuntimeTranslatePipe',
  'runtimeTranslate',
  'assets/i18n',
  'RuntimeTranslationLoader',
];
const runtimeTranslationNamespaces = [
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
];
const privateRouteFragments = [
  '/auth',
  '/login',
  '/register',
  '/password-reset',
  '/email-verification',
  '/app',
  '/dashboard',
  '/cards',
  '/rooms',
  '/room/',
  '/games/',
  '/profile',
  '/settings',
  '/account',
  '/decks',
  '/table-assistant',
];

const errors = [];
const warnings = [];

const config = await loadSeoSitemapConfig(frontendRoot);
const sitemapEntries = getSeoSitemapEntries(config);
const routeKeys = config.routes.map((route) => route.routeKey);
const localeCodes = config.locales.map((locale) => locale.code);

validateSeoStaticBoundary();
validateSeoRoutesUseSharedRouteComponent();
validateSharedLandingArchitecture();
validateStaticContentCoverage();
validateNoPerLocaleLandingComponents();
validateNoDuplicatedLayoutMarkup();
validateNoDuplicateSlugsWithinLocale();
validateSitemapCompleteness();
validatePrerenderedHtmlWhenAvailable();

if (errors.length > 0) {
  console.error('Final SEO/i18n architecture validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

for (const warning of warnings) {
  console.warn(`Warning: ${warning}`);
}

console.log([
  'Final SEO/i18n architecture validation passed',
  `(${routeKeys.length} SEO landings, ${localeCodes.length} locales, ${sitemapEntries.length} localized URLs checked).`,
].join(' '));

function validateSeoStaticBoundary() {
  for (const file of walkFiles(seoLandingRoot, ['.ts', '.html']).filter((sourceFile) => !sourceFile.endsWith('.spec.ts'))) {
    const text = readText(file);
    const forbiddenMatches = forbiddenSeoI18nMarkers.filter((marker) => text.includes(marker));

    if (forbiddenMatches.length > 0) {
      fail(`${formatPath(file)} must not mix SEO-static landings with runtime i18n: ${forbiddenMatches.join(', ')}.`);
    }
  }
}

function validateSeoRoutesUseSharedRouteComponent() {
  const routesPath = join(seoLandingRoot, 'seo-landing.routes.ts');
  const routesText = readText(routesPath);
  const loadComponentMatches = [...routesText.matchAll(/\bloadComponent\b/g)];

  if (!routesText.includes('SEO_ROUTE_KEYS.flatMap') || !routesText.includes('SEO_LOCALE_CODES.map')) {
    fail(`${formatPath(routesPath)} must generate localized SEO routes from route keys and SEO locales.`);
  }

  if (loadComponentMatches.length !== 1 || !routesText.includes('SeoLandingRouteComponent')) {
    fail(`${formatPath(routesPath)} must route every SEO URL through the shared SeoLandingRouteComponent.`);
  }

  for (const componentName of extractComponentClassNames(routesText)) {
    if (componentName !== 'SeoLandingRouteComponent') {
      fail(`${formatPath(routesPath)} must not reference landing-specific route components: ${componentName}.`);
    }
  }
}

function validateSharedLandingArchitecture() {
  const routeComponent = join(seoLandingRoot, 'seo-landing-route', 'seo-landing-route.component.ts');
  const pageComponent = join(seoLandingRoot, 'seo-landing-page', 'seo-landing-page.component.ts');
  const pageTemplate = join(seoLandingRoot, 'seo-landing-page', 'seo-landing-page.component.html');
  const layoutComponent = join(seoLandingRoot, 'components', 'seo-landing-layout', 'seo-landing-layout.component.ts');
  const layoutTemplate = join(seoLandingRoot, 'components', 'seo-landing-layout', 'seo-landing-layout.component.html');
  const templateModel = join(seoLandingRoot, 'models', 'seo-landing-template.model.ts');
  const faqTemplate = join(seoLandingRoot, 'templates', 'faq-landing-template', 'faq-landing-template.component.html');

  assertIncludes(routeComponent, 'getSeoLandingContent', 'SEO landing route must read main content from typed static content.');
  assertIncludes(routeComponent, 'applySeoRouteMetadata', 'SEO landing route must apply title, description, canonical and alternates through SeoService.');
  assertIncludes(pageComponent, 'SeoLandingLayoutComponent', 'SEO landing page must compose the shared SeoLandingLayoutComponent.');
  assertIncludes(pageTemplate, '<app-seo-landing-layout', 'SEO landing page template must wrap all variants in the shared layout.');
  assertIncludes(layoutComponent, 'SeoLandingContent', 'SEO landing layout must receive typed static landing content.');
  assertIncludes(layoutTemplate, '<header', 'Shared SEO landing layout must own the public header.');
  assertIncludes(layoutTemplate, '<main', 'Shared SEO landing layout must own the main landmark.');
  assertIncludes(layoutTemplate, '<footer', 'Shared SEO landing layout must own the public footer.');
  assertIncludes(layoutTemplate, '<app-landing-internal-links', 'Shared SEO landing layout must own SEO internal link rendering.');
  assertIncludes(templateModel, "faq: 'FaqLandingTemplate'", 'FAQ route must use the approved shared FAQ landing template.');
  assertIncludes(faqTemplate, '<app-seo-landing-template-renderer', 'FAQ template must reuse the shared template renderer.');

  for (const templateName of [
    'ProductLandingTemplate',
    'GuideLandingTemplate',
    'ComparisonLandingTemplate',
    'FaqLandingTemplate',
  ]) {
    assertIncludes(pageTemplate, templateName, `SEO landing page must support ${templateName}.`);
  }
}

function validateStaticContentCoverage() {
  const registryPath = join(seoLandingRoot, 'content', 'seo-landing-content.ts');
  const factoryPath = join(seoLandingRoot, 'content', 'seo-landing-content-factory.ts');
  const registryText = readText(registryPath);
  const factoryText = readText(factoryPath);

  assertIncludes(factoryPath, 'SEO_LOCALE_CODES.map', 'Static SEO content must be generated for every SEO locale.');
  assertIncludes(factoryPath, 'LOCALE_COPY[locale]', 'Static SEO content must take locale differences from typed localized copy.');
  assertIncludes(factoryPath, 'ROUTE_LABELS[routeKey][locale]', 'Static SEO content must be keyed by routeKey and locale.');
  assertIncludes(factoryPath, 'seo: SeoMetadataContent', 'Static SEO content must define SEO metadata for each localized landing.');

  for (const routeKey of routeKeys) {
    const contentPath = join(seoLandingRoot, 'content', `${camelToKebab(routeKey)}.content.ts`);
    if (!existsSync(contentPath)) {
      fail(`Missing SEO static content entry file for ${routeKey}: ${formatPath(contentPath)}.`);
      continue;
    }

    const contentText = readText(contentPath);
    if (!contentText.includes(`createSeoLandingContentByLocale('${routeKey}')`)) {
      fail(`${formatPath(contentPath)} must create content from routeKey ${routeKey}.`);
    }

    if (!new RegExp(`\\b${escapeRegExp(routeKey)}\\s*:`).test(registryText)) {
      fail(`${formatPath(registryPath)} must register static content for ${routeKey}.`);
    }
  }
}

function validateNoPerLocaleLandingComponents() {
  const componentFiles = walkFiles(seoLandingRoot, ['.ts']).filter((file) => file.endsWith('.component.ts'));
  const localeTokens = localeCodes.flatMap((locale) => [
    locale,
    locale.replace('-', ''),
    toPascalCase(locale),
  ]);
  const tokenPattern = new RegExp(`(^|[-_.])(${localeTokens.map(escapeRegExp).join('|')})([-_.]|$)`, 'i');
  const classLocaleSuffixPattern = new RegExp(`(?:${localeTokens.map(toPascalComponentToken).join('|')})Component\\b`);

  for (const file of componentFiles) {
    const normalizedPath = formatPath(file);
    const fileBaseName = normalizedPath.split('/').at(-1) ?? '';
    const text = readText(file);

    if (tokenPattern.test(fileBaseName)) {
      fail(`${normalizedPath} looks like a per-locale landing component. Locale differences must come from routes and static content.`);
    }

    for (const componentName of extractComponentClassNames(text)) {
      if (!allowedTemplateComponentNames.has(componentName) && classLocaleSuffixPattern.test(componentName)) {
        fail(`${normalizedPath} declares ${componentName}, which looks like a per-locale landing component.`);
      }
    }
  }
}

function validateNoDuplicatedLayoutMarkup() {
  const layoutTemplate = join(seoLandingRoot, 'components', 'seo-landing-layout', 'seo-landing-layout.component.html');
  const seoHtmlFiles = walkFiles(seoLandingRoot, ['.html']);

  for (const file of seoHtmlFiles) {
    if (file === layoutTemplate) {
      continue;
    }

    const text = readText(file);
    if (/\bseo-landing-layout__(?:header|footer)\b/.test(text) || /<footer\b/i.test(text)) {
      fail(`${formatPath(file)} must not duplicate public header/footer markup outside SeoLandingLayoutComponent.`);
    }
  }
}

function validateNoDuplicateSlugsWithinLocale() {
  for (const locale of localeCodes) {
    const slugs = config.routes.map((route) => route.slugs[locale]);
    const duplicates = slugs.filter((slug, index) => slugs.indexOf(slug) !== index);

    if (duplicates.length > 0) {
      fail(`Duplicated SEO slugs for locale ${locale}: ${[...new Set(duplicates)].join(', ')}.`);
    }
  }
}

function validateSitemapCompleteness() {
  if (!existsSync(sitemapPath)) {
    fail(`Missing SEO sitemap: ${formatPath(sitemapPath)}.`);
    return;
  }

  const sitemapXml = readText(sitemapPath);
  for (const entry of sitemapEntries) {
    if (!sitemapXml.includes(`<loc>${entry.loc}</loc>`)) {
      fail(`Sitemap is missing SEO URL ${entry.loc}.`);
    }
  }

  for (const privateFragment of privateRouteFragments) {
    if (sitemapXml.includes(privateFragment)) {
      fail(`Sitemap must not include private/internal route fragment: ${privateFragment}.`);
    }
  }
}

function validatePrerenderedHtmlWhenAvailable() {
  const htmlFilesByEntry = sitemapEntries
    .map((entry) => [entry, findPrerenderHtmlForEntry(entry)])
    .filter(([, htmlPath]) => htmlPath !== undefined);

  if (htmlFilesByEntry.length === 0) {
    warnings.push('No prerendered localized SEO HTML files found under dist/frontend/browser; source, sitemap and architecture checks ran. Run this validator after a prerender build in CI to enforce rendered HTML checks.');
    return;
  }

  const renderedUrls = new Set(htmlFilesByEntry.map(([entry]) => entry.loc));

  for (const entry of sitemapEntries) {
    if (!renderedUrls.has(entry.loc)) {
      fail(`Missing prerendered SEO HTML for ${entry.loc}.`);
    }
  }

  for (const [entry, htmlPath] of htmlFilesByEntry) {
    validateRenderedSeoHtml(entry, htmlPath);
  }
}

function validateRenderedSeoHtml(entry, htmlPath) {
  const html = readText(htmlPath);
  const titleTags = html.match(/<title\b[^>]*>[\s\S]*?<\/title>/gi) ?? [];
  const descriptionTags = html.match(/<meta\b(?=[^>]*\bname=["']description["'])[^>]*>/gi) ?? [];
  const canonicalTags = html.match(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/gi) ?? [];
  const alternateTags = html.match(/<link\b(?=[^>]*\brel=["']alternate["'])[^>]*>/gi) ?? [];

  if (titleTags.length !== 1) {
    fail(`${entry.loc} must render exactly one <title>, got ${titleTags.length}.`);
  }

  if (descriptionTags.length !== 1) {
    fail(`${entry.loc} must render exactly one meta description, got ${descriptionTags.length}.`);
  }

  if (canonicalTags.length !== 1) {
    fail(`${entry.loc} must render exactly one canonical link, got ${canonicalTags.length}.`);
  } else if (getAttribute(canonicalTags[0], 'href') !== entry.loc) {
    fail(`${entry.loc} canonical must point to itself, got ${getAttribute(canonicalTags[0], 'href') ?? '(missing)'}.`);
  }

  if (alternateTags.length < localeCodes.length + 1) {
    fail(`${entry.loc} must render hreflang alternates for every locale plus x-default.`);
  }

  for (const alternate of [...entry.alternates, { hreflang: 'x-default', href: entry.xDefault }]) {
    const hasAlternate = alternateTags.some((tag) =>
      getAttribute(tag, 'hreflang') === alternate.hreflang && getAttribute(tag, 'href') === alternate.href
    );

    if (!hasAlternate) {
      fail(`${entry.loc} is missing hreflang ${alternate.hreflang} -> ${alternate.href}.`);
    }
  }

  if (!/<main\b/i.test(html)) {
    fail(`${entry.loc} must render a main landmark.`);
  }

  if (!/<h1\b[^>]*>[\s\S]*?\S[\s\S]*?<\/h1>/i.test(html)) {
    fail(`${entry.loc} must render a visible H1.`);
  }

  if (!/\bseo-landing-layout\b/.test(html) || !/\blanding-hero\b/.test(html)) {
    fail(`${entry.loc} must render main SEO landing content, not only the shell.`);
  }

  const visibleText = getVisibleHtmlText(html);
  const visibleKeyPattern = new RegExp(`\\b(?:${runtimeTranslationNamespaces.join('|')})\\.[A-Za-z0-9.-]+\\b`);
  if (visibleKeyPattern.test(visibleText)) {
    fail(`${entry.loc} contains a visible runtime translation key.`);
  }

  if (/\b(TODO|FIXME|Lorem ipsum|placeholder|translation missing|replace me)\b|{{|}}/i.test(visibleText)) {
    fail(`${entry.loc} contains placeholder text or unreplaced template markers.`);
  }
}

function getVisibleHtmlText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findPrerenderHtmlForEntry(entry) {
  if (!existsSync(distBrowserRoot)) {
    return undefined;
  }

  const publicUrl = new URL(entry.loc);
  const htmlPath = join(distBrowserRoot, publicUrl.pathname.replace(/^\/+/, ''), 'index.html');
  return existsSync(htmlPath) ? htmlPath : undefined;
}

function assertIncludes(file, fragment, message) {
  if (!readText(file).includes(fragment)) {
    fail(`${message} Missing "${fragment}" in ${formatPath(file)}.`);
  }
}

function extractComponentClassNames(text) {
  return [...text.matchAll(/\bclass\s+([A-Za-z0-9_]+Component)\b/g)].map((match) => match[1]);
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

function getAttribute(tag, attribute) {
  const match = tag.match(new RegExp(`\\b${attribute}=["']([^"']+)["']`, 'i'));
  return match?.[1];
}

function readText(file) {
  return readFileSync(file, 'utf8');
}

function formatPath(file) {
  return relative(frontendRoot, file).replaceAll('\\', '/');
}

function fail(message) {
  errors.push(message);
}

function camelToKebab(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function toPascalCase(value) {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function toPascalComponentToken(value) {
  return escapeRegExp(toPascalCase(value));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
