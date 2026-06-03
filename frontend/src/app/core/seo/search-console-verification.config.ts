import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';

export const SEARCH_CONSOLE_VERIFICATION_TOKEN = new InjectionToken<string>(
  'CommanderZone Google Search Console verification token',
  {
    providedIn: 'root',
    factory: () => normalizeSearchConsoleVerificationToken(environment.googleSearchConsoleVerification),
  },
);

export function normalizeSearchConsoleVerificationToken(token: string | null | undefined): string {
  return (token ?? '').trim();
}
