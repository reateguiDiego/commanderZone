import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { GameCardInstance, GameSnapshot } from '../../../core/models/game.model';
import { GameTableStore } from './game-table.store';

describe('GameTableStore.load', () => {
  it('loads the session with the session context', async () => {
    const storeLike = {
      selection: { clearSelection: vi.fn() },
      session: {
        load: vi.fn(async () => undefined),
      },
      contexts: {
        session: vi.fn(() => ({ gameId: () => 'game-1', refreshViewerControlAccess: vi.fn() })),
      },
    };

    await GameTableStore.prototype.load.call(storeLike as never);

    expect(storeLike.contexts.session).toHaveBeenCalledTimes(1);
    expect(storeLike.selection.clearSelection).toHaveBeenCalledOnce();
    expect(storeLike.session.load).toHaveBeenCalledWith(storeLike.contexts.session.mock.results[0]?.value);
  });
});

describe('GameTableStore selection connection cleanup', () => {
  it('clears selection once when a previously live runtime connection is interrupted', () => {
    const storeLike = {
      selectionObservedLiveConnection: false,
      selection: { clearSelection: vi.fn() },
    };
    const reconcile = GameTableStore.prototype['reconcileSelectionConnectionStatus'];

    reconcile.call(storeLike as never, 'connecting');
    reconcile.call(storeLike as never, 'live');
    reconcile.call(storeLike as never, 'connecting');
    reconcile.call(storeLike as never, 'degraded');

    expect(storeLike.selection.clearSelection).toHaveBeenCalledOnce();
    expect(storeLike.selectionObservedLiveConnection).toBe(false);
  });

  it('arms cleanup again after a successful reconnect', () => {
    const storeLike = {
      selectionObservedLiveConnection: false,
      selection: { clearSelection: vi.fn() },
    };
    const reconcile = GameTableStore.prototype['reconcileSelectionConnectionStatus'];

    reconcile.call(storeLike as never, 'live');
    reconcile.call(storeLike as never, 'connecting');
    reconcile.call(storeLike as never, 'live');
    reconcile.call(storeLike as never, 'degraded');

    expect(storeLike.selection.clearSelection).toHaveBeenCalledTimes(2);
  });
});

describe('GameTableStore snapshot UI consistency', () => {
  it('clears selected cards that no longer exist in their selected zone after a snapshot update', () => {
    const card = gameCard('card-1');
    const selectedCards = signal([{ playerId: 'player-1', zone: 'hand' as const, card }]);
    const storeLike = {
      mulliganState: { syncSnapshot: vi.fn() },
      locallyConcededPlayerId: null,
      lastSeenActiveTurnPlayerId: null,
      manaPoolState: { resetAll: vi.fn() },
      snapshotCoordinatorState: { setSnapshot: vi.fn() },
      zoneModalState: { reconcileLibraryView: vi.fn() },
      openRevealedLibraryFromSnapshot: vi.fn(),
      selectedCards,
      currentPlayer: vi.fn(() => ({ id: 'player-1' })),
      selection: { reconcileSelectedCards: vi.fn((cards) => selectedCards.set(cards)) },
      uiState: { activeHoveredSelection: vi.fn(() => null) },
      contextMenu: signal(null),
      clearCardPreview: vi.fn(),
      closeContextMenu: vi.fn(),
      reconcileSelectedStackGroups: vi.fn(),
      pruneTransientCardUiState: GameTableStore.prototype['pruneTransientCardUiState'],
    };

    GameTableStore.prototype['setSnapshot'].call(
      storeLike as never,
      snapshotWithZones({ hand: [], battlefield: [card] }),
    );

    expect(selectedCards()).toEqual([]);
    expect(storeLike.clearCardPreview).not.toHaveBeenCalled();
    expect(storeLike.closeContextMenu).not.toHaveBeenCalled();
    expect(storeLike.reconcileSelectedStackGroups).toHaveBeenCalledOnce();
  });
});

function gameCard(instanceId: string): GameCardInstance {
  return {
    instanceId,
    ownerId: 'player-1',
    controllerId: 'player-1',
    name: 'Sol Ring',
    tapped: false,
  };
}

function snapshotWithZones(zones: {
  readonly hand: readonly GameCardInstance[];
  readonly battlefield: readonly GameCardInstance[];
}): GameSnapshot {
  return {
    version: 1,
    ownerId: 'player-1',
    gamePhase: 'PLAYING',
    players: {
      'player-1': {
        user: { id: 'player-1', email: 'player@test', displayName: 'Player', roles: [] },
        status: 'active',
        life: 40,
        zones: {
          library: [],
          hand: [...zones.hand],
          battlefield: [...zones.battlefield],
          graveyard: [],
          exile: [],
          command: [],
        },
        commanderDamage: {},
        counters: {},
      },
    },
    turn: { activePlayerId: 'player-1', phase: 'main', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-01-01T00:00:00+00:00',
  };
}
