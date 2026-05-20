import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { AuthStore } from './auth.store';

export const authGuard: CanActivateFn = (_route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  const auth = inject(AuthStore);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }

  return auth.refreshSession().then(async (token) => {
    if (token) {
      try {
        await auth.loadMe();
        return true;
      } catch {
        auth.clearSession();
      }
    }

    return router.createUrlTree(['/auth/login'], { queryParams: { redirect: safeRedirectUrl(state.url) ?? undefined } });
  });
};

export const guestGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  const redirect = safeRedirectUrl(route.queryParamMap.get('redirect'));

  return auth.isAuthenticated() ? router.parseUrl(redirect ?? '/dashboard') : true;
};

function safeRedirectUrl(url: string | null): string | null {
  if (!url || !url.startsWith('/') || url.startsWith('//') || url.includes('://')) {
    return null;
  }

  return url;
}
