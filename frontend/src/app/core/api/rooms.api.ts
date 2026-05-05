import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { DataResponse, RoomInviteResponse, RoomResponse, StartGameResponse } from '../models/api-responses.model';
import { RoomInvite } from '../models/room-invite.model';
import { Room, RoomVisibility } from '../models/room.model';
import { withoutGlobalLoading } from '../loading/loading-context';

@Injectable({ providedIn: 'root' })
export class RoomsApi {
  private readonly http = inject(HttpClient);

  list(status: 'active' | 'archived' | 'all' = 'active', skipGlobalLoading = false): Observable<DataResponse<Room>> {
    return this.http.get<DataResponse<Room>>(`${API_BASE_URL}/rooms`, {
      params: { status },
      context: skipGlobalLoading ? withoutGlobalLoading() : undefined,
    });
  }

  show(roomId: string): Observable<RoomResponse> {
    return this.http.get<RoomResponse>(`${API_BASE_URL}/rooms/${roomId}`);
  }

  create(deckId?: string, visibility: RoomVisibility = 'private'): Observable<RoomResponse> {
    return this.http.post<RoomResponse>(`${API_BASE_URL}/rooms`, { ...this.deckPayload(deckId), visibility });
  }

  join(roomId: string, deckId?: string): Observable<RoomResponse> {
    return this.http.post<RoomResponse>(`${API_BASE_URL}/rooms/${roomId}/join`, this.deckPayload(deckId));
  }

  leave(roomId: string): Observable<RoomResponse> {
    return this.http.post<RoomResponse>(`${API_BASE_URL}/rooms/${roomId}/leave`, {});
  }

  delete(roomId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/rooms/${roomId}`);
  }

  archive(roomId: string): Observable<RoomResponse> {
    return this.http.post<RoomResponse>(`${API_BASE_URL}/rooms/${roomId}/archive`, {});
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
