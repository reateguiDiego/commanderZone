import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { GameChatHistoryPageResponse } from '../../../../core/models/api-responses.model';
import { ChatMessage, GameSnapshot } from '../../../../core/models/game.model';
import { GameTableCoreState } from '../state/core/game-table-core.state';
import { GameTableNormalizedV2Store } from '../state/realtime/game-table-normalized-v2.store';
import { GameTableChatHistoryService } from './game-table-chat-history.service';

describe('GameTableChatHistoryService', () => {
  let service: GameTableChatHistoryService;
  let olderResponse: Subject<GameChatHistoryPageResponse>;
  let newerResponse: Subject<GameChatHistoryPageResponse>;
  const initialSnapshot = snapshot(650, 699);
  const core = {
    gameId: signal('game-1'),
    snapshot: signal<GameSnapshot | null>(initialSnapshot),
  };
  const gamesApi = { chatHistoryPage: vi.fn(), chatForwardPage: vi.fn() };
  const normalizedV2Store = { prependChatMessages: vi.fn(), appendChatMessages: vi.fn() };

  beforeEach(() => {
    olderResponse = new Subject<GameChatHistoryPageResponse>();
    newerResponse = new Subject<GameChatHistoryPageResponse>();
    core.snapshot.set(initialSnapshot);
    gamesApi.chatHistoryPage.mockReset().mockReturnValue(olderResponse.asObservable());
    gamesApi.chatForwardPage.mockReset().mockReturnValue(newerResponse.asObservable());
    normalizedV2Store.prependChatMessages.mockReset().mockReturnValue(snapshot(400, 649));
    normalizedV2Store.appendChatMessages.mockReset().mockReturnValue(snapshot(450, 699));
    TestBed.configureTestingModule({
      providers: [
        GameTableChatHistoryService,
        { provide: GamesApi, useValue: gamesApi },
        { provide: GameTableCoreState, useValue: core },
        { provide: GameTableNormalizedV2Store, useValue: normalizedV2Store },
      ],
    });
    service = TestBed.inject(GameTableChatHistoryService);
    service.reset(initialSnapshot);
  });

  it('loads one visible older page at a time and retains at most 250 messages', async () => {
    const first = service.loadOlder();
    const duplicate = service.loadOlder();

    expect(gamesApi.chatHistoryPage).toHaveBeenCalledOnce();
    expect(gamesApi.chatHistoryPage).toHaveBeenCalledWith('game-1', 'chat-650', 50);

    olderResponse.next({ data: messages(600, 649), limit: 50, hasMore: true, nextBefore: 'chat-600' });
    olderResponse.complete();
    await Promise.all([first, duplicate]);

    expect(normalizedV2Store.prependChatMessages).toHaveBeenCalledWith(messages(600, 649), 250);
    expect(service.canLoadOlder()).toBe(true);
    expect(service.canLoadNewer()).toBe(true);
  });

  it('loads newer messages after the active window discarded them', async () => {
    const olderRequest = service.loadOlder();
    olderResponse.next({ data: messages(600, 649), limit: 50, hasMore: true, nextBefore: 'chat-600' });
    olderResponse.complete();
    await olderRequest;

    const newerRequest = service.loadNewer();
    expect(gamesApi.chatForwardPage).toHaveBeenCalledWith('game-1', 'chat-649', 50);
    newerResponse.next({ data: messages(650, 699), limit: 50, hasMore: false, nextAfter: 'chat-699' });
    newerResponse.complete();
    await newerRequest;

    expect(normalizedV2Store.appendChatMessages).toHaveBeenCalledWith(messages(650, 699), 250);
    expect(service.canLoadNewer()).toBe(false);
  });
});

function snapshot(first: number, last: number): GameSnapshot {
  return { chat: messages(first, last) } as GameSnapshot;
}

function messages(first: number, last: number): ChatMessage[] {
  return Array.from({ length: last - first + 1 }, (_, offset) => {
    const index = first + offset;
    return {
      id: `chat-${index}`,
      userId: 'user-1',
      displayName: 'Player',
      message: `Message ${index}`,
      createdAt: new Date(Date.UTC(2026, 7, 19, 0, 0, index)).toISOString(),
    };
  });
}
