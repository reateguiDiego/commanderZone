import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { API_BASE_URL } from '../api/api.config';
import { AuthStore } from './auth.store';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  const retryHeader = 'X-Auth-Refresh-Retry';
  const requestToken = auth.token();
  const isApiRequest = request.url.startsWith(API_BASE_URL);
  const isRefreshEndpoint = request.url === `${API_BASE_URL}/auth/refresh`;
  const isRetriedRequest = request.headers.has(retryHeader);

  const authorizedRequest =
    requestToken && isApiRequest && !isRefreshEndpoint
      ? request.clone({ setHeaders: { Authorization: `Bearer ${requestToken}` } })
      : request;

  return next(authorizedRequest).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse
        && error.status === 401
        && requestToken
        && isApiRequest
        && auth.token() === requestToken
      ) {
        if (!isRetriedRequest && !isRefreshEndpoint) {
          return from(auth.refreshSession()).pipe(
            switchMap((refreshedToken) => {
              if (!refreshedToken) {
                auth.clearSession();
                void router.navigate(['/auth/login']);
                return throwError(() => error);
              }

              const retryRequest = request.clone({
                setHeaders: {
                  Authorization: `Bearer ${refreshedToken}`,
                  [retryHeader]: '1',
                },
              });

              return next(retryRequest);
            }),
          );
        }

        auth.clearSession();
        void router.navigate(['/auth/login']);
      }

      return throwError(() => error);
    }),
  );
};
