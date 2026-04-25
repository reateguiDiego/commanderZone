import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthApi } from '../api/auth.api';
import { User } from '../models/user.model';

const TOKEN_KEY = 'commanderzone.jwt';
const USER_KEY = 'commanderzone.user';

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly authApi = inject(AuthApi);
  private readonly tokenState = signal<string | null>(readStoredToken());
  private readonly userState = signal<User | null>(readStoredUser());
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private initialized = false;

  readonly token = this.tokenState.asReadonly();
  readonly user = this.userState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly isAuthenticated = computed(() => this.tokenState() !== null);

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
      this.setToken(response.token);
      await this.loadMe();
    } catch (error) {
      this.clearSession();
      this.errorState.set('Could not login.');
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
      const response = await firstValueFrom(this.authApi.login({ email, password }));
      this.setToken(response.token);
      await this.loadMe();
    } catch (error) {
      this.clearSession();
      this.errorState.set('Could not create account.');
      throw error;
    } finally {
      this.loadingState.set(false);
    }
  }

  async loadMe(): Promise<void> {
    if (!this.tokenState()) {
      return;
    }

    try {
      const response = await firstValueFrom(this.authApi.me());
      this.setUser(response.user);
    } catch (error) {
      this.clearSession();
      throw error;
    }
  }

  logout(): void {
    this.clearSession();
  }

  clearSession(): void {
    this.tokenState.set(null);
    this.userState.set(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  private setToken(token: string): void {
    this.tokenState.set(token);
    localStorage.setItem(TOKEN_KEY, token);
  }

  private setUser(user: User): void {
    this.userState.set(user);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
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
