import { isAppThemeId, type AppThemeId } from './theme-id';

export const THEME_STORAGE_KEY = 'commanderzone.theme';
export const USER_STORAGE_KEY = 'commanderzone.user';

interface StoredThemeUser {
  readonly preferences?: {
    readonly themeId?: unknown;
  } | null;
}

export function browserLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readStoredThemeId(storage: Storage | null): AppThemeId | null {
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
