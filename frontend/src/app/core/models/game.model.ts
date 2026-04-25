import { User } from './user.model';

export type GameZoneName = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command';
export type GameCommandType =
  | 'chat.message'
  | 'life.changed'
  | 'commander.damage.changed'
  | 'counter.changed'
  | 'card.moved'
  | 'card.tapped'
  | 'turn.changed'
  | 'zone.changed';

export interface GameCardInstance {
  instanceId: string;
  scryfallId: string;
  name: string;
  tapped: boolean;
}

export type GameZones = Record<GameZoneName, GameCardInstance[]>;

export interface GamePlayerState {
  user: User;
  life: number;
  zones: GameZones;
  commanderDamage: Record<string, number>;
  counters: Record<string, number>;
}

export interface GameTurn {
  activePlayerId: string | null;
  phase: string;
  number: number;
}

export interface ChatMessage {
  userId: string;
  displayName: string;
  message: string;
  createdAt: string;
}

export interface GameSnapshot {
  players: Record<string, GamePlayerState>;
  turn: GameTurn;
  chat: ChatMessage[];
  createdAt: string;
  counters?: Record<string, Record<string, number>>;
}

export interface Game {
  id: string;
  status: 'active' | string;
  snapshot: GameSnapshot;
}

export interface GameEvent {
  id: string;
  type: GameCommandType | string;
  payload: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
}

export interface GameCommand<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  type: GameCommandType;
  payload: TPayload;
}

export interface MercureGameEvent {
  gameId: string;
  event: GameEvent;
  snapshot: GameSnapshot;
}

