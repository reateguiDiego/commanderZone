import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { AppThemeId, DEFAULT_APP_THEME_ID, appThemeById, isAppThemeId } from './app-theme';

const THEME_STORAGE_KEY = 'commanderzone.theme';

@Injectable({ providedIn: 'root' })
export class AppThemeService {
  private readonly document = inject(DOCUMENT);
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
    this.themeIdState.set(nextThemeId);
    this.writeStoredThemeId(nextThemeId);
    this.applyTheme(nextThemeId);
  }

  private applyTheme(themeId: AppThemeId): void {
    this.document.documentElement.setAttribute('data-theme', themeId);
  }

  private readStoredThemeId(): AppThemeId {
    if (!isPlatformBrowser(this.platformId)) {
      return DEFAULT_APP_THEME_ID;
    }

    const storedThemeId = browserLocalStorage()?.getItem(THEME_STORAGE_KEY);
    return storedThemeId && isAppThemeId(storedThemeId) ? storedThemeId : DEFAULT_APP_THEME_ID;
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
