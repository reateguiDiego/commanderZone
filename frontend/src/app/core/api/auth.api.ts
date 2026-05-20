import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import {
  EmailVerificationConfirmResponse,
  EmailVerificationRequestResponse,
  LoginResponse,
  PasswordResetConfirmResponse,
  PasswordResetRequestResponse,
  UserResponse,
} from '../models/api-responses.model';
import { withoutGlobalLoading } from '../loading/loading-context';
import { UserAvatarType } from '../models/user.model';

export interface AuthAvailabilityResponse {
  available: boolean;
}

export type AvatarUpdatePayload =
  | {
      type: Extract<UserAvatarType, 'initial'>;
      letter?: string;
      backgroundColor?: string;
      textColor?: string;
    }
  | { type: Extract<UserAvatarType, 'preset'>; imageUrl: string }
  | { type: Extract<UserAvatarType, 'upload'>; imageData: string };

export interface DisplayNameStyleUpdatePayload {
  presetId: string;
  textColor?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);

  register(payload: { email: string; displayName: string; password: string }): Observable<UserResponse> {
    return this.http.post<UserResponse>(`${API_BASE_URL}/auth/register`, payload);
  }

  login(payload: { email: string; password: string }): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${API_BASE_URL}/auth/login`, payload, { withCredentials: true });
  }

  requestPasswordReset(email: string): Observable<PasswordResetRequestResponse> {
    return this.http.post<PasswordResetRequestResponse>(
      `${API_BASE_URL}/auth/password-reset/request`,
      { email },
      { context: withoutGlobalLoading() },
    );
  }

  confirmPasswordReset(payload: { email: string; token: string; newPassword: string }): Observable<PasswordResetConfirmResponse> {
    return this.http.post<PasswordResetConfirmResponse>(
      `${API_BASE_URL}/auth/password-reset/confirm`,
      payload,
      { context: withoutGlobalLoading(), withCredentials: true },
    );
  }

  requestEmailVerification(email: string): Observable<EmailVerificationRequestResponse> {
    return this.http.post<EmailVerificationRequestResponse>(
      `${API_BASE_URL}/auth/email-verification/request`,
      { email },
      { context: withoutGlobalLoading() },
    );
  }

  confirmEmailVerification(payload: { token: string }): Observable<EmailVerificationConfirmResponse> {
    return this.http.post<EmailVerificationConfirmResponse>(
      `${API_BASE_URL}/auth/email-verification/confirm`,
      payload,
      { context: withoutGlobalLoading(), withCredentials: true },
    );
  }

  refresh(): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(
      `${API_BASE_URL}/auth/refresh`,
      null,
      { context: withoutGlobalLoading(), withCredentials: true },
    );
  }

  logout(): Observable<void> {
    return this.http.post<void>(
      `${API_BASE_URL}/auth/logout`,
      null,
      { context: withoutGlobalLoading(), withCredentials: true },
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

  updateMe(payload: { email?: string; displayName?: string }): Observable<UserResponse> {
    return this.http.patch<UserResponse>(`${API_BASE_URL}/me`, payload);
  }

  updateAvatar(payload: AvatarUpdatePayload): Observable<UserResponse> {
    return this.http.patch<UserResponse>(`${API_BASE_URL}/me/avatar`, payload);
  }

  updateDisplayNameStyle(payload: DisplayNameStyleUpdatePayload): Observable<UserResponse> {
    return this.http.patch<UserResponse>(`${API_BASE_URL}/me/display-name-style`, payload);
  }

  deleteMe(): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/me`);
  }

  offline(): Observable<void> {
    return this.http.post<void>(`${API_BASE_URL}/me/offline`, null, { context: withoutGlobalLoading() });
  }
}
