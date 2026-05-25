import type { GameSnapshot, GameZoneName } from './game.model';
import {
  getGamePatchDecision,
} from './game-realtime.model';
import type {
  GameplayClientMessage,
  GameplayConnectionPresence,
  GameplayGamePatchMessage,
  GameplayServerMessage,
  GameSnapshotPatchOperation,
  RealtimeGameCommand,
} from './game-realtime.model';

describe('game realtime contract', () => {
  it('requires realtime commands to include clientActionId and baseVersion', () => {
    const command = {
      type: 'life.changed',
      payload: { playerId: 'player-1', delta: -1 },
      clientActionId: 'action-1',
      baseVersion: 7,
    } satisfies RealtimeGameCommand;

    const message = {
      kind: 'command',
      gameId: 'game-1',
      messageId: 'message-1',
      command,
    } satisfies GameplayClientMessage;

    expect(message.command.clientActionId).toBe('action-1');
    expect(message.command.baseVersion).toBe(7);
  });

  it('defines typed client and server message envelopes', () => {
    const ping = {
      kind: 'ping',
      gameId: 'game-1',
      messageId: 'ping-1',
      sentAt: '2026-01-01T00:00:00+00:00',
    } satisfies GameplayClientMessage;

    const messages = [
      {
        kind: 'command_ack',
        gameId: 'game-1',
        messageId: 'message-1',
        clientActionId: 'action-1',
        status: 'rejected',
        version: 8,
        error: {
          code: 'COMMAND_REJECTED',
          message: 'Command rejected',
          retryable: false,
        },
      },
      {
        kind: 'game_patch',
        gameId: 'game-1',
        baseVersion: 7,
        version: 8,
        clientActionId: 'action-1',
        operations: [
          {
            op: 'player.life.set',
            playerId: 'player-1',
            value: 39,
          },
        ],
      },
      {
        kind: 'resync_required',
        gameId: 'game-1',
        currentVersion: 9,
        reason: 'version_gap',
      },
      {
        kind: 'error',
        gameId: 'game-1',
        messageId: 'message-1',
        clientActionId: 'action-1',
        error: {
          code: 'COMMAND_REJECTED',
          message: 'Command rejected',
          retryable: false,
        },
      },
      {
        kind: 'pong',
        gameId: 'game-1',
        messageId: 'ping-1',
        serverTime: '2026-01-01T00:00:01+00:00',
      },
      {
        kind: 'connection_state',
        gameId: 'game-1',
        connectionId: 'connection-1',
        status: 'connected',
        serverTime: '2026-01-01T00:00:01+00:00',
      },
      {
        kind: 'connection_joined',
        gameId: 'game-1',
        connection: connectionPresence(),
      },
      {
        kind: 'connection_left',
        gameId: 'game-1',
        connection: connectionPresence(),
        leftAt: '2026-01-01T00:00:02+00:00',
      },
    ] satisfies GameplayServerMessage[];

    expect(ping.kind).toBe('ping');
    expect(messages.map((message) => message.kind)).toEqual([
      'command_ack',
      'game_patch',
      'resync_required',
      'error',
      'pong',
      'connection_state',
      'connection_joined',
      'connection_left',
    ]);
  });

  it('applies patches only when baseVersion matches the current snapshot version', () => {
    const patch = gamePatch({ baseVersion: 12, version: 13 });

    expect(getGamePatchDecision(12, patch)).toBe('apply');
  });

  it('uses game patches with clientActionId as the successful applied command ack', () => {
    const patch = {
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 12,
      version: 13,
      clientActionId: 'action-1',
      operations: [
        {
          op: 'player.life.set',
          playerId: 'player-1',
          value: 39,
        },
      ],
    } satisfies GameplayServerMessage;

    expect(patch.kind).toBe('game_patch');
    expect(patch.clientActionId).toBe('action-1');
  });

  it('ignores duplicate or late patches', () => {
    expect(getGamePatchDecision(12, gamePatch({ baseVersion: 11, version: 12 }))).toBe('ignore');
    expect(getGamePatchDecision(12, gamePatch({ baseVersion: 10, version: 9 }))).toBe('ignore');
  });

  it('requires resync when the patch baseVersion does not match the snapshot version', () => {
    expect(getGamePatchDecision(12, gamePatch({ baseVersion: 10, version: 13 }))).toBe('resync');
    expect(getGamePatchDecision(12, gamePatch({ baseVersion: 13, version: 14 }))).toBe('resync');
  });

  it('requires resync when patch version skips ahead even if baseVersion matches', () => {
    expect(getGamePatchDecision(12, gamePatch({ baseVersion: 12, version: 14 }))).toBe('resync');
    expect(getGamePatchDecision(12, gamePatch({ baseVersion: 12, version: 13 }))).toBe('apply');
  });

  it('keeps player sleeves and background as stable snapshot state', () => {
    const snapshot = snapshotFixture();

    expect(snapshot.players['player-1'].sleevesName).toBe('custom-sleeves');
    expect(snapshot.players['player-1'].backgroundName).toBe('G_3');
  });

  it('defines card position patches by instanceId and preserves ratio coordinates', () => {
    const operation = {
      op: 'card.position.set',
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      position: { x: 0.42, y: 0.31, unit: 'ratio' },
    } satisfies GameSnapshotPatchOperation;

    expect(operation.instanceId).toBe('card-1');
    expect(operation.position).toEqual({ x: 0.42, y: 0.31, unit: 'ratio' });
  });

  it('defines card move patches by player, zone and instanceId instead of paths', () => {
    const zone: GameZoneName = 'battlefield';
    const operation = {
      op: 'card.move',
      instanceId: 'card-1',
      from: { playerId: 'player-1', zone: 'hand' },
      to: { playerId: 'player-1', zone, index: 0 },
      card: {
        instanceId: 'card-1',
        ownerId: 'player-1',
        controllerId: 'player-1',
        name: 'Silvercoat Lion',
        tapped: false,
        zone,
      },
      zoneCounts: { hand: 6, battlefield: 1 },
    } satisfies GameSnapshotPatchOperation;

    expect(operation.from).toEqual({ playerId: 'player-1', zone: 'hand' });
    expect(operation.to).toEqual({ playerId: 'player-1', zone: 'battlefield', index: 0 });
  });

  it('defines advanced card patches without full snapshots', () => {
    const projection = {
      op: 'card.projection.set',
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      card: {
        instanceId: 'card-1',
        ownerId: 'player-1',
        controllerId: 'player-1',
        name: 'Face-down card',
        tapped: false,
        hidden: true,
        faceDown: true,
        zone: 'battlefield',
      },
    } satisfies GameSnapshotPatchOperation;
    const counters = {
      op: 'card.counters.set',
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      counters: { charge: 2 },
    } satisfies GameSnapshotPatchOperation;
    const stats = {
      op: 'card.stats.set',
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      power: 3,
      toughness: 4,
    } satisfies GameSnapshotPatchOperation;
    const batchState = {
      op: 'cards.state.set',
      playerId: 'player-1',
      zone: 'battlefield',
      cards: [{ instanceId: 'card-1', tapped: false, rotation: 0 }],
    } satisfies GameSnapshotPatchOperation;
    const create = {
      op: 'card.create',
      playerId: 'player-1',
      zone: 'battlefield',
      card: {
        instanceId: 'token-1',
        ownerId: 'player-1',
        controllerId: 'player-1',
        name: 'Token',
        tapped: false,
        isToken: true,
        zone: 'battlefield',
      },
    } satisfies GameSnapshotPatchOperation;
    const remove = {
      op: 'card.remove',
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'token-1',
    } satisfies GameSnapshotPatchOperation;

    expect(projection.op).toBe('card.projection.set');
    expect(counters.counters).toEqual({ charge: 2 });
    expect(stats.power).toBe(3);
    expect(batchState.cards).toHaveLength(1);
    expect(create.card.isToken).toBe(true);
    expect(remove.instanceId).toBe('token-1');
  });

  it('defines zone count patches without sending cards or zones', () => {
    const operation = {
      op: 'zone.counts.set',
      playerId: 'player-1',
      counts: { hand: 6, library: 92 },
    } satisfies GameSnapshotPatchOperation;

    expect(operation.counts).toEqual({ hand: 6, library: 92 });
    expect(Object.keys(operation)).toEqual(['op', 'playerId', 'counts']);
  });

  it('defines projected visible zone patches for hidden zone views', () => {
    const operation = {
      op: 'zone.visible.set',
      playerId: 'player-1',
      zone: 'library',
      cards: [{
        instanceId: 'library-1',
        ownerId: 'player-1',
        controllerId: 'player-1',
        name: 'Visible Top',
        tapped: false,
        zone: 'library',
      }],
    } satisfies GameSnapshotPatchOperation;

    expect(operation.zone).toBe('library');
    expect(operation.cards.map((card) => card.instanceId)).toEqual(['library-1']);
  });

  it('defines player library visibility patches without sending library order', () => {
    const operation = {
      op: 'player.library.visibility.set',
      playerId: 'player-1',
      playTopLibraryRevealed: true,
      revealedLibraryTo: ['all'],
    } satisfies GameSnapshotPatchOperation;

    expect(operation.playTopLibraryRevealed).toBe(true);
    expect(operation.revealedLibraryTo).toEqual(['all']);
  });

  it('defines small stack, relation and player status patches', () => {
    const operations = [
      {
        op: 'stack.item.add',
        item: { id: 'stack-1', kind: 'card', createdAt: '2026-01-01T00:00:00+00:00' },
      },
      {
        op: 'stack.item.remove',
        id: 'stack-1',
      },
      {
        op: 'arrow.add',
        arrow: { id: 'arrow-1', ownerId: 'player-1', fromInstanceId: 'card-1', toInstanceId: 'card-2', color: 'yellow', createdAt: '2026-01-01T00:00:00+00:00' },
      },
      {
        op: 'arrow.remove',
        id: 'arrow-1',
      },
      {
        op: 'attachment.add',
        attachment: { id: 'attachment-1', ownerId: 'player-1', equipmentInstanceId: 'card-1', attachedToInstanceId: 'card-2', createdAt: '2026-01-01T00:00:00+00:00' },
      },
      {
        op: 'attachment.remove',
        id: 'attachment-1',
      },
      {
        op: 'player.status.set',
        playerId: 'player-1',
        status: 'conceded',
        concededAt: '2026-01-01T00:00:00+00:00',
      },
    ] satisfies GameSnapshotPatchOperation[];

    expect(operations.map((operation) => operation.op)).toEqual([
      'stack.item.add',
      'stack.item.remove',
      'arrow.add',
      'arrow.remove',
      'attachment.add',
      'attachment.remove',
      'player.status.set',
    ]);
  });

  it('defines turn and timer patches without requiring a full snapshot', () => {
    const turnOperation = {
      op: 'turn.set',
      turn: { activePlayerId: 'player-2', phase: 'combat', number: 3 },
    } satisfies GameSnapshotPatchOperation;
    const timerOperation = {
      op: 'timer.set',
      timer: {
        mode: 'turn',
        status: 'running',
        durationSeconds: 120,
        remainingSeconds: 90,
      },
    } satisfies GameSnapshotPatchOperation;

    expect(turnOperation.turn.phase).toBe('combat');
    expect(timerOperation.timer?.remainingSeconds).toBe(90);
  });
});

