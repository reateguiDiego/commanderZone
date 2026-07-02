import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../api/api.config';
import { AuthApi } from '../api/auth.api';
import { User } from '../models/user.model';
import { AppThemeId } from '../theme/app-theme';
import { AppThemeService } from '../theme/app-theme.service';
import { AppBackgroundService } from '../ui/app-background.service';

const LEGACY_TOKEN_KEY = 'commanderzone.jwt';
const USER_KEY = 'commanderzone.user';

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly authApi = inject(AuthApi);
  private readonly injector = inject(Injector);
  private readonly tokenState = signal<string | null>(null);
  private readonly userState = signal<User | null>(readStoredUser());
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly loginFailureCountState = signal<number | null>(null);
  private readonly resolvedDisplayNameState = signal<string | null>(readStoredDisplayName());
  private initialized = false;
  private initializeInFlight: Promise<void> | null = null;
  private refreshInFlight: Promise<string | null> | null = null;

  readonly token = this.tokenState.asReadonly();
  readonly user = this.userState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly loginFailureCount = this.loginFailureCountState.asReadonly();
  readonly isAuthenticated = computed(() => this.tokenState() !== null);
  readonly displayName = computed(() => this.currentDisplayName());

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializeInFlight) {
      return this.initializeInFlight;
    }

    this.initializeInFlight = (async () => {
      this.clearLegacyToken();
      await this.restoreSessionFromRefreshCookie();
      this.initialized = true;
    })();

    try {
      await this.initializeInFlight;
    } finally {
      this.initializeInFlight = null;
    }
  }

  async login(identifier: string, password: string): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);
    this.loginFailureCountState.set(null);
    let requestToken: string | null = null;

    try {
      const response = await firstValueFrom(this.authApi.login({ identifier, password }));
      requestToken = response.token;
      await this.establishSession(response.token);
    } catch (error) {
      if (requestToken === null || this.tokenState() === requestToken) {
        this.clearSession();
      }
      this.errorState.set(errorMessageFromResponse(error, 'Could not login.'));
      this.loginFailureCountState.set(loginFailureCountFromResponse(error));
      throw error;
    } finally {
      this.loadingState.set(false);
    }
  }

  async loginWithGoogleCredential(credential: string): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);
    this.loginFailureCountState.set(null);
    let requestToken: string | null = null;

    try {
      const response = await firstValueFrom(this.authApi.exchangeGoogleCredential({ credential }));
      requestToken = response.token;
      await this.establishSession(response.token);
    } catch (error) {
      if (requestToken !== null && this.tokenState() === requestToken) {
        this.clearSession();
      }
      this.errorState.set(errorMessageFromResponse(error, 'Could not complete Google login.'));
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
      if (this.tokenState() === token) {
        this.clearSession();
      }
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
      this.rotateSessionBackground();
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
    try {
      await firstValueFrom(this.authApi.logout());
    } catch {
      // Local logout must continue even if cookie revocation fails.
    }
    this.clearSession();
    this.rotateSessionBackground();
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
    const storage = browserLocalStorage();
    storage?.removeItem(LEGACY_TOKEN_KEY);
    storage?.removeItem(USER_KEY);
  }

  clearError(): void {
    this.errorState.set(null);
    this.loginFailureCountState.set(null);
  }

  updateThemePreference(themeId: AppThemeId): void {
    const currentUser = this.userState();
    if (!currentUser?.preferences) {
      return;
    }

    this.setUser({
      ...currentUser,
      preferences: {
        ...currentUser.preferences,
        themeId,
      },
    });
  }

  private setToken(token: string): void {
    this.tokenState.set(token);
  }

  private setUser(user: User): void {
    const normalizedUser = this.normalizeUser(user);
    this.userState.set(normalizedUser);
    this.resolvedDisplayNameState.set(normalizedUser.displayName);
    this.injector.get(AppThemeService).applyUserTheme(normalizedUser.preferences?.themeId);
    browserLocalStorage()?.setItem(USER_KEY, JSON.stringify(normalizedUser));
  }

  private async establishSession(token: string): Promise<void> {
    this.setToken(token);
    this.userState.set(null);
    this.resolvedDisplayNameState.set(null);
    await this.loadMe();
    this.rotateSessionBackground();
  }

  async refreshSession(): Promise<string | null> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.refreshSessionInternal();
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private async restoreSessionFromRefreshCookie(): Promise<void> {
    if (!this.userState()) {
      this.tokenState.set(null);
      return;
    }

    const token = await this.refreshSession();
    if (!token) {
      this.clearSession();
      return;
    }

    try {
      await this.loadMe();
    } catch {
      this.clearSession();
    }
  }

  private rotateSessionBackground(): void {
    this.injector.get(AppBackgroundService).useNewSessionBackground();
  }

  private async refreshSessionInternal(): Promise<string | null> {
    try {
      const response = await firstValueFrom(this.authApi.refresh());
      const token = (response.token ?? '').trim();
      if (!token) {
        this.tokenState.set(null);
        return null;
      }

      this.tokenState.set(token);
      return token;
    } catch {
      this.tokenState.set(null);
      return null;
    }
  }

  private clearLegacyToken(): void {
    browserLocalStorage()?.removeItem(LEGACY_TOKEN_KEY);
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

function readStoredUser(): User | null {
  const storage = browserLocalStorage();
  const rawUser = storage?.getItem(USER_KEY);
  if (!rawUser) {
    return null;
  }

  try {
    return JSON.parse(rawUser) as User;
  } catch {
    storage?.removeItem(USER_KEY);
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

function browserLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
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

function loginFailureCountFromResponse(error: unknown): number | null {
  if (!(error instanceof HttpErrorResponse)) {
    return null;
  }

  const responseError = error.error as { count?: unknown } | string | null;
  if (!responseError || typeof responseError !== 'object' || typeof responseError.count !== 'number') {
    return null;
  }

  return Number.isInteger(responseError.count) && responseError.count >= 0 ? responseError.count : null;
}
