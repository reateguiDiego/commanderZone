import { User } from './user.model';

export type GameZoneName = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command';
export type GameCommandType =
  | 'game.concede'
  | 'game.close'
  | 'chat.message'
  | 'life.changed'
  | 'commander.damage.changed'
  | 'counter.changed'
  | 'card.counter.changed'
  | 'card.power_toughness.changed'
  | 'card.moved'
  | 'cards.moved'
  | 'card.tapped'
  | 'card.position.changed'
  | 'card.face_down.changed'
  | 'card.revealed'
  | 'card.token_copy.created'
  | 'card.controller.changed'
  | 'turn.changed'
  | 'zone.changed'
  | 'zone.move_all'
  | 'library.draw'
  | 'library.draw_many'
  | 'library.shuffle'
  | 'library.move_top'
  | 'library.reveal_top'
  | 'library.reveal'
  | 'library.play_top_revealed'
  | 'stack.card_added'
  | 'stack.item_removed'
  | 'arrow.created'
  | 'arrow.removed';

export interface GameCardInstance {
  instanceId: string;
  ownerId?: string;
  controllerId?: string;
  scryfallId?: string;
  name: string;
  imageUris?: Record<string, string>;
  typeLine?: string | null;
  manaCost?: string | null;
  colorIdentity?: string[];
  power?: number | null;
  toughness?: number | null;
  loyalty?: number | null;
  tapped: boolean;
  faceDown?: boolean;
  hidden?: boolean;
  revealedTo?: string[];
  position?: { x: number; y: number };
  rotation?: number;
  counters?: Record<string, number>;
  zone?: GameZoneName;
  isToken?: boolean;
}

export type GameZones = Record<GameZoneName, GameCardInstance[]>;
export type GameZoneCounts = Record<GameZoneName, number>;

export interface GamePlayerState {
  user: User;
  status?: 'active' | 'conceded';
  concededAt?: string | null;
  colorIdentity?: string[];
  life: number;
  zones: GameZones;
  zoneCounts?: GameZoneCounts;
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

export interface GameLogEntry {
  id: string;
  type: string;
  message: string;
  actorId: string | null;
  displayName: string | null;
  createdAt: string;
}

export interface GameStackItem {
  id: string;
  kind: string;
  card?: GameCardInstance;
  createdAt: string;
}

export interface GameArrow {
  id: string;
  fromInstanceId: string;
  toInstanceId: string;
  color: string;
  createdAt: string;
}

export interface GameSnapshot {
  version: number;
  ownerId?: string;
  players: Record<string, GamePlayerState>;
  turn: GameTurn;
  stack: GameStackItem[];
  arrows: GameArrow[];
  chat: ChatMessage[];
  eventLog: GameLogEntry[];
  createdAt: string;
  updatedAt?: string;
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
  clientActionId?: string;
}

export interface MercureGameEvent {
  gameId: string;
  event: GameEvent;
  version: number | null;
}

export interface GameZoneResponse {
  gameId: string;
  playerId: string;
  zone: GameZoneName;
  total: number;
  data: GameCardInstance[];
}

