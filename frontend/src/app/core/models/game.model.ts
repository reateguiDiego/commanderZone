import { User } from './user.model';
import { CardFace } from './card.model';

export type GameZoneName = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command';
export interface GameCardPixelPosition {
  x: number;
  y: number;
  unit?: undefined;
}

export interface GameCardRatioPosition {
  x: number;
  y: number;
  unit: 'ratio';
}

export type GameCardPosition = GameCardPixelPosition | GameCardRatioPosition;

export type GameCommandType =
  | 'game.concede'
  | 'game.close'
  | 'chat.message'
  | 'chat.reaction.toggled'
  | 'dice.rolled'
  | 'life.changed'
  | 'commander.damage.changed'
  | 'counter.changed'
  | 'card.counter.changed'
  | 'card.power_toughness.changed'
  | 'card.moved'
  | 'cards.moved'
  | 'card.tapped'
  | 'card.position.changed'
  | 'cards.position.changed'
  | 'card.face_down.changed'
  | 'card.face.changed'
  | 'card.revealed'
  | 'card.token.created'
  | 'card.token_copy.created'
  | 'card.controller.changed'
  | 'turn.changed'
  | 'battlefield.untap_all'
  | 'zone.changed'
  | 'zone.move_all'
  | 'zone.random_card.selected'
  | 'library.draw'
  | 'library.draw_many'
  | 'library.shuffle'
  | 'library.move_top'
  | 'library.reveal_top'
  | 'library.reveal'
  | 'library.view'
  | 'library.play_top_revealed'
  | 'library.reorder_top'
  | 'stack.card_added'
  | 'stack.item_removed'
  | 'arrow.created'
  | 'arrow.removed'
  | 'attachment.created'
  | 'attachment.removed'
  | 'disconnect.vote';

export interface GameCardInstance {
  instanceId: string;
  ownerId?: string;
  controllerId?: string;
  scryfallId?: string;
  name: string;
  imageUris?: Record<string, string>;
  cardFaces?: CardFace[];
  hasRulings?: boolean;
  typeLine?: string | null;
  manaCost?: string | null;
  oracleText?: string | null;
  colorIdentity?: string[];
  power?: number | null;
  toughness?: number | null;
  loyalty?: number | null;
  defaultPower?: number | null;
  defaultToughness?: number | null;
  defaultLoyalty?: number | null;
  tapped: boolean;
  faceDown?: boolean;
  activeFaceIndex?: number;
  hidden?: boolean;
  revealedTo?: string[];
  position?: GameCardPosition;
  rotation?: number;
  counters?: Record<string, number>;
  zone?: GameZoneName;
  isToken?: boolean;
  isTokenCopy?: boolean;
  isCommander?: boolean;
}

export type GameZones = Record<GameZoneName, GameCardInstance[]>;
export type GameZoneCounts = Record<GameZoneName, number>;

export interface GamePlayerState {
  user: User;
  status?: 'active' | 'conceded';
  concededAt?: string | null;
  deckName?: string | null;
  colorIdentity?: string[];
  backgroundName?: string;
  sleevesName?: string;
  playTopLibraryRevealed?: boolean;
  revealedLibraryTo?: string[];
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

export type ChatReactionType = 'like' | 'dislike' | 'love' | 'laugh' | 'angry' | 'vomit' | 'cry';

export interface ChatReactionEntry {
  userId: string;
  displayName: string;
  createdAt: string;
}

export type ChatReactions = Partial<Record<ChatReactionType, ChatReactionEntry[]>>;

export interface ChatMessage {
  id?: string;
  userId: string;
  displayName: string;
  message: string;
  targetPlayerId?: string | null;
  targetDisplayName?: string | null;
  createdAt: string;
  reactions?: ChatReactions;
}

export interface GameLogEntry {
  id: string;
  type: string;
  message: string;
  actorId: string | null;
  displayName: string | null;
  createdAt: string;
  cardNames?: string[];
  cardInstanceId?: string;
  cardPlayerId?: string;
  cardZone?: GameZoneName;
}

export interface GameStackItem {
  id: string;
  kind: string;
  card?: GameCardInstance;
  createdAt: string;
}

export interface GameArrow {
  id: string;
  ownerId?: string;
  fromInstanceId: string;
  toInstanceId: string;
  color: string;
  createdAt: string;
}

export interface GameAttachment {
  id: string;
  ownerId?: string;
  equipmentInstanceId: string;
  attachedToInstanceId: string;
  createdAt: string;
}

export type GameRematchVote = 'play_again' | 'leave';

export interface GameRematchVoteState {
  playerId: string;
  displayName: string;
  vote: GameRematchVote;
  votedAt: string;
}

export interface GameRematchState {
  votes: Record<string, GameRematchVoteState>;
}

export type GameDisconnectVoteChoice = 'wait' | 'expel';
export type GameDisconnectVoteStatus = 'open' | 'resolved_wait' | 'resolved_expel' | 'cancelled';

export interface GameDisconnectVoteEntry {
  playerId: string;
  displayName: string;
  vote: GameDisconnectVoteChoice;
  votedAt: string;
}

export interface GameDisconnectVoteState {
  targetPlayerId: string | null;
  status: GameDisconnectVoteStatus;
  openedAt: string | null;
  deadlineAt: string | null;
  cooldownUntil: string | null;
  votes: Record<string, GameDisconnectVoteEntry>;
}

export interface GameSnapshot {
  version: number;
  ownerId?: string;
  players: Record<string, GamePlayerState>;
  turn: GameTurn;
  timer?: {
    mode: 'none' | 'turn';
    status: 'idle' | 'running' | 'paused';
    durationSeconds: number | null;
    remainingSeconds: number | null;
  };
  stack: GameStackItem[];
  arrows: GameArrow[];
  attachments?: GameAttachment[];
  chat: ChatMessage[];
  eventLog: GameLogEntry[];
  rematch?: GameRematchState;
  disconnectVote?: GameDisconnectVoteState | null;
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

