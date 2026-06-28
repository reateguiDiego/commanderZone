import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize } from 'rxjs';
import { GlobalLoadingFeaturePolicy } from './global-loading-feature-policy.service';
import { FORCE_GLOBAL_LOADING, GLOBAL_LOADING_ENABLED_FEATURES, SKIP_GLOBAL_LOADING } from './loading-context';
import { LoadingStore } from './loading.store';

export const loadingInterceptor: HttpInterceptorFn = (request, next) => {
  const forced = request.context.get(FORCE_GLOBAL_LOADING);
  const enabledFeatures = request.context.get(GLOBAL_LOADING_ENABLED_FEATURES);
  const featurePolicy = inject(GlobalLoadingFeaturePolicy);

  if (!forced && enabledFeatures.length > 0 && !featurePolicy.matchesCurrentFeature(enabledFeatures)) {
    return next(request);
  }

  if (!forced && (request.context.get(SKIP_GLOBAL_LOADING) || featurePolicy.skipsCurrentFeature())) {
    return next(request);
  }

  const loading = inject(LoadingStore);

  loading.start();

  return next(request).pipe(finalize(() => loading.stop()));
};
