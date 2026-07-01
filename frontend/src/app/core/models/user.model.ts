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
  enableStackMana: boolean;
  gameAnimations: boolean;
  chatNotificationSounds: boolean;
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
  displayNameStyle?: UserDisplayNameStyle;
  roles: string[];
  premiumTier?: 'none' | 'tier1' | 'tier2' | 'tier3';
  avatar?: UserAvatar;
  preferences?: UserPreferences;
}
