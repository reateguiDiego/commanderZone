import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { AppBackgroundService } from './app-background.service';
import { AppThemeService } from '../theme/app-theme.service';

describe('AppBackgroundService', () => {
  const sessionKey = 'commanderzone.backgroundImage';
  const themeSessionKey = 'commanderzone.backgroundTheme';
  const previousSessionKey = 'commanderzone.previousBackgroundImage';
  const themeStorageKey = 'commanderzone.theme';

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.body.classList.remove('dashboard-background');
    document.documentElement.style.removeProperty('--app-session-background');
    TestBed.resetTestingModule();
  });

  it('reuses the session background for the selected theme and exposes it as a CSS variable', () => {
    localStorage.setItem(themeStorageKey, 'candy-summoners');
    sessionStorage.setItem(themeSessionKey, 'candy-summoners');
    sessionStorage.setItem(sessionKey, 'assets/images/backgrounds/candy-summoners/bg-4.webp');

    const service = TestBed.inject(AppBackgroundService);

    expect(service.imageUrl).toBe('/assets/images/backgrounds/candy-summoners/bg-4.webp');
    expect(document.documentElement.style.getPropertyValue('--app-session-background')).toBe('url("/assets/images/backgrounds/candy-summoners/bg-4.webp")');
  });

  it('ignores a stored background when it belongs to a different theme', () => {
    localStorage.setItem(themeStorageKey, 'treasure-tavern');
    sessionStorage.setItem(themeSessionKey, 'sunrise');
    sessionStorage.setItem(sessionKey, 'assets/images/backgrounds/sunrise/bg-4.webp');

    const service = TestBed.inject(AppBackgroundService);

    expect(service.imageUrl).toMatch(/^\/assets\/images\/backgrounds\/treasure-tavern\/bg-\d+\.webp$/);
    expect(sessionStorage.getItem(themeSessionKey)).toBe('treasure-tavern');
    expect(sessionStorage.getItem(sessionKey)).toBe(service.imageUrl);
  });

  it('toggles dashboard background mode on the document body', () => {
    const service = TestBed.inject(AppBackgroundService);

    service.setDashboardMode(true);
    expect(document.body.classList.contains('dashboard-background')).toBe(true);

    service.setDashboardMode(false);
    expect(document.body.classList.contains('dashboard-background')).toBe(false);
  });

  it('restores the session background when dashboard mode is re-enabled', () => {
    sessionStorage.setItem(themeSessionKey, 'sunrise');
    sessionStorage.setItem(sessionKey, 'assets/images/backgrounds/sunrise/bg-4.webp');
    const service = TestBed.inject(AppBackgroundService);
    document.documentElement.style.removeProperty('--app-session-background');

    service.setDashboardMode(true);

    expect(document.body.classList.contains('dashboard-background')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--app-session-background')).toBe('url("/assets/images/backgrounds/sunrise/bg-4.webp")');
  });

  it('can rotate the current session background without repeating the previous image in the current theme', () => {
    sessionStorage.setItem(themeSessionKey, 'sunrise');
    sessionStorage.setItem(sessionKey, 'assets/images/backgrounds/sunrise/bg-4.webp');
    const service = TestBed.inject(AppBackgroundService);

    service.useNewSessionBackground();

    expect(service.imageUrl).not.toBe('/assets/images/backgrounds/sunrise/bg-4.webp');
    expect(service.imageUrl).toMatch(/^\/assets\/images\/backgrounds\/sunrise\/bg-\d+\.webp$/);
    expect(sessionStorage.getItem(sessionKey)).toBe(service.imageUrl);
    expect(sessionStorage.getItem(themeSessionKey)).toBe('sunrise');
    expect(sessionStorage.getItem(previousSessionKey)).toBe('/assets/images/backgrounds/sunrise/bg-4.webp');
    expect(document.documentElement.style.getPropertyValue('--app-session-background')).toBe(`url("${service.imageUrl}")`);
  });

  it('selects a new background from the new theme folder when the theme changes', () => {
    sessionStorage.setItem(themeSessionKey, 'sunrise');
    sessionStorage.setItem(sessionKey, 'assets/images/backgrounds/sunrise/bg-4.webp');
    const service = TestBed.inject(AppBackgroundService);
    const themeService = TestBed.inject(AppThemeService);

    themeService.selectTheme('mystic-grove');
    TestBed.tick();

    expect(service.imageUrl).toMatch(/^\/assets\/images\/backgrounds\/mystic-grove\/bg-\d+\.webp$/);
    expect(sessionStorage.getItem(themeSessionKey)).toBe('mystic-grove');
    expect(sessionStorage.getItem(previousSessionKey)).toBe('/assets/images/backgrounds/sunrise/bg-4.webp');
    expect(document.documentElement.style.getPropertyValue('--app-session-background')).toBe(`url("${service.imageUrl}")`);
  });

  it('does not access browser storage or mutate the document in server rendering', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
      ],
    });

    const service = TestBed.inject(AppBackgroundService);

    service.setDashboardMode(true);
    service.useNewSessionBackground();

    expect(service.imageUrl).toBe('/assets/images/backgrounds/sunrise/bg-1.webp');
    expect(document.body.classList.contains('dashboard-background')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--app-session-background')).toBe('');
  });
});
