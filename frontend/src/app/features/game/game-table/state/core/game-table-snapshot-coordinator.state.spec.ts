import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameSnapshot } from '../../../../../core/models/game.model';
import { GameTableDebouncedValueCommandsService } from '../../services/game-table-debounced-value-commands.service';
import { GameTableBattlefieldState } from '../battlefield/game-table-battlefield.state';
import { GameTableCardsState } from '../cards/game-table-cards.state';
import { GameTableDropFeedbackState } from '../drag-drop/game-table-drop-feedback.state';
import { GameTablePendingTransferState } from './game-table-pending-transfer.state';
import { GameTableCoreState } from './game-table-core.state';
import { GameTableSnapshotCoordinatorState } from './game-table-snapshot-coordinator.state';

describe('GameTableSnapshotCoordinatorState', () => {
  let state: GameTableSnapshotCoordinatorState;
  const snapshotSignal = signal<GameSnapshot | null>(null);
  const trackSnapshot = vi.fn();
  const reconcileSnapshot = vi.fn();
  const openRevealedLibraryFromSnapshot = vi.fn();

  beforeEach(() => {
    snapshotSignal.set(null);
    trackSnapshot.mockClear();
    reconcileSnapshot.mockClear();
    openRevealedLibraryFromSnapshot.mockClear();

    TestBed.configureTestingModule({
      providers: [
        GameTableSnapshotCoordinatorState,
        {
          provide: GameTableCoreState,
          useValue: { snapshot: snapshotSignal } satisfies Pick<GameTableCoreState, 'snapshot'>,
        },
        {
          provide: GameTableBattlefieldState,
          useValue: {
            applyViewportClampedBattlefieldPositions: vi.fn((snapshot: GameSnapshot | null) => snapshotWithVersion(snapshot, 2)),
            applyOptimisticBattlefieldPositions: vi.fn((snapshot: GameSnapshot | null) => snapshotWithVersion(snapshot, 3)),
          } satisfies Pick<GameTableBattlefieldState, 'applyViewportClampedBattlefieldPositions' | 'applyOptimisticBattlefieldPositions'>,
        },
        {
          provide: GameTableDebouncedValueCommandsService,
          useValue: {
            applyOptimisticValues: vi.fn((snapshot: GameSnapshot | null) => snapshotWithVersion(snapshot, 4)),
          } satisfies Pick<GameTableDebouncedValueCommandsService, 'applyOptimisticValues'>,
        },
        {
          provide: GameTableCardsState,
          useValue: {
            applyOptimisticCardCounters: vi.fn((snapshot: GameSnapshot | null) => snapshotWithVersion(snapshot, 5)),
          } satisfies Pick<GameTableCardsState, 'applyOptimisticCardCounters'>,
        },
        {
          provide: GameTableDropFeedbackState,
          useValue: { trackSnapshot } satisfies Pick<GameTableDropFeedbackState, 'trackSnapshot'>,
        },
        {
          provide: GameTablePendingTransferState,
          useValue: { reconcileSnapshot } satisfies Pick<GameTablePendingTransferState, 'reconcileSnapshot'>,
        },
      ],
    });

    state = TestBed.inject(GameTableSnapshotCoordinatorState);
  });

  it('applies snapshot overlays before publishing and reconciling dependants', () => {
    state.setSnapshot({ openRevealedLibraryFromSnapshot }, snapshot(1));

    expect(snapshotSignal()?.version).toBe(5);
    expect(trackSnapshot).toHaveBeenCalledWith(snapshotSignal());
    expect(reconcileSnapshot).toHaveBeenCalledWith(snapshotSignal());
    expect(openRevealedLibraryFromSnapshot).toHaveBeenCalledWith(snapshotSignal());
  });
});

function snapshotWithVersion(snapshot: GameSnapshot | null, version: number): GameSnapshot | null {
  return snapshot ? { ...snapshot, version } : null;
}

function snapshot(version: number): GameSnapshot {
  return {
    version,
    ownerId: 'player-1',
    players: {},
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-05-19T00:00:00+00:00',
  };
}
