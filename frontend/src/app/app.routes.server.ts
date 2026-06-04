import { RenderMode, ServerRoute } from '@angular/ssr';
import { LEGAL_PRERENDER_ROUTES } from './core/legal/legal-routes';
import { SEO_PRERENDER_ROUTES, toAngularServerRoutePath } from './core/localization/seo-prerender-routes';

const seoServerRoutes: ServerRoute[] = SEO_PRERENDER_ROUTES.map((path): ServerRoute => ({
  path: toAngularServerRoutePath(path),
  renderMode: RenderMode.Prerender,
}));
const legalServerRoutes: ServerRoute[] = LEGAL_PRERENDER_ROUTES.map((path): ServerRoute => ({
  path: toAngularServerRoutePath(path),
  renderMode: RenderMode.Prerender,
}));

export const serverRoutes: ServerRoute[] = [
  ...seoServerRoutes,
  ...legalServerRoutes,
  { path: 'auth/login', renderMode: RenderMode.Client },
  { path: 'auth/register', renderMode: RenderMode.Client },
  { path: 'auth/password-reset', renderMode: RenderMode.Client },
  { path: 'email-verification', renderMode: RenderMode.Client },
  { path: 'games/:id/debug', renderMode: RenderMode.Client },
  { path: 'games/:id', renderMode: RenderMode.Client },
  { path: 'dashboard', renderMode: RenderMode.Client },
  { path: 'profile', renderMode: RenderMode.Client },
  { path: 'settings', renderMode: RenderMode.Client },
  { path: 'account', renderMode: RenderMode.Client },
  { path: 'cards', renderMode: RenderMode.Client },
  { path: 'cards/:scryfallId', renderMode: RenderMode.Client },
  { path: 'decks', renderMode: RenderMode.Client },
  { path: 'decks/:id', renderMode: RenderMode.Client },
  { path: 'rooms', renderMode: RenderMode.Client },
  { path: 'rooms/:id/waiting', renderMode: RenderMode.Client },
  { path: 'table-assistant', renderMode: RenderMode.Client },
  { path: 'table-assistant/:id', renderMode: RenderMode.Client },
  { path: 'room/:id', renderMode: RenderMode.Client },
  { path: 'welcome', renderMode: RenderMode.Client },
  { path: '**', renderMode: RenderMode.Server, status: 404 },
];
