import { Card } from './card.model';
import { CommunityDeckDetail, CommunityHome, CommunityPreviewCards } from './community.model';
import { Deck, DeckFolder, DeckFormat, CommanderValidation } from './deck.model';
import { Game, GameDisconnectVoteChoice, GameEvent, GameRematchVote, GameSnapshot } from './game.model';
import { Friendship } from './friendship.model';
import { RoomInvite } from './room-invite.model';
import { CurrentRoomPlayerSummary, CurrentRoomSummary, CurrentRoomTurn, CurrentRoomViewerRole, Room } from './room.model';
import { User } from './user.model';

export interface ApiError {
  error: string;
  code?: string;
  count?: number;
  retryAfterSeconds?: number;
}

export interface DataResponse<T> {
  data: T[];
  page?: number;
  limit?: number;
  hasMore?: boolean;
  total?: number;
}

export interface UserResponse {
  user: User;
}

export interface LoginResponse {
  token: string;
}

export interface PasswordResetRequestResponse {
  accepted: boolean;
}

export interface ContactResponse {
  accepted: boolean;
}

export interface PasswordResetConfirmResponse {
  updated: boolean;
  token: string;
  user: User;
}

export interface EmailVerificationConfirmResponse {
  verified: boolean;
  token: string;
  user: User;
}

export interface CardResponse {
  card: Card;
}

export interface CardImageResponse {
  scryfallId: string;
  format: string;
  uri: string;
}

export interface DeckResponse {
  deck: Deck;
}

export interface DeckFolderResponse {
  folder: DeckFolder;
}

export type CommunityHomeResponse = CommunityHome;

export interface CommunityDeckListResponse {
  decks: import('./community.model').CommunityDeckSummary[];
}

export interface CommunityDeckDetailResponse {
  deck: CommunityDeckDetail;
}

export type CommunityPreviewCardsResponse = CommunityPreviewCards;

export interface FriendshipResponse {
  friendship: Friendship;
}

export interface DeckImportResponse {
  format?: string;
  deck: Deck;
  missing: string[];
  summary?: {
    format: string;
    parsedCards: number;
    totalCards: number;
    resolvedCards: number;
    importedCards: number;
    missingCards: number;
    commanderCount: number;
    mainCount: number;
    sideboardCount?: number;
    maybeboardCount?: number;
    playableTotal?: number;
  };
  missingCards?: MissingDeckCard[];
}

export interface MissingDeckCard {
  name: string;
  quantity: number;
  section: string;
  setCode: string | null;
  collectorNumber: string | null;
  line: number;
  rawLine: string;
  reason: 'not_found' | 'ambiguous' | string;
  matches?: Card[];
}

export interface DeckFormatResponse {
  data: DeckFormat[];
}

export type CommanderValidationResponse = CommanderValidation;

export interface RoomResponse {
  room: Room;
}

export interface LeaveRoomResponse {
  left: boolean;
  roomDeleted: boolean;
}

export interface CurrentRoomResponse {
  room: CurrentRoomSummary | null;
  player: CurrentRoomPlayerSummary | null;
  turn: CurrentRoomTurn | null;
  viewerRole: CurrentRoomViewerRole | null;
}

export interface StartGameResponse {
  room: Room;
  game: Game;
}

export interface RoomInviteResponse {
  invite: RoomInvite;
  room?: Room;
}

export interface GameResponse {
  game: Game;
}

export interface GameWebsocketTicketResponse {
  ticket: string;
  expiresAt: string;
  websocketUrl: string;
}

export interface GameDebugPlayerContext {
  playerId: string;
  displayName: string;
  deckName: string | null;
  status: string;
}

export interface GameDebugTrafficBucket {
  messages: number;
  characters: number;
  byKind: Record<string, number>;
  byAction: Record<string, number>;
  byChannel: Record<string, number>;
}

export interface GameDebugActionExchange {
  kind: string;
  action: string;
  userId?: string | null;
  clientActionId?: string | null;
  baseVersion?: number | null;
  durationMs?: number;
  incoming?: {
    kind?: string;
    characters?: number;
  };
  outgoing?: {
    messages?: number;
    characters?: number;
    byKind?: Record<string, number>;
    byChannel?: Record<string, number>;
    operationTypes?: string[];
    operationCount?: number;
    recipientCount?: number;
    maxMessageCharacters?: number;
    errors?: GameDebugError[];
  };
  at: string;
  [key: string]: unknown;
}

export interface GameDebugError {
  code?: string | null;
  message?: string | null;
  retryable?: boolean | null;
  status?: string | null;
  kind?: string | null;
  at?: string;
  [key: string]: unknown;
}

export interface GameDebugConnectionRankingEntry {
  userId: string;
  displayName: string;
  disconnects: number;
  status: string;
  lastDisconnectedAt: string | null;
}

export interface GameDebugConnectionState {
  displayName?: string;
  status?: string;
  connections?: number;
  disconnects?: number;
  lastConnectedAt?: string | null;
  lastDisconnectedAt?: string | null;
  offlineSince?: string | null;
  [key: string]: unknown;
}

export interface GameDebugHealthResponse {
  gameId: string;
  enabled: boolean;
  context: {
    players: GameDebugPlayerContext[];
  };
  health: {
    websocket: {
      connections: {
        total: number;
        byUser: Record<string, GameDebugConnectionState>;
        transitions: {
          online: number;
          offline: number;
        };
        disconnectRanking: GameDebugConnectionRankingEntry[];
      };
      lastSeen: Record<string, unknown> | null;
    };
    traffic: {
      incoming: GameDebugTrafficBucket;
      outgoing: GameDebugTrafficBucket;
      keepalive: {
        incoming: GameDebugTrafficBucket;
        outgoing: GameDebugTrafficBucket;
      };
    };
    actions: {
      total: number;
      byType: Record<string, number>;
      recent: GameDebugActionExchange[];
    };
    pipeline: {
      gamePatch: number;
      commandAck: Record<string, number>;
      resyncRequired: number;
      error: number;
      pong: number;
      presenceChanged: number;
    };
    performance: {
      commands: {
        count: number;
        totalMs: number;
        avgMs: number;
        maxMs: number;
      };
    };
    replay: Record<string, unknown>;
    sync: Record<string, unknown>;
    errors: {
      total: number;
      byCode: Record<string, number>;
      recent: GameDebugError[];
    };
    recent: Record<string, unknown>[];
    events: Record<string, unknown>[];
  };
  generatedAt: string;
  updatedAt: string | null;
}

export interface CommandResponse {
  event: GameEvent;
  snapshot: GameSnapshot;
  version?: number | null;
  applied?: boolean;
}

export type RematchVoteStatus = 'left' | 'room_deleted' | 'waiting_for_game_end' | 'waiting_for_votes' | 'room_ready';

export interface RematchVoteResponse {
  status: RematchVoteStatus;
  message?: string | null;
  event?: GameEvent | null;
  snapshot?: GameSnapshot | null;
  version?: number | null;
  room?: Room;
  left?: boolean;
  roomDeleted?: boolean;
}

export interface RematchVoteRequest {
  vote: GameRematchVote;
}

export interface DisconnectVoteRequest {
  targetPlayerId: string;
  vote: GameDisconnectVoteChoice;
}

export interface DisconnectVoteResponse {
  status: 'recorded';
  event?: GameEvent | null;
  snapshot?: GameSnapshot | null;
  version?: number | null;
}
