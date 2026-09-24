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
  defaultBattlefieldLayout: UserGameLayoutPreference;
  chosenModeView: UserGameLayoutPreference;
  showCardAlignmentHelper: boolean;
  showManaHelperOnStartup: boolean;
  enableManaRow: boolean;
  autoApplyCommanderDamageToLife: boolean;
  gameAnimations: boolean;
  chatNotificationSounds: boolean;
  combineChatAndGameLog: boolean;
}

/**
 * Game preferences as received from the user payload. The boolean fields are
 * the current settings names; the older fields remain supported so existing
 * accounts keep their saved behavior.
 */
export interface UserGamePreferencesInput extends Partial<UserGamePreferences> {
  gridLayout?: boolean;
  lineAlignment?: boolean;
}

export type UserGameLayoutPreference = 'square' | 'grid';

export const DEFAULT_USER_GAME_PREFERENCES: Readonly<UserGamePreferences> = {
  defaultBattlefieldLayout: 'grid',
  chosenModeView: 'grid',
  showCardAlignmentHelper: true,
  showManaHelperOnStartup: false,
  enableManaRow: true,
  autoApplyCommanderDamageToLife: true,
  gameAnimations: true,
  chatNotificationSounds: true,
  combineChatAndGameLog: false,
};

export function normalizeUserGamePreferences(
  preferences: UserGamePreferencesInput | null | undefined,
): UserGamePreferences {
  const defaultBattlefieldLayout = battlefieldLayoutPreference(
    preferences?.gridLayout,
    preferences?.defaultBattlefieldLayout,
    DEFAULT_USER_GAME_PREFERENCES.defaultBattlefieldLayout,
  );

  return {
    defaultBattlefieldLayout,
    // Retained only to safely read legacy account payloads. Game tables always
    // initialize from defaultBattlefieldLayout; the active view is session-only.
    chosenModeView: battlefieldLayoutPreference(
      undefined,
      preferences?.chosenModeView,
      defaultBattlefieldLayout,
    ),
    showCardAlignmentHelper: booleanGamePreference(
      preferences?.lineAlignment,
      booleanGamePreference(
        preferences?.showCardAlignmentHelper,
        DEFAULT_USER_GAME_PREFERENCES.showCardAlignmentHelper,
      ),
    ),
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

function battlefieldLayoutPreference(
  gridLayout: unknown,
  defaultLayout: unknown,
  fallback: UserGameLayoutPreference,
): UserGameLayoutPreference {
  if (typeof gridLayout === 'boolean') {
    return gridLayout ? 'grid' : 'square';
  }

  return defaultLayout === 'square' || defaultLayout === 'grid' ? defaultLayout : fallback;
}

function booleanGamePreference(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export interface UserPreferences {
  cardLanguage: SupportedCardLanguageCode;
  appLanguage: SupportedLanguageCode;
  themeId: AppThemeId;
  game?: UserGamePreferencesInput;
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
