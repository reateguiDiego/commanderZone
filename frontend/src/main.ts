import { isPublicStaticPath, normalizeBrowserPath } from './app/core/routing/public-static-path';

const currentPath = normalizeBrowserPath(globalThis.location?.pathname ?? '/');

if (isPublicStaticPath(currentPath)) {
  preparePublicStaticPage(currentPath);
} else {
  preparePrivateAppPage();
  void import('./bootstrap-app')
    .then(({ bootstrapCommanderZoneApp }) => bootstrapCommanderZoneApp())
    .catch((error) => console.error(error));
}

function preparePublicStaticPage(path: string): void {
  const documentRef = globalThis.document;
  if (!documentRef) {
    return;
  }

  documentRef.body.classList.add('cz-public-route');
  ensureStylesheet(documentRef, 'cz-public-route-stylesheet', '/route-styles/seo-public.css');
  removeInactiveCookieBanner(documentRef);

  if (path === '/' && hasStoredUserSession()) {
    globalThis.location.assign('/dashboard');
  }
}

function preparePrivateAppPage(): void {
  const documentRef = globalThis.document;
  if (!documentRef) {
    return;
  }

  documentRef.body.classList.add('cz-private-route');
  ensureStylesheet(documentRef, 'cz-private-route-stylesheet', '/route-styles/app-private.css');
}

function ensureStylesheet(documentRef: Document, id: string, href: string): void {
  if (documentRef.getElementById(id)) {
    return;
  }

  const link = documentRef.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = href;
  documentRef.head.appendChild(link);
}

function removeInactiveCookieBanner(documentRef: Document): void {
  documentRef.querySelector('app-cookie-consent-banner')?.remove();
}

function hasStoredUserSession(): boolean {
  try {
    return globalThis.localStorage?.getItem('commanderzone.user') !== null;
  } catch {
    return false;
  }
}
