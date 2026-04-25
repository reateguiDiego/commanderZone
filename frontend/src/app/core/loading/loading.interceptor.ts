import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize } from 'rxjs';
import { LoadingStore } from './loading.store';

export const loadingInterceptor: HttpInterceptorFn = (request, next) => {
  const loading = inject(LoadingStore);

  loading.start();

  return next(request).pipe(finalize(() => loading.stop()));
};
