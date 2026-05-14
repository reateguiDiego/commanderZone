import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { CurrentRoomResponse, DataResponse, RoomInviteResponse, RoomResponse, StartGameResponse } from '../models/api-responses.model';
import { RoomInvite } from '../models/room-invite.model';
import { Room, RoomFormat, RoomTimerMode, RoomVisibility } from '../models/room.model';
import { withoutGlobalLoading } from '../loading/loading-context';

@Injectable({ providedIn: 'root' })
export class RoomsApi {
  private readonly http = inject(HttpClient);

  list(status: 'active' | 'all' = 'active', skipGlobalLoading = false): Observable<DataResponse<Room>> {
    return this.http.get<DataResponse<Room>>(`${API_BASE_URL}/rooms`, {
      params: { status },
      context: skipGlobalLoading ? withoutGlobalLoading() : undefined,
    });
  }

  show(roomId: string, skipGlobalLoading = false): Observable<RoomResponse> {
    return this.http.get<RoomResponse>(`${API_BASE_URL}/rooms/${roomId}`, {
      context: skipGlobalLoading ? withoutGlobalLoading() : undefined,
    });
  }

  current(skipGlobalLoading = false): Observable<CurrentRoomResponse> {
    return this.http.get<CurrentRoomResponse>(`${API_BASE_URL}/rooms/current`, {
      context: skipGlobalLoading ? withoutGlobalLoading() : undefined,
    });
  }

  create(
    deckId?: string,
    visibility: RoomVisibility = 'private',
    options?: { name?: string; maxPlayers?: number; startingLife?: number; timerMode?: RoomTimerMode; timerDurationSeconds?: number; format?: RoomFormat },
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
    });
  }

  join(roomId: string, deckId?: string, skipGlobalLoading = false): Observable<RoomResponse> {
    return this.http.post<RoomResponse>(`${API_BASE_URL}/rooms/${roomId}/join`, this.deckPayload(deckId), {
      context: skipGlobalLoading ? withoutGlobalLoading() : undefined,
    });
  }

  joinByCode(code: string, deckId?: string, skipGlobalLoading = false): Observable<RoomResponse> {
    return this.http.post<RoomResponse>(`${API_BASE_URL}/rooms/code/${encodeURIComponent(code)}/join`, this.deckPayload(deckId), {
      context: skipGlobalLoading ? withoutGlobalLoading() : undefined,
    });
  }

  update(roomId: string, options: { maxPlayers?: number; startingLife?: number; timerMode?: RoomTimerMode; timerDurationSeconds?: number }, skipGlobalLoading = false): Observable<RoomResponse> {
    return this.http.patch<RoomResponse>(`${API_BASE_URL}/rooms/${roomId}`, options, {
      context: skipGlobalLoading ? withoutGlobalLoading() : undefined,
    });
  }

  rollTurn(roomId: string, skipGlobalLoading = false): Observable<RoomResponse> {
    return this.http.post<RoomResponse>(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, {}, {
      context: skipGlobalLoading ? withoutGlobalLoading() : undefined,
    });
  }

  leave(roomId: string): Observable<RoomResponse> {
    return this.http.post<RoomResponse>(`${API_BASE_URL}/rooms/${roomId}/leave`, {});
  }

  kickPlayer(roomId: string, playerId: string, skipGlobalLoading = false): Observable<RoomResponse> {
    return this.http.delete<RoomResponse>(`${API_BASE_URL}/rooms/${roomId}/players/${playerId}`, {
      context: skipGlobalLoading ? withoutGlobalLoading() : undefined,
    });
  }

  delete(roomId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/rooms/${roomId}`);
  }

  start(roomId: string): Observable<StartGameResponse> {
    return this.http.post<StartGameResponse>(`${API_BASE_URL}/rooms/${roomId}/start`, {});
  }

  incomingInvites(skipGlobalLoading = false): Observable<DataResponse<RoomInvite>> {
    return this.http.get<DataResponse<RoomInvite>>(`${API_BASE_URL}/rooms/invites/incoming`, {
      context: skipGlobalLoading ? withoutGlobalLoading() : undefined,
    });
  }

  invites(roomId: string, skipGlobalLoading = false): Observable<DataResponse<RoomInvite>> {
    return this.http.get<DataResponse<RoomInvite>>(`${API_BASE_URL}/rooms/${roomId}/invites`, {
      context: skipGlobalLoading ? withoutGlobalLoading() : undefined,
    });
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
}