// @ts-expect-error RealtimeGameCommand requires clientActionId and baseVersion.
const commandMissingRealtimeFields = { type: 'life.changed', payload: { playerId: 'player-1', delta: -1 } } satisfies RealtimeGameCommand;
void commandMissingRealtimeFields;

// @ts-expect-error command_ack success is represented by game_patch with clientActionId, not accepted status.
const acceptedCommandAck = { kind: 'command_ack', gameId: 'game-1', clientActionId: 'action-1', status: 'accepted', version: 8 } satisfies GameplayServerMessage;
void acceptedCommandAck;

// @ts-expect-error gameplay patches are typed domain operations, not JSON Pointer operations.
const jsonPointerPatchOperation = { op: 'replace', path: '/players/player-1/life', value: 39 } satisfies GameSnapshotPatchOperation;
void jsonPointerPatchOperation;

function gamePatch(versions: Pick<GameplayGamePatchMessage, 'baseVersion' | 'version'>): GameplayGamePatchMessage {
  return {
    kind: 'game_patch',
    gameId: 'game-1',
    operations: [],
    ...versions,
  };
}

function snapshotFixture(): GameSnapshot {
  return {
    version: 12,
    ownerId: 'player-1',
    players: {
      'player-1': {
        user: { id: 'player-1', email: 'player-1@example.test', displayName: 'Player 1', roles: [] },
        deckName: 'Test Deck',
        colorIdentity: ['G'],
        backgroundName: 'G_3',
        sleevesName: 'custom-sleeves',
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
          exile: 1,
          command: 1,
        },
        commanderDamage: {},
        counters: {},
      },
    },
    turn: { activePlayerId: 'player-1', phase: 'main', number: 1 },
    stack: [],
    arrows: [],
    attachments: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-01-01T00:00:00+00:00',
    updatedAt: '2026-01-01T00:01:00+00:00',
  };
}

function connectionPresence(): GameplayConnectionPresence {
  return {
    connectionId: 'connection-1',
    gameId: 'game-1',
    userId: 'player-1',
    displayName: 'Player 1',
    connectedAt: '2026-01-01T00:00:00+00:00',
  };
}
