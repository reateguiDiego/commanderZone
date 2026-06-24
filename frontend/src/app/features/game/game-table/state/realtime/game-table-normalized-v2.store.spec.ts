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

  it('applies battlefield field and counter patches without refetch', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const result = applyPatchEnvelopeV2(initial, patch(6, [
      {
        op: 'card.field.set',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-1',
        tapped: true,
        rotation: 90,
      },
      {
        op: 'card.field.set',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-1',
        position: { x: 0.5, y: 0.4, unit: 'ratio' },
      },
      {
        op: 'card.counters.patch',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-1',
        counters: { charge: 2 },
      },
    ]));

    expect(result.status).toBe('applied');
    expect(result.state.instances['battlefield-1'].tapped).toBe(true);
    expect(result.state.instances['battlefield-1'].rotation).toBe(90);
    expect(result.state.instances['battlefield-1'].position).toEqual({ x: 0.5, y: 0.4, unit: 'ratio' });
    expect(result.state.instances['battlefield-1'].counters).toEqual({ charge: 2 });
  });

  it('applies public player and shared counters plus commander damage patches', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const result = applyPatchEnvelopeV2(initial, patch(6, [
      { op: 'player.counters.set', playerId: 'player-1', counters: { poison: 3 } },
      { op: 'player.commanderDamage.set', playerId: 'player-1', commanderDamage: { 'commander-2': 11 } },
      { op: 'game.counters.set', scope: 'commander:commander-1', counters: { casts: 2 } },
    ]));
    const snapshot = hydrateGameSnapshotFromV2State(result.state);

    expect(result.status).toBe('applied');
    expect(result.state.players['player-1'].counters).toEqual({ poison: 3 });
    expect(result.state.players['player-1'].commanderDamage).toEqual({ 'commander-2': 11 });
    expect(result.state.sharedCounters['commander:commander-1']).toEqual({ casts: 2 });
    expect(snapshot.counters).toEqual({ 'commander:commander-1': { casts: 2 } });
  });

  it('applies runtime battlefield stats patches without snapshot refetch', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const result = applyPatchEnvelopeV2(initial, patch(6, [{
      op: 'card.field.set',
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'battlefield-1',
      power: 5,
      toughness: 6,
      loyalty: 4,
      defense: 7,
      saga: 2,
    }]));

    expect(result.status).toBe('applied');
    expect(result.state.instances['battlefield-1'].power).toBe(5);
    expect(result.state.instances['battlefield-1'].toughness).toBe(6);
    expect(result.state.instances['battlefield-1'].loyalty).toBe(4);
    expect(result.state.instances['battlefield-1'].defense).toBe(7);
    expect(result.state.instances['battlefield-1'].saga).toBe(2);
  });

  it('applies stack, relation and helper runtime patches without static payload duplication', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const result = applyPatchEnvelopeV2(initial, patch(6, [
      {
        op: 'stack.item.add',
        item: {
          id: 'stack-runtime',
          stackId: 'stack-runtime',
          kind: 'card',
          sourceInstanceId: 'battlefield-1',
          cardKey: 'card:sol-ring',
          controllerId: 'player-1',
          createdAt: '2026-01-01T00:00:02.000Z',
        },
      },
      {
        op: 'arrow.add',
        arrow: {
          id: 'arrow-runtime',
          ownerId: 'player-1',
          fromInstanceId: 'battlefield-1',
          toInstanceId: 'commander-1',
          color: 'blue',
          createdAt: '2026-01-01T00:00:03.000Z',
        },
      },
      {
        op: 'attachment.add',
        attachment: {
          id: 'attachment-runtime',
          ownerId: 'player-1',
          equipmentInstanceId: 'battlefield-1',
          attachedToInstanceId: 'commander-1',
          createdAt: '2026-01-01T00:00:04.000Z',
        },
      },
      {
        op: 'helper.add',
        entity: {
          id: 'helper-runtime',
          template: 'emblem',
          scope: 'player',
          ownerPlayerId: 'player-1',
          card: { scryfallId: 's-helper', name: 'Helper Emblem' },
          state: { label: 'Helper' },
          createdAt: '2026-01-01T00:00:05.000Z',
        },
      },
      {
        op: 'helper.update',
        entity: {
          id: 'helper-runtime',
          template: 'emblem',
          scope: 'player',
          ownerPlayerId: 'player-1',
          card: { scryfallId: 's-helper', name: 'Helper Emblem' },
          state: { label: 'Updated Helper' },
          createdAt: '2026-01-01T00:00:05.000Z',
        },
      },
    ]));

    expect(result.status).toBe('applied');
    expect(result.state.stack.byId['stack-runtime']?.sourceInstanceId).toBe('battlefield-1');
    expect(result.state.relations.arrows['arrow-runtime']?.fromInstanceId).toBe('battlefield-1');
    expect(result.state.relations.attachments['attachment-runtime']?.attachedToInstanceId).toBe('commander-1');
    expect(result.state.relations.specialEntities['helper-runtime']?.state).toEqual({ label: 'Updated Helper' });
    expect(JSON.stringify(result.state.relations.specialEntities['helper-runtime'])).not.toContain('oracleText');
    expect(JSON.stringify(result.state.relations.specialEntities['helper-runtime'])).not.toContain('imageUris');
    expect(JSON.stringify(result.state.relations.specialEntities['helper-runtime'])).not.toContain('cardFaces');

    const removed = applyPatchEnvelopeV2(result.state, patch(7, [
      { op: 'stack.item.remove', id: 'stack-runtime' },
      { op: 'arrow.remove', id: 'arrow-runtime' },
      { op: 'attachment.remove', id: 'attachment-runtime' },
      { op: 'helper.remove', id: 'helper-runtime' },
    ]));

    expect(removed.status).toBe('applied');
    expect(removed.state.stack.byId['stack-runtime']).toBeUndefined();
    expect(removed.state.relations.arrows['arrow-runtime']).toBeUndefined();
    expect(removed.state.relations.attachments['attachment-runtime']).toBeUndefined();
    expect(removed.state.relations.specialEntities['helper-runtime']).toBeUndefined();
  });

  it('applies chat and reaction stream patches without snapshot refetch', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const message = {
      id: 'chat-runtime-1',
      userId: 'player-1',
      displayName: 'Player One',
      message: 'hello table',
      createdAt: '2026-01-01T00:00:10.000Z',
      reactions: {},
    };
    const added = applyPatchEnvelopeV2(initial, patch(6, [{
      op: 'chat.message.add',
      message,
    }]));
    const reacted = applyPatchEnvelopeV2(added.state, patch(7, [{
      op: 'chat.reaction.set',
      messageId: 'chat-runtime-1',
      reactions: {
        like: [{ userId: 'player-2', displayName: 'Player Two', createdAt: '2026-01-01T00:00:11.000Z' }],
      },
    }]));

    expect(added.status).toBe('applied');
    expect(added.state.chat.order.at(-1)).toBe('chat-runtime-1');
    expect(added.state.chat.byId['chat-runtime-1']?.message).toBe('hello table');
    expect(reacted.status).toBe('applied');
    expect(reacted.state.chat.byId['chat-runtime-1']?.reactions?.like?.[0]?.userId).toBe('player-2');
  });

  it('applies same-version chat stream patches without advancing gameplay version', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const result = applyPatchEnvelopeV2(initial, patch(5, [{
      op: 'chat.message.add',
      message: {
        id: 'chat-stream-same-version',
        userId: 'player-1',
        displayName: 'Player One',
        message: 'same version stream',
        createdAt: '2026-01-01T00:00:12.000Z',
        reactions: {},
      },
    }]));
    const gameplayDuplicate = applyPatchEnvelopeV2(result.state, patch(5, [{ op: 'player.life.set', playerId: 'player-1', value: 1 }]));

    expect(result.status).toBe('applied');
    expect(result.state.lastAppliedVersion).toBe(5);
    expect(result.state.chat.byId['chat-stream-same-version']?.message).toBe('same version stream');
    expect(gameplayDuplicate.status).toBe('ignored');
    expect(gameplayDuplicate.state.players['player-1'].life).toBe(40);
  });

  it('applies lifecycle status and disconnect vote patches without snapshot refetch', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const result = applyPatchEnvelopeV2(initial, patch(6, [
      {
        op: 'player.status.set',
        playerId: 'player-2',
        status: 'conceded',
        concededAt: '2026-01-01T00:00:12.000Z',
      },
      {
        op: 'disconnect.vote.set',
        disconnectVote: {
          targetPlayerId: 'player-2',
          status: 'open',
          openedAt: '2026-01-01T00:00:13.000Z',
          deadlineAt: '2026-01-01T00:01:13.000Z',
          cooldownUntil: null,
          votes: {
            'player-1': {
              playerId: 'player-1',
              displayName: 'Player One',
              vote: 'expel',
              votedAt: '2026-01-01T00:00:14.000Z',
            },
          },
        },
      },
      {
        op: 'game.status.set',
        status: 'finished',
        phase: 'FINISHED',
      },
    ]));

    expect(result.status).toBe('applied');
    expect(result.state.players['player-2'].status).toBe('conceded');
    expect(result.state.players['player-2'].concededAt).toBe('2026-01-01T00:00:12.000Z');
    expect(result.state.game.disconnectVote?.targetPlayerId).toBe('player-2');
    expect(result.state.game.status).toBe('finished');
    expect(result.state.game.gamePhase).toBe('FINISHED');
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

  it('applies batchMove moves contract without using legacy cards field', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const result = applyPatchEnvelopeV2(initial, patch(6, [{
      op: 'zone.cards.batchMove',
      moves: [{
        instanceId: 'hand-1',
        from: { playerId: 'player-1', zone: 'hand' },
        to: { playerId: 'player-1', zone: 'battlefield', index: 1 },
        card: { instanceId: 'hand-1', cardRef: 'card:bolt', cardKey: 'card:bolt', zoneId: 'player-1:battlefield', ownerId: 'player-1', controllerId: 'player-1' },
      }],
    }]));

    expect(result.status).toBe('applied');
    expect(result.state.zones['player-1'].hand).toEqual([]);
    expect(result.state.zones['player-1'].battlefield).toEqual(['battlefield-1', 'hand-1']);
    expect(result.state.instances['hand-1'].zoneId).toBe('player-1:battlefield');
  });

  it('applies public add/count patches for private hand to public zone without requiring source card', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const result = applyPatchEnvelopeV2(initial, patch(6, [
      { op: 'zone.cards.remove', playerId: 'player-2', zone: 'hand', instanceIds: ['opp-hand-1'] },
      {
        op: 'zone.cards.add',
        playerId: 'player-2',
        zone: 'graveyard',
        cards: [{ instanceId: 'opp-hand-1', ownerId: 'player-2', controllerId: 'player-2', zone: 'graveyard', hidden: false }],
      },
      { op: 'zone.count.set', playerId: 'player-2', zone: 'hand', count: 0 },
      { op: 'zone.count.set', playerId: 'player-2', zone: 'graveyard', count: 1 },
    ]));

    expect(result.status).toBe('applied');
    expect(result.state.zones['player-2'].hand).toEqual([]);
    expect(result.state.zoneCounts['player-2'].hand).toBe(0);
    expect(result.state.zones['player-2'].graveyard).toEqual(['opp-hand-1']);
    expect(JSON.stringify(result.state.instances['opp-hand-1'])).not.toContain('imageUris');
  });

  it('applies combined owner move envelope after public remove and add ops', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const result = applyPatchEnvelopeV2(initial, patch(6, [
      { op: 'zone.cards.remove', playerId: 'player-1', zone: 'hand', instanceIds: ['hand-1'] },
      {
        op: 'zone.cards.add',
        playerId: 'player-1',
        zone: 'battlefield',
        cards: [{
          instanceId: 'hand-1',
          ownerId: 'player-1',
          controllerId: 'player-1',
          zone: 'battlefield',
          hidden: false,
        }],
      },
      { op: 'zone.count.set', playerId: 'player-1', zone: 'hand', count: 0 },
      { op: 'zone.count.set', playerId: 'player-1', zone: 'battlefield', count: 2 },
      {
        op: 'zone.cards.move',
        instanceId: 'hand-1',
        from: { playerId: 'player-1', zone: 'hand' },
        to: { playerId: 'player-1', zone: 'battlefield', index: 1 },
        card: {
          instanceId: 'hand-1',
          cardRef: 'card:bolt',
          cardKey: 'card:bolt',
          zoneId: 'player-1:battlefield',
          ownerId: 'player-1',
          controllerId: 'player-1',
        },
      },
    ]));

    expect(result.status).toBe('applied');
    expect(result.state.zones['player-1'].hand).toEqual([]);
    expect(result.state.zoneCounts['player-1'].hand).toBe(0);
    expect(result.state.zones['player-1'].battlefield).toEqual(['battlefield-1', 'hand-1']);
    expect(result.state.zoneCounts['player-1'].battlefield).toBe(2);
  });

  it('applies zone.reordered for known zones and rejects mismatched sets', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const moved = applyPatchEnvelopeV2(initial, patch(6, [{
      op: 'zone.cards.move',
      instanceId: 'hand-1',
      from: { playerId: 'player-1', zone: 'hand' },
      to: { playerId: 'player-1', zone: 'battlefield', index: 1 },
    }]));
    const reordered = applyPatchEnvelopeV2(moved.state, patch(7, [{
      op: 'zone.reordered',
      playerId: 'player-1',
      zone: 'battlefield',
      instanceIds: ['hand-1', 'battlefield-1'],
    }]));
    const invalid = applyPatchEnvelopeV2(reordered.state, patch(8, [{
      op: 'zone.reordered',
      playerId: 'player-1',
      zone: 'battlefield',
      instanceIds: ['hand-1', 'hand-1'],
    }]));

    expect(reordered.status).toBe('applied');
    expect(reordered.state.zones['player-1'].battlefield).toEqual(['hand-1', 'battlefield-1']);
    expect(invalid.status).toBe('resync_required');
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

  it('applies runtime draw patches without snapshot refetch', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const result = applyPatchEnvelopeV2(initial, patch(6, [
      { op: 'zone.cards.remove', playerId: 'player-1', zone: 'library', instanceIds: ['library-1'] },
      {
        op: 'zone.cards.add',
        playerId: 'player-1',
        zone: 'hand',
        cards: [{ instanceId: 'library-1', cardRef: 'card:forest', cardKey: 'card:forest', zoneId: 'player-1:hand', ownerId: 'player-1', controllerId: 'player-1' }],
        staticCards: { 'card:forest': { cardRef: 'card:forest', name: 'Forest', imageUris: null, cardFaces: [] } },
      },
      { op: 'zone.count.set', playerId: 'player-1', zone: 'library', count: 97 },
      { op: 'zone.count.set', playerId: 'player-1', zone: 'hand', count: 2 },
    ]));

    expect(result.status).toBe('applied');
    expect(result.state.zones['player-1'].library).toEqual(['library-2']);
    expect(result.state.zones['player-1'].hand).toEqual(['hand-1', 'library-1']);
    expect(result.state.zoneCounts['player-1'].library).toBe(97);
    expect(hydrateGameSnapshotFromV2State(result.state).players['player-1'].zones.hand[1]?.name).toBe('Forest');
  });

  it('applies runtime rival count patches without private card data', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const result = applyPatchEnvelopeV2(initial, patch(6, [
      { op: 'zone.count.set', playerId: 'player-2', zone: 'library', count: 97 },
      { op: 'zone.count.set', playerId: 'player-2', zone: 'hand', count: 2 },
    ]));

    expect(result.status).toBe('applied');
    expect(result.state.zones['player-2'].hand).toEqual(['opp-hand-1']);
    expect(result.state.zoneCounts['player-2'].hand).toBe(2);
    expect(JSON.stringify(result.state.instances['opp-hand-1'])).not.toContain('cardKey');
  });

  it('accepts library count patches as a compatibility alias without resync', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const result = applyPatchEnvelopeV2(initial, patch(6, [
      { op: 'library.count.set', playerId: 'player-1', count: 88 },
    ]));

    expect(result.status).toBe('applied');
    expect(result.state.zoneCounts['player-1'].library).toBe(88);
  });

  it('applies runtime reorder, move top and shuffle patches without resync', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const reordered = applyPatchEnvelopeV2(initial, patch(6, [
      { op: 'library.top.reordered', playerId: 'player-1', instanceIds: ['library-2', 'library-1'] },
    ]));
    const moved = applyPatchEnvelopeV2(reordered.state, patch(7, [
      { op: 'library.top.moved', playerId: 'player-1', count: 1, instanceIds: ['library-2'], position: 'bottom' },
      { op: 'zone.count.set', playerId: 'player-1', zone: 'library', count: 98 },
    ]));
    const shuffled = applyPatchEnvelopeV2(moved.state, patch(8, [
      { op: 'library.shuffled', playerId: 'player-1', visibilityEpoch: 2 },
      { op: 'zone.count.set', playerId: 'player-1', zone: 'library', count: 98 },
    ]));

    expect(reordered.status).toBe('applied');
    expect(reordered.state.zones['player-1'].library).toEqual(['library-2', 'library-1']);
    expect(moved.status).toBe('applied');
    expect(moved.state.zones['player-1'].library).toEqual([]);
    expect(moved.state.zoneCounts['player-1'].library).toBe(98);
    expect(shuffled.status).toBe('applied');
    expect(shuffled.state.zones['player-1'].library).toEqual([]);
    expect(shuffled.state.zoneCounts['player-1'].library).toBe(98);
  });

  it('applies private library view patch without mutating counts', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const result = applyPatchEnvelopeV2(initial, patch(6, [{
      op: 'library.top.viewed',
      playerId: 'player-1',
      cards: [{ instanceId: 'library-1', cardRef: 'card:forest', cardKey: 'card:forest', zoneId: 'player-1:library', ownerId: 'player-1', controllerId: 'player-1' }],
      staticCards: { 'card:forest': { cardRef: 'card:forest', name: 'Forest', imageUris: null, cardFaces: [] } },
    }]));

    expect(result.status).toBe('applied');
    expect(result.state.zoneCounts['player-1'].library).toBe(98);
    expect(hydrateGameSnapshotFromV2State(result.state).players['player-1'].zones.library[0]?.name).toBe('Forest');
  });

  it('applies sensitive card field patches without snapshot refetch', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const result = applyPatchEnvelopeV2(initial, patch(6, [{
      op: 'card.field.set',
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'battlefield-1',
      faceDown: true,
      hidden: true,
      controllerId: 'player-2',
    }]));

    expect(result.status).toBe('applied');
    expect(result.state.instances['battlefield-1'].faceDown).toBe(true);
    expect(result.state.instances['battlefield-1'].hidden).toBe(true);
    expect(result.state.instances['battlefield-1'].controllerId).toBe('player-2');
  });

  it('applies runtime edge patches without static payload duplication or resync', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const result = applyPatchEnvelopeV2(initial, patch(6, [
      {
        op: 'zone.cards.add',
        playerId: 'player-1',
        zone: 'battlefield',
        cards: [{
          instanceId: 'token-runtime-1',
          ownerId: 'player-1',
          controllerId: 'player-1',
          name: 'Runtime Goblin',
          cardKey: 'runtime-token:token',
          zone: 'battlefield',
          isToken: true,
          tokenMeta: {
            isCopy: false,
            templateScryfallId: 'runtime-token',
            mutableOverrides: { power: 1, toughness: 1 },
          },
        }],
      },
      {
        op: 'card.field.set',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-1',
        dungeonMarker: { x: 0.2, y: 0.4 },
        activeFaceIndex: 1,
      },
      {
        op: 'zone.random_card.selected',
        playerId: 'player-2',
        zone: 'hand',
        count: 1,
      },
    ]));

    expect(result.status).toBe('applied');
    expect(result.state.zones['player-1'].battlefield).toContain('token-runtime-1');
    expect(result.state.instances['token-runtime-1'].isToken).toBe(true);
    expect(result.state.instances['token-runtime-1'].tokenMeta?.mutableOverrides).toEqual({ power: 1, toughness: 1 });
    expect(result.state.instances['battlefield-1'].dungeonMarker).toEqual({ x: 0.2, y: 0.4 });
    expect(result.state.instances['battlefield-1'].activeFaceIndex).toBe(1);
    expect(result.state.instances['opp-hand-1'].cardKey).toBeUndefined();
    expect(JSON.stringify(result.state.instances['token-runtime-1'])).not.toContain('imageUris');
    expect(JSON.stringify(result.state.instances['token-runtime-1'])).not.toContain('oracleText');
    expect(JSON.stringify(result.state.instances['token-runtime-1'])).not.toContain('cardFaces');
  });

  it('applies full library reveal and play-top patches without static payload duplication', () => {
    const initial = createGameTableNormalizedV2State(bootstrapV2());
    const revealed = applyPatchEnvelopeV2(initial, patch(6, [{
      op: 'library.revealed.set',
      playerId: 'player-1',
      cards: [
        { instanceId: 'library-1', cardRef: 'card:forest', cardKey: 'card:forest', zoneId: 'player-1:library', ownerId: 'player-1', controllerId: 'player-1' },
        { instanceId: 'library-2', cardRef: 'card:island', cardKey: 'card:island', zoneId: 'player-1:library', ownerId: 'player-1', controllerId: 'player-1' },
      ],
      staticCards: {
        'card:forest': { cardRef: 'card:forest', name: 'Forest', imageUris: null, cardFaces: [] },
        'card:island': { cardRef: 'card:island', name: 'Island', imageUris: null, cardFaces: [] },
      },
    }]));
    const playTop = applyPatchEnvelopeV2(revealed.state, patch(7, [{
      op: 'library.play_top_revealed.set',
      playerId: 'player-1',
      enabled: true,
    }]));
    const hidden = applyPatchEnvelopeV2(playTop.state, patch(8, [{
      op: 'library.top.hidden',
      playerId: 'player-1',
    }]));

    expect(revealed.status).toBe('applied');
    expect(revealed.state.zones['player-1'].library).toEqual(['library-1', 'library-2']);
    expect(revealed.state.staticCards['card:forest'].name).toBe('Forest');
    expect(playTop.status).toBe('applied');
    expect(hydrateGameSnapshotFromV2State(playTop.state).players['player-1'].playTopLibraryRevealed).toBe(true);
    expect(hidden.status).toBe('applied');
    expect(hidden.state.zones['player-1'].library).toEqual([]);
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
