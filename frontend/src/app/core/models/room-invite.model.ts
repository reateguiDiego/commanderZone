import { Room } from './room.model';

export type RoomInviteStatus = 'pending' | 'accepted' | 'declined';

export interface RoomInviteUser {
  id: string;
  displayName: string;
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
