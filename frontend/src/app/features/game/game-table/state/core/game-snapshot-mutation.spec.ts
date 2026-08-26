import { describe, expect, it } from 'vitest';
import { GameCardInstance, GamePlayerState, GameSnapshot } from '../../../../../core/models/game.model';
import { updateGameSnapshotCards, updateGameSnapshotPlayer } from './game-snapshot-mutation';

describe('game snapshot mutation', () => {
  it('retains every untouched player, zone and card reference for a scalar card update', () => {
    const snapshot = gameSnapshot();
    const next = updateGameSnapshotCards(snapshot, [{
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      update: (card) => ({ ...card, tapped: true }),
    }]);

    expect(next).not.toBe(snapshot);
    expect(next.players['player-1']).not.toBe(snapshot.players['player-1']);
    expect(next.players['player-2']).toBe(snapshot.players['player-2']);
    expect(next.players['player-1'].zones.battlefield).not.toBe(snapshot.players['player-1'].zones.battlefield);
    expect(next.players['player-1'].zones.hand).toBe(snapshot.players['player-1'].zones.hand);
    expect(next.players['player-1'].zones.battlefield[0]).not.toBe(snapshot.players['player-1'].zones.battlefield[0]);
    expect(next.players['player-1'].zones.battlefield[1]).toBe(snapshot.players['player-1'].zones.battlefield[1]);
  });

  it('copies a shared player branch only once for a multi-card update', () => {
    const snapshot = gameSnapshot();
    const next = updateGameSnapshotCards(snapshot, [
      {
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'card-1',
        update: (card) => ({ ...card, tapped: true }),
      },
      {
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'card-2',
        update: (card) => ({ ...card, tapped: true }),
      },
    ]);

    expect(next.players['player-1'].zones.battlefield).toHaveLength(2);
    expect(next.players['player-1'].zones.battlefield.map((card) => card.tapped)).toEqual([true, true]);
    expect(next.players['player-2']).toBe(snapshot.players['player-2']);
  });

  it('does not publish a new snapshot when an update is semantically unchanged', () => {
    const snapshot = gameSnapshot();
    const nextPlayer = updateGameSnapshotPlayer(snapshot, 'player-1', (player) => player);
    const nextCard = updateGameSnapshotCards(snapshot, [{
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      update: (card) => card,
    }]);

    expect(nextPlayer).toBe(snapshot);
    expect(nextCard).toBe(snapshot);
  });
});

function gameSnapshot(): GameSnapshot {
  return {
    version: 1,
    players: {
      'player-1': player('player-1', [card('card-1'), card('card-2')]),
      'player-2': player('player-2', [card('card-3')]),
    },
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: [],
    attachments: [],
    specialEntities: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-08-26T00:00:00.000Z',
  };
}

function player(id: string, battlefield: GameCardInstance[]): GamePlayerState {
  return {
    user: { id, email: `${id}@example.test`, displayName: id, roles: [] },
    life: 40,
    zones: {
      library: [],
      hand: [card(`${id}-hand`)],
      battlefield,
      graveyard: [],
      exile: [],
      command: [],
    },
    commanderDamage: {},
    counters: {},
  };
}

function card(instanceId: string): GameCardInstance {
  return { instanceId, name: instanceId, tapped: false };
}
