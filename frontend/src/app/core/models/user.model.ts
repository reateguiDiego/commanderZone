export type UserAvatarType = 'initial' | 'preset' | 'upload';

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

export interface User {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  avatar?: UserAvatar;
}
