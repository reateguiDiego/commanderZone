import { User } from './user.model';

export type RoomStatus = 'waiting' | 'started' | 'archived';
export type RoomVisibility = 'private' | 'public';
export type RoomFormat = 'commander';

export interface RoomPlayer {
  id: string;
  user: User;
  deckId: string | null;
  turnRoll: number | null;
}

export interface Room {
  id: string;
  name: string;
  owner: User;
  status: RoomStatus;
  visibility: RoomVisibility;
  format: RoomFormat;
  maxPlayers: number;
  players: RoomPlayer[];
  gameId: string | null;
}

export type WaitingRoomEventType =
  | 'room.created'
  | 'room.updated'
  | 'room.player.joined'
  | 'room.player.updated'
  | 'room.player.rolled'
  | 'room.player.left'
  | 'room.started'
  | 'room.deleted';

export interface WaitingRoomEvent {
  type: WaitingRoomEventType;
  roomId: string;
  room?: Room;
}
