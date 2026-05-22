import { guestGuard } from './core/auth/auth.guard';
import { routes } from './app.routes';

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
});
