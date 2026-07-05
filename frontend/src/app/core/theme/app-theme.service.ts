import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, Injector, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ThemesService } from '../api/themes.service';
import { AppThemeId, DEFAULT_APP_THEME_ID, appThemeById, isAppThemeId } from './app-theme';

const THEME_STORAGE_KEY = 'commanderzone.theme';
const USER_STORAGE_KEY = 'commanderzone.user';

interface StoredThemeUser {
  readonly preferences?: {
    readonly themeId?: unknown;
  } | null;
}

@Injectable({ providedIn: 'root' })
export class AppThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly themeIdState = signal<AppThemeId>(this.readStoredThemeId());

  readonly themeId = this.themeIdState.asReadonly();
  readonly theme = computed(() => appThemeById(this.themeIdState()));

  constructor() {
    this.applyTheme(this.themeIdState());
  }

  initialize(): void {
    this.applyTheme(this.themeIdState());
  }

  selectTheme(themeId: string): void {
    const nextThemeId = isAppThemeId(themeId) ? themeId : DEFAULT_APP_THEME_ID;
    this.setTheme(nextThemeId);
  }

  previewTheme(themeId: string): AppThemeId {
    const nextThemeId = isAppThemeId(themeId) ? themeId : DEFAULT_APP_THEME_ID;
    this.setThemeState(nextThemeId);
    return nextThemeId;
  }

  applyUserTheme(themeId: string | null | undefined): void {
    if (themeId === null || themeId === undefined) {
      return;
    }

    const nextThemeId = isAppThemeId(themeId) ? themeId : DEFAULT_APP_THEME_ID;
    this.setTheme(nextThemeId);
  }

  async saveTheme(themeId: string): Promise<void> {
    const previousThemeId = this.themeIdState();
    const nextThemeId = isAppThemeId(themeId) ? themeId : DEFAULT_APP_THEME_ID;

    try {
      const response = await firstValueFrom(this.injector.get(ThemesService).update(nextThemeId));
      this.setTheme(isAppThemeId(response.themeId) ? response.themeId : DEFAULT_APP_THEME_ID);
    } catch (error) {
      this.setThemeState(previousThemeId);
      throw error;
    }
  }

  private applyTheme(themeId: AppThemeId): void {
    this.document.documentElement.setAttribute('data-theme', themeId);
  }

  private setTheme(themeId: AppThemeId): void {
    this.setThemeState(themeId);
    this.writeStoredThemeId(themeId);
  }

  private setThemeState(themeId: AppThemeId): void {
    this.themeIdState.set(themeId);
    this.applyTheme(themeId);
  }

  private readStoredThemeId(): AppThemeId {
    if (!isPlatformBrowser(this.platformId)) {
      return DEFAULT_APP_THEME_ID;
    }

    return readStoredThemeId(browserLocalStorage()) ?? DEFAULT_APP_THEME_ID;
  }

  private writeStoredThemeId(themeId: AppThemeId): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    browserLocalStorage()?.setItem(THEME_STORAGE_KEY, themeId);
  }
}

function browserLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readStoredThemeId(storage: Storage | null): AppThemeId | null {
  const storedThemeId = storage?.getItem(THEME_STORAGE_KEY);
  if (storedThemeId && isAppThemeId(storedThemeId)) {
    return storedThemeId;
  }

  const storedUserThemeId = readStoredUserThemeId(storage);
  return storedUserThemeId && isAppThemeId(storedUserThemeId) ? storedUserThemeId : null;
}

function readStoredUserThemeId(storage: Storage | null): string | null {
  const rawUser = storage?.getItem(USER_STORAGE_KEY);
  if (!rawUser) {
    return null;
  }

  try {
    const user = JSON.parse(rawUser) as StoredThemeUser;
    const themeId = user.preferences?.themeId;
    return typeof themeId === 'string' ? themeId : null;
  } catch {
    return null;
  }
}
