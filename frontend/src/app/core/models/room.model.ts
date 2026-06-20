import { User } from './user.model';
import { Deck } from './deck.model';

export type RoomStatus = 'waiting' | 'started';
export type RoomVisibility = 'private' | 'public';
export type RoomFormat = 'commander' | string;
export type RoomTimerMode = 'none' | 'turn';
export type RoomMulliganRule = 'LONDON' | 'VANCOUVER' | 'PARIS' | 'GENEROUS';

export interface RoomPlayer {
  id: string;
  user: User;
  deckId: string | null;
  deck?: Deck | null;
  turnRoll: number | null;
  turnRolls?: number[];
}

export type WaitingRoomLogTone = 'default' | 'success';

export interface WaitingRoomLogEntry {
  id: string;
  label: string;
  tone: WaitingRoomLogTone;
  createdAt: string;
}

export interface Room {
  id: string;
  name: string;
  owner: User;
  status: RoomStatus;
  visibility: RoomVisibility;
  format: RoomFormat;
  maxPlayers: number;
  startingLife: number;
  timerMode: RoomTimerMode;
  timerDurationSeconds: number;
  mulliganRule: RoomMulliganRule;
  firstMulliganFree: boolean;
  players: RoomPlayer[];
  waitingLog?: WaitingRoomLogEntry[];
  gameId: string | null;
}

export interface CurrentRoomSummary {
  id: string;
  name: string;
  status: RoomStatus;
  visibility: RoomVisibility;
  format: RoomFormat;
  maxPlayers: number;
  mulliganRule: RoomMulliganRule;
  firstMulliganFree: boolean;
  playerCount: number;
  gameId: string | null;
}

export interface CurrentRoomPlayerSummary {
  playerId: string;
  deckId: string | null;
  deckName: string | null;
  deckImageUrl: string | null;
}

export interface CurrentRoomTurn {
  number: number | null;
}

export type CurrentRoomViewerRole = 'owner' | 'player' | 'owner_player';

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
