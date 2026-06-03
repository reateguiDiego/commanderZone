import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { AppThemeService } from './app-theme.service';

describe('AppThemeService', () => {
  let documentRef: Document;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    documentRef = TestBed.inject(DOCUMENT);
    documentRef.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    localStorage.clear();
    documentRef.documentElement.removeAttribute('data-theme');
  });

  it('uses sunrise by default', () => {
    const service = TestBed.inject(AppThemeService);

    expect(service.themeId()).toBe('sunrise');
    expect(documentRef.documentElement.getAttribute('data-theme')).toBe('sunrise');
  });

  it('loads a valid stored theme', () => {
    localStorage.setItem('commanderzone.theme', 'cyber-duel-arena');

    const service = TestBed.inject(AppThemeService);

    expect(service.themeId()).toBe('cyber-duel-arena');
    expect(documentRef.documentElement.getAttribute('data-theme')).toBe('cyber-duel-arena');
  });

  it('falls back to sunrise for invalid stored values', () => {
    localStorage.setItem('commanderzone.theme', 'unknown-theme');

    const service = TestBed.inject(AppThemeService);

    expect(service.themeId()).toBe('sunrise');
    expect(documentRef.documentElement.getAttribute('data-theme')).toBe('sunrise');
  });

  it('persists selected themes and applies data-theme', () => {
    const service = TestBed.inject(AppThemeService);

    service.selectTheme('mystic-grove');

    expect(service.themeId()).toBe('mystic-grove');
    expect(localStorage.getItem('commanderzone.theme')).toBe('mystic-grove');
    expect(documentRef.documentElement.getAttribute('data-theme')).toBe('mystic-grove');
  });

  it('normalizes invalid selections to sunrise', () => {
    const service = TestBed.inject(AppThemeService);

    service.selectTheme('not-real');

    expect(service.themeId()).toBe('sunrise');
    expect(localStorage.getItem('commanderzone.theme')).toBe('sunrise');
    expect(documentRef.documentElement.getAttribute('data-theme')).toBe('sunrise');
  });
});
