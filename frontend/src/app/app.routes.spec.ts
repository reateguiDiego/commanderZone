import { guestGuard } from './core/auth/auth.guard';
import { PAGE_TRANSLATION_STRATEGIES, PageKey } from './core/localization/page-translation-strategy';
import { getPageRobotsMeta } from './core/seo/route-robots';
import { routes } from './app.routes';
import { Route } from '@angular/router';

describe('app routes', () => {
  it('protects the root landing route with guestGuard', () => {
    const rootRoute = routes.find((route) => route.path === '' && route.pathMatch === 'full');

    expect(rootRoute).toBeDefined();
    expect(rootRoute?.canActivate).toEqual([guestGuard]);
  });

  it('keeps onboarding as the root landing component', async () => {
    const rootRoute = routes.find((route) => route.path === '' && route.pathMatch === 'full');
    const componentLoader = rootRoute?.loadComponent as (() => Promise<{ name: string }>) | undefined;
    const component = componentLoader ? await componentLoader() : undefined;

    expect(component?.name).toMatch(/OnboardingPageComponent$/);
  });

  it('renders a not-found page for wildcard routes instead of redirecting to home or dashboard', async () => {
    const wildcardRoute = routes.find((route) => route.path === '**');
    const componentLoader = wildcardRoute?.loadComponent as (() => Promise<{ name: string }>) | undefined;
    const component = componentLoader ? await componentLoader() : undefined;

    expect(wildcardRoute?.redirectTo).toBeUndefined();
    expect(wildcardRoute?.data?.['pageKey']).toBe('wildcardRedirect');
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
  const strategy = PAGE_TRANSLATION_STRATEGIES[pageKey];

  if (strategy === 'seo-static') {
    return 'index, follow';
  }

  if (strategy === 'runtime-i18n') {
    return 'noindex, follow';
  }

  return 'noindex, nofollow';
}
