import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { LoginResponse, PasswordResetConfirmResponse, PasswordResetRequestResponse, UserResponse } from '../models/api-responses.model';
import { withoutGlobalLoading } from '../loading/loading-context';

export interface AuthAvailabilityResponse {
  available: boolean;
}

@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);

  register(payload: { email: string; displayName: string; password: string }): Observable<UserResponse> {
    return this.http.post<UserResponse>(`${API_BASE_URL}/auth/register`, payload);
  }

  login(payload: { email: string; password: string }): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${API_BASE_URL}/auth/login`, payload);
  }

  requestPasswordReset(email: string): Observable<PasswordResetRequestResponse> {
    return this.http.post<PasswordResetRequestResponse>(
      `${API_BASE_URL}/auth/password-reset/request`,
      { email },
      { context: withoutGlobalLoading() },
    );
  }

  confirmPasswordReset(payload: { email: string; newPassword: string }): Observable<PasswordResetConfirmResponse> {
    return this.http.post<PasswordResetConfirmResponse>(
      `${API_BASE_URL}/auth/password-reset/confirm`,
      payload,
      { context: withoutGlobalLoading() },
    );
  }

  checkEmailAvailability(email: string): Observable<AuthAvailabilityResponse> {
    return this.http.get<AuthAvailabilityResponse>(`${API_BASE_URL}/auth/email-availability`, {
      params: { email },
      context: withoutGlobalLoading(),
    });
  }

  checkDisplayNameAvailability(displayName: string): Observable<AuthAvailabilityResponse> {
    return this.http.get<AuthAvailabilityResponse>(`${API_BASE_URL}/auth/display-name-availability`, {
      params: { displayName },
      context: withoutGlobalLoading(),
    });
  }

  me(): Observable<UserResponse> {
    return this.http.get<UserResponse>(`${API_BASE_URL}/me`);
  }

  offline(): Observable<void> {
    return this.http.post<void>(`${API_BASE_URL}/me/offline`, null, { context: withoutGlobalLoading() });
  }
}
