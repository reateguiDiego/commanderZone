import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { MERCURE_URL } from '../api/api.config';
import { MercureGameEvent } from '../models/game.model';

@Injectable({ providedIn: 'root' })
export class MercureService {
  gameEvents(gameId: string): Observable<MercureGameEvent> {
    return new Observable<MercureGameEvent>((subscriber) => {
      const url = `${MERCURE_URL}?topic=${encodeURIComponent(`games/${gameId}`)}`;
      const source = new EventSource(url);

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

      return () => source.close();
    });
  }

  tableAssistantEvents<TEvent>(roomId: string): Observable<TEvent> {
    return new Observable<TEvent>((subscriber) => {
      const url = `${MERCURE_URL}?topic=${encodeURIComponent(`table-assistant/rooms/${roomId}`)}`;
      const source = new EventSource(url);

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

      return () => source.close();
    });
  }
}
