import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { API_BASE_URL, MERCURE_URL } from '../api/api.config';
import { MercureGameEvent } from '../models/game.model';

@Injectable({ providedIn: 'root' })
export class MercureService {
  constructor(private readonly http: HttpClient) {}

  gameEvents(gameId: string): Observable<MercureGameEvent> {
    return new Observable<MercureGameEvent>((subscriber) => {
      let source: EventSource | null = null;
      let closed = false;
      const url = `${MERCURE_URL}?topic=${encodeURIComponent(`games/${gameId}`)}`;
      this.authorizeMercure()
        .then(() => {
          if (closed) {
            return;
          }
          source = new EventSource(url, { withCredentials: true });

          source.onmessage = (message) => {
            try {
              subscriber.next(JSON.parse(message.data) as MercureGameEvent);
            } catch (error) {
              subscriber.error(error);
            }
          };

          source.onerror = () => {
            // Snapshot polling in the gameplay store is the fallback. Keep the stream open.
          };
        })
        .catch((error) => subscriber.error(error));

      return () => {
        closed = true;
        source?.close();
      };
    });
  }

  tableAssistantEvents<TEvent>(roomId: string): Observable<TEvent> {
    return new Observable<TEvent>((subscriber) => {
      let source: EventSource | null = null;
      let closed = false;
      const url = `${MERCURE_URL}?topic=${encodeURIComponent(`table-assistant/rooms/${roomId}`)}`;
      this.authorizeMercure()
        .then(() => {
          if (closed) {
            return;
          }
          source = new EventSource(url, { withCredentials: true });

          source.onmessage = (message) => {
            try {
              subscriber.next(JSON.parse(message.data) as TEvent);
            } catch (error) {
              subscriber.error(error);
            }
          };

          source.onerror = () => {
            subscriber.error(new Error('Mercure connection failed.'));
          };
        })
        .catch((error) => subscriber.error(error));

      return () => {
        closed = true;
        source?.close();
      };
    });
  }

  roomInviteEvents<TEvent = { type: string; inviteId?: string; status?: string; roomId?: string }>(userId: string): Observable<TEvent> {
    return new Observable<TEvent>((subscriber) => {
      let source: EventSource | null = null;
      let closed = false;
      const url = `${MERCURE_URL}?topic=${encodeURIComponent(`rooms/invites/users/${userId}`)}`;
      this.authorizeMercure()
        .then(() => {
          if (closed) {
            return;
          }
          source = new EventSource(url, { withCredentials: true });

          source.onmessage = (message) => {
            try {
              subscriber.next(JSON.parse(message.data) as TEvent);
            } catch (error) {
              subscriber.error(error);
            }
          };

          source.onerror = () => {
            subscriber.error(new Error('Mercure room invite connection failed.'));
          };
        })
        .catch((error) => subscriber.error(error));

      return () => {
        closed = true;
        source?.close();
      };
    });
  }

  private async authorizeMercure(): Promise<void> {
    await firstValueFrom(this.http.post<void>(`${API_BASE_URL}/realtime/mercure-cookie`, {}));
  }
}
