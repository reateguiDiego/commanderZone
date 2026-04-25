import { User } from './user.model';

export type RoomStatus = 'waiting' | 'started';
export type RoomVisibility = 'private' | 'public';

export interface RoomPlayer {
  id: string;
  user: User;
  deckId: string | null;
}

export interface Room {
  id: string;
  owner: User;
  status: RoomStatus;
  visibility: RoomVisibility;
  players: RoomPlayer[];
  gameId: string | null;
}
