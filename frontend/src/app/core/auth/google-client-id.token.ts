import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';
import { runtimeGoogleClientId } from '../config/runtime-config';

export const GOOGLE_CLIENT_ID = new InjectionToken<string>('Google OAuth client id', {
  providedIn: 'root',
  factory: () => runtimeGoogleClientId() || environment.googleClientId,
});
