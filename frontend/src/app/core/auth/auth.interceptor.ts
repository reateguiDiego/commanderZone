import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { API_BASE_URL } from '../api/api.config';
import { AuthStore } from './auth.store';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  const requestToken = auth.token();
  const isApiRequest = request.url.startsWith(API_BASE_URL);

  const authorizedRequest =
    requestToken && isApiRequest
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
        auth.clearSession();
        void router.navigate(['/auth/login']);
      }

      return throwError(() => error);
    }),
  );
};
