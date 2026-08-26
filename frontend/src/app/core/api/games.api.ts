import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { withoutGlobalLoading } from '../loading/loading-context';
import { CommandResponse, DisconnectVoteResponse, GameChatHistoryPageResponse, GameControlPlaneResponse, GameDebugHealthResponse, GameLogHistoryPageResponse, GameResponse, GameWebsocketTicketResponse, RematchVoteRequest, RematchVoteResponse } from '../models/api-responses.model';
import { GameCommand, GameDisconnectVoteChoice, GameZoneName, GameZoneResponse } from '../models/game.model';
import { BootstrapV2 } from '../models/game-v2.model';

@Injectable({ providedIn: 'root' })
export class GamesApi {
  private readonly http = inject(HttpClient);

  snapshot(gameId: string): Observable<GameResponse> {
    return this.http.get<GameResponse>(`${API_BASE_URL}/games/${gameId}/snapshot`);
  }

  bootstrapV2(gameId: string, knownStaticCards: string[] = []): Observable<BootstrapV2> {
    const params: Record<string, string> = {
      contract: 'v2',
    };
    if (knownStaticCards.length > 0) {
      params['knownStaticCards'] = knownStaticCards.join(',');
    }

    return this.http.get<BootstrapV2>(`${API_BASE_URL}/games/${gameId}/bootstrap`, {
      context: withoutGlobalLoading(),
      params,
    });
  }

  command(command: GameCommand, gameId: string): Observable<CommandResponse> {
    return this.http.post<CommandResponse>(`${API_BASE_URL}/games/${gameId}/commands`, command);
  }

  websocketTicket(gameId: string): Observable<GameWebsocketTicketResponse> {
    return this.http.post<GameWebsocketTicketResponse>(`${API_BASE_URL}/games/${gameId}/websocket-ticket`, {});
  }

  debugHealth(gameId: string): Observable<GameDebugHealthResponse> {
    return this.http.get<GameDebugHealthResponse>(`${API_BASE_URL}/games/${gameId}/debug/health`);
  }

  rematchVote(gameId: string, request: RematchVoteRequest): Observable<RematchVoteResponse> {
    return this.http.post<RematchVoteResponse>(`${API_BASE_URL}/games/${gameId}/rematch-vote`, request);
  }

  /**
   * One-shot recovery used only after a real Mercure reconnect. This endpoint
   * deliberately returns a compact control-plane projection, not a snapshot.
   */
  controlPlane(gameId: string, afterRevision: number): Observable<GameControlPlaneResponse | null> {
    return this.http.get<GameControlPlaneResponse>(`${API_BASE_URL}/games/${gameId}/control-plane`, {
      params: { afterRevision: String(afterRevision) },
      observe: 'response',
      context: withoutGlobalLoading(),
    }).pipe(
      map((response: HttpResponse<GameControlPlaneResponse>) => response.status === 204 ? null : response.body),
    );
  }

  disconnectVote(gameId: string, targetPlayerId: string, vote: GameDisconnectVoteChoice): Observable<DisconnectVoteResponse> {
    return this.http.post<DisconnectVoteResponse>(
      `${API_BASE_URL}/games/${gameId}/disconnect-vote`,
      { targetPlayerId, vote },
    );
  }

  zone(gameId: string, playerId: string, zone: GameZoneName, params: { type?: string; search?: string; limit?: number; offset?: number } = {}): Observable<GameZoneResponse> {
    const query = Object.fromEntries(
      Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => [key, String(value)]),
    );

    return this.http.get<GameZoneResponse>(`${API_BASE_URL}/games/${gameId}/zones/${playerId}/${zone}`, {
      params: query,
    });
  }

  logHistoryPage(gameId: string, before: string, limit = 50): Observable<GameLogHistoryPageResponse> {
    return this.http.get<GameLogHistoryPageResponse>(`${API_BASE_URL}/games/${gameId}/log`, {
      context: withoutGlobalLoading(),
      params: {
        before,
        limit: String(limit),
      },
    });
  }

  logForwardPage(gameId: string, after: string, limit = 50): Observable<GameLogHistoryPageResponse> {
    return this.http.get<GameLogHistoryPageResponse>(`${API_BASE_URL}/games/${gameId}/log`, {
      context: withoutGlobalLoading(),
      params: {
        cursor: after,
        limit: String(limit),
      },
    });
  }

  logLatestPage(gameId: string, limit = 50): Observable<GameLogHistoryPageResponse> {
    return this.http.get<GameLogHistoryPageResponse>(`${API_BASE_URL}/games/${gameId}/log`, {
      context: withoutGlobalLoading(),
      params: { limit: String(limit) },
    });
  }

  chatHistoryPage(gameId: string, before: string, limit = 50): Observable<GameChatHistoryPageResponse> {
    return this.http.get<GameChatHistoryPageResponse>(`${API_BASE_URL}/games/${gameId}/chat`, {
      context: withoutGlobalLoading(),
      params: { before, limit: String(limit) },
    });
  }

  chatForwardPage(gameId: string, after: string, limit = 50): Observable<GameChatHistoryPageResponse> {
    return this.http.get<GameChatHistoryPageResponse>(`${API_BASE_URL}/games/${gameId}/chat`, {
      context: withoutGlobalLoading(),
      params: { cursor: after, limit: String(limit) },
    });
  }

  chatLatestPage(gameId: string, limit = 50): Observable<GameChatHistoryPageResponse> {
    return this.http.get<GameChatHistoryPageResponse>(`${API_BASE_URL}/games/${gameId}/chat`, {
      context: withoutGlobalLoading(),
      params: { limit: String(limit) },
    });
  }
}

