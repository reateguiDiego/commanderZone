import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const workspaceRoot = process.cwd();
const distBrowserRoot = join(workspaceRoot, 'dist', 'frontend', 'browser');
const canonicalOrigin = 'https://www.commanderzone.com';
const legalPages = [
  { locale: 'en', path: '/privacy-policy/', h1: 'Privacy Policy' },
  { locale: 'en', path: '/cookie-policy/', h1: 'Cookie Policy' },
  { locale: 'en', path: '/terms/', h1: 'Terms of Use' },
  { locale: 'es', path: '/es/politica-privacidad/', h1: 'Política de privacidad' },
  { locale: 'es', path: '/es/politica-cookies/', h1: 'Política de cookies' },
  { locale: 'es', path: '/es/terminos/', h1: 'Términos de uso' },
  { locale: 'de', path: '/de/datenschutzerklaerung/', h1: 'Datenschutzerklärung' },
  { locale: 'de', path: '/de/cookie-richtlinie/', h1: 'Cookie-Richtlinie' },
  { locale: 'de', path: '/de/nutzungsbedingungen/', h1: 'Nutzungsbedingungen' },
  { locale: 'fr', path: '/fr/politique-confidentialite/', h1: 'Politique de confidentialité' },
  { locale: 'fr', path: '/fr/politique-cookies/', h1: 'Politique relative aux cookies' },
  { locale: 'fr', path: '/fr/conditions-utilisation/', h1: 'Conditions d’utilisation' },
  { locale: 'pt', path: '/pt/politica-privacidade/', h1: 'Política de privacidade' },
  { locale: 'pt', path: '/pt/politica-cookies/', h1: 'Política de cookies' },
  { locale: 'pt', path: '/pt/termos/', h1: 'Termos de uso' },
  { locale: 'it', path: '/it/privacy-policy/', h1: 'Informativa sulla privacy' },
  { locale: 'it', path: '/it/cookie-policy/', h1: 'Cookie policy' },
  { locale: 'it', path: '/it/termini/', h1: 'Termini di utilizzo' },
];
const errors = [];

validateSourceContracts();
validateLegalPagesAreNotIndexableAssets();
validatePrerenderedLegalHtmlWhenAvailable();

