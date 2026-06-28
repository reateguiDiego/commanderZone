import { HttpContext, HttpContextToken } from '@angular/common/http';

export const SKIP_GLOBAL_LOADING = new HttpContextToken<boolean>(() => false);
export const FORCE_GLOBAL_LOADING = new HttpContextToken<boolean>(() => false);
export const GLOBAL_LOADING_ENABLED_FEATURES = new HttpContextToken<readonly string[]>(() => []);

export function withoutGlobalLoading(): HttpContext {
  return new HttpContext().set(SKIP_GLOBAL_LOADING, true);
}

export function withGlobalLoading(): HttpContext {
  return new HttpContext().set(FORCE_GLOBAL_LOADING, true);
}

export function withGlobalLoadingForFeature(feature: string): HttpContext {
  return new HttpContext().set(GLOBAL_LOADING_ENABLED_FEATURES, [feature]);
}
