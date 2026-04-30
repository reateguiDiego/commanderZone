import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { CommandResponse, GameResponse } from '../models/api-responses.model';
import { withoutGlobalLoading } from '../loading/loading-context';
import { GameCommand, GameZoneName, GameZoneResponse } from '../models/game.model';

@Injectable({ providedIn: 'root' })
export class GamesApi {
  private readonly http = inject(HttpClient);

  snapshot(gameId: string): Observable<GameResponse> {
    return this.http.get<GameResponse>(`${API_BASE_URL}/games/${gameId}/snapshot`, { context: withoutGlobalLoading() });
  }

  command(command: GameCommand, gameId: string): Observable<CommandResponse> {
    return this.http.post<CommandResponse>(`${API_BASE_URL}/games/${gameId}/commands`, command, { context: withoutGlobalLoading() });
  }

  zone(gameId: string, playerId: string, zone: GameZoneName, params: { type?: string; search?: string; limit?: number; offset?: number } = {}): Observable<GameZoneResponse> {
    const query = Object.fromEntries(
      Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => [key, String(value)]),
    );

    return this.http.get<GameZoneResponse>(`${API_BASE_URL}/games/${gameId}/zones/${playerId}/${zone}`, {
      context: withoutGlobalLoading(),
      params: query,
    });
  }
}

