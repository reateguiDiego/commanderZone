export type AppThemeId =
  | 'sunrise'
  | 'arcade-neon-clash'
  | 'candy-summoners'
  | 'treasure-tavern'
  | 'cyber-duel-arena'
  | 'mystic-grove';

export interface AppThemePalette {
  readonly bg: string;
  readonly surface: string;
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
  readonly text: string;
}

export interface AppThemeFunctionalColors {
  readonly success: string;
  readonly danger: string;
  readonly warning: string;
  readonly info: string;
}

export interface AppTheme {
  readonly id: AppThemeId;
  readonly label: string;
  readonly description: string;
  readonly palette: AppThemePalette;
  readonly functional: AppThemeFunctionalColors;
}

export const DEFAULT_APP_THEME_ID: AppThemeId = 'sunrise';

export const APP_THEMES: readonly AppTheme[] = [
  {
    id: 'sunrise',
    label: 'Sunrise',
    description: 'Pure black, grayscale, and strong gold highlights.',
    palette: {
      bg: '#000000',
      surface: '#101010',
      primary: '#B88A1A',
      secondary: '#8A8A8A',
      accent: '#D4AF37',
      text: '#F5F5F5',
    },
    functional: {
      success: '#4ADE80',
      danger: '#F43F5E',
      warning: '#D4AF37',
      info: '#38BDF8',
    },
  },
  {
    id: 'arcade-neon-clash',
    label: 'Arcade Neon Clash',
    description: 'Competitive neon with electric highlights.',
    palette: {
      bg: '#080B1F',
      surface: '#171A3A',
      primary: '#7B2CFF',
      secondary: '#00D9FF',
      accent: '#FF2DAA',
      text: '#F4F7FF',
    },
    functional: {
      success: '#28F29C',
      danger: '#FF3B4F',
      warning: '#FFD84D',
      info: '#3BA7FF',
    },
  },
  {
    id: 'candy-summoners',
    label: 'Candy Summoners',
    description: 'Soft, collectible pastel colors.',
    palette: {
      bg: '#F0E5FF',
      surface: '#FFD5EA',
      primary: '#8B5CFF',
      secondary: '#38CFFF',
      accent: '#FF6F8F',
      text: '#120B18',
    },
    functional: {
      success: '#22C98A',
      danger: '#F83F6B',
      warning: '#FFC83D',
      info: '#2FA8FF',
    },
  },
  {
    id: 'treasure-tavern',
    label: 'Treasure Tavern',
    description: 'Warm fantasy tavern colors with leather, wine, treasure gold, and emerald loot.',
    palette: {
      bg: '#1D130C',
      surface: '#332015',
      primary: '#F4B63F',
      secondary: '#9D2F3F',
      accent: '#27C98B',
      text: '#FFF1D6',
    },
    functional: {
      success: '#38C172',
      danger: '#E54848',
      warning: '#FFB020',
      info: '#4BA3F2',
    },
  },
  {
    id: 'cyber-duel-arena',
    label: 'Cyber Duel Arena',
    description: 'Serious PvP colors with plasma and energy accents.',
    palette: {
      bg: '#050A12',
      surface: '#111827',
      primary: '#2563FF',
      secondary: '#9DFF3F',
      accent: '#FF7A1A',
      text: '#EAF0FF',
    },
    functional: {
      success: '#22C55E',
      danger: '#EF4444',
      warning: '#EAB308',
      info: '#06B6D4',
    },
  },
  {
    id: 'mystic-grove',
    label: 'Mystic Grove',
    description: 'Magical nature colors with emerald and spell-light.',
    palette: {
      bg: '#081C15',
      surface: '#12372A',
      primary: '#2EE6A6',
      secondary: '#B388FF',
      accent: '#FFD166',
      text: '#FFF8E7',
    },
    functional: {
      success: '#4ADE80',
      danger: '#F43F5E',
      warning: '#FACC15',
      info: '#38BDF8',
    },
  },
] as const;

export function isAppThemeId(value: string): value is AppThemeId {
  return APP_THEMES.some((theme) => theme.id === value);
}

export function appThemeById(value: string | null | undefined): AppTheme {
  return APP_THEMES.find((theme) => theme.id === value) ?? APP_THEMES[0];
}
