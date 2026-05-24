import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { API_BASE_URL, MERCURE_URL } from '../api/api.config';
import { FriendRealtimeEvent } from '../models/friendship.model';
import { MercureGameEvent } from '../models/game.model';
import { WaitingRoomEvent } from '../models/room.model';

@Injectable({ providedIn: 'root' })
export class MercureService {
  constructor(private readonly http: HttpClient) {}

  gameEvents(gameId: string): Observable<MercureGameEvent> {
    return new Observable<MercureGameEvent>((subscriber) => {
      let source: EventSource | null = null;
      let closed = false;
      const url = `${MERCURE_URL}?topic=${encodeURIComponent(`games/${gameId}`)}`;
      this.prepareMercureConnection()
        .then((withCredentials) => {
          if (closed) {
            return;
          }
          source = withCredentials ? new EventSource(url, { withCredentials: true }) : new EventSource(url);

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
      this.prepareMercureConnection()
        .then((withCredentials) => {
          if (closed) {
            return;
          }
          source = withCredentials ? new EventSource(url, { withCredentials: true }) : new EventSource(url);

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
      this.prepareMercureConnection()
        .then((withCredentials) => {
          if (closed) {
            return;
          }
          source = withCredentials ? new EventSource(url, { withCredentials: true }) : new EventSource(url);

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

  waitingRoomEvents(roomId: string): Observable<WaitingRoomEvent> {
    return new Observable<WaitingRoomEvent>((subscriber) => {
      let source: EventSource | null = null;
      let closed = false;
      const url = `${MERCURE_URL}?topic=${encodeURIComponent(`rooms/${roomId}/waiting`)}`;
      this.prepareMercureConnection()
        .then((withCredentials) => {
          if (closed) {
            return;
          }
          source = withCredentials ? new EventSource(url, { withCredentials: true }) : new EventSource(url);

          source.onmessage = (message) => {
            try {
              subscriber.next(JSON.parse(message.data) as WaitingRoomEvent);
            } catch (error) {
              subscriber.error(error);
            }
          };

          source.onerror = () => {
            // Polling in the waiting room remains the fallback. Keep the stream open.
          };
        })
        .catch((error) => subscriber.error(error));

      return () => {
        closed = true;
        source?.close();
      };
    });
  }

  friendEvents(userId: string): Observable<FriendRealtimeEvent> {
    return new Observable<FriendRealtimeEvent>((subscriber) => {
      let source: EventSource | null = null;
      let closed = false;
      const url = `${MERCURE_URL}?topic=${encodeURIComponent(`friends/users/${userId}`)}`;
      this.prepareMercureConnection()
        .then((withCredentials) => {
          if (closed) {
            return;
          }
          source = withCredentials ? new EventSource(url, { withCredentials: true }) : new EventSource(url);

          source.onmessage = (message) => {
            try {
              subscriber.next(JSON.parse(message.data) as FriendRealtimeEvent);
            } catch (error) {
              subscriber.error(error);
            }
          };

          source.onerror = () => {
            // The friends store keeps its current state; user actions still reload as fallback.
          };
        })
        .catch((error) => subscriber.error(error));

      return () => {
        closed = true;
        source?.close();
      };
    });
  }

  private async prepareMercureConnection(): Promise<boolean> {
    if (!this.shouldUseCredentials()) {
      return false;
    }

    try {
      await firstValueFrom(this.http.post<void>(`${API_BASE_URL}/realtime/mercure-cookie`, {}));

      return true;
    } catch (error) {
      if (this.canUseAnonymousFallback()) {
        return false;
      }

      throw error;
    }
  }

  private shouldUseCredentials(): boolean {
    const apiHost = this.hostnameFromUrl(API_BASE_URL);
    const mercureHost = this.hostnameFromUrl(MERCURE_URL);
    if (!apiHost || !mercureHost) {
      return true;
    }

    // Local loopback mixed hosts (localhost vs 127.0.0.1) cannot share Mercure cookies.
    if (this.isLoopbackHost(apiHost) && this.isLoopbackHost(mercureHost) && apiHost !== mercureHost) {
      return false;
    }

    return true;
  }

  private canUseAnonymousFallback(): boolean {
    const apiHost = this.hostnameFromUrl(API_BASE_URL);
    const mercureHost = this.hostnameFromUrl(MERCURE_URL);

    return apiHost !== null
      && mercureHost !== null
      && this.isLoopbackHost(apiHost)
      && this.isLoopbackHost(mercureHost);
  }

  private hostnameFromUrl(url: string): string | null {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  private isLoopbackHost(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1';
  }
}
