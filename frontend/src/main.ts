import { isPublicStaticPath, normalizeBrowserPath } from './app/core/routing/public-static-path';
import { initializePublicStaticCookiePreferences } from './app/core/privacy/public-static-cookie-preferences';
import { DEFAULT_APP_THEME_ID } from './app/core/theme/theme-id';
import { browserLocalStorage, readStoredThemeId } from './app/core/theme/theme-storage';

const currentPath = normalizeBrowserPath(globalThis.location?.pathname ?? '/');

if (isPublicStaticPath(currentPath)) {
  preparePublicStaticPage(currentPath);
} else {
  void preparePrivateAppPage()
    .then(() => import('./bootstrap-app'))
    .then(({ bootstrapCommanderZoneApp }) => bootstrapCommanderZoneApp())
    .catch((error) => console.error(error));
}

function preparePublicStaticPage(path: string): void {
  const documentRef = globalThis.document;
  if (!documentRef) {
    return;
  }

  documentRef.body.classList.add('cz-public-route');
  void ensureStylesheet(documentRef, 'cz-public-route-stylesheet', '/route-styles/seo-public.css');
  initializePublicStaticCookiePreferences(documentRef);

  if (path === '/' && hasStoredUserSession()) {
    globalThis.location.assign('/dashboard');
  }
}

async function preparePrivateAppPage(): Promise<void> {
  const documentRef = globalThis.document;
  if (!documentRef) {
    return;
  }

  documentRef.body.classList.add('cz-private-route');
  applyStoredTheme(documentRef);
  await Promise.all([
    ensureStylesheet(documentRef, 'cz-private-theme-stylesheet', '/route-styles/themes.css'),
    ensureStylesheet(documentRef, 'cz-private-route-stylesheet', '/route-styles/app-private.css'),
  ]);
}

function applyStoredTheme(documentRef: Document): void {
  const themeId = readStoredThemeId(browserLocalStorage()) ?? DEFAULT_APP_THEME_ID;
  documentRef.documentElement.setAttribute('data-theme', themeId);
}

function ensureStylesheet(documentRef: Document, id: string, href: string): Promise<void> {
  const existing = documentRef.getElementById(id);
  if (existing instanceof HTMLLinkElement) {
    return waitForStylesheet(existing);
  }

  const link = documentRef.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = href;
  documentRef.head.appendChild(link);

  return waitForStylesheet(link);
}

function waitForStylesheet(link: HTMLLinkElement): Promise<void> {
  if (link.sheet) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
  });
}

function hasStoredUserSession(): boolean {
  try {
    return globalThis.localStorage?.getItem('commanderzone.user') !== null;
  } catch {
    return false;
  }
}
