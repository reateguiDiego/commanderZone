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
  readonly surfaceElevated: string;
  readonly primary: string;
  readonly secondary: string;
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
    description: 'Warm blacks, gold, amber, and sunset tones.',
    palette: {
      bg: '#070707',
      surface: '#12100D',
      surfaceElevated: '#1F1913',
      primary: '#C79A43',
      secondary: '#E0B86A',
      text: '#F3ECDD',
    },
    functional: {
      success: '#7FA66A',
      danger: '#A94A3B',
      warning: '#D8A94A',
      info: '#6E8FA8',
    },
  },
  {
    id: 'arcade-neon-clash',
    label: 'Arcade Neon Clash',
    description: 'Competitive neon with electric highlights.',
    palette: {
      bg: '#050816',
      surface: '#10162B',
      surfaceElevated: '#1A2140',
      primary: '#6F4CFF',
      secondary: '#28D7FF',
      text: '#F5F8FF',
    },
    functional: {
      success: '#36D98A',
      danger: '#FF4D6D',
      warning: '#F2C94C',
      info: '#4EA8FF',
    },
  },
  {
    id: 'candy-summoners',
    label: 'Candy Summoners',
    description: 'Soft, collectible pastel colors.',
    palette: {
      bg: '#FAF6F2',
      surface: '#F1E8E5',
      surfaceElevated: '#E3D8E8',
      primary: '#A384C8',
      secondary: '#A8C7DF',
      text: '#34283B',
    },
    functional: {
      success: '#86B89B',
      danger: '#C86B77',
      warning: '#D6B06E',
      info: '#7CA7C8',
    },
  },
  {
    id: 'treasure-tavern',
    label: 'Treasure Tavern',
    description: 'Warm fantasy colors with treasure and leather tones.',
    palette: {
      bg: '#140F0B',
      surface: '#241913',
      surfaceElevated: '#34221A',
      primary: '#B78A44',
      secondary: '#6A2F35',
      text: '#EEE2C8',
    },
    functional: {
      success: '#5F8A6E',
      danger: '#9B3D3D',
      warning: '#C89A48',
      info: '#6A8397',
    },
  },
  {
    id: 'cyber-duel-arena',
    label: 'Cyber Duel Arena',
    description: 'Serious PvP colors with plasma and energy accents.',
    palette: {
      bg: '#06090D',
      surface: '#11161D',
      surfaceElevated: '#1B2430',
      primary: '#3F6BFF',
      secondary: '#38C7C9',
      text: '#E8EEF5',
    },
    functional: {
      success: '#4EBB7A',
      danger: '#D45757',
      warning: '#D8B04C',
      info: '#69A7E0',
    },
  },
  {
    id: 'mystic-grove',
    label: 'Mystic Grove',
    description: 'Magical nature colors with emerald and spell-light.',
    palette: {
      bg: '#081411',
      surface: '#10211B',
      surfaceElevated: '#183229',
      primary: '#47B88B',
      secondary: '#8E75C9',
      text: '#EEF2E6',
    },
    functional: {
      success: '#5BAF6E',
      danger: '#A14A5D',
      warning: '#D4B76A',
      info: '#72A9B6',
    },
  },
] as const;

export function isAppThemeId(value: string): value is AppThemeId {
  return APP_THEMES.some((theme) => theme.id === value);
}

export function appThemeById(value: string | null | undefined): AppTheme {
  return APP_THEMES.find((theme) => theme.id === value) ?? APP_THEMES[0];
}
