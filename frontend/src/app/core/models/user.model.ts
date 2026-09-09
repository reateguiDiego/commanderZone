import { SupportedCardLanguageCode, SupportedLanguageCode } from '../localization/language-preferences';
import { AppThemeId } from '../theme/app-theme';
export type UserAvatarType = 'initial' | 'preset' | 'upload';
export type UserDisplayNameStyleType = 'plain' | 'preset';

export interface UserInitialAvatarSettings {
  letter: string | null;
  backgroundColor: string | null;
  textColor: string | null;
}

export interface UserAvatar {
  type: UserAvatarType;
  imageUrl: string | null;
  initial?: UserInitialAvatarSettings | null;
}

export interface UserDisplayNameStyle {
  type: UserDisplayNameStyleType;
  presetId: string;
  textColor?: string | null;
}

export interface UserGamePreferences {
  showManaHelperOnStartup: boolean;
  enableManaRow: boolean;
  autoApplyCommanderDamageToLife: boolean;
  gameAnimations: boolean;
  chatNotificationSounds: boolean;
  combineChatAndGameLog: boolean;
}

export const DEFAULT_USER_GAME_PREFERENCES: Readonly<UserGamePreferences> = {
  showManaHelperOnStartup: false,
  enableManaRow: true,
  autoApplyCommanderDamageToLife: true,
  gameAnimations: true,
  chatNotificationSounds: true,
  combineChatAndGameLog: false,
};

export function normalizeUserGamePreferences(
  preferences: Partial<UserGamePreferences> | null | undefined,
): UserGamePreferences {
  return {
    showManaHelperOnStartup: booleanGamePreference(
      preferences?.showManaHelperOnStartup,
      DEFAULT_USER_GAME_PREFERENCES.showManaHelperOnStartup,
    ),
    enableManaRow: booleanGamePreference(
      preferences?.enableManaRow,
      DEFAULT_USER_GAME_PREFERENCES.enableManaRow,
    ),
    autoApplyCommanderDamageToLife: booleanGamePreference(
      preferences?.autoApplyCommanderDamageToLife,
      DEFAULT_USER_GAME_PREFERENCES.autoApplyCommanderDamageToLife,
    ),
    gameAnimations: booleanGamePreference(
      preferences?.gameAnimations,
      DEFAULT_USER_GAME_PREFERENCES.gameAnimations,
    ),
    chatNotificationSounds: booleanGamePreference(
      preferences?.chatNotificationSounds,
      DEFAULT_USER_GAME_PREFERENCES.chatNotificationSounds,
    ),
    combineChatAndGameLog: booleanGamePreference(
      preferences?.combineChatAndGameLog,
      DEFAULT_USER_GAME_PREFERENCES.combineChatAndGameLog,
    ),
  };
}

function booleanGamePreference(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export interface UserPreferences {
  cardLanguage: SupportedCardLanguageCode;
  appLanguage: SupportedLanguageCode;
  themeId: AppThemeId;
  game?: UserGamePreferences;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  publicHandle?: string | null;
  publicPath?: string | null;
  displayNameStyle?: UserDisplayNameStyle;
  roles: string[];
  premiumTier?: 'none' | 'tier1' | 'tier2' | 'tier3';
  avatar?: UserAvatar;
  preferences?: UserPreferences;
}
