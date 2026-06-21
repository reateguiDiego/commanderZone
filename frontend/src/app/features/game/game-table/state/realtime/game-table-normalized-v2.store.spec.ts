import { describe, expect, it } from 'vitest';
import type { BootstrapV2, PatchEnvelopeV2 } from '../../../../../core/models/game-v2.model';
import {
  applyPatchEnvelopeV2,
  createGameTableNormalizedV2State,
  hydrateGameSnapshotFromV2State,
} from './game-table-normalized-v2.store';

describe('game table normalized v2 store', () => {
  it('applies bootstrap v2 into normalized state and hydrates a compatible snapshot', () => {
    const state = createGameTableNormalizedV2State(bootstrapV2());
    const snapshot = hydrateGameSnapshotFromV2State(state);

    expect(state.lastAppliedVersion).toBe(5);
    expect(state.zones['player-1'].battlefield).toEqual(['battlefield-1']);
    expect(state.staticCards['token:beast'].name).toBe('Beast');
    expect(snapshot.players['player-1'].zones.hand[0]?.name).toBe('Lightning Bolt');
    expect(snapshot.players['player-2'].zones.hand[0]?.scryfallId).toBeUndefined();
    expect(snapshot.players['player-2'].zones.hand[0]?.name).toBe('Card');
  });

  it('applies ordered patches and keeps version idempotent', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const first = applyPatchEnvelopeV2(initial, patch(6, [{ op: 'player.life.set', playerId: 'player-1', value: 37 }]));
    const second = applyPatchEnvelopeV2(first.state, patch(7, [{
      op: 'card.field.set',
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'battlefield-1',
      tapped: true,
    }]));
    const duplicate = applyPatchEnvelopeV2(second.state, patch(7, [{ op: 'player.life.set', playerId: 'player-1', value: 35 }]));

    expect(first.status).toBe('applied');
    expect(first.state.players['player-1'].life).toBe(37);
    expect(second.status).toBe('applied');
    expect(second.state.instances['battlefield-1'].tapped).toBe(true);
    expect(duplicate.status).toBe('ignored');
    expect(duplicate.state.players['player-1'].life).toBe(37);
  });

  it('requires resync on a version gap', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const result = applyPatchEnvelopeV2(initial, patch(8, [{ op: 'player.life.set', playerId: 'player-1', value: 37 }]));

    expect(result).toMatchObject({
      status: 'resync_required',
      reason: 'version_gap',
    });
  });

  it('preserves privacy for rival hidden hand cards after hydration', () => {
    const state = createGameTableNormalizedV2State(bootstrapV2());
    const snapshot = hydrateGameSnapshotFromV2State(state);
    const hiddenOpponentHand = snapshot.players['player-2'].zones.hand[0];

    expect(hiddenOpponentHand?.hidden).toBe(true);
    expect(hiddenOpponentHand?.name).toBe('Card');
    expect(hiddenOpponentHand?.imageUris).toBeUndefined();
    expect(hiddenOpponentHand?.cardFaces).toBeUndefined();
  });

  it('drops pending optimistic actions on ack', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2(), {
      'action-1': { createdAt: '2026-01-01T00:00:10.000Z' },
    });
    const result = applyPatchEnvelopeV2(initial, {
      ...patch(6, [{ op: 'player.life.set', playerId: 'player-1', value: 39 }]),
      ackClientActionId: 'action-1',
    });

    expect(result.status).toBe('applied');
    expect(result.state.pendingOptimisticActions['action-1']).toBeUndefined();
  });

  it('does not mutate unrelated structures when moving a card', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const originalPlayer2Hand = initial.zones['player-2'].hand;
    const originalStaticCards = initial.staticCards;
    const result = applyPatchEnvelopeV2(initial, patch(6, [{
      op: 'zone.cards.move',
      instanceId: 'hand-1',
      from: { playerId: 'player-1', zone: 'hand' },
      to: { playerId: 'player-1', zone: 'battlefield', index: 0 },
    }]));

    expect(result.status).toBe('applied');
    expect(result.state.zones['player-1'].battlefield[0]).toBe('hand-1');
    expect(result.state.zones['player-2'].hand).toBe(originalPlayer2Hand);
    expect(result.state.staticCards).toBe(originalStaticCards);
    expect(initial.zones['player-1'].hand).toEqual(['hand-1']);
  });

  it('reveals top library cards without rewriting the whole zone', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const result = applyPatchEnvelopeV2(initial, patch(6, [{
      op: 'library.top.revealed',
      playerId: 'player-1',
      cards: [{
        instanceId: 'library-1',
        ownerId: 'player-1',
        controllerId: 'player-1',
        scryfallId: 's-library-1',
        name: 'Forest',
        tapped: false,
        zone: 'library',
      }],
    }]));
    const snapshot = hydrateGameSnapshotFromV2State(result.state);

    expect(result.status).toBe('applied');
    expect(result.state.zones['player-1'].library).toEqual(['library-1', 'library-2']);
    expect(snapshot.players['player-1'].zones.library[0]?.name).toBe('Forest');
    expect(snapshot.players['player-1'].zones.library[1]?.name).toBe('Card');
  });

  it('applies semantic mulligan patches without full snapshot replacement', () => {
    const initial = createGameTableNormalizedV2State({
      ...bootstrapV2(),
      game: {
        ...bootstrapV2().game,
        gamePhase: 'MULLIGAN',
      },
    });
    const result = applyPatchEnvelopeV2(initial, patch(6, [
      {
        op: 'mulligan.private_state.set',
        playerId: 'player-1',
        state: {
          rule: 'LONDON',
          mulligansTaken: 1,
          effectiveMulligans: 0,
          drawCount: 7,
          bottomSelectionCount: 0,
          finalHandSize: 7,
          needsBottomSelection: false,
          bottomOrderMode: 'PLAYER_CHOSEN_ORDER',
          needsScryAfterKeep: false,
          canTakeAnotherMulligan: true,
          status: 'DECIDING',
          ready: false,
        },
        hand: [
          { instanceId: 'opening-a', cardKey: 'card:bolt' },
          { instanceId: 'opening-b', cardKey: 'card:bolt' },
        ],
      },
      { op: 'mulligan.hand.count.set', playerId: 'player-2', count: 7 },
    ]));
    const snapshot = hydrateGameSnapshotFromV2State(result.state);

    expect(result.status).toBe('applied');
    expect(result.state.zones['player-1'].hand).toEqual(['opening-a', 'opening-b']);
    expect(result.state.players['player-1'].mulligan?.mulligansTaken).toBe(1);
    expect(snapshot.players['player-1'].zones.hand.map((card) => card.instanceId)).toEqual(['opening-a', 'opening-b']);
    expect(snapshot.players['player-2'].handCount).toBe(7);
  });

  it('applies mulligan completion and phase patches by version', () => {
    const initial = createGameTableNormalizedV2State({
      ...bootstrapV2(),
      game: {
        ...bootstrapV2().game,
        gamePhase: 'MULLIGAN',
      },
    });
    const playing = applyPatchEnvelopeV2(initial, patch(6, [{ op: 'mulligan.completed' }]));
    const duplicate = applyPatchEnvelopeV2(playing.state, patch(6, [{ op: 'game.phase.set', phase: 'MULLIGAN' }]));

    expect(playing.status).toBe('applied');
    expect(playing.state.game.gamePhase).toBe('PLAYING');
    expect(duplicate.status).toBe('ignored');
    expect(duplicate.state.game.gamePhase).toBe('PLAYING');
  });
});

