import { type AppThemeId } from './theme-id';

export { DEFAULT_APP_THEME_ID, isAppThemeId, type AppThemeId } from './theme-id';

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
  readonly labelKey: string;
  readonly descriptionKey: string;
  readonly palette: AppThemePalette;
  readonly functional: AppThemeFunctionalColors;
}

export const APP_THEMES: readonly AppTheme[] = [
  {
    id: 'sunrise',
    labelKey: 'settings.themeSettingsPanel.themes.sunrise.label',
    descriptionKey: 'settings.themeSettingsPanel.themes.sunrise.description',
    palette: {
      bg: '#000000',
      surface: '#101010',
      primary: '#D2AC47',
      secondary: '#8A8A8A',
      accent: '#E6C76B',
      text: '#F5F5F5',
    },
    functional: {
      success: '#4ADE80',
      danger: '#F43F5E',
      warning: '#D2AC47',
      info: '#38BDF8',
    },
  },
  {
    id: 'arcade-neon-clash',
    labelKey: 'settings.themeSettingsPanel.themes.arcadeNeonClash.label',
    descriptionKey: 'settings.themeSettingsPanel.themes.arcadeNeonClash.description',
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
    labelKey: 'settings.themeSettingsPanel.themes.candySummoners.label',
    descriptionKey: 'settings.themeSettingsPanel.themes.candySummoners.description',
    palette: {
      bg: '#C6C0C9',
      surface: '#CFC9D2',
      primary: '#780049',
      secondary: '#004249',
      accent: '#780049',
      text: '#3D3542',
    },
    functional: {
      success: '#004628',
      danger: '#800018',
      warning: '#5B3200',
      info: '#003677',
    },
  },
  {
    id: 'treasure-tavern',
    labelKey: 'settings.themeSettingsPanel.themes.treasureTavern.label',
    descriptionKey: 'settings.themeSettingsPanel.themes.treasureTavern.description',
    palette: {
      bg: '#10171B',
      surface: '#1A252A',
      primary: '#65D6C2',
      secondary: '#B7A2E8',
      accent: '#E1B768',
      text: '#F3EEE4',
    },
    functional: {
      success: '#79D5A5',
      danger: '#FF8795',
      warning: '#F2C66D',
      info: '#86BFFF',
    },
  },
  {
    id: 'cyber-duel-arena',
    labelKey: 'settings.themeSettingsPanel.themes.cyberDuelArena.label',
    descriptionKey: 'settings.themeSettingsPanel.themes.cyberDuelArena.description',
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
    labelKey: 'settings.themeSettingsPanel.themes.mysticGrove.label',
    descriptionKey: 'settings.themeSettingsPanel.themes.mysticGrove.description',
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

export function appThemeById(value: string | null | undefined): AppTheme {
  return APP_THEMES.find((theme) => theme.id === value) ?? APP_THEMES[0];
}
