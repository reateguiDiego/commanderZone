import { describe, expect, it } from 'vitest';
import { GameCardInstance, GameSnapshot } from '../../../../core/models/game.model';
import { pruneTransientCardUiState } from './transient-card-ui';

describe('pruneTransientCardUiState', () => {
  it('keeps selected cards that still exist in the same zone', () => {
    const card = gameCard('card-1');
    const snapshot = snapshotWithZones({ hand: [card], battlefield: [] });

    const result = pruneTransientCardUiState(snapshot, {
      selectedCards: [{ playerId: 'player-1', zone: 'hand', card }],
      hoveredSelection: null,
      contextMenu: null,
    });

    expect(result.selectedCards).toEqual([{ playerId: 'player-1', zone: 'hand', card }]);
    expect(result.clearCardPreview).toBe(false);
    expect(result.closeContextMenu).toBe(false);
  });

  it('removes selected cards when a patch moves them out of the selected zone', () => {
    const card = gameCard('card-1');
    const snapshot = snapshotWithZones({ hand: [], battlefield: [card] });

    const result = pruneTransientCardUiState(snapshot, {
      selectedCards: [{ playerId: 'player-1', zone: 'hand', card }],
      hoveredSelection: null,
      contextMenu: null,
    });

    expect(result.selectedCards).toEqual([]);
  });

  it('clears card preview when the hovered card leaves its source zone', () => {
    const card = gameCard('card-1');
    const snapshot = snapshotWithZones({ hand: [], battlefield: [card] });

    const result = pruneTransientCardUiState(snapshot, {
      selectedCards: [],
      hoveredSelection: { playerId: 'player-1', zone: 'hand', card },
      contextMenu: null,
    });

    expect(result.clearCardPreview).toBe(true);
  });

  it('closes a card context menu when the menu card leaves its source zone', () => {
    const card = gameCard('card-1');
    const snapshot = snapshotWithZones({ hand: [], battlefield: [card] });

    const result = pruneTransientCardUiState(snapshot, {
      selectedCards: [],
      hoveredSelection: null,
      contextMenu: { playerId: 'player-1', zone: 'hand', card },
    });

    expect(result.closeContextMenu).toBe(true);
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
