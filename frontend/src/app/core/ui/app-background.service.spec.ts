import { TestBed } from '@angular/core/testing';
import { AppBackgroundService } from './app-background.service';

describe('AppBackgroundService', () => {
  const sessionKey = 'commanderzone.backgroundImage';

  beforeEach(() => {
    sessionStorage.clear();
    document.body.classList.remove('dashboard-background');
    document.documentElement.style.removeProperty('--app-session-background');
    TestBed.resetTestingModule();
  });

  it('reuses the session background and exposes it as a CSS variable', () => {
    sessionStorage.setItem(sessionKey, 'assets/images/backgrounds/back_4.png');

    const service = TestBed.inject(AppBackgroundService);

    expect(service.imageUrl).toBe('/assets/images/backgrounds/back_4.png');
    expect(document.documentElement.style.getPropertyValue('--app-session-background')).toBe('url("/assets/images/backgrounds/back_4.png")');
  });

  it('toggles dashboard background mode on the document body', () => {
    const service = TestBed.inject(AppBackgroundService);

    service.setDashboardMode(true);
    expect(document.body.classList.contains('dashboard-background')).toBe(true);

    service.setDashboardMode(false);
    expect(document.body.classList.contains('dashboard-background')).toBe(false);
  });

  it('can rotate the current session background without repeating the previous image', () => {
    sessionStorage.setItem(sessionKey, 'assets/images/backgrounds/back_4.png');
    const service = TestBed.inject(AppBackgroundService);

    service.useNewSessionBackground();

    expect(service.imageUrl).not.toBe('/assets/images/backgrounds/back_4.png');
    expect(service.imageUrl).toMatch(/^\/assets\/images\/backgrounds\/back_\d\.png$/);
    expect(sessionStorage.getItem(sessionKey)).toBe(service.imageUrl);
    expect(sessionStorage.getItem('commanderzone.previousBackgroundImage')).toBe('/assets/images/backgrounds/back_4.png');
    expect(document.documentElement.style.getPropertyValue('--app-session-background')).toBe(`url("${service.imageUrl}")`);
  });
});
