import { Injectable, computed, signal } from '@angular/core';
import { User } from '../models/user.model';

const TOKEN_KEY = 'commanderzone.jwt';
const USER_KEY = 'commanderzone.user';
export const DUMMY_AUTH_PREFIX = 'dummy-dev-token';
const DUMMY_AUTH_ENABLED = true; // Temporary frontend-only auth for local UI development.

@Injectable({ providedIn: 'root' })
export class AuthStore {
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
      this.setDummySession(email, emailToDisplayName(email));
    } catch (error) {
      this.errorState.set('Could not create dummy session.');
      throw error;
    } finally {
      this.loadingState.set(false);
    }
  }

  async register(email: string, displayName: string, password: string): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);

    try {
      this.setDummySession(email, displayName || emailToDisplayName(email));
    } catch (error) {
      this.errorState.set('Could not create dummy session.');
      throw error;
    } finally {
      this.loadingState.set(false);
    }
  }

  async loadMe(): Promise<void> {
    if (!DUMMY_AUTH_ENABLED) {
      return;
    }

    const storedUser = readStoredUser();
    if (storedUser) {
      this.userState.set(storedUser);
      return;
    }

    const token = this.tokenState();
    if (token?.startsWith(DUMMY_AUTH_PREFIX)) {
      const fallbackUser = createDummyUser('player@commanderzone.local', 'Local Player');
      this.setUser(fallbackUser);
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

  private setDummySession(email: string, displayName: string): void {
    const user = createDummyUser(email, displayName);
    this.setToken(`${DUMMY_AUTH_PREFIX}.${btoa(JSON.stringify({ sub: user.email, name: user.displayName }))}`);
    this.setUser(user);
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

function createDummyUser(email: string, displayName: string): User {
  const safeEmail = email.trim() || 'player@commanderzone.local';
  const safeDisplayName = displayName.trim() || emailToDisplayName(safeEmail);

  return {
    id: `dummy-${safeEmail.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    email: safeEmail,
    displayName: safeDisplayName,
    roles: ['ROLE_USER'],
  };
}

function emailToDisplayName(email: string): string {
  const localPart = email.split('@')[0]?.trim();
  return localPart || 'Local Player';
}
