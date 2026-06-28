import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ThemesService } from '../api/themes.service';
import { AppThemeId } from './app-theme';
import { AppThemeService } from './app-theme.service';

describe('AppThemeService', () => {
  let documentRef: Document;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ThemesService,
          useValue: {
            update: vi.fn((themeId: AppThemeId) => of({ themeId })),
          } satisfies Pick<ThemesService, 'update'>,
        },
      ],
    });
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

  it('previews themes without persisting them locally', () => {
    const service = TestBed.inject(AppThemeService);

    service.previewTheme('mystic-grove');

    expect(service.themeId()).toBe('mystic-grove');
    expect(localStorage.getItem('commanderzone.theme')).toBeNull();
    expect(documentRef.documentElement.getAttribute('data-theme')).toBe('mystic-grove');
  });

  it('persists selected theme through the themes API', async () => {
    const themes = TestBed.inject(ThemesService);
    const service = TestBed.inject(AppThemeService);

    await service.saveTheme('candy-summoners');

    expect(themes.update).toHaveBeenCalledWith('candy-summoners');
    expect(service.themeId()).toBe('candy-summoners');
    expect(localStorage.getItem('commanderzone.theme')).toBe('candy-summoners');
  });

  it('reverts local theme when remote persistence fails', async () => {
    const themes = TestBed.inject(ThemesService);
    vi.mocked(themes.update).mockReturnValueOnce(throwError(() => new Error('failed')));
    const service = TestBed.inject(AppThemeService);
    service.selectTheme('mystic-grove');

    await expect(service.saveTheme('candy-summoners')).rejects.toThrow('failed');

    expect(service.themeId()).toBe('mystic-grove');
    expect(localStorage.getItem('commanderzone.theme')).toBe('mystic-grove');
  });
});
