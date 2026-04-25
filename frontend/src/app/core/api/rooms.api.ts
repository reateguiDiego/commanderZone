import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { RoomResponse, StartGameResponse } from '../models/api-responses.model';

@Injectable({ providedIn: 'root' })
export class RoomsApi {
  private readonly http = inject(HttpClient);

  create(deckId?: string): Observable<RoomResponse> {
    return this.http.post<RoomResponse>(`${API_BASE_URL}/rooms`, this.deckPayload(deckId));
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

