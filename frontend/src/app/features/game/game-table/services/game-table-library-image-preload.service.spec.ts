import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameCardInstance, GamePlayerState, GameSnapshot } from '../../../../core/models/game.model';
import {
  ImagePreloadQueueService,
  type ImagePreloadQueuePriority,
  type ImagePreloadRequest,
} from '../../../../shared/services/image-preload-queue.service';
import { PlayerView, GameTableSnapshotSelectors } from '../state/core/game-table-snapshot-selectors';
import { GameTablePlayersStore } from '../state/players/game-table-players.store';
import { GameTableLibraryImagePreloadService } from './game-table-library-image-preload.service';

const LIBRARY_PRELOAD_STORAGE_KEY = 'cz_perf_library_preload';

describe('GameTableLibraryImagePreloadService', () => {
  const currentPlayer = signal<PlayerView | null>({ id: 'viewer' } as PlayerView);
  const requests: Array<{
    readonly url: string | null;
    readonly priority: ImagePreloadQueuePriority;
    readonly request: ImagePreloadRequest;
  }> = [];
  const request = vi.fn((url: string | null, priority: ImagePreloadQueuePriority): ImagePreloadRequest => {
    const scheduledRequest: ImagePreloadRequest = {
      completed: new Promise<boolean>(() => undefined),
      cancel: vi.fn(),
    };
    requests.push({ url, priority, request: scheduledRequest });

    return scheduledRequest;
  });
  const publicCardImage = vi.fn((card: GameCardInstance) => card.imageUris?.['normal'] ?? null);

  beforeEach(() => {
    window.localStorage.removeItem(LIBRARY_PRELOAD_STORAGE_KEY);
    currentPlayer.set({ id: 'viewer' } as PlayerView);
    requests.length = 0;
    request.mockClear();
    publicCardImage.mockClear();
    TestBed.configureTestingModule({
      providers: [
        GameTableLibraryImagePreloadService,
        {
          provide: ImagePreloadQueueService,
          useValue: { request } satisfies Pick<ImagePreloadQueueService, 'request'>,
        },
        {
          provide: GameTablePlayersStore,
          useValue: { currentPlayer } satisfies Pick<GameTablePlayersStore, 'currentPlayer'>,
        },
        {
          provide: GameTableSnapshotSelectors,
          useValue: { publicCardImage } satisfies Pick<GameTableSnapshotSelectors, 'publicCardImage'>,
        },
      ],
    });
  });

  afterEach(() => {
    window.localStorage.removeItem(LIBRARY_PRELOAD_STORAGE_KEY);
  });

  it('does nothing unless the library preload experiment is enabled', () => {
    const service = TestBed.inject(GameTableLibraryImagePreloadService);

    service.sync(snapshot({
      opponent: player('opponent', cards(3), { revealedLibraryTo: ['viewer'] }),
    }));

    expect(request).not.toHaveBeenCalled();
  });

  it('prioritizes an authorized revealed library as visible, overscan, then background work', () => {
    const service = enabledService();

    service.sync(snapshot({
      opponent: player('opponent', cards(20), { revealedLibraryTo: ['viewer'] }),
    }));

    expect(request).toHaveBeenCalledTimes(20);
    expect(request.mock.calls.slice(0, 3).every(([, priority]) => priority === 'interaction')).toBe(true);
    expect(request.mock.calls.slice(3, 9).every(([, priority]) => priority === 'visible')).toBe(true);
    expect(request.mock.calls.slice(9).every(([, priority]) => priority === 'background')).toBe(true);
  });

  it('preloads known own-library identities in a neutral background order without using its secret order', () => {
    const service = enabledService();
    const ownLibrary = [
      card('third', '/images/z.jpg'),
      card('first', '/images/a.jpg'),
      card('second', '/images/m.jpg'),
    ];

    service.sync(snapshot({
      viewer: player('viewer', ownLibrary, { libraryShuffleRevision: 1 }),
    }));

    expect(request.mock.calls).toEqual([
      ['/images/a.jpg', 'background'],
      ['/images/m.jpg', 'background'],
      ['/images/z.jpg', 'background'],
    ]);

    service.sync(snapshot({
      viewer: player('viewer', [...ownLibrary].reverse(), { libraryShuffleRevision: 2 }),
    }));

    expect(request).toHaveBeenCalledTimes(3);
    expect(requests.every(({ request: scheduledRequest }) => !vi.mocked(scheduledRequest.cancel).mock.calls.length)).toBe(true);
  });

  it('does not request opponent card identities until they are explicitly revealed to this viewer', () => {
    const service = enabledService();

    service.sync(snapshot({
      opponent: player('opponent', [
        card('unknown', '/images/unknown.jpg'),
        { ...card('hidden', '/images/hidden.jpg'), hidden: true, revealedTo: ['viewer'] },
      ]),
    }));

    expect(request).not.toHaveBeenCalled();
  });

  it('preloads individually revealed opponent cards only as neutral background work', () => {
    const service = enabledService();

    service.sync(snapshot({
      opponent: player('opponent', [
        { ...card('z-card', '/images/z.jpg'), revealedTo: ['viewer'] },
        { ...card('a-card', '/images/a.jpg'), revealedTo: ['viewer'] },
      ]),
    }));

    expect(request.mock.calls).toEqual([
      ['/images/a.jpg', 'background'],
      ['/images/z.jpg', 'background'],
    ]);
  });

  it('cancels pending work and advances to a new plan when an authorized library order changes', () => {
    const service = enabledService();
    const firstCards = [card('first', '/images/a.jpg'), card('second', '/images/b.jpg')];

    service.sync(snapshot({
      opponent: player('opponent', firstCards, { revealedLibraryTo: ['viewer'], libraryShuffleRevision: 1 }),
    }));
    const firstRequests = [...requests];

    service.sync(snapshot({
      opponent: player('opponent', [...firstCards].reverse(), { revealedLibraryTo: ['viewer'], libraryShuffleRevision: 2 }),
    }));

    expect(firstRequests.every(({ request: scheduledRequest }) =>
      vi.mocked(scheduledRequest.cancel).mock.calls.length === 1,
    )).toBe(true);
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls.slice(2)).toEqual([
      ['/images/b.jpg', 'interaction'],
      ['/images/a.jpg', 'interaction'],
    ]);
  });

  function enabledService(): GameTableLibraryImagePreloadService {
    window.localStorage.setItem(LIBRARY_PRELOAD_STORAGE_KEY, '1');

    return TestBed.inject(GameTableLibraryImagePreloadService);
  }
});

function snapshot(players: Record<string, GamePlayerState>): GameSnapshot {
  return {
    version: 1,
    players,
    turn: { activePlayerId: null, phase: 'main-1', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-10-01T00:00:00+00:00',
  };
}

function player(
  id: string,
  library: GameCardInstance[],
  options: Pick<GamePlayerState, 'revealedLibraryTo' | 'libraryShuffleRevision'> = {},
): GamePlayerState {
  return {
    user: { id, email: `${id}@example.test`, displayName: id, roles: [] },
    life: 40,
    zones: {
      library,
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      command: [],
    },
    commanderDamage: {},
    counters: {},
    ...options,
  };
}

function cards(count: number): GameCardInstance[] {
  return Array.from({ length: count }, (_unused, index) => card(`card-${index + 1}`, `/images/${index + 1}.jpg`));
}

function card(instanceId: string, imageUrl: string): GameCardInstance {
  return {
    instanceId,
    name: instanceId,
    tapped: false,
    imageUris: { normal: imageUrl },
  };
}
