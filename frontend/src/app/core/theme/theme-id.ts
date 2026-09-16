export const APP_THEME_IDS = [
  'sunrise',
  'arcade-neon-clash',
  'candy-summoners',
  'treasure-tavern',
  'cyber-duel-arena',
  'mystic-grove',
] as const;

export type AppThemeId = (typeof APP_THEME_IDS)[number];

export const DEFAULT_APP_THEME_ID: AppThemeId = 'sunrise';

export function isAppThemeId(value: string): value is AppThemeId {
  return (APP_THEME_IDS as readonly string[]).includes(value);
}
