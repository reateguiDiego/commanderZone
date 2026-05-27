import { SupportedLanguageCode } from '../localization/language-preferences';
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

export interface UserPreferences {
  cardLanguage: SupportedLanguageCode;
  appLanguage: SupportedLanguageCode;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  displayNameStyle?: UserDisplayNameStyle;
  roles: string[];
  avatar?: UserAvatar;
  preferences?: UserPreferences;
}