if (errors.length > 0) {
  console.error('Legal page validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Legal page validation passed (${legalPages.length} localized noindex pages checked).`);

function validateSourceContracts() {
  const pageStrategies = readText('src/app/core/localization/page-translation-strategy.ts');
  const serverRoutes = readText('src/app/app.routes.server.ts');
  const appRoutes = readText('src/app/app.routes.ts');
  const legalRoutes = readText('src/app/core/legal/legal-routes.ts');
  const featureLegalRoutes = readText('src/app/features/legal/legal.routes.ts');
  const contactConfig = readText('src/app/core/contact/contact.config.ts');
  const legalContent = readText('src/app/features/legal/legal-page.content.ts');

  if (!pageStrategies.includes("legal: 'runtime-i18n'")) {
    fail('Legal routes must use runtime-i18n with explicit legal robots handling for noindex, follow.');
  }

  if (!serverRoutes.includes('LEGAL_PRERENDER_ROUTES')) {
    fail('Server routes must prerender LEGAL_PRERENDER_ROUTES.');
  }

  if (!appRoutes.includes("import { LEGAL_ROUTES } from './features/legal/legal.routes';")) {
    fail('App routes must import LEGAL_ROUTES from the legal feature routes.');
  }

  const seoRoutesIndex = appRoutes.indexOf('...SEO_LANDING_ROUTES');
  const legalRoutesIndex = appRoutes.indexOf('...LEGAL_ROUTES');
  const firstAuthRouteIndex = appRoutes.indexOf("path: 'auth/login'");

  if (seoRoutesIndex === -1 || legalRoutesIndex === -1 || firstAuthRouteIndex === -1) {
    fail('App routes must include SEO_LANDING_ROUTES, LEGAL_ROUTES, and auth routes explicitly.');
  } else if (legalRoutesIndex < seoRoutesIndex || legalRoutesIndex > firstAuthRouteIndex) {
    fail('App routes must register LEGAL_ROUTES after SEO_LANDING_ROUTES and before auth/app routes.');
  }

  if (!featureLegalRoutes.includes('LegalPageComponent')) {
    fail('Legal feature routes must render LegalPageComponent.');
  }

  if (!legalRoutes.includes('LEGAL_CONTACT_EMAIL = PUBLIC_CONTACT_EMAIL')) {
    fail('Legal contact email must reuse the shared public contact config.');
  }

  if (!contactConfig.includes('info.dev.sunrise@gmail.com')) {
    fail('Public legal/contact email must be info.dev.sunrise@gmail.com.');
  }

  for (const requiredText of [
    'LEGAL_OWNER_COUNTRY = \'España\'',
    'commanderzone.refresh',
    'mercureAuthorization',
    'commanderzone.cookieConsent',
    'commanderzone.user',
    'commanderzone.theme',
    'commanderzone.deck-history.*',
    'commanderzone.missing-watchlist',
    'CommanderZone no usa cookies de analítica',
    'ni trata la publicidad como consentida',
  ]) {
    if (!legalContent.includes(requiredText)) {
      fail(`Legal content must include production cookie/privacy text: ${requiredText}`);
    }
  }

  for (const forbiddenText of [
    'analítica opcional',
    'Analítica opcional',
    'optional analytics',
    'Optional analytics',
  ]) {
    if (legalContent.includes(forbiddenText)) {
      fail(`Legal content must not describe analytics as an optional active purpose: ${forbiddenText}`);
    }
  }
}

function validateLegalPagesAreNotIndexableAssets() {
  const sitemap = readText('public/sitemaps/sitemap-seo.xml');
  const prerenderRoutes = readText('src/seo-prerender-routes.txt');
  const combinedPrerenderRoutes = readText('src/prerender-routes.txt');
  const combinedPrerenderRouteList = combinedPrerenderRoutes.split(/\r?\n/).filter(Boolean);

  for (const authRoute of ['/auth/login/', '/auth/register/']) {
    if (combinedPrerenderRouteList.includes(authRoute)) {
      fail(`Auth route must not appear in combined prerender manifest: ${authRoute}`);
    }

    if (prerenderRoutes.split(/\r?\n/).includes(authRoute)) {
      fail(`Auth route must not appear in SEO prerender manifest: ${authRoute}`);
    }

    if (sitemap.includes(`${canonicalOrigin}${authRoute}`)) {
      fail(`Auth route must not appear in sitemap: ${authRoute}`);
    }
  }

  for (const page of legalPages) {
    const absoluteUrl = `${canonicalOrigin}${page.path}`;

    if (sitemap.includes(absoluteUrl)) {
      fail(`Legal noindex page must not appear in sitemap: ${absoluteUrl}`);
    }

    if (prerenderRoutes.split(/\r?\n/).includes(page.path)) {
      fail(`Legal noindex page must not appear in SEO prerender manifest: ${page.path}`);
    }

    if (!combinedPrerenderRouteList.includes(page.path)) {
      fail(`Legal noindex page must appear in combined prerender manifest: ${page.path}`);
    }
  }
}

function validatePrerenderedLegalHtmlWhenAvailable() {
  if (!existsSync(distBrowserRoot)) {
    return;
  }

  for (const page of legalPages) {
    const htmlPath = join(distBrowserRoot, page.path.replace(/^\/+/, ''), 'index.html');
    if (!existsSync(htmlPath)) {
      fail(`Missing prerendered legal HTML for ${page.path}.`);
      continue;
    }

    validateLegalHtml(page, readFileSync(htmlPath, 'utf8'));
  }
}

function validateLegalHtml(page, html) {
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0];
  const h1Tags = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) ?? [];
  const robotsTags = html.match(/<meta\b(?=[^>]*\bname=["']robots["'])[^>]*>/gi) ?? [];
  const canonicalTags = html.match(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/gi) ?? [];
  const alternateTags = html.match(/<link\b(?=[^>]*\brel=["']alternate["'])[^>]*>/gi) ?? [];
  const jsonLdTags = html.match(/<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi) ?? [];
  const visibleText = visibleHtmlText(html);

  if (getAttribute(htmlTag ?? '', 'lang') !== page.locale) {
    fail(`${page.path} html lang must be ${page.locale}.`);
  }

  if (h1Tags.length !== 1 || !visibleHtmlText(h1Tags[0]).includes(page.h1)) {
    fail(`${page.path} must render exactly one localized H1: ${page.h1}.`);
  }

  if (visibleText.includes('Play Commander online with your pod')) {
    fail(`${page.path} must render legal content, not the home landing.`);
  }

  if (!visibleText.includes('CommanderZone') || !visibleText.includes('Wizards')) {
    fail(`${page.path} must render public legal content and fan-content disclaimer.`);
  }

  if (robotsTags.length !== 1 || getAttribute(robotsTags[0], 'content') !== 'noindex, follow') {
    fail(`${page.path} must render exactly one noindex, follow robots meta tag.`);
  }

  if (canonicalTags.length !== 1 || getAttribute(canonicalTags[0], 'href') !== `${canonicalOrigin}${page.path}`) {
    fail(`${page.path} must render a self-referencing canonical.`);
  }

  if (alternateTags.length > 0) {
    fail(`${page.path} must not render hreflang alternates while legal pages stay noindex.`);
  }

  for (const jsonLdTag of jsonLdTags) {
    const jsonLd = jsonLdTag.replace(/<script\b[^>]*>/i, '').replace(/<\/script>/i, '').trim();
    if (/"@type"\s*:\s*"(?:FAQPage|SoftwareApplication|WebApplication)"/.test(jsonLd)) {
      fail(`${page.path} must not render FAQPage, SoftwareApplication or WebApplication structured data.`);
    }
  }
}

function readText(relativePath) {
  return readFileSync(join(workspaceRoot, relativePath), 'utf8');
}

function visibleHtmlText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getAttribute(tag, attribute) {
  return tag.match(new RegExp(`\\b${attribute}=["']([^"']+)["']`, 'i'))?.[1];
}

function fail(message) {
  errors.push(message);
}
