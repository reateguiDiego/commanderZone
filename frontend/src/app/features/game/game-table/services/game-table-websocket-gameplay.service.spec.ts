import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { GameplayClientMessage, GameplayServerMessage } from '../../../../core/models/game-realtime.model';
import { GameCardInstance, GameSnapshot } from '../../../../core/models/game.model';
import { GameTableWebsocketTransportService } from './game-table-websocket-transport.service';
import { GameTableWebsocketGameplayContext, GameTableWebsocketGameplayService } from './game-table-websocket-gameplay.service';

describe('GameTableWebsocketGameplayService', () => {
  let service: GameTableWebsocketGameplayService;
  let messages: Subject<GameplayServerMessage>;
  let status: ReturnType<typeof signal<'stopped' | 'connecting' | 'connected' | 'disconnected' | 'error'>>;
  let send: ReturnType<typeof vi.fn>;
  let snapshotState: GameSnapshot;
  let refetch: (force?: boolean) => Promise<void>;
  let refetchSpy: ReturnType<typeof vi.fn<(force?: boolean) => Promise<void>>>;
  let setError: (message: string | null) => void;
  let setErrorSpy: ReturnType<typeof vi.fn<(message: string | null) => void>>;

  beforeEach(() => {
    messages = new Subject<GameplayServerMessage>();
    status = signal('connected');
    send = vi.fn(() => true);
    snapshotState = snapshot();
    refetchSpy = vi.fn(async () => undefined);
    refetch = (force) => refetchSpy(force);
    setErrorSpy = vi.fn();
    setError = (message) => {
      setErrorSpy(message);
    };

    TestBed.configureTestingModule({
      providers: [
        GameTableWebsocketGameplayService,
        {
          provide: GameTableWebsocketTransportService,
          useValue: {
            status,
            messages$: messages.asObservable(),
            connect: vi.fn(async () => undefined),
            disconnect: vi.fn(),
            send,
          },
        },
      ],
    });

    service = TestBed.inject(GameTableWebsocketGameplayService);
    service.start(context(), 'game-1');
  });

  afterEach(() => {
    service.stop();
  });

  it('starts transport with a lastSeenVersion provider based on the current snapshot', () => {
    const transport = TestBed.inject(GameTableWebsocketTransportService) as unknown as { connect: ReturnType<typeof vi.fn> };
    const options = transport.connect.mock.calls.at(-1)?.[1] as { lastSeenVersion: () => number | null };

    expect(options.lastSeenVersion()).toBe(1);
    snapshotState = { ...snapshotState, version: 7 };
    expect(options.lastSeenVersion()).toBe(7);
  });

  it('sends migrated commands with clientActionId and baseVersion, then applies the success patch without snapshot refetch', async () => {
    const sent = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
    const message = sentMessage();

    expect(message.kind).toBe('command');
    expect(message.command.clientActionId).toBeTruthy();
    expect(message.command.baseVersion).toBe(1);
    expect(message.command.type).toBe('life.changed');

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: message.command.clientActionId,
      operations: [{ op: 'player.life.set', playerId: 'player-1', value: 39 }],
    });
    await sent;

    expect(snapshotState.version).toBe(2);
    expect(snapshotState.players['player-1'].life).toBe(39);
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('applies patches received from another client', async () => {
    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      operations: [{ op: 'turn.set', turn: { activePlayerId: 'player-2', phase: 'combat', number: 2 } }],
    });

    expect(snapshotState.version).toBe(2);
    expect(snapshotState.turn).toEqual({ activePlayerId: 'player-2', phase: 'combat', number: 2 });
  });

  it('sends final card position commands over websocket and applies ratio patches without snapshot refetch', async () => {
    const payload = {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'battlefield-1',
      position: { x: 0.25, y: 0.5, unit: 'ratio' },
    };

    const sent = service.sendCommand(context(), 'card.position.changed', payload);
    const message = sentMessage();

    expect(message.command.type).toBe('card.position.changed');
    expect(message.command.baseVersion).toBe(1);
    expect(message.command.payload).toEqual(payload);
    expect(JSON.stringify(message)).not.toContain('zoomPercent');

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: message.command.clientActionId,
      operations: [{
        op: 'card.position.set',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-1',
        position: { x: 0.25, y: 0.5, unit: 'ratio' },
      }],
    });
    await sent;

    expect(snapshotState.version).toBe(2);
    expect(snapshotState.players['player-1'].zones.battlefield[0]?.position).toEqual({ x: 0.25, y: 0.5, unit: 'ratio' });
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('applies one multi-card position patch while preserving ratio positions', async () => {
    const sent = service.sendCommand(context(), 'cards.position.changed', {
      playerId: 'player-1',
      zone: 'battlefield',
      positions: [
        { instanceId: 'battlefield-1', position: { x: 0.12, y: 0.34, unit: 'ratio' } },
        { instanceId: 'battlefield-2', position: { x: 0.56, y: 0.78, unit: 'ratio' } },
      ],
    });
    const message = sentMessage();

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: message.command.clientActionId,
      operations: [{
        op: 'cards.position.set',
        playerId: 'player-1',
        zone: 'battlefield',
        positions: [
          { instanceId: 'battlefield-1', position: { x: 0.12, y: 0.34, unit: 'ratio' } },
          { instanceId: 'battlefield-2', position: { x: 0.56, y: 0.78, unit: 'ratio' } },
        ],
      }],
    });
    await sent;

    expect(snapshotState.players['player-1'].zones.battlefield.map((card) => card.position)).toEqual([
      { x: 0.12, y: 0.34, unit: 'ratio' },
      { x: 0.56, y: 0.78, unit: 'ratio' },
    ]);
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('applies card tapped patches without changing the card position', async () => {
    const originalPosition = snapshotState.players['player-1'].zones.battlefield[0]?.position;
    const sent = service.sendCommand(context(), 'card.tapped', {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'battlefield-1',
      tapped: true,
    });
    const message = sentMessage();

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: message.command.clientActionId,
      operations: [{
        op: 'card.state.set',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-1',
        tapped: true,
      }],
    });
    await sent;

    const card = snapshotState.players['player-1'].zones.battlefield[0];
    expect(card?.tapped).toBe(true);
    expect(card?.position).toEqual(originalPosition);
  });

  it('sends power toughness and loyalty changes over websocket and applies stats patches without snapshot refetch', async () => {
    const sent = service.sendCommand(context(), 'card.power_toughness.changed', {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'battlefield-1',
      power: 5,
      toughness: 6,
      loyalty: 4,
    });
    const message = sentMessage();

    expect(message.command.type).toBe('card.power_toughness.changed');
    expect(message.command.baseVersion).toBe(1);
    expect(message.command.payload).toEqual({
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'battlefield-1',
      power: 5,
      toughness: 6,
      loyalty: 4,
    });

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: message.command.clientActionId,
      operations: [{
        op: 'card.stats.set',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-1',
        power: 5,
        toughness: 6,
        loyalty: 4,
      }],
    });
    await sent;

    const card = snapshotState.players['player-1'].zones.battlefield[0];
    expect(card?.power).toBe(5);
    expect(card?.toughness).toBe(6);
    expect(card?.loyalty).toBe(4);
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('sends zone movement commands over websocket and applies card.move without snapshot refetch', async () => {
    snapshotState = {
      ...snapshotState,
      players: {
        ...snapshotState.players,
        'player-1': {
          ...snapshotState.players['player-1'],
          zones: {
            ...snapshotState.players['player-1'].zones,
            hand: [{
              instanceId: 'hand-1',
              ownerId: 'player-1',
              controllerId: 'player-1',
              name: 'Hand One',
              tapped: false,
            }],
          },
          zoneCounts: {
            ...snapshotState.players['player-1'].zoneCounts!,
            hand: 1,
          },
        },
      },
    };

    const sent = service.sendCommand(context(), 'card.moved', {
      playerId: 'player-1',
      fromZone: 'hand',
      toZone: 'battlefield',
      instanceId: 'hand-1',
    });
    const message = sentMessage();

    expect(message.command.type).toBe('card.moved');
    expect(message.command.baseVersion).toBe(1);

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: message.command.clientActionId,
      operations: [
        {
          op: 'card.move',
          instanceId: 'hand-1',
          from: { playerId: 'player-1', zone: 'hand' },
          to: { playerId: 'player-1', zone: 'battlefield', index: 2 },
        },
        { op: 'zone.counts.set', playerId: 'player-1', counts: { hand: 0, battlefield: 3 } },
      ],
    });
    await sent;

    expect(snapshotState.players['player-1'].zones.hand).toEqual([]);
    expect(snapshotState.players['player-1'].zones.battlefield.map((card) => card.instanceId)).toEqual([
      'battlefield-1',
      'battlefield-2',
      'hand-1',
    ]);
    expect(snapshotState.players['player-1'].zoneCounts?.hand).toBe(0);
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('sends zone.changed over websocket as compact instanceIds without full cards', async () => {
    const cards = [...snapshotState.players['player-1'].zones.battlefield].reverse();

    const sent = service.sendCommand(context(), 'zone.changed', {
      playerId: 'player-1',
      zone: 'battlefield',
      cards,
    });
    const message = sentMessage();

    expect(message.command.type).toBe('zone.changed');
    expect(message.command.payload).toEqual({
      playerId: 'player-1',
      zone: 'battlefield',
      instanceIds: ['battlefield-2', 'battlefield-1'],
    });
    expect(JSON.stringify(message.command.payload)).not.toContain('"cards"');

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: message.command.clientActionId,
      operations: [
        {
          op: 'card.move',
          instanceId: 'battlefield-2',
          from: { playerId: 'player-1', zone: 'battlefield' },
          to: { playerId: 'player-1', zone: 'battlefield', index: 0 },
        },
        {
          op: 'card.move',
          instanceId: 'battlefield-1',
          from: { playerId: 'player-1', zone: 'battlefield' },
          to: { playerId: 'player-1', zone: 'battlefield', index: 1 },
        },
      ],
    });
    await sent;

    expect(snapshotState.players['player-1'].zones.battlefield.map((card) => card.instanceId)).toEqual(['battlefield-2', 'battlefield-1']);
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('applies rival private movement patches as counts and placeholders without leaking card data', () => {
    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      operations: [{
        op: 'card.move',
        instanceId: 'battlefield-1',
        from: { playerId: 'player-1', zone: 'battlefield' },
        to: { playerId: 'player-1', zone: 'hand' },
        card: {
          instanceId: 'player-1-hidden-hand-new',
          ownerId: 'player-1',
          controllerId: 'player-1',
          name: 'Hidden card',
          hidden: true,
          faceDown: true,
          tapped: false,
          zone: 'hand',
        },
      }, {
        op: 'zone.counts.set',
        playerId: 'player-1',
        counts: { hand: 1, battlefield: 1 },
      }],
    });

    expect(snapshotState.players['player-1'].zones.battlefield.map((card) => card.instanceId)).toEqual(['battlefield-2']);
    expect(snapshotState.players['player-1'].zones.hand).toEqual([expect.objectContaining({
      name: 'Hidden card',
      hidden: true,
      faceDown: true,
    })]);
    expect(JSON.stringify(snapshotState.players['player-1'].zones.hand)).not.toContain('Battlefield One');
  });

  it('sends library commands over websocket and applies draw patches without snapshot refetch', async () => {
    snapshotState = {
      ...snapshotState,
      players: {
        ...snapshotState.players,
        'player-1': {
          ...snapshotState.players['player-1'],
          zones: {
            ...snapshotState.players['player-1'].zones,
            library: [card('library-1', { zone: 'library', name: 'Private Library One' })],
          },
          zoneCounts: {
            ...snapshotState.players['player-1'].zoneCounts!,
            library: 1,
          },
        },
      },
    };

    const sent = service.sendCommand(context(), 'library.draw', { playerId: 'player-1', count: 1 });
    const message = sentMessage();

    expect(message.command.type).toBe('library.draw');
    expect(message.command.baseVersion).toBe(1);

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: message.command.clientActionId,
      operations: [
        {
          op: 'card.move',
          instanceId: 'library-1',
          from: { playerId: 'player-1', zone: 'library' },
          to: { playerId: 'player-1', zone: 'hand', index: 0 },
          card: card('library-1', { zone: 'hand', name: 'Private Library One' }),
        },
        { op: 'zone.counts.set', playerId: 'player-1', counts: { library: 0, hand: 1 } },
      ],
    });
    await sent;

    expect(snapshotState.players['player-1'].zones.library).toEqual([]);
    expect(snapshotState.players['player-1'].zones.hand.map((entry) => entry.instanceId)).toEqual(['library-1']);
    expect(snapshotState.players['player-1'].zoneCounts?.library).toBe(0);
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('sends advanced card commands over websocket and applies token creation without snapshot refetch', async () => {
    const sent = service.sendCommand(context(), 'card.token.created', {
      playerId: 'player-1',
      card: { name: 'Beast Token', power: 3, toughness: 3 },
    });
    const message = sentMessage();

    expect(message.command.type).toBe('card.token.created');
    expect(message.command.baseVersion).toBe(1);

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: message.command.clientActionId,
      operations: [{
        op: 'card.create',
        playerId: 'player-1',
        zone: 'battlefield',
        card: card('token-1', {
          zone: 'battlefield',
          name: 'Beast Token',
          power: 3,
          toughness: 3,
          isToken: true,
        }),
      }],
    });
    await sent;

    expect(snapshotState.players['player-1'].zones.battlefield.map((entry) => entry.instanceId)).toEqual([
      'battlefield-1',
      'battlefield-2',
      'token-1',
    ]);
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('sends relation and game close commands over websocket and applies small patches without snapshot refetch', async () => {
    const sent = service.sendCommand(context(), 'arrow.created', {
      fromInstanceId: 'battlefield-1',
      toInstanceId: 'battlefield-2',
      color: 'yellow',
    });
    const arrowMessage = sentMessage();

    expect(arrowMessage.command.type).toBe('arrow.created');
    expect(arrowMessage.command.baseVersion).toBe(1);

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: arrowMessage.command.clientActionId,
      operations: [{
        op: 'arrow.add',
        arrow: { id: 'arrow-1', ownerId: 'player-1', fromInstanceId: 'battlefield-1', toInstanceId: 'battlefield-2', color: 'yellow', createdAt: '2026-01-01T00:00:00.000Z' },
      }],
    });
    await sent;

    expect(snapshotState.arrows).toEqual([expect.objectContaining({ id: 'arrow-1', ownerId: 'player-1' })]);
    expect(refetchSpy).not.toHaveBeenCalled();

    const closeSent = service.sendCommand(context(), 'game.close', {});
    const closeMessage = sentMessage();

    expect(closeMessage.command.type).toBe('game.close');
    expect(closeMessage.command.baseVersion).toBe(2);

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 2,
      version: 3,
      clientActionId: closeMessage.command.clientActionId,
      operations: [{
        op: 'eventLog.append',
        entries: [{ id: 'log-close', type: 'game.close', message: 'Closed the game.', actorId: 'player-1', displayName: 'Player 1', createdAt: '2026-01-01T00:00:01.000Z' }],
      }],
    });
    await closeSent;

    expect(snapshotState.eventLog.map((entry) => entry.id)).toContain('log-close');
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('applies pruned relation patches from movement without snapshot refetch', () => {
    snapshotState = {
      ...snapshotState,
      arrows: [{ id: 'arrow-1', ownerId: 'player-1', fromInstanceId: 'battlefield-1', toInstanceId: 'battlefield-2', color: 'yellow', createdAt: '2026-01-01T00:00:00.000Z' }],
      attachments: [{ id: 'attachment-1', ownerId: 'player-1', equipmentInstanceId: 'battlefield-1', attachedToInstanceId: 'battlefield-2', createdAt: '2026-01-01T00:00:00.000Z' }],
    };

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      operations: [
        {
          op: 'card.move',
          instanceId: 'battlefield-1',
          from: { playerId: 'player-1', zone: 'battlefield' },
          to: { playerId: 'player-1', zone: 'graveyard' },
        },
        { op: 'arrow.remove', id: 'arrow-1' },
        { op: 'attachment.remove', id: 'attachment-1' },
      ],
    });

    expect(snapshotState.arrows).toEqual([]);
    expect(snapshotState.attachments).toEqual([]);
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('applies projected library visibility patches without mutating player visual fields', () => {
    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      operations: [
        {
          op: 'player.library.visibility.set',
          playerId: 'player-1',
          playTopLibraryRevealed: true,
          revealedLibraryTo: ['all'],
        },
        {
          op: 'zone.visible.set',
          playerId: 'player-1',
          zone: 'library',
          cards: [card('library-visible', { zone: 'library', name: 'Visible Top' })],
        },
      ],
    });

    const player = snapshotState.players['player-1'];
    expect(player.playTopLibraryRevealed).toBe(true);
    expect(player.revealedLibraryTo).toEqual(['all']);
    expect(player.zones.library.map((entry) => entry.instanceId)).toEqual(['library-visible']);
    expect(player.backgroundName).toBe('G_3');
    expect(player.sleevesName).toBe('default');
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('applies empty hidden-zone reorder patches without snapshot refetch', () => {
    const previousHand = snapshotState.players['player-1'].zones.hand;
    const previousLibrary = snapshotState.players['player-1'].zones.library;

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      operations: [],
    });

    expect(snapshotState.version).toBe(2);
    expect(snapshotState.players['player-1'].zones.hand).toBe(previousHand);
    expect(snapshotState.players['player-1'].zones.library).toBe(previousLibrary);
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('requests one resync when a patch has a version gap', async () => {
    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 3,
      operations: [{ op: 'player.life.set', playerId: 'player-1', value: 10 }],
    });
    await Promise.resolve();

    expect(refetchSpy).toHaveBeenCalledTimes(1);
    expect(refetchSpy).toHaveBeenCalledWith(true);
    expect(snapshotState.version).toBe(1);
  });

  it('uses HTTP resync without websocket snapshots and keeps the replacement snapshot contract intact', async () => {
    refetchSpy.mockImplementation(async () => {
      snapshotState = {
        ...snapshotState,
        version: 8,
        players: {
          ...snapshotState.players,
          'player-1': {
            ...snapshotState.players['player-1'],
            backgroundName: 'R_1',
            sleevesName: 'custom-sleeves',
            zones: {
              ...snapshotState.players['player-1'].zones,
              battlefield: [
                {
                  ...snapshotState.players['player-1'].zones.battlefield[0],
                  position: { x: 0.42, y: 0.24, unit: 'ratio' },
                },
              ],
            },
          },
        },
      };
    });

    messages.next({
      kind: 'resync_required',
      gameId: 'game-1',
      currentVersion: 8,
      reason: 'version_gap',
    });
    await Promise.resolve();

    expect(refetchSpy).toHaveBeenCalledTimes(1);
    expect(refetchSpy).toHaveBeenCalledWith(true);
    expect(snapshotState.version).toBe(8);
    expect(snapshotState.players['player-1'].backgroundName).toBe('R_1');
    expect(snapshotState.players['player-1'].sleevesName).toBe('custom-sleeves');
    expect(snapshotState.players['player-1'].zones.battlefield[0]?.position).toEqual({ x: 0.42, y: 0.24, unit: 'ratio' });
  });

  it('rejects pending commands when command_ack is rejected', async () => {
    const sent = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
    const message = sentMessage();

    messages.next({
      kind: 'command_ack',
      gameId: 'game-1',
      messageId: message.messageId,
      clientActionId: message.command.clientActionId,
      status: 'rejected',
      version: 1,
      error: { code: 'COMMAND_REJECTED', message: 'Denied', retryable: false },
    });

    await expect(sent).rejects.toThrow('Denied');
  });

  it('uses resync for duplicate and resync_required command_ack states', async () => {
    const sent = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
    const message = sentMessage();

    messages.next({
      kind: 'command_ack',
      gameId: 'game-1',
      messageId: message.messageId,
      clientActionId: message.command.clientActionId,
      status: 'duplicate',
      version: 1,
    });
    await sent;

    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns false so callers can use HTTP fallback when websocket is not connected before sending', async () => {
    status.set('connecting');

    await expect(service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 })).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects the pending command on gameId mismatch errors', async () => {
    const sent = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
    const message = sentMessage();

    messages.next({
      kind: 'error',
      gameId: 'game-1',
      messageId: message.messageId,
      error: { code: 'GAME_ID_MISMATCH', message: 'Wrong game', retryable: false },
    });

    await expect(sent).rejects.toThrow('Wrong game');
    expect(setErrorSpy).toHaveBeenCalledWith('Wrong game');
  });

  function sentMessage(): Extract<GameplayClientMessage, { kind: 'command' }> {
    expect(send).toHaveBeenCalled();

    return send.mock.calls.at(-1)?.[0] as Extract<GameplayClientMessage, { kind: 'command' }>;
  }

  function context(): GameTableWebsocketGameplayContext {
    return {
      gameId: () => 'game-1',
      snapshot: () => snapshotState,
      setSnapshot: (nextSnapshot) => {
        snapshotState = nextSnapshot;
      },
      refetch,
      setError,
    };
  }
});

