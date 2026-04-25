import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { CommandResponse, GameResponse } from '../models/api-responses.model';
import { GameCommand } from '../models/game.model';

@Injectable({ providedIn: 'root' })
export class GamesApi {
  private readonly http = inject(HttpClient);

  snapshot(gameId: string): Observable<GameResponse> {
    return this.http.get<GameResponse>(`${API_BASE_URL}/games/${gameId}/snapshot`);
  }

  command(command: GameCommand, gameId: string): Observable<CommandResponse> {
    return this.http.post<CommandResponse>(`${API_BASE_URL}/games/${gameId}/commands`, command);
  }
}

