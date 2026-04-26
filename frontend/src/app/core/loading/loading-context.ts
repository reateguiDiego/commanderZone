import { HttpContext, HttpContextToken } from '@angular/common/http';

export const SKIP_GLOBAL_LOADING = new HttpContextToken<boolean>(() => false);

export function withoutGlobalLoading(): HttpContext {
  return new HttpContext().set(SKIP_GLOBAL_LOADING, true);
}
