import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../api/api.config';
import { AuthApi } from '../api/auth.api';
import { User } from '../models/user.model';
import { AppBackgroundService } from '../ui/app-background.service';

const TOKEN_KEY = 'commanderzone.jwt';
const USER_KEY = 'commanderzone.user';

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly authApi = inject(AuthApi);
  private readonly appBackground = inject(AppBackgroundService);
  private readonly tokenState = signal<string | null>(readStoredToken());
  private readonly userState = signal<User | null>(readStoredUser());
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly resolvedDisplayNameState = signal<string | null>(readStoredDisplayName());
  private initialized = false;

  readonly token = this.tokenState.asReadonly();
  readonly user = this.userState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly isAuthenticated = computed(() => this.tokenState() !== null);
  readonly displayName = computed(() => this.currentDisplayName());

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    if (this.tokenState()) {
      await this.loadMe();
    }
  }

  async login(email: string, password: string): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);

    try {
      const response = await firstValueFrom(this.authApi.login({ email, password }));
      await this.establishSession(response.token);
    } catch (error) {
      this.clearSession();
      this.errorState.set(errorMessageFromResponse(error, 'Could not login.'));
      throw error;
    } finally {
      this.loadingState.set(false);
    }
  }

  async register(email: string, displayName: string, password: string): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);

    try {
      await firstValueFrom(this.authApi.register({ email, displayName, password }));
    } catch (error) {
      this.errorState.set(errorMessageFromResponse(error, 'Could not create account.'));
      throw error;
    } finally {
      this.loadingState.set(false);
    }
  }

  async loginWithToken(token: string): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);

    try {
      await this.establishSession(token);
    } catch (error) {
      this.clearSession();
      this.errorState.set(errorMessageFromResponse(error, 'Could not complete login.'));
      throw error;
    } finally {
      this.loadingState.set(false);
    }
  }

  async loginWithResolvedUser(token: string, user: User): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);

    try {
      this.setToken(token);
      this.setUser(user);
      this.appBackground.useNewSessionBackground();
    } catch (error) {
      this.clearSession();
      this.errorState.set(errorMessageFromResponse(error, 'Could not complete login.'));
      throw error;
    } finally {
      this.loadingState.set(false);
    }
  }

  async loadMe(): Promise<void> {
    const requestToken = this.tokenState();
    if (!requestToken) {
      return;
    }

    try {
      const response = await firstValueFrom(this.authApi.me());
      if (this.tokenState() !== requestToken) {
        return;
      }
      this.setUser(response.user);
    } catch (error) {
      if (this.tokenState() === requestToken) {
        this.clearSession();
      }
      throw error;
    }
  }

  async logout(): Promise<void> {
    await this.markOffline();
    this.clearSession();
    this.appBackground.useNewSessionBackground();
  }

  async markOffline(): Promise<void> {
    if (!this.tokenState()) {
      return;
    }

    try {
      await firstValueFrom(this.authApi.offline());
    } catch {
      // Logout must not leave a stale local session if the presence update fails.
    }
  }

  markOfflineOnUnload(): void {
    const token = this.tokenState();
    if (!token) {
      return;
    }

    try {
      void fetch(`${API_BASE_URL}/me/offline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        keepalive: true,
      });
    } catch {
      // Browsers can cancel unload requests; presence also expires by timeout.
    }
  }

  clearSession(): void {
    this.tokenState.set(null);
    this.userState.set(null);
    this.resolvedDisplayNameState.set(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  clearError(): void {
    this.errorState.set(null);
  }

  private setToken(token: string): void {
    this.tokenState.set(token);
    localStorage.setItem(TOKEN_KEY, token);
  }

  private setUser(user: User): void {
    const normalizedUser = this.normalizeUser(user);
    this.userState.set(normalizedUser);
    this.resolvedDisplayNameState.set(normalizedUser.displayName);
    localStorage.setItem(USER_KEY, JSON.stringify(normalizedUser));
  }

  private async establishSession(token: string): Promise<void> {
    this.setToken(token);
    this.userState.set(null);
    this.resolvedDisplayNameState.set(null);
    await this.loadMe();
    this.appBackground.useNewSessionBackground();
  }

  private normalizeUser(user: User): User {
    const normalizedDisplayName = (user.displayName ?? '').trim();
    if (normalizedDisplayName !== '') {
      return { ...user, displayName: normalizedDisplayName };
    }

    const previousDisplayName = (this.userState()?.displayName ?? '').trim();
    if (previousDisplayName !== '') {
      return { ...user, displayName: previousDisplayName };
    }

    const email = (user.email ?? '').trim();
    if (email.includes('@')) {
      const localPart = email.split('@')[0]?.trim();
      if (localPart) {
        return { ...user, displayName: localPart };
      }
    }

    return { ...user, displayName: 'Player' };
  }

  private currentDisplayName(): string | null {
    const liveDisplayName = (this.userState()?.displayName ?? '').trim();
    if (liveDisplayName !== '') {
      return liveDisplayName;
    }

    const liveEmailDisplayName = displayNameFromEmail(this.userState()?.email ?? null);
    if (liveEmailDisplayName) {
      return liveEmailDisplayName;
    }

    const resolvedDisplayName = (this.resolvedDisplayNameState() ?? '').trim();
    if (resolvedDisplayName !== '') {
      return resolvedDisplayName;
    }

    return null;
  }
}

function readStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function readStoredUser(): User | null {
  const rawUser = localStorage.getItem(USER_KEY);
  if (!rawUser) {
    return null;
  }

  try {
    return JSON.parse(rawUser) as User;
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

function readStoredDisplayName(): string | null {
  const user = readStoredUser();
  const displayName = (user?.displayName ?? '').trim();
  return displayName !== '' ? displayName : null;
}

function displayNameFromEmail(email: string | null): string | null {
  const normalizedEmail = (email ?? '').trim();
  if (!normalizedEmail.includes('@')) {
    return null;
  }

  const localPart = normalizedEmail.split('@')[0]?.trim();
  return localPart ? localPart : null;
}

function errorMessageFromResponse(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) {
    return fallback;
  }

  const responseError = error.error as { error?: unknown; message?: unknown } | string | null;
  if (typeof responseError === 'string' && responseError.trim()) {
    return responseError;
  }

  if (responseError && typeof responseError === 'object') {
    if (typeof responseError.error === 'string' && responseError.error.trim()) {
      return responseError.error;
    }

    if (typeof responseError.message === 'string' && responseError.message.trim()) {
      return responseError.message;
    }
  }

  return fallback;
}
