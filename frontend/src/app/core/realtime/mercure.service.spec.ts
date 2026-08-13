import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, MERCURE_URL } from '../api/api.config';
import { MercureService } from './mercure.service';

class MockEventSource {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly close = vi.fn();

  constructor(readonly url: string, readonly init?: EventSourceInit) {}
}

describe('MercureService', () => {
  let eventSources: MockEventSource[];

  beforeEach(() => {
    eventSources = [];
    const EventSourceMock = vi.fn(function eventSourceMock(url: string, init?: EventSourceInit) {
      const source = new MockEventSource(url, init);
      eventSources.push(source);

      return source;
    });
    vi.stubGlobal('EventSource', EventSourceMock as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('authorizes Mercure and subscribes with credentials before reading game events', async () => {
    const post = vi.fn().mockReturnValue(of(undefined));
    const service = new MercureService({ post } as unknown as HttpClient);
    const received: unknown[] = [];
    const subscription = service.gameEvents('game-1').subscribe((event) => {
      received.push(event);
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(post).toHaveBeenCalledWith(`${API_BASE_URL}/realtime/mercure-cookie`, {});
    expect(eventSources.length).toBe(1);
    expect(eventSources[0].url).toBe(`${MERCURE_URL}?topic=${encodeURIComponent('games/game-1')}`);
    expect(eventSources[0].init).toEqual({ withCredentials: true });

    eventSources[0].onmessage?.({ data: '{"gameId":"game-1"}' } as MessageEvent<string>);
    expect(received).toEqual([{ gameId: 'game-1' }]);

    subscription.unsubscribe();
    expect(eventSources[0].close).toHaveBeenCalled();
  });

  it('marks only an error-to-open transition as a game stream reconnect', async () => {
    const post = vi.fn().mockReturnValue(of(undefined));
    const service = new MercureService({ post } as unknown as HttpClient);
    const received: unknown[] = [];
    const subscription = service.gameEventStream('game-1').subscribe((event) => received.push(event));

    await Promise.resolve();
    await Promise.resolve();

    eventSources[0].onopen?.(new Event('open'));
    eventSources[0].onerror?.(new Event('error'));
    eventSources[0].onopen?.(new Event('open'));

    expect(received).toEqual([
      { kind: 'connected', reconnected: false },
      { kind: 'connected', reconnected: true },
    ]);
    subscription.unsubscribe();
  });

  it('subscribes to waiting room events with the room topic and reports reconnects without polling', async () => {
    const post = vi.fn().mockReturnValue(of(undefined));
    const service = new MercureService({ post } as unknown as HttpClient);
    const received: unknown[] = [];
    const subscription = service.waitingRoomEvents('room-1').subscribe((event) => {
      received.push(event);
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(post).toHaveBeenCalledWith(`${API_BASE_URL}/realtime/mercure-cookie`, {});
    expect(eventSources.length).toBe(1);
    expect(eventSources[0].url).toBe(`${MERCURE_URL}?topic=${encodeURIComponent('rooms/room-1/waiting')}`);
    expect(eventSources[0].init).toEqual({ withCredentials: true });

    eventSources[0].onopen?.(new Event('open'));
    eventSources[0].onerror?.(new Event('error'));
    eventSources[0].onopen?.(new Event('open'));
    eventSources[0].onmessage?.({ data: '{"type":"room.updated","roomId":"room-1"}' } as MessageEvent<string>);
    expect(received).toEqual([
      { kind: 'connected', reconnected: false },
      { kind: 'unavailable' },
      { kind: 'connected', reconnected: true },
      { kind: 'event', event: { type: 'room.updated', roomId: 'room-1' } },
    ]);

    subscription.unsubscribe();
    expect(eventSources[0].close).toHaveBeenCalled();
  });

  it('subscribes to friend events with the user topic', async () => {
    const post = vi.fn().mockReturnValue(of(undefined));
    const service = new MercureService({ post } as unknown as HttpClient);
    const received: unknown[] = [];
    const subscription = service.friendEvents('user-1').subscribe((event) => {
      received.push(event);
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(post).toHaveBeenCalledWith(`${API_BASE_URL}/realtime/mercure-cookie`, {});
    expect(eventSources.length).toBe(1);
    expect(eventSources[0].url).toBe(`${MERCURE_URL}?topic=${encodeURIComponent('friends/users/user-1')}`);
    expect(eventSources[0].init).toEqual({ withCredentials: true });

    eventSources[0].onmessage?.({
      data: '{"type":"friend.presence.changed","user":{"id":"friend-1","displayName":"Marta","presence":"online"}}',
    } as MessageEvent<string>);
    expect(received).toEqual([{ type: 'friend.presence.changed', user: { id: 'friend-1', displayName: 'Marta', presence: 'online' } }]);

    subscription.unsubscribe();
    expect(eventSources[0].close).toHaveBeenCalled();
  });
});
