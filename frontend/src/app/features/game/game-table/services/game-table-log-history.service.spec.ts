import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { GameLogHistoryPageResponse } from '../../../../core/models/api-responses.model';
import { GameLogEntry, GameSnapshot } from '../../../../core/models/game.model';
import { GameTableCoreState } from '../state/core/game-table-core.state';
import { GameTableNormalizedV2Store } from '../state/realtime/game-table-normalized-v2.store';
import { GameTableLogHistoryService } from './game-table-log-history.service';

describe('GameTableLogHistoryService', () => {
  let service: GameTableLogHistoryService;
  let historyResponse: Subject<GameLogHistoryPageResponse>;
  let forwardResponse: Subject<GameLogHistoryPageResponse>;
  const initialSnapshot = snapshot(650, 699);
  const mergedSnapshot = snapshot(600, 699);
  const core = {
    gameId: signal('game-1'),
    snapshot: signal<GameSnapshot | null>(initialSnapshot),
  };
  const gamesApi = {
    logHistoryPage: vi.fn(),
    logForwardPage: vi.fn(),
  };
  const normalizedV2Store = {
    prependLogEntries: vi.fn(),
    appendLogEntries: vi.fn(),
  };

  beforeEach(() => {
    historyResponse = new Subject<GameLogHistoryPageResponse>();
    forwardResponse = new Subject<GameLogHistoryPageResponse>();
    core.snapshot.set(initialSnapshot);
    gamesApi.logHistoryPage.mockReset().mockReturnValue(historyResponse.asObservable());
    gamesApi.logForwardPage.mockReset().mockReturnValue(forwardResponse.asObservable());
    normalizedV2Store.prependLogEntries.mockReset().mockReturnValue(mergedSnapshot);
    normalizedV2Store.appendLogEntries.mockReset().mockReturnValue(snapshot(50, 299));
    TestBed.configureTestingModule({
      providers: [
        GameTableLogHistoryService,
        { provide: GamesApi, useValue: gamesApi },
        { provide: GameTableCoreState, useValue: core },
        { provide: GameTableNormalizedV2Store, useValue: normalizedV2Store },
      ],
    });
    service = TestBed.inject(GameTableLogHistoryService);
    service.reset(initialSnapshot);
  });

  it('loads one older page at a time and keeps its loading state until the response completes', async () => {
    const firstRequest = service.loadOlder();
    const duplicateRequest = service.loadOlder();

    expect(gamesApi.logHistoryPage).toHaveBeenCalledOnce();
    expect(gamesApi.logHistoryPage).toHaveBeenCalledWith('game-1', 'log-650', 50);
    expect(service.loadingOlder()).toBe(true);

    historyResponse.next({
      data: entries(600, 649),
      limit: 50,
      hasMore: true,
      nextBefore: 'log-600',
    });
    historyResponse.complete();
    await Promise.all([firstRequest, duplicateRequest]);

    expect(normalizedV2Store.prependLogEntries).toHaveBeenCalledWith(entries(600, 649), 250);
    expect(core.snapshot()).toBe(mergedSnapshot);
    expect(service.loadingOlder()).toBe(false);
    expect(service.viewingOlderHistory()).toBe(true);
    expect(service.canLoadOlder()).toBe(true);
  });

  it('stops requesting history when the server reaches the oldest entry', async () => {
    const request = service.loadOlder();
    historyResponse.next({
      data: entries(600, 649),
      limit: 50,
      hasMore: false,
      nextBefore: null,
    });
    historyResponse.complete();
    await request;
    await service.loadOlder();

    expect(gamesApi.logHistoryPage).toHaveBeenCalledOnce();
    expect(service.canLoadOlder()).toBe(false);
  });

  it('loads newer pages after the active window has discarded recent entries', async () => {
    const trimmedSnapshot = snapshot(0, 249);
    normalizedV2Store.prependLogEntries.mockReturnValue(trimmedSnapshot);
    service.reset(snapshot(250, 299));
    core.snapshot.set(snapshot(250, 299));

    const olderRequest = service.loadOlder();
    historyResponse.next({
      data: entries(200, 249),
      limit: 50,
      hasMore: true,
      nextBefore: 'log-200',
    });
    historyResponse.complete();
    await olderRequest;

    expect(service.canLoadNewer()).toBe(true);
    const newerRequest = service.loadNewer();
    expect(gamesApi.logForwardPage).toHaveBeenCalledWith('game-1', 'log-249', 50);
    forwardResponse.next({
      data: entries(250, 299),
      limit: 50,
      hasMore: true,
      nextAfter: 'log-299',
    });
    forwardResponse.complete();
    await newerRequest;

    expect(normalizedV2Store.appendLogEntries).toHaveBeenCalledWith(entries(250, 299), 250);
    expect(service.canLoadNewer()).toBe(true);
  });
});

function snapshot(first: number, last: number): GameSnapshot {
  return { eventLog: entries(first, last) } as GameSnapshot;
}

function entries(first: number, last: number): GameLogEntry[] {
  return Array.from({ length: last - first + 1 }, (_, offset) => entry(first + offset));
}

function entry(index: number): GameLogEntry {
  return {
    id: `log-${index}`,
    type: 'performance.history.seed',
    message: `Performance history test entry ${index}`,
    createdAt: new Date(Date.UTC(2026, 7, 19, 0, 0, index)).toISOString(),
  };
}
