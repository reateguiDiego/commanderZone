import { Card } from './card.model';
import { Deck, CommanderValidation } from './deck.model';
import { Game, GameEvent, GameSnapshot } from './game.model';
import { Room } from './room.model';
import { User } from './user.model';

export interface ApiError {
  error: string;
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

export interface CardResponse {
  card: Card;
}

export interface DeckResponse {
  deck: Deck;
}

export interface DeckImportResponse {
  deck: Deck;
  missing: string[];
}

export type CommanderValidationResponse = CommanderValidation;

export interface RoomResponse {
  room: Room;
}

export interface StartGameResponse {
  room: Room;
  game: Game;
}

export interface GameResponse {
  game: Game;
}

export interface CommandResponse {
  event: GameEvent;
  snapshot: GameSnapshot;
}

