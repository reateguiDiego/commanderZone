import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { GameCardInstance, GameSnapshot } from '../../../core/models/game.model';
import { GameTableStore } from './game-table.store';

describe('GameTableStore.load', () => {
  it('loads the session with the session context', async () => {
    const storeLike = {
      session: {
        load: vi.fn(async () => undefined),
      },
      contexts: {
        session: vi.fn(() => ({ gameId: () => 'game-1', refreshViewerControlAccess: vi.fn() })),
      },
    };

    await GameTableStore.prototype.load.call(storeLike as never);

    expect(storeLike.contexts.session).toHaveBeenCalledTimes(1);
    expect(storeLike.session.load).toHaveBeenCalledWith(storeLike.contexts.session.mock.results[0]?.value);
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
      openRevealedLibraryFromSnapshot: vi.fn(),
      selectedCards,
      uiState: { activeHoveredSelection: vi.fn(() => null) },
      contextMenu: signal(null),
      clearCardPreview: vi.fn(),
      closeContextMenu: vi.fn(),
      pruneTransientCardUiState: GameTableStore.prototype['pruneTransientCardUiState'],
    };

    GameTableStore.prototype['setSnapshot'].call(
      storeLike as never,
      snapshotWithZones({ hand: [], battlefield: [card] }),
    );

    expect(selectedCards()).toEqual([]);
    expect(storeLike.clearCardPreview).not.toHaveBeenCalled();
    expect(storeLike.closeContextMenu).not.toHaveBeenCalled();
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