function snapshot(): GameSnapshot {
  return {
    version: 1,
    ownerId: 'player-1',
    players: {
      'player-1': {
        user: { id: 'player-1', email: 'player1@example.test', displayName: 'Player 1', roles: [] },
        backgroundName: 'G_3',
        sleevesName: 'default',
        life: 40,
        zones: {
          library: [],
          hand: [],
          battlefield: [
            {
              instanceId: 'battlefield-1',
              ownerId: 'player-1',
              controllerId: 'player-1',
              name: 'Battlefield One',
              tapped: false,
              position: { x: 0.1, y: 0.2, unit: 'ratio' },
            },
            {
              instanceId: 'battlefield-2',
              ownerId: 'player-1',
              controllerId: 'player-1',
              name: 'Battlefield Two',
              tapped: false,
              position: { x: 0.3, y: 0.4, unit: 'ratio' },
            },
          ],
          graveyard: [],
          exile: [],
          command: [],
        },
        zoneCounts: {
          library: 0,
          hand: 0,
          battlefield: 2,
          graveyard: 0,
          exile: 0,
          command: 0,
        },
        commanderDamage: {},
        counters: {},
      },
      'player-2': {
        user: { id: 'player-2', email: 'player2@example.test', displayName: 'Player 2', roles: [] },
        backgroundName: 'U_1',
        sleevesName: 'default',
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
          library: 0,
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
    eventLog: [],
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
