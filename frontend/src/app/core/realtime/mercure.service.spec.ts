import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, MERCURE_URL } from '../api/api.config';
import { MercureService } from './mercure.service';

class MockEventSource {
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
});
