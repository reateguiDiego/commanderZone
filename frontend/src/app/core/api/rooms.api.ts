import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { DataResponse, RoomResponse, StartGameResponse } from '../models/api-responses.model';
import { Room, RoomVisibility } from '../models/room.model';

@Injectable({ providedIn: 'root' })
export class RoomsApi {
  private readonly http = inject(HttpClient);

  list(): Observable<DataResponse<Room>> {
    return this.http.get<DataResponse<Room>>(`${API_BASE_URL}/rooms`);
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

  start(roomId: string): Observable<StartGameResponse> {
    return this.http.post<StartGameResponse>(`${API_BASE_URL}/rooms/${roomId}/start`, {});
  }

  private deckPayload(deckId?: string): { deckId?: string } {
    return deckId ? { deckId } : {};
  }
}
