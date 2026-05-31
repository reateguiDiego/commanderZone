import { GameCardInstance, GameSnapshot } from '../../../../../core/models/game.model';
import { GameplayGamePatchMessage, GameSnapshotPatchOperation } from '../../../../../core/models/game-realtime.model';
import { applyGameSnapshotPatch, applyGameSnapshotPatchOperations } from './game-snapshot-patch-reducer';

describe('game snapshot patch reducer', () => {
  it('applies player scalar state updates and publishes the patch version', () => {
    const snapshot = snapshotFixture();

    const result = applyGameSnapshotPatch(snapshot, patch([
      { op: 'player.life.set', playerId: 'player-1', value: 37 },
      { op: 'player.counters.set', playerId: 'player-1', counters: { poison: 2 } },
      { op: 'player.commanderDamage.set', playerId: 'player-1', commanderDamage: { 'player-2': 5 } },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.version).toBe(2);
    expect(result.snapshot.players['player-1'].life).toBe(37);
    expect(result.snapshot.players['player-1'].counters).toEqual({ poison: 2 });
    expect(result.snapshot.players['player-1'].commanderDamage).toEqual({ 'player-2': 5 });
  });

  it('applies shared game counters by scope', () => {
    const snapshot = snapshotFixture();

    const result = applyGameSnapshotPatch(snapshot, patch([
      { op: 'game.counters.set', scope: 'global', counters: { storm: 3 } },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.version).toBe(2);
    expect(result.snapshot.counters).toEqual({
      global: { storm: 3 },
    });
  });

  it('preserves ratio positions and player visual state when setting card positions', () => {
    const snapshot = snapshotFixture();

    const result = applyGameSnapshotPatch(snapshot, patch([
      {
        op: 'card.position.set',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-1',
        position: { x: 0.4, y: 0.6, unit: 'ratio' },
      },
      {
        op: 'cards.position.set',
        playerId: 'player-1',
        zone: 'battlefield',
        positions: [{ instanceId: 'battlefield-2', position: { x: 0.2, y: 0.3, unit: 'ratio' } }],
      },
    ]));

    expect(result.status).toBe('applied');
    const player = result.snapshot.players['player-1'];
    expect(player.backgroundName).toBe('G_3');
    expect(player.sleevesName).toBe('custom-sleeves');
    expect(player.zones.battlefield[0].position).toEqual({ x: 0.4, y: 0.6, unit: 'ratio' });
    expect(player.zones.battlefield[1].position).toEqual({ x: 0.2, y: 0.3, unit: 'ratio' });
  });

  it('moves an existing visible card without requiring a complete card payload', () => {
    const snapshot = snapshotFixture();

    const result = applyGameSnapshotPatch(snapshot, patch([
      {
        op: 'card.move',
        instanceId: 'hand-1',
        from: { playerId: 'player-1', zone: 'hand' },
        to: { playerId: 'player-1', zone: 'battlefield' },
      },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.players['player-1'].zones.hand.map((card) => card.instanceId)).toEqual([]);
    expect(result.snapshot.players['player-1'].zones.battlefield.map((card) => card.instanceId)).toEqual([
      'battlefield-1',
      'battlefield-2',
      'hand-1',
    ]);
    expect(result.snapshot.players['player-1'].zones.battlefield[2].zone).toBe('battlefield');
  });

  it('inserts moved cards at the requested destination index', () => {
    const snapshot = snapshotFixture();

    const result = applyGameSnapshotPatch(snapshot, patch([
      {
        op: 'card.move',
        instanceId: 'graveyard-1',
        from: { playerId: 'player-1', zone: 'graveyard' },
        to: { playerId: 'player-1', zone: 'battlefield', index: 1 },
      },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.players['player-1'].zones.battlefield.map((card) => card.instanceId)).toEqual([
      'battlefield-1',
      'graveyard-1',
      'battlefield-2',
    ]);
  });

  it('uses card.move card payload only when the source card is not visible locally', () => {
    const snapshot = snapshotFixture();
    const hiddenCard = card('library-hidden', { zone: 'hand', hidden: true });

    const result = applyGameSnapshotPatch(snapshot, patch([
      {
        op: 'card.move',
        instanceId: 'library-hidden',
        from: { playerId: 'player-1', zone: 'library' },
        to: { playerId: 'player-1', zone: 'hand' },
        card: hiddenCard,
      },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.players['player-1'].zones.hand.map((entry) => entry.instanceId)).toEqual(['hand-1', 'library-hidden']);
  });

  it('uses card.move card payload as the destination representation even when the source card is visible', () => {
    const snapshot = snapshotFixture();
    const hiddenPlaceholder = card('player-1-hidden-hand-new', {
      zone: 'hand',
      name: 'Hidden card',
      hidden: true,
      faceDown: true,
    });

    const result = applyGameSnapshotPatch(snapshot, patch([
      {
        op: 'card.move',
        instanceId: 'battlefield-1',
        from: { playerId: 'player-1', zone: 'battlefield' },
        to: { playerId: 'player-1', zone: 'hand' },
        card: hiddenPlaceholder,
      },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.players['player-1'].zones.battlefield.map((entry) => entry.instanceId)).toEqual(['battlefield-2']);
    expect(result.snapshot.players['player-1'].zones.hand.map((entry) => entry.instanceId)).toEqual(['hand-1', 'player-1-hidden-hand-new']);
    expect(result.snapshot.players['player-1'].zones.hand[1]).toEqual(expect.objectContaining({
      name: 'Hidden card',
      hidden: true,
      faceDown: true,
    }));
  });

  it('removes a hidden placeholder when a private source card becomes visible', () => {
    const snapshot = snapshotFixture();
    snapshot.players['player-2'].zones.hand = [
      card('player-2-hidden-hand-0', { ownerId: 'player-2', controllerId: 'player-2', zone: 'hand', hidden: true, faceDown: true }),
    ];
    snapshot.players['player-2'].zoneCounts!.hand = 1;
    const revealedCard = card('revealed-from-hand', { ownerId: 'player-2', controllerId: 'player-2', zone: 'battlefield', name: 'Revealed Bear' });

    const result = applyGameSnapshotPatch(snapshot, patch([
      {
        op: 'card.move',
        instanceId: 'revealed-from-hand',
        from: { playerId: 'player-2', zone: 'hand' },
        to: { playerId: 'player-2', zone: 'battlefield' },
        card: revealedCard,
      },
      { op: 'zone.counts.set', playerId: 'player-2', counts: { hand: 0, battlefield: 1 } },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.players['player-2'].zones.hand).toEqual([]);
    expect(result.snapshot.players['player-2'].zones.battlefield).toEqual([expect.objectContaining({
      instanceId: 'revealed-from-hand',
      name: 'Revealed Bear',
    })]);
    expect(result.snapshot.players['player-2'].zoneCounts?.hand).toBe(0);
  });

  it('updates zone counts without touching zone card arrays', () => {
    const snapshot = snapshotFixture();
    const originalLibrary = snapshot.players['player-1'].zones.library;
    const originalBattlefield = snapshot.players['player-1'].zones.battlefield;

    const result = applyGameSnapshotPatch(snapshot, patch([
      { op: 'zone.counts.set', playerId: 'player-1', counts: { library: 92, hand: 4 } },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.players['player-1'].zoneCounts).toEqual({
      library: 92,
      hand: 4,
      battlefield: 2,
      graveyard: 1,
      exile: 0,
      command: 1,
    });
    expect(result.snapshot.players['player-1'].zones.library).toBe(originalLibrary);
    expect(result.snapshot.players['player-1'].zones.battlefield).toBe(originalBattlefield);
  });

  it('replaces only the projected visible cards for a zone', () => {
    const snapshot = snapshotFixture();
    const originalHand = snapshot.players['player-1'].zones.hand;
    const visibleTop = card('library-visible-1', { zone: 'library', name: 'Visible Top' });

    const result = applyGameSnapshotPatch(snapshot, patch([
      { op: 'zone.visible.set', playerId: 'player-1', zone: 'library', cards: [visibleTop] },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.players['player-1'].zones.library).toEqual([visibleTop]);
    expect(result.snapshot.players['player-1'].zones.hand).toBe(originalHand);
    expect(result.snapshot.players['player-1'].backgroundName).toBe('G_3');
    expect(result.snapshot.players['player-1'].sleevesName).toBe('custom-sleeves');
  });

  it('updates player library visibility without changing visual contract fields', () => {
    const snapshot = snapshotFixture();

    const result = applyGameSnapshotPatch(snapshot, patch([
      {
        op: 'player.library.visibility.set',
        playerId: 'player-1',
        playTopLibraryRevealed: true,
        revealedLibraryTo: ['player-2'],
      },
    ]));

    expect(result.status).toBe('applied');
    const player = result.snapshot.players['player-1'];
    expect(player.playTopLibraryRevealed).toBe(true);
    expect(player.revealedLibraryTo).toEqual(['player-2']);
    expect(player.backgroundName).toBe('G_3');
    expect(player.sleevesName).toBe('custom-sleeves');
  });

  it('updates turn and timer without requiring a full snapshot replacement', () => {
    const snapshot = snapshotFixture();

    const result = applyGameSnapshotPatch(snapshot, patch([
      { op: 'turn.set', turn: { activePlayerId: 'player-2', phase: 'combat', number: 2 } },
      { op: 'timer.set', timer: { mode: 'turn', status: 'running', durationSeconds: 120, remainingSeconds: 87 } },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.turn).toEqual({ activePlayerId: 'player-2', phase: 'combat', number: 2 });
    expect(result.snapshot.timer).toEqual({ mode: 'turn', status: 'running', durationSeconds: 120, remainingSeconds: 87 });
  });

  it('applies disconnect vote snapshot updates', () => {
    const snapshot = snapshotFixture();

    const result = applyGameSnapshotPatch(snapshot, patch([
      {
        op: 'disconnect.vote.set',
        disconnectVote: {
          targetPlayerId: 'player-2',
          status: 'open',
          openedAt: '2026-01-01T00:00:10.000Z',
          deadlineAt: '2026-01-01T00:01:10.000Z',
          cooldownUntil: null,
          votes: {
            'player-1': {
              playerId: 'player-1',
              displayName: 'Player 1',
              vote: 'expel',
              votedAt: '2026-01-01T00:00:15.000Z',
            },
          },
        },
      },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.disconnectVote).toEqual(expect.objectContaining({
      targetPlayerId: 'player-2',
      status: 'open',
    }));
    expect(result.snapshot.disconnectVote?.votes['player-1']?.vote).toBe('expel');
  });

  it('applies append and set operations for shared gameplay collections', () => {
    const snapshot = snapshotFixture();

    const result = applyGameSnapshotPatch(snapshot, patch([
      {
        op: 'chat.append',
        entries: [{ id: 'chat-1', userId: 'player-1', displayName: 'Player 1', message: 'go', createdAt: '2026-01-01T00:00:02.000Z' }],
      },
      {
        op: 'chat.message.set',
        message: {
          id: 'chat-1',
          userId: 'player-1',
          displayName: 'Player 1',
          message: 'go',
          createdAt: '2026-01-01T00:00:02.000Z',
          reactions: {
            like: [{ userId: 'player-2', displayName: 'Player 2', createdAt: '2026-01-01T00:00:03.000Z' }],
          },
        },
      },
      {
        op: 'eventLog.append',
        entries: [{ id: 'log-2', type: 'card.moved', message: 'Moved card', actorId: 'player-1', displayName: 'Player 1', createdAt: '2026-01-01T00:00:03.000Z' }],
      },
      {
        op: 'stack.set',
        stack: [{ id: 'stack-1', kind: 'spell', card: card('stack-card'), createdAt: '2026-01-01T00:00:04.000Z' }],
      },
      {
        op: 'arrows.set',
        arrows: [{ id: 'arrow-1', fromInstanceId: 'battlefield-1', toInstanceId: 'battlefield-2', color: '#fff', createdAt: '2026-01-01T00:00:05.000Z' }],
      },
      {
        op: 'attachments.set',
        attachments: [{ id: 'attachment-1', equipmentInstanceId: 'battlefield-1', attachedToInstanceId: 'battlefield-2', createdAt: '2026-01-01T00:00:06.000Z' }],
      },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.chat).toHaveLength(1);
    expect(result.snapshot.chat[0]?.reactions?.like?.[0]?.displayName).toBe('Player 2');
    expect(result.snapshot.eventLog.map((entry) => entry.id)).toEqual(['log-1', 'log-2']);
    expect(result.snapshot.stack.map((entry) => entry.id)).toEqual(['stack-1']);
    expect(result.snapshot.arrows.map((entry) => entry.id)).toEqual(['arrow-1']);
    expect(result.snapshot.attachments?.map((entry) => entry.id)).toEqual(['attachment-1']);
  });

  it('keeps only the latest 250 event log entries when appending', () => {
    const snapshot = snapshotFixture();
    snapshot.eventLog = Array.from({ length: 250 }, (_, index) => ({
      id: `log-${index + 1}`,
      type: 'life.changed',
      message: `Life changed ${index + 1}`,
      actorId: 'player-1',
      displayName: 'Player 1',
      createdAt: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
    }));

    const result = applyGameSnapshotPatch(snapshot, patch([
      {
        op: 'eventLog.append',
        entries: [
          {
            id: 'log-251',
            type: 'life.changed',
            message: 'Life changed 251',
            actorId: 'player-1',
            displayName: 'Player 1',
            createdAt: '2026-01-01T00:04:11.000Z',
          },
          {
            id: 'log-252',
            type: 'life.changed',
            message: 'Life changed 252',
            actorId: 'player-1',
            displayName: 'Player 1',
            createdAt: '2026-01-01T00:04:12.000Z',
          },
        ],
      },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.eventLog).toHaveLength(250);
    expect(result.snapshot.eventLog[0]?.id).toBe('log-3');
    expect(result.snapshot.eventLog.at(-1)?.id).toBe('log-252');
  });

  it('applies small stack and relation add/remove operations', () => {
    const snapshot = {
      ...snapshotFixture(),
      stack: [{ id: 'stack-old', kind: 'card', card: card('stack-card'), createdAt: '2026-01-01T00:00:04.000Z' }],
      arrows: [{ id: 'arrow-old', ownerId: 'player-1', fromInstanceId: 'battlefield-1', toInstanceId: 'battlefield-2', color: 'yellow', createdAt: '2026-01-01T00:00:05.000Z' }],
      attachments: [{ id: 'attachment-old', ownerId: 'player-1', equipmentInstanceId: 'battlefield-1', attachedToInstanceId: 'battlefield-2', createdAt: '2026-01-01T00:00:06.000Z' }],
    };

    const result = applyGameSnapshotPatch(snapshot, patch([
      { op: 'stack.item.remove', id: 'stack-old' },
      { op: 'stack.item.add', item: { id: 'stack-new', kind: 'card', card: card('stack-new-card'), createdAt: '2026-01-01T00:00:07.000Z' } },
      { op: 'arrow.remove', id: 'arrow-old' },
      { op: 'arrow.add', arrow: { id: 'arrow-new', ownerId: 'player-1', fromInstanceId: 'battlefield-2', toInstanceId: 'battlefield-1', color: 'blue', createdAt: '2026-01-01T00:00:08.000Z' } },
      { op: 'attachment.remove', id: 'attachment-old' },
      { op: 'attachment.add', attachment: { id: 'attachment-new', ownerId: 'player-1', equipmentInstanceId: 'battlefield-2', attachedToInstanceId: 'battlefield-1', createdAt: '2026-01-01T00:00:09.000Z' } },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.stack.map((entry) => entry.id)).toEqual(['stack-new']);
    expect(result.snapshot.arrows).toEqual([expect.objectContaining({ id: 'arrow-new', ownerId: 'player-1' })]);
    expect(result.snapshot.attachments).toEqual([expect.objectContaining({ id: 'attachment-new', ownerId: 'player-1' })]);
    expect(snapshot.stack.map((entry) => entry.id)).toEqual(['stack-old']);
    expect(snapshot.arrows.map((entry) => entry.id)).toEqual(['arrow-old']);
    expect(snapshot.attachments?.map((entry) => entry.id)).toEqual(['attachment-old']);
  });

  it('updates player status without mutating sleeves or background', () => {
    const snapshot = snapshotFixture();

    const result = applyGameSnapshotPatch(snapshot, patch([
      {
        op: 'player.status.set',
        playerId: 'player-1',
        status: 'conceded',
        concededAt: '2026-01-01T00:00:10.000Z',
      },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.players['player-1']).toEqual(expect.objectContaining({
      status: 'conceded',
      concededAt: '2026-01-01T00:00:10.000Z',
      backgroundName: 'G_3',
      sleevesName: 'custom-sleeves',
    }));
    expect(snapshot.players['player-1'].status).toBeUndefined();
  });

  it('updates card state and player visual fields explicitly', () => {
    const snapshot = snapshotFixture();

    const result = applyGameSnapshotPatch(snapshot, patch([
      {
        op: 'card.state.set',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-1',
        tapped: true,
        faceDown: true,
        hidden: true,
        revealedTo: ['player-2'],
        counters: { charge: 3 },
      },
      { op: 'player.sleeves.set', playerId: 'player-1', sleevesName: 'new-sleeves' },
      { op: 'player.background.set', playerId: 'player-1', backgroundName: 'G_7' },
    ]));

    expect(result.status).toBe('applied');
    const player = result.snapshot.players['player-1'];
    expect(player.sleevesName).toBe('new-sleeves');
    expect(player.backgroundName).toBe('G_7');
    expect(player.zones.battlefield[0]).toEqual(expect.objectContaining({
      tapped: true,
      faceDown: true,
      hidden: true,
      revealedTo: ['player-2'],
      counters: { charge: 3 },
    }));
  });

  it('applies advanced card projection, counters and stats operations', () => {
    const snapshot = snapshotFixture();
    const faceDownProjection = card('battlefield-1', {
      zone: 'battlefield',
      name: 'Face-down card',
      hidden: true,
      faceDown: true,
      tapped: false,
    });

    const result = applyGameSnapshotPatch(snapshot, patch([
      {
        op: 'card.projection.set',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-1',
        card: faceDownProjection,
      },
      {
        op: 'card.counters.set',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-2',
        counters: { charge: 2 },
      },
      {
        op: 'card.stats.set',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-2',
        power: 4,
        toughness: 5,
        loyalty: null,
      },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.players['player-1'].zones.battlefield[0]).toEqual(expect.objectContaining({
      name: 'Face-down card',
      hidden: true,
      faceDown: true,
    }));
    expect(result.snapshot.players['player-1'].zones.battlefield[1]).toEqual(expect.objectContaining({
      counters: { charge: 2 },
      power: 4,
      toughness: 5,
      loyalty: null,
    }));
  });

  it('applies batch card state and token creation operations', () => {
    const snapshot = snapshotFixture();
    const token = card('token-1', {
      zone: 'battlefield',
      name: 'Token',
      isToken: true,
      position: { x: 0.5, y: 0.5, unit: 'ratio' },
    });

    const result = applyGameSnapshotPatch(snapshot, patch([
      {
        op: 'cards.state.set',
        playerId: 'player-1',
        zone: 'battlefield',
        cards: [
          { instanceId: 'battlefield-1', tapped: false, rotation: 0 },
          { instanceId: 'battlefield-2', tapped: false, rotation: 0 },
        ],
      },
      {
        op: 'card.create',
        playerId: 'player-1',
        zone: 'battlefield',
        card: token,
        index: 1,
      },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.players['player-1'].zones.battlefield.map((entry) => entry.instanceId)).toEqual([
      'battlefield-1',
      'token-1',
      'battlefield-2',
    ]);
    expect(result.snapshot.players['player-1'].zones.battlefield[1]).toEqual(expect.objectContaining({
      name: 'Token',
      isToken: true,
    }));
  });

  it('removes an evaporated card without inserting it into another zone', () => {
    const snapshot = snapshotFixture();

    const result = applyGameSnapshotPatch(snapshot, patch([
      {
        op: 'card.remove',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-1',
      },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.players['player-1'].zones.battlefield.map((entry) => entry.instanceId)).toEqual(['battlefield-2']);
    expect(result.snapshot.players['player-1'].zones.graveyard.map((entry) => entry.instanceId)).toEqual(['graveyard-1']);
  });

  it('removes stale local copies of an evaporated card from hidden destinations', () => {
    const snapshot = snapshotFixture();
    snapshot.players['player-1'].zones.hand = [
      card('battlefield-1', { zone: 'hand', hidden: true, faceDown: true }),
    ];

    const result = applyGameSnapshotPatch(snapshot, patch([
      {
        op: 'card.remove',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-1',
      },
    ]));

    expect(result.status).toBe('applied');
    expect(result.snapshot.players['player-1'].zones.battlefield.map((entry) => entry.instanceId)).toEqual(['battlefield-2']);
    expect(result.snapshot.players['player-1'].zones.hand).toEqual([]);
  });

  it('does not apply patches with a version gap', () => {
    const snapshot = snapshotFixture();

    const result = applyGameSnapshotPatch(snapshot, patch([
      { op: 'player.life.set', playerId: 'player-1', value: 10 },
    ], { version: 3 }));

    expect(result).toEqual({ status: 'resync_required', snapshot, reason: 'version_gap' });
    expect(snapshot.players['player-1'].life).toBe(40);
  });

  it('ignores duplicate or late patches without changing the snapshot', () => {
    const snapshot = snapshotFixture();

    const result = applyGameSnapshotPatch(snapshot, patch([
      { op: 'player.life.set', playerId: 'player-1', value: 10 },
    ], { baseVersion: 0, version: 1 }));

    expect(result).toEqual({ status: 'ignored', snapshot, reason: 'duplicate_or_late_version' });
  });

  it('returns resync_required when an operation cannot find its target', () => {
    const snapshot = snapshotFixture();

    const result = applyGameSnapshotPatch(snapshot, patch([
      { op: 'card.position.set', playerId: 'player-1', zone: 'battlefield', instanceId: 'missing-card', position: { x: 0.1, y: 0.2, unit: 'ratio' } },
    ]));

    expect(result).toEqual({ status: 'resync_required', snapshot, reason: 'target_not_found' });
  });

  it('returns resync_required for invalid operations and keeps the original snapshot', () => {
    const snapshot = snapshotFixture();

    const result = applyGameSnapshotPatchOperations(snapshot, [
      {
        op: 'card.move',
        instanceId: 'hand-1',
        from: { playerId: 'player-1', zone: 'hand' },
        to: { playerId: 'player-1', zone: 'battlefield', index: -1 },
      },
    ]);

    expect(result).toEqual({ status: 'resync_required', snapshot, reason: 'invalid_operation' });
  });

  it('does not mutate the original snapshot', () => {
    const snapshot = snapshotFixture();
    const original = JSON.parse(JSON.stringify(snapshot)) as GameSnapshot;

    const result = applyGameSnapshotPatch(snapshot, patch([
      { op: 'player.life.set', playerId: 'player-1', value: 35 },
      {
        op: 'card.move',
        instanceId: 'hand-1',
        from: { playerId: 'player-1', zone: 'hand' },
        to: { playerId: 'player-1', zone: 'battlefield' },
      },
    ]));

    expect(result.status).toBe('applied');
    expect(snapshot).toEqual(original);
    expect(result.snapshot).not.toBe(snapshot);
    expect(result.snapshot.players['player-1']).not.toBe(snapshot.players['player-1']);
  });
});

function patch(
  operations: GameSnapshotPatchOperation[],
  overrides: Partial<Pick<GameplayGamePatchMessage, 'baseVersion' | 'version'>> = {},
): GameplayGamePatchMessage {
  return {
    kind: 'game_patch',
    gameId: 'game-1',
    baseVersion: overrides.baseVersion ?? 1,
    version: overrides.version ?? 2,
    operations,
  };
}

function snapshotFixture(): GameSnapshot {
  return {
    version: 1,
    ownerId: 'player-1',
    players: {
      'player-1': {
        user: { id: 'player-1', email: 'player1@example.test', displayName: 'Player 1', roles: [] },
        deckName: 'Deck 1',
        colorIdentity: ['G'],
        backgroundName: 'G_3',
        sleevesName: 'custom-sleeves',
        life: 40,
        zones: {
          library: [],
          hand: [card('hand-1', { zone: 'hand' })],
          battlefield: [
            card('battlefield-1', { zone: 'battlefield', position: { x: 0.1, y: 0.1, unit: 'ratio' } }),
            card('battlefield-2', { zone: 'battlefield', position: { x: 0.3, y: 0.3, unit: 'ratio' } }),
          ],
          graveyard: [card('graveyard-1', { zone: 'graveyard' })],
          exile: [],
          command: [card('commander-1', { zone: 'command', isCommander: true })],
        },
        zoneCounts: {
          library: 93,
          hand: 1,
          battlefield: 2,
          graveyard: 1,
          exile: 0,
          command: 1,
        },
        commanderDamage: {},
        counters: {},
      },
      'player-2': {
        user: { id: 'player-2', email: 'player2@example.test', displayName: 'Player 2', roles: [] },
        backgroundName: 'U_1',
        sleevesName: 'blue-sleeves',
        life: 40,
        zones: {
          library: [],
          hand: [],
          battlefield: [],
          graveyard: [],
          exile: [],
          command: [],
        },
        zoneCounts: {
          library: 99,
          hand: 0,
          battlefield: 0,
          graveyard: 0,
          exile: 0,
          command: 0,
        },
        commanderDamage: {},
        counters: {},
      },
    },
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    timer: { mode: 'none', status: 'idle', durationSeconds: null, remainingSeconds: null },
    stack: [],
    arrows: [],
    attachments: [],
    chat: [],
    eventLog: [{ id: 'log-1', type: 'game.started', message: 'Started', actorId: null, displayName: null, createdAt: '2026-01-01T00:00:00.000Z' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
  };
}

function card(instanceId: string, overrides: Partial<GameCardInstance> = {}): GameCardInstance {
  return {
    instanceId,
    ownerId: 'player-1',
    controllerId: 'player-1',
    name: instanceId,
    tapped: false,
    ...overrides,
  };
}
