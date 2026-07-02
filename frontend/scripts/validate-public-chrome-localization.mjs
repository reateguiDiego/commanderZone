import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const workspaceRoot = process.cwd();
const distBrowserRoot = join(workspaceRoot, 'dist', 'frontend', 'browser');
const localizedHomes = [
  {
    locale: 'es',
    path: '/es/',
    expected: ['Idioma', 'Jugar Commander online', 'Preferencias de cookies', 'Rechazar', 'Aceptar', 'política de privacidad', 'Aviso legal'],
  },
  {
    locale: 'de',
    path: '/de/',
    expected: ['Sprache', 'Online spielen', 'Cookie-Einstellungen', 'Ablehnen', 'Akzeptieren', 'Datenschutzerklärung', 'Hinweis'],
  },
  {
    locale: 'fr',
    path: '/fr/',
    expected: ['Langue', 'Jouer en ligne', 'Préférences de cookies', 'Refuser', 'Accepter', 'politique de confidentialité', 'Mention légale'],
  },
  {
    locale: 'pt',
    path: '/pt/',
    expected: ['Idioma', 'Jogar Commander online', 'Preferências de cookies', 'Rejeitar', 'Aceitar', 'política de privacidade', 'Aviso legal'],
  },
  {
    locale: 'it',
    path: '/it/',
    expected: ['Lingua', 'Gioca online', 'Preferenze cookie', 'Rifiuta', 'Accetta', 'cookie policy', 'Avviso legale'],
  },
];
const forbiddenVisibleEnglish = [
  { label: 'Language', pattern: /\bLanguage\b/ },
  { label: 'Cookie preferences', pattern: /\bCookie preferences\b/ },
  { label: 'Reject', pattern: /\bReject\b/ },
  { label: 'Accept', pattern: /\bAccept\b/ },
  { label: 'privacy policy', pattern: /\bprivacy policy\b/ },
];
const errors = [];

validatePrerenderedHtmlWhenAvailable();

if (errors.length > 0) {
  console.error('Public chrome localization validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Public chrome localization validation passed (${localizedHomes.length} localized homes checked).`);

function validatePrerenderedHtmlWhenAvailable() {
  if (!existsSync(distBrowserRoot)) {
    return;
  }

  for (const page of localizedHomes) {
    const htmlPath = join(distBrowserRoot, page.path.replace(/^\/+/, ''), 'index.html');
    if (!existsSync(htmlPath)) {
      fail(`Missing prerendered localized home HTML for ${page.path}.`);
      continue;
    }

    validateLocalizedHome(page, readFileSync(htmlPath, 'utf8'));
  }
}

function validateLocalizedHome(page, html) {
  const visibleText = visibleHtmlText(html);

  for (const expectedText of page.expected) {
    if (!visibleText.includes(expectedText)) {
      fail(`${page.path} must render localized public chrome text: ${expectedText}.`);
    }
  }

  for (const forbiddenText of forbiddenVisibleEnglish) {
    if (forbiddenText.pattern.test(visibleText)) {
      fail(`${page.path} must not render fixed English public chrome text: ${forbiddenText.label}.`);
    }
  }
}

function visibleHtmlText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fail(message) {
  errors.push(message);
}
