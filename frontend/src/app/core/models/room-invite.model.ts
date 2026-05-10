import { Room } from './room.model';
import { UserAvatar, UserDisplayNameStyle } from './user.model';

export type RoomInviteStatus = 'pending' | 'accepted' | 'declined';

export interface RoomInviteUser {
  id: string;
  displayName: string;
  displayNameStyle?: UserDisplayNameStyle;
  avatar?: UserAvatar;
}

export interface RoomInvite {
  id: string;
  status: RoomInviteStatus;
  room: Room;
  sender: RoomInviteUser;
  recipient: RoomInviteUser;
  createdAt: string;
  updatedAt: string;
}
