import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { AuthStore } from './auth.store';
import { canAccessAdmin } from './user-roles';

export const authGuard: CanActivateFn = (_route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  const auth = inject(AuthStore);
  const router = inject(Router);

  return auth.initialize().then(() => {
    if (auth.isAuthenticated()) {
      return true;
    }

    return router.createUrlTree(['/auth/login'], { queryParams: { redirect: safeRedirectUrl(state.url) ?? undefined } });
  });
};

export const guestGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const platformId = inject(PLATFORM_ID);

  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const auth = inject(AuthStore);
  const router = inject(Router);
  const queryRedirect = safeRedirectUrl(route.queryParamMap.get('redirect'));
  const dataRedirect = safeRedirectUrl(routeDataRedirect(route));
  const authenticatedRedirect = queryRedirect ?? dataRedirect ?? '/dashboard';

  return auth.initialize().then(() => auth.isAuthenticated() ? router.parseUrl(authenticatedRedirect) : true);
};

export const adminAccessGuard: CanActivateFn = (_route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  const auth = inject(AuthStore);
  const router = inject(Router);

  return auth.initialize().then(() => {
    if (!auth.isAuthenticated()) {
      return router.createUrlTree(['/auth/login'], { queryParams: { redirect: safeRedirectUrl(state.url) ?? undefined } });
    }

    return canAccessAdmin(auth.user()) ? true : router.parseUrl('/dashboard');
  });
};

function routeDataRedirect(route: ActivatedRouteSnapshot): string | null {
  const redirect = route.data?.['authenticatedRedirect'];
  return typeof redirect === 'string' ? redirect : null;
}

function safeRedirectUrl(url: string | null): string | null {
  if (!url || !url.startsWith('/') || url.startsWith('//') || url.includes('://')) {
    return null;
  }

  return url;
}
