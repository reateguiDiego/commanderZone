import { Card } from './card.model';
import { Deck, DeckFolder, DeckFormat, CommanderValidation } from './deck.model';
import { Game, GameEvent, GameRematchVote, GameSnapshot } from './game.model';
import { Friendship } from './friendship.model';
import { RoomInvite } from './room-invite.model';
import { CurrentRoomPlayerSummary, CurrentRoomSummary, CurrentRoomTurn, CurrentRoomViewerRole, Room } from './room.model';
import { User } from './user.model';

export interface ApiError {
  error: string;
  code?: string;
}

export interface DataResponse<T> {
  data: T[];
  page?: number;
  limit?: number;
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

export interface PasswordResetConfirmResponse {
  updated: boolean;
  token: string;
  user: User;
}

export interface EmailVerificationRequestResponse {
  accepted: boolean;
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