function patch(version: number, ops: PatchEnvelopeV2['ops']): PatchEnvelopeV2 {
  return {
    gameId: 'game-1',
    version,
    visibility: 'player:player-1',
    ops,
  };
}

function bootstrapV2(): BootstrapV2 {
  return {
    game: {
      id: 'game-1',
      status: 'active',
      version: 5,
      viewerId: 'player-1',
      ownerId: 'player-1',
      gamePhase: 'PLAYING',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:10.000Z',
    },
    players: {
      'player-1': {
        playerId: 'player-1',
        user: { id: 'player-1', email: 'player1@example.test', displayName: 'Player 1', roles: [] },
        displayName: 'Player 1',
        life: 40,
        status: 'active',
        handCount: 1,
        zoneIds: ['player-1:library', 'player-1:hand', 'player-1:battlefield', 'player-1:graveyard', 'player-1:exile', 'player-1:command'],
        zoneCounts: { library: 98, hand: 1, battlefield: 1, graveyard: 0, exile: 0, command: 1 },
        commanderDamage: {},
        counters: {},
        deckName: 'Owner Deck',
      },
      'player-2': {
        playerId: 'player-2',
        user: { id: 'player-2', email: 'player2@example.test', displayName: 'Player 2', roles: [] },
        displayName: 'Player 2',
        life: 40,
        status: 'active',
        handCount: 1,
        zoneIds: ['player-2:library', 'player-2:hand', 'player-2:battlefield', 'player-2:graveyard', 'player-2:exile', 'player-2:command'],
        zoneCounts: { library: 98, hand: 1, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
        commanderDamage: {},
        counters: {},
        deckName: 'Opponent Deck',
      },
    },
    zones: {
      'player-1:library': { zoneId: 'player-1:library', playerId: 'player-1', name: 'library', instanceIds: ['library-1', 'library-2'] },
      'player-1:hand': { zoneId: 'player-1:hand', playerId: 'player-1', name: 'hand', instanceIds: ['hand-1'] },
      'player-1:battlefield': { zoneId: 'player-1:battlefield', playerId: 'player-1', name: 'battlefield', instanceIds: ['battlefield-1'] },
      'player-1:graveyard': { zoneId: 'player-1:graveyard', playerId: 'player-1', name: 'graveyard', instanceIds: [] },
      'player-1:exile': { zoneId: 'player-1:exile', playerId: 'player-1', name: 'exile', instanceIds: [] },
      'player-1:command': { zoneId: 'player-1:command', playerId: 'player-1', name: 'command', instanceIds: ['commander-1'] },
      'player-2:library': { zoneId: 'player-2:library', playerId: 'player-2', name: 'library', instanceIds: ['opp-library-1'] },
      'player-2:hand': { zoneId: 'player-2:hand', playerId: 'player-2', name: 'hand', instanceIds: ['opp-hand-1'] },
      'player-2:battlefield': { zoneId: 'player-2:battlefield', playerId: 'player-2', name: 'battlefield', instanceIds: [] },
      'player-2:graveyard': { zoneId: 'player-2:graveyard', playerId: 'player-2', name: 'graveyard', instanceIds: [] },
      'player-2:exile': { zoneId: 'player-2:exile', playerId: 'player-2', name: 'exile', instanceIds: [] },
      'player-2:command': { zoneId: 'player-2:command', playerId: 'player-2', name: 'command', instanceIds: [] },
    },
    instances: {
      'library-1': { instanceId: 'library-1', cardRef: 'instance:library-1', zoneId: 'player-1:library', ownerId: 'player-1', controllerId: 'player-1', hidden: true, tapped: false },
      'library-2': { instanceId: 'library-2', cardRef: 'instance:library-2', zoneId: 'player-1:library', ownerId: 'player-1', controllerId: 'player-1', hidden: true, tapped: false },
      'hand-1': { instanceId: 'hand-1', cardRef: 'card:bolt', zoneId: 'player-1:hand', ownerId: 'player-1', controllerId: 'player-1', tapped: false },
      'battlefield-1': { instanceId: 'battlefield-1', cardRef: 'card:sol-ring', zoneId: 'player-1:battlefield', ownerId: 'player-1', controllerId: 'player-1', tapped: false, position: { x: 0.2, y: 0.3, unit: 'ratio' } },
      'commander-1': { instanceId: 'commander-1', cardRef: 'card:commander', zoneId: 'player-1:command', ownerId: 'player-1', controllerId: 'player-1', tapped: false, isCommander: true },
      'opp-library-1': { instanceId: 'opp-library-1', cardRef: 'instance:opp-library-1', zoneId: 'player-2:library', ownerId: 'player-2', controllerId: 'player-2', hidden: true, tapped: false },
      'opp-hand-1': { instanceId: 'opp-hand-1', cardRef: 'instance:opp-hand-1', zoneId: 'player-2:hand', ownerId: 'player-2', controllerId: 'player-2', hidden: true, tapped: false },
    },
    zoneCounts: {
      'player-1:library': 98,
      'player-1:hand': 1,
      'player-1:battlefield': 1,
      'player-1:graveyard': 0,
      'player-1:exile': 0,
      'player-1:command': 1,
      'player-2:library': 98,
      'player-2:hand': 1,
      'player-2:battlefield': 0,
      'player-2:graveyard': 0,
      'player-2:exile': 0,
      'player-2:command': 0,
    },
    relations: {
      stack: [{ stackId: 'stack-1', kind: 'card', cardRef: 'card:sol-ring', sourceInstanceId: 'battlefield-1', createdAt: '2026-01-01T00:00:01.000Z' }],
      arrows: [],
      attachments: [],
      specialEntities: [],
    },
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 3 },
    staticCards: {
      'card:bolt': { cardRef: 'card:bolt', scryfallId: 's-bolt', name: 'Lightning Bolt', imageUris: null, cardFaces: [], typeLine: 'Instant', manaCost: '{R}', colorIdentity: ['R'] },
      'card:sol-ring': { cardRef: 'card:sol-ring', scryfallId: 's-ring', name: 'Sol Ring', imageUris: null, cardFaces: [], typeLine: 'Artifact', manaCost: '{1}', colorIdentity: [] },
      'card:commander': { cardRef: 'card:commander', scryfallId: 's-commander', name: 'Atraxa, Praetors Voice', imageUris: null, cardFaces: [], typeLine: 'Legendary Creature', manaCost: '{1}{G}{W}{U}{B}', colorIdentity: ['G', 'W', 'U', 'B'] },
      'token:beast': { cardRef: 'token:beast', scryfallId: 's-beast', name: 'Beast', imageUris: null, cardFaces: [], typeLine: 'Token Creature', manaCost: null, colorIdentity: ['G'] },
    },
    chatCursor: null,
    logCursor: null,
  };
}
