import { DEFAULT_APP_THEME_ID } from './theme-id';
import { readStoredThemeId, THEME_STORAGE_KEY, USER_STORAGE_KEY } from './theme-storage';

describe('theme storage', () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => localStorage.clear());

  it('prefers the directly stored valid theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'candy-summoners');
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify({
      preferences: { themeId: 'treasure-tavern' },
    }));

    expect(readStoredThemeId(localStorage)).toBe('candy-summoners');
  });

  it('uses the cached user theme when no direct preference exists', () => {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify({
      preferences: { themeId: 'treasure-tavern' },
    }));

    expect(readStoredThemeId(localStorage)).toBe('treasure-tavern');
  });

  it('rejects invalid and malformed stored values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'unknown-theme');
    localStorage.setItem(USER_STORAGE_KEY, '{not-json');

    expect(readStoredThemeId(localStorage) ?? DEFAULT_APP_THEME_ID).toBe('sunrise');
  });
});
