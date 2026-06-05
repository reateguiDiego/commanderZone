import { guestGuard } from './core/auth/auth.guard';
import { PAGE_TRANSLATION_STRATEGIES, PageKey } from './core/localization/page-translation-strategy';
import { getPageRobotsMeta } from './core/seo/route-robots';
import { routes } from './app.routes';
import { Route } from '@angular/router';

describe('app routes', () => {
  it('serves the root path as the public English SEO home with guest redirect for authenticated users', async () => {
    const rootRoute = routes.find((route) => route.path === '' && route.pathMatch === 'full');
    const componentLoader = rootRoute?.loadComponent as (() => Promise<{ name: string }>) | undefined;
    const component = componentLoader ? await componentLoader() : undefined;

    expect(rootRoute).toBeDefined();
    expect(rootRoute?.canActivate).toEqual([guestGuard]);
    expect(rootRoute?.data?.['pageKey']).toBe('home');
    expect(rootRoute?.data?.['routeKey']).toBe('home');
    expect(rootRoute?.data?.['locale']).toBe('en');
    expect(rootRoute?.data?.['authenticatedRedirect']).toBe('/dashboard');
    expect(component?.name).toMatch(/SeoLandingRouteComponent$/);
  });

  it('keeps onboarding on /welcome behind guestGuard', async () => {
    const welcomeRoute = routes.find((route) => route.path === 'welcome');
    const componentLoader = welcomeRoute?.loadComponent as (() => Promise<{ name: string }>) | undefined;
    const component = componentLoader ? await componentLoader() : undefined;

    expect(welcomeRoute).toBeDefined();
    expect(welcomeRoute?.canActivate).toEqual([guestGuard]);
    expect(welcomeRoute?.data?.['pageKey']).toBe('app');
    expect(component?.name).toMatch(/OnboardingPageComponent$/);
  });

  it('renders a not-found page for wildcard routes instead of redirecting to home or dashboard', async () => {
    const wildcardRoute = routes.find((route) => route.path === '**');
    const componentLoader = wildcardRoute?.loadComponent as (() => Promise<{ name: string }>) | undefined;
    const component = componentLoader ? await componentLoader() : undefined;

    expect(wildcardRoute?.redirectTo).toBeUndefined();
    expect(wildcardRoute?.data?.['pageKey']).toBe('wildcardRedirect');
    expect(wildcardRoute?.title).toBeUndefined();
    expect(component?.name).toMatch(/NotFoundPageComponent$/);
  });

  it('declares robots behavior for every configured route with a page key', () => {
    for (const route of flattenRoutes(routes)) {
      const pageKey = route.data?.['pageKey'];

      expect(pageKey).toBeDefined();
      expect(isPageKey(pageKey)).toBe(true);

      if (isPageKey(pageKey)) {
        expect(getPageRobotsMeta(pageKey)).toBe(expectedRobotsFor(pageKey));
      }
    }
  });
});

function flattenRoutes(routeList: readonly Route[]): Route[] {
  return routeList.flatMap((route) => [
    route,
    ...flattenRoutes(route.children ?? []),
  ]);
}

function isPageKey(value: unknown): value is PageKey {
  return typeof value === 'string' && value in PAGE_TRANSLATION_STRATEGIES;
}

function expectedRobotsFor(pageKey: PageKey): 'index, follow' | 'noindex, follow' | 'noindex, nofollow' {
  if (pageKey === 'legal') {
    return 'noindex, follow';
  }

  if (pageKey === 'wildcardRedirect') {
    return 'noindex, nofollow';
  }

  const strategy = PAGE_TRANSLATION_STRATEGIES[pageKey];

  if (strategy === 'seo-static') {
    return 'index, follow';
  }

  if (strategy === 'runtime-i18n') {
    return 'noindex, nofollow';
  }

  return 'noindex, nofollow';
}
