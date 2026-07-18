import { describe, expect, it } from 'vitest';
import { GameCardInstance, GameSnapshot } from '../../../../core/models/game.model';
import { pruneTransientCardUiState } from './transient-card-ui';

describe('pruneTransientCardUiState', () => {
  it('keeps selected cards that still exist in the same zone', () => {
    const card = gameCard('card-1');
    const snapshot = snapshotWithZones({ hand: [card], battlefield: [] });

    const result = pruneTransientCardUiState(snapshot, {
      selectedCards: [{ playerId: 'player-1', zone: 'hand', card }],
      currentPlayerId: 'player-1',
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
      currentPlayerId: 'player-1',
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
      currentPlayerId: 'player-1',
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
      currentPlayerId: 'player-1',
      hoveredSelection: null,
      contextMenu: { playerId: 'player-1', zone: 'hand', card },
    });

    expect(result.closeContextMenu).toBe(true);
  });

  it('prunes only cards that lose controller authority and preserves the remaining order', () => {
    const first = gameCard('card-1');
    const lost = gameCard('card-2', { controllerId: 'player-2' });
    const third = gameCard('card-3');
    const snapshot = snapshotWithZones({ hand: [], battlefield: [first, lost, third] });

    const result = pruneTransientCardUiState(snapshot, {
      selectedCards: [first, lost, third].map((card) => ({ playerId: 'player-1', zone: 'battlefield' as const, card })),
      currentPlayerId: 'player-1',
      hoveredSelection: null,
      contextMenu: null,
    });

    expect(result.selectedCards.map((selection) => selection.card.instanceId)).toEqual(['card-1', 'card-3']);
  });

  it('prunes collapsed stack members while retaining the root exactly once', () => {
    const root = gameCard('root');
    const member = gameCard('member');
    const snapshot = snapshotWithZones({ hand: [], battlefield: [root, member] });
    snapshot.battlefieldStacks = [{
      id: 'stack-1', relationType: 'battlefield_stack', rootInstanceId: 'root',
      orderedMemberIds: ['root', 'member'], stackKind: 'land', effectVersion: 1, createdAtVersion: 1,
    }];

    const result = pruneTransientCardUiState(snapshot, {
      selectedCards: [root, member, root].map((card) => ({ playerId: 'player-1', zone: 'battlefield' as const, card })),
      currentPlayerId: 'player-1',
      hoveredSelection: null,
      contextMenu: null,
    });

    expect(result.selectedCards.map((selection) => selection.card.instanceId)).toEqual(['root']);
  });

  it.each(['conceded', 'defeated'] as const)('clears all selection when the actor is %s', (status) => {
    const card = gameCard('card-1');
    const snapshot = snapshotWithZones({ hand: [], battlefield: [card] });
    snapshot.players['player-1']!.status = status;

    const result = pruneTransientCardUiState(snapshot, {
      selectedCards: [{ playerId: 'player-1', zone: 'battlefield', card }],
      currentPlayerId: 'player-1',
      hoveredSelection: null,
      contextMenu: null,
    });

    expect(result.selectedCards).toEqual([]);
  });

  it('clears all selection when the game finishes or hydration is absent', () => {
    const card = gameCard('card-1');
    const snapshot = snapshotWithZones({ hand: [], battlefield: [card] });
    snapshot.gamePhase = 'FINISHED';
    const state = {
      selectedCards: [{ playerId: 'player-1', zone: 'battlefield' as const, card }],
      currentPlayerId: 'player-1',
      hoveredSelection: null,
      contextMenu: null,
    };

    expect(pruneTransientCardUiState(snapshot, state).selectedCards).toEqual([]);
    expect(pruneTransientCardUiState(null, state).selectedCards).toEqual([]);
  });
});

function gameCard(instanceId: string, overrides: Partial<GameCardInstance> = {}): GameCardInstance {
  return {
    instanceId,
    ownerId: 'player-1',
    controllerId: 'player-1',
    name: 'Sol Ring',
    tapped: false,
    zone: 'battlefield',
    ...overrides,
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
