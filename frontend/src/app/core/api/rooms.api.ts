import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { CurrentRoomResponse, DataResponse, LeaveRoomResponse, RoomInviteResponse, RoomResponse, StartGameResponse } from '../models/api-responses.model';
import { RoomInvite } from '../models/room-invite.model';
import { Room, RoomFormat, RoomMulliganRule, RoomTimerMode, RoomVisibility } from '../models/room.model';

export interface JoinRoomOptions {
  readonly randomDeckOptionCount?: number;
}

@Injectable({ providedIn: 'root' })
export class RoomsApi {
  private readonly http = inject(HttpClient);

  list(status: 'active' | 'all' = 'active', _skipGlobalLoading = false): Observable<DataResponse<Room>> {
    return this.http.get<DataResponse<Room>>(`${API_BASE_URL}/rooms`, {
      params: { status },
    });
  }

  show(roomId: string, _skipGlobalLoading = false): Observable<RoomResponse> {
    return this.http.get<RoomResponse>(`${API_BASE_URL}/rooms/${roomId}`);
  }

  current(_skipGlobalLoading = false): Observable<CurrentRoomResponse> {
    return this.http.get<CurrentRoomResponse>(`${API_BASE_URL}/rooms/current`);
  }

  create(
    deckId?: string,
    visibility: RoomVisibility = 'private',
    options?: {
      name?: string;
      maxPlayers?: number;
      startingLife?: number;
      timerMode?: RoomTimerMode;
      timerDurationSeconds?: number;
      format?: RoomFormat;
      mulliganRule?: RoomMulliganRule;
      firstMulliganFree?: boolean;
    },
  ): Observable<RoomResponse> {
    return this.http.post<RoomResponse>(`${API_BASE_URL}/rooms`, {
      ...this.deckPayload(deckId),
      visibility,
      ...(options?.name ? { name: options.name } : {}),
      ...(typeof options?.maxPlayers === 'number' ? { maxPlayers: options.maxPlayers } : {}),
      ...(typeof options?.startingLife === 'number' ? { startingLife: options.startingLife } : {}),
      ...(options?.timerMode ? { timerMode: options.timerMode } : {}),
      ...(typeof options?.timerDurationSeconds === 'number' ? { timerDurationSeconds: options.timerDurationSeconds } : {}),
      ...(options?.format ? { format: options.format } : {}),
      ...(options?.mulliganRule ? { mulliganRule: options.mulliganRule } : {}),
      ...(typeof options?.firstMulliganFree === 'boolean' ? { firstMulliganFree: options.firstMulliganFree } : {}),
    });
  }

  join(roomId: string, deckId?: string, _skipGlobalLoading = false, options?: JoinRoomOptions): Observable<RoomResponse> {
    return this.http.post<RoomResponse>(`${API_BASE_URL}/rooms/${roomId}/join`, this.joinPayload(deckId, options));
  }

  joinByCode(code: string, deckId?: string, _skipGlobalLoading = false): Observable<RoomResponse> {
    return this.http.post<RoomResponse>(`${API_BASE_URL}/rooms/code/${encodeURIComponent(code)}/join`, this.deckPayload(deckId));
  }

  update(
    roomId: string,
    options: {
      maxPlayers?: number;
      startingLife?: number;
      timerMode?: RoomTimerMode;
      timerDurationSeconds?: number;
      mulliganRule?: RoomMulliganRule;
      firstMulliganFree?: boolean;
    },
    _skipGlobalLoading = false,
  ): Observable<RoomResponse> {
    return this.http.patch<RoomResponse>(`${API_BASE_URL}/rooms/${roomId}`, options);
  }

  rollTurn(roomId: string, _skipGlobalLoading = false): Observable<RoomResponse> {
    return this.http.post<RoomResponse>(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, {});
  }

  leave(roomId: string, _skipGlobalLoading = false): Observable<LeaveRoomResponse> {
    return this.http.post<LeaveRoomResponse>(`${API_BASE_URL}/rooms/${roomId}/leave`, {});
  }

  kickPlayer(roomId: string, playerId: string, _skipGlobalLoading = false): Observable<RoomResponse> {
    return this.http.delete<RoomResponse>(`${API_BASE_URL}/rooms/${roomId}/players/${playerId}`);
  }

  delete(roomId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/rooms/${roomId}`);
  }

  start(roomId: string): Observable<StartGameResponse> {
    return this.http.post<StartGameResponse>(`${API_BASE_URL}/rooms/${roomId}/start`, {});
  }

  incomingInvites(_skipGlobalLoading = false): Observable<DataResponse<RoomInvite>> {
    return this.http.get<DataResponse<RoomInvite>>(`${API_BASE_URL}/rooms/invites/incoming`);
  }

  invites(roomId: string, _skipGlobalLoading = false): Observable<DataResponse<RoomInvite>> {
    return this.http.get<DataResponse<RoomInvite>>(`${API_BASE_URL}/rooms/${roomId}/invites`);
  }

  invite(roomId: string, userId: string): Observable<RoomInviteResponse> {
    return this.http.post<RoomInviteResponse>(`${API_BASE_URL}/rooms/${roomId}/invites`, { userId });
  }

  acceptInvite(inviteId: string, deckId?: string): Observable<RoomInviteResponse> {
    return this.http.post<RoomInviteResponse>(`${API_BASE_URL}/rooms/invites/${inviteId}/accept`, this.deckPayload(deckId));
  }

  declineInvite(inviteId: string): Observable<RoomInviteResponse> {
    return this.http.post<RoomInviteResponse>(`${API_BASE_URL}/rooms/invites/${inviteId}/decline`, {});
  }

  private deckPayload(deckId?: string): { deckId?: string } {
    return deckId ? { deckId } : {};
  }

  private joinPayload(deckId?: string, options?: JoinRoomOptions): { deckId?: string; randomDeckOptionCount?: number } {
    return {
      ...this.deckPayload(deckId),
      ...(typeof options?.randomDeckOptionCount === 'number'
        ? { randomDeckOptionCount: options.randomDeckOptionCount }
        : {}),
    };
  }
}
