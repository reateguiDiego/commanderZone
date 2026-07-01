import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { CardsApi } from '../../../../core/api/cards.api';
import type { Card } from '../../../../core/models/card.model';
import { BootstrapV2, PatchEnvelopeV2 } from '../../../../core/models/game-v2.model';
import { GameplayClientMessage, GameplayServerMessage } from '../../../../core/models/game-realtime.model';
import { GameCardInstance, GameSnapshot } from '../../../../core/models/game.model';
import { GameTableRealtimeAnimationBusService } from './game-table-realtime-animation-bus.service';
import { GameTableGameplayV2FlagsService } from './game-table-gameplay-v2-flags.service';
import { GameTableWebsocketTransportService } from './game-table-websocket-transport.service';
import { GameTableWebsocketGameplayContext, GameTableWebsocketGameplayService } from './game-table-websocket-gameplay.service';
import { GameTableNormalizedV2Store } from '../state/realtime/game-table-normalized-v2.store';

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
  let onCommandBlockedSpy: ReturnType<typeof vi.fn<(reason: string, type: string, payload: Record<string, unknown>) => void>>;
  let onMulliganPatchV2AppliedSpy: ReturnType<typeof vi.fn<(patch: PatchEnvelopeV2 & { kind: 'patch.v2' }, snapshot: GameSnapshot) => void>>;
  let broadcastChannels: FakeBroadcastChannel[];
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  const gameplayV2Flags = {
    enabled: vi.fn(() => false),
  };
  const cardsApi = {
    getSilently: vi.fn(),
  };

  beforeEach(() => {
    broadcastChannels = [];
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: class extends FakeBroadcastChannel {
        constructor(name: string) {
          super(name, broadcastChannels);
        }
      },
    });

    messages = new Subject<GameplayServerMessage>();
    cardsApi.getSilently.mockReset();
    gameplayV2Flags.enabled.mockReset();
    gameplayV2Flags.enabled.mockReturnValue(false);
    status = signal('connected');
    send = vi.fn(() => true);
    snapshotState = snapshot();
    refetchSpy = vi.fn(async () => undefined);
    refetch = (force) => refetchSpy(force);
    setErrorSpy = vi.fn();
    setError = (message) => {
      setErrorSpy(message);
    };
    onCommandBlockedSpy = vi.fn<(reason: string, type: string, payload: Record<string, unknown>) => void>();
    onMulliganPatchV2AppliedSpy = vi.fn<(patch: PatchEnvelopeV2 & { kind: 'patch.v2' }, snapshot: GameSnapshot) => void>();
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    TestBed.configureTestingModule({
      providers: [
        GameTableWebsocketGameplayService,
        GameTableRealtimeAnimationBusService,
        GameTableNormalizedV2Store,
        { provide: CardsApi, useValue: cardsApi },
        { provide: GameTableGameplayV2FlagsService, useValue: gameplayV2Flags },
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
    consoleDebugSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: originalBroadcastChannel,
    });
  });

  it('starts transport with a lastAppliedVersion provider based on the current snapshot', () => {
    const transport = TestBed.inject(GameTableWebsocketTransportService) as unknown as { connect: ReturnType<typeof vi.fn> };
    const options = transport.connect.mock.calls.at(-1)?.[1] as { lastAppliedVersion: () => number | null };

    expect(options.lastAppliedVersion()).toBe(1);
    snapshotState = { ...snapshotState, version: 7 };
    expect(options.lastAppliedVersion()).toBe(7);
  });

  it('uses normalized v2 lastAppliedVersion for runtime websocket reconnects when initialized', () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    const normalizedStore = TestBed.inject(GameTableNormalizedV2Store);
    normalizedStore.applyBootstrap(bootstrapV2());
    const transport = TestBed.inject(GameTableWebsocketTransportService) as unknown as { connect: ReturnType<typeof vi.fn> };
    const options = transport.connect.mock.calls.at(-1)?.[1] as { lastAppliedVersion: () => number | null };

    expect(options.lastAppliedVersion()).toBe(1);
    normalizedStore.applyPatch({
      gameId: 'game-1',
      version: 2,
      visibility: 'player:player-1',
      ops: [{ op: 'player.life.set', playerId: 'player-1', value: 38 }],
    });

    expect(options.lastAppliedVersion()).toBe(2);
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

  it('sends command.v2 and applies patch.v2 when the frontend v2 flag is enabled', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    const normalizedStore = TestBed.inject(GameTableNormalizedV2Store);
    normalizedStore.applyBootstrap(bootstrapV2());

    const sent = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -2 });
    const message = sentMessage<Extract<GameplayClientMessage, { kind: 'command.v2' }>>();

    expect(message.kind).toBe('command.v2');
    expect(message.clientActionId).toBeTruthy();
    expect(message.baseVersion).toBe(1);

    const patch: PatchEnvelopeV2 & { kind: 'patch.v2' } = {
      kind: 'patch.v2',
      gameId: 'game-1',
      version: 2,
      visibility: 'player:player-1',
      ackClientActionId: message.clientActionId,
      ops: [{ op: 'player.life.set', playerId: 'player-1', value: 38 }],
    };
    messages.next(patch);
    await sent;

    expect(snapshotState.version).toBe(2);
    expect(snapshotState.players['player-1'].life).toBe(38);
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('resolves visible private runtime card cache misses without snapshot refetch', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    cardsApi.getSilently.mockReturnValue(of({ card: catalogCard('runtime-print-forest', 'Runtime Forest') }));
    const normalizedStore = TestBed.inject(GameTableNormalizedV2Store);
    normalizedStore.applyBootstrap(bootstrapV2());

    messages.next({
      kind: 'patch.v2',
      gameId: 'game-1',
      version: 2,
      visibility: 'player:player-1',
      ops: [
        { op: 'zone.cards.remove', playerId: 'player-1', zone: 'library', instanceIds: ['library-1'] },
        {
          op: 'zone.cards.add',
          playerId: 'player-1',
          zone: 'hand',
          cards: [{
            instanceId: 'library-1',
            cardKey: 'runtime-card-forest',
            printId: 'runtime-print-forest',
            cardVersion: 'forest-v1',
            language: 'en',
            viewerVisibility: 'private',
            ownerId: 'player-1',
            controllerId: 'player-1',
          }],
        },
        { op: 'zone.count.set', playerId: 'player-1', zone: 'library', count: 0 },
        { op: 'zone.count.set', playerId: 'player-1', zone: 'hand', count: 1 },
      ],
    });

    await vi.waitFor(() => expect(snapshotState.version).toBe(2));

    expect(cardsApi.getSilently).toHaveBeenCalledWith('runtime-print-forest');
    expect(snapshotState.players['player-1'].zones.hand[0]).toMatchObject({
      instanceId: 'library-1',
      scryfallId: 'runtime-print-forest',
      name: 'Runtime Forest',
      imageUris: { normal: 'https://cards.test/runtime-print-forest.jpg' },
    });
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('does not loop refetches when patch.v2 arrives before bootstrap v2 is initialized', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    const patch: PatchEnvelopeV2 & { kind: 'patch.v2' } = {
      kind: 'patch.v2',
      gameId: 'game-1',
      version: 2,
      visibility: 'player:player-1',
      ops: [{ op: 'player.life.set', playerId: 'player-1', value: 38 }],
    };

    messages.next(patch);
    await vi.waitFor(() => expect(refetchSpy).toHaveBeenCalledTimes(1));
    messages.next(patch);
    await Promise.resolve();
    await Promise.resolve();

    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });

  it('limits repeated patch.v2 version gaps to one controlled refetch per version window', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    const normalizedStore = TestBed.inject(GameTableNormalizedV2Store);
    normalizedStore.applyBootstrap(bootstrapV2());
    const patch: PatchEnvelopeV2 & { kind: 'patch.v2' } = {
      kind: 'patch.v2',
      gameId: 'game-1',
      version: 3,
      visibility: 'player:player-1',
      ops: [{ op: 'player.life.set', playerId: 'player-1', value: 38 }],
    };

    messages.next(patch);
    await vi.waitFor(() => expect(refetchSpy).toHaveBeenCalledTimes(1));
    messages.next(patch);
    await Promise.resolve();
    await Promise.resolve();

    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not surface a late websocket error after patch.v2 already completed the action', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    const normalizedStore = TestBed.inject(GameTableNormalizedV2Store);
    normalizedStore.applyBootstrap(bootstrapV2());

    const sent = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -2 });
    const message = sentMessage<Extract<GameplayClientMessage, { kind: 'command.v2' }>>();
    messages.next({
      kind: 'patch.v2',
      gameId: 'game-1',
      version: 2,
      visibility: 'player:player-1',
      ackClientActionId: message.clientActionId,
      ops: [{ op: 'player.life.set', playerId: 'player-1', value: 38 }],
    });

    await expect(sent).resolves.toBe(true);
    messages.next({
      kind: 'error',
      gameId: 'game-1',
      messageId: message.messageId,
      clientActionId: message.clientActionId,
      error: { code: 'LATE_RUNTIME_ERROR', message: 'Late runtime error', retryable: false },
    });

    expect(setErrorSpy).not.toHaveBeenCalled();
    expect(snapshotState.players['player-1'].life).toBe(38);
  });

  it('ignores command-scoped websocket errors that do not belong to the active command', async () => {
    const sent = service.sendCommand(context(), 'card.tapped', {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'battlefield-1',
      tapped: true,
    });
    const message = sentMessage();

    messages.next({
      kind: 'error',
      gameId: 'game-1',
      messageId: 'stale-message-id',
      clientActionId: 'stale-client-action-id',
      error: { code: 'STALE_RUNTIME_ERROR', message: 'Stale runtime error', retryable: false },
    });
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

    await expect(sent).resolves.toBe(true);
    expect(setErrorSpy).not.toHaveBeenCalled();
    expect(snapshotState.players['player-1'].zones.battlefield[0]?.tapped).toBe(true);
  });

  it('applies mulligan runtime patch.v2 from websocket without snapshot refetch', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    const normalizedStore = TestBed.inject(GameTableNormalizedV2Store);
    normalizedStore.applyBootstrap({
      ...bootstrapV2(),
      game: {
        ...bootstrapV2().game,
        gamePhase: 'MULLIGAN',
      },
    });

    const patch: PatchEnvelopeV2 & { kind: 'patch.v2' } = {
      kind: 'patch.v2',
      gameId: 'game-1',
      version: 2,
      visibility: 'player:player-1',
      ackClientActionId: 'runtime-mulligan-action',
      ops: [
        {
          op: 'mulligan.status.set',
          playerId: 'player-1',
          status: 'DECIDING',
          ready: false,
          effectiveMulligans: 0,
          handCount: 7,
        },
        {
          op: 'mulligan.hand.replace_private',
          playerId: 'player-1',
          hand: [
            { instanceId: 'runtime-hand-1', cardKey: 'runtime-card-a', printId: 'runtime-print-a', cardVersion: 'runtime-v1', language: 'en', viewerVisibility: 'private' },
            { instanceId: 'runtime-hand-2', cardKey: 'runtime-card-b', printId: 'runtime-print-b', cardVersion: 'runtime-v1', language: 'en', viewerVisibility: 'private' },
          ],
          staticCards: {
            'runtime-card-a': { cardRef: 'runtime-card-a', cardKey: 'runtime-card-a', printId: 'runtime-print-a', cardVersion: 'runtime-v1', language: 'en', viewerVisibility: 'private', name: 'Runtime Card A', imageUris: null, cardFaces: [] },
            'runtime-card-b': { cardRef: 'runtime-card-b', cardKey: 'runtime-card-b', printId: 'runtime-print-b', cardVersion: 'runtime-v1', language: 'en', viewerVisibility: 'private', name: 'Runtime Card B', imageUris: null, cardFaces: [] },
          },
        },
        { op: 'mulligan.hand.count.set', playerId: 'player-2', count: 7 },
        { op: 'zone.count.set', playerId: 'player-1', zone: 'hand', count: 7 },
      ],
    };

    messages.next(patch);
    await vi.waitFor(() => expect(snapshotState.version).toBe(2));

    expect(snapshotState.version).toBe(2);
    expect(snapshotState.players['player-1'].zones.hand.map((card) => card.instanceId)).toEqual(['runtime-hand-1', 'runtime-hand-2']);
    expect(snapshotState.players['player-1'].mulligan?.status).toBe('DECIDING');
    expect(snapshotState.players['player-2'].handCount).toBe(7);
    expect(onMulliganPatchV2AppliedSpy).toHaveBeenCalledWith(patch, expect.objectContaining({
      version: 2,
      gamePhase: 'MULLIGAN',
    }));
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('applies runtime mulligan take patch with compact hand refs resolved through staticCards', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    const normalizedStore = TestBed.inject(GameTableNormalizedV2Store);
    normalizedStore.applyBootstrap({
      ...bootstrapV2(),
      game: {
        ...bootstrapV2().game,
        gamePhase: 'MULLIGAN',
      },
    });

    const patch: PatchEnvelopeV2 & { kind: 'patch.v2' } = {
      kind: 'patch.v2',
      gameId: 'game-1',
      version: 2,
      visibility: 'player:player-1',
      ackClientActionId: 'runtime-mulligan-action',
      ops: [
        {
          op: 'mulligan.status.set',
          playerId: 'player-1',
          status: 'DECIDING',
          ready: false,
          effectiveMulligans: 0,
        },
        { op: 'mulligan.hand.count.set', playerId: 'player-1', count: 2 },
        { op: 'zone.count.set', playerId: 'player-1', zone: 'hand', count: 2 },
        { op: 'zone.count.set', playerId: 'player-1', zone: 'library', count: 92 },
        {
          op: 'mulligan.private_state.set',
          playerId: 'player-1',
          state: {
            bottomPending: false,
            cardsToBottom: 0,
            effectiveMulligans: 0,
            handSize: 2,
            scryPending: false,
            status: 'DECIDING',
          },
        },
        {
          op: 'mulligan.hand.replace_private',
          playerId: 'player-1',
          hand: [
            { instanceId: 'runtime-hand-1', cardKey: 'runtime-card-a', printId: 'runtime-print-a', cardVersion: 'runtime-v1', language: 'en', viewerVisibility: 'private' },
            { instanceId: 'runtime-hand-2', cardKey: 'runtime-card-a', printId: 'runtime-print-a', cardVersion: 'runtime-v1', language: 'en', viewerVisibility: 'private' },
          ],
          staticCards: {
            'runtime-card-a': {
              cardRef: 'runtime-card-a',
              cardKey: 'runtime-card-a',
              printId: 'runtime-print-a',
              cardVersion: 'runtime-v1',
              language: 'en',
              viewerVisibility: 'private',
              name: 'Runtime Card A',
              imageUris: null,
              cardFaces: [],
            },
          },
        },
      ],
    };

    messages.next(patch);
    await vi.waitFor(() => expect(snapshotState.players['player-1'].zones.hand.map((card) => card.name)).toEqual(['Runtime Card A', 'Runtime Card A']));

    expect(snapshotState.players['player-1'].zones.hand.map((card) => card.name)).toEqual(['Runtime Card A', 'Runtime Card A']);
    expect(snapshotState.players['player-1'].handCount).toBe(2);
    expect(snapshotState.players['player-1'].zoneCounts?.hand).toBe(2);
    expect(onMulliganPatchV2AppliedSpy).toHaveBeenCalledWith(patch, expect.objectContaining({
      version: 2,
      gamePhase: 'MULLIGAN',
    }));
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('closes local mulligan pending state for an already-applied duplicate runtime patch.v2', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    const normalizedStore = TestBed.inject(GameTableNormalizedV2Store);
    normalizedStore.applyBootstrap({
      ...bootstrapV2(),
      game: {
        ...bootstrapV2().game,
        gamePhase: 'MULLIGAN',
      },
    });

    const patch: PatchEnvelopeV2 & { kind: 'patch.v2' } = {
      kind: 'patch.v2',
      gameId: 'game-1',
      version: 2,
      visibility: 'player:player-1',
      ops: [
        {
          op: 'mulligan.status.set',
          playerId: 'player-1',
          status: 'DECIDING',
          ready: false,
          effectiveMulligans: 0,
          handCount: 7,
        },
      ],
    };

    messages.next(patch);
    await vi.waitFor(() => expect(onMulliganPatchV2AppliedSpy).toHaveBeenCalled());
    onMulliganPatchV2AppliedSpy.mockClear();
    messages.next(patch);
    await vi.waitFor(() => expect(onMulliganPatchV2AppliedSpy).toHaveBeenCalled());

    expect(onMulliganPatchV2AppliedSpy).toHaveBeenCalledWith(patch, expect.objectContaining({
      version: 2,
      gamePhase: 'MULLIGAN',
    }));
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('does not force a snapshot after mulligan.completed when patch.v2 already advanced the store', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    const normalizedStore = TestBed.inject(GameTableNormalizedV2Store);
    normalizedStore.applyBootstrap({
      ...bootstrapV2(),
      game: {
        ...bootstrapV2().game,
        gamePhase: 'MULLIGAN',
      },
    });

    const patch: PatchEnvelopeV2 & { kind: 'patch.v2' } = {
      kind: 'patch.v2',
      gameId: 'game-1',
      version: 2,
      visibility: 'player:player-1',
      ops: [{ op: 'mulligan.completed' }],
    };

    messages.next(patch);
    await vi.waitFor(() => expect(snapshotState.version).toBe(2));
    messages.next({
      kind: 'mulligan.completed',
      gameId: 'game-1',
      version: 2,
    });
    await Promise.resolve();

    expect(snapshotState.version).toBe(2);
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('closes local mulligan pending state after resyncing a runtime mulligan patch.v2 version gap', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    const normalizedStore = TestBed.inject(GameTableNormalizedV2Store);
    normalizedStore.applyBootstrap({
      ...bootstrapV2(),
      game: {
        ...bootstrapV2().game,
        gamePhase: 'MULLIGAN',
      },
    });
    refetchSpy.mockImplementationOnce(async () => {
      snapshotState = {
        ...snapshotState,
        version: 3,
        gamePhase: 'MULLIGAN',
      };
    });

    const patch: PatchEnvelopeV2 & { kind: 'patch.v2' } = {
      kind: 'patch.v2',
      gameId: 'game-1',
      version: 3,
      visibility: 'player:player-1',
      ops: [
        {
          op: 'mulligan.status.set',
          playerId: 'player-1',
          status: 'DECIDING',
          ready: false,
          effectiveMulligans: 0,
          handCount: 7,
        },
      ],
    };

    messages.next(patch);

    await vi.waitFor(() => {
      expect(refetchSpy).toHaveBeenCalledWith(true);
      expect(onMulliganPatchV2AppliedSpy).toHaveBeenCalledWith(patch, expect.objectContaining({
        version: 3,
        gamePhase: 'MULLIGAN',
      }));
    });
  });

  it('queues mulligan messages until the websocket connection is ready', () => {
    status.set('connecting');
    send.mockClear();

    const queued = service.sendMulliganTake('game-1');

    expect(queued).toBe(true);
    expect(send).not.toHaveBeenCalled();

    status.set('connected');
    messages.next({
      kind: 'connection_state',
      gameId: 'game-1',
      status: 'connected',
      connectionId: 'conn-1',
      serverTime: new Date(0).toISOString(),
    });

    const message = sentMessage<Extract<GameplayClientMessage, { kind: 'mulligan.take' }>>();
    expect(message.kind).toBe('mulligan.take');
    expect(message.gameId).toBe('game-1');
  });

  it('logs initial websocket connection and later reconnect as separate sync phases', () => {
    messages.next({
      kind: 'connection_state',
      gameId: 'game-1',
      status: 'connected',
      connectionId: 'conn-1',
      serverTime: new Date(0).toISOString(),
    });
    messages.next({
      kind: 'connection_state',
      gameId: 'game-1',
      status: 'connected',
      connectionId: 'conn-2',
      serverTime: new Date(1).toISOString(),
    });

    expect(consoleInfoSpy).toHaveBeenCalledWith('[CommanderZone gameplay realtime]', expect.objectContaining({
      source: 'bootstrap',
      reason: 'connection_state',
      result: 'live',
    }));
    expect(consoleInfoSpy).toHaveBeenCalledWith('[CommanderZone gameplay realtime]', expect.objectContaining({
      source: 'reconnect',
      reason: 'connection_state',
      result: 'reconnected',
    }));
  });

  it('resyncs bootstrap once after legacy mulligan completion when v2 state is stale', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    const normalizedStore = TestBed.inject(GameTableNormalizedV2Store);
    normalizedStore.applyBootstrap({
      ...bootstrapV2(),
      game: {
        ...bootstrapV2().game,
        gamePhase: 'MULLIGAN',
        version: 1,
      },
    });

    messages.next({
      kind: 'mulligan.completed',
      gameId: 'game-1',
      version: 3,
    });
    await Promise.resolve();

    expect(refetchSpy).toHaveBeenCalledWith(true);
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

  it('emits one realtime animation hook for each applied remote patch', async () => {
    const animationBus = TestBed.inject(GameTableRealtimeAnimationBusService);
    const patchAnimation = vi.fn();
    const subscription = animationBus.patchAnimation$.subscribe(patchAnimation);

    try {
      messages.next({
        kind: 'game_patch',
        gameId: 'game-1',
        baseVersion: 1,
        version: 2,
        operations: [{ op: 'turn.set', turn: { activePlayerId: 'player-2', phase: 'combat', number: 2 } }],
      });

      expect(patchAnimation).toHaveBeenCalledTimes(1);
      expect(patchAnimation).toHaveBeenCalledWith(expect.objectContaining({
        previousSnapshot: expect.objectContaining({ version: 1 }),
        nextSnapshot: expect.objectContaining({ version: 2 }),
        isLocalPatch: false,
      }));
    } finally {
      subscription.unsubscribe();
    }
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

  it('publishes local snapshot growth metrics while debug is observing the game', async () => {
    const channel = broadcastChannels[0];
    channel.emit({
      kind: 'debug_observe',
      gameId: 'game-1',
      observedAt: '2026-05-24T10:00:00.000Z',
    });

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

    const metric = channel.sentMessages.find((item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && (item as { kind?: unknown }).kind === 'snapshot_metric',
    );

    expect(metric).toMatchObject({
      kind: 'snapshot_metric',
      gameId: 'game-1',
      clientActionId: message.command.clientActionId,
      version: 2,
      operationCount: 1,
      lineDelta: 0,
    });
    expect(metric?.['previousLines']).toBeGreaterThan(0);
    expect(metric?.['nextLines']).toBeGreaterThan(0);
  });

  it('publishes queue metrics while debug observes gameplay traffic', async () => {
    const channel = broadcastChannels[0];
    channel.emit({
      kind: 'debug_observe',
      gameId: 'game-1',
      observedAt: '2026-05-24T10:00:00.000Z',
    });

    const sent = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
    const message = sentMessage();

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: message.command.clientActionId,
      operations: [{ op: 'player.life.set', playerId: 'player-1', value: 39 }],
    });
    await sent;

    const queueMetrics = channel.sentMessages
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && (item as { kind?: unknown }).kind === 'queue_metrics');
    expect(queueMetrics.length).toBeGreaterThan(0);

    const latest = queueMetrics.at(-1);
    expect(latest).toMatchObject({
      kind: 'queue_metrics',
      gameId: 'game-1',
      queueDepth: 0,
      inFlight: false,
      enqueueTotal: 1,
      drainTotal: 1,
      dropTotal: 0,
      retryTotal: 0,
      rejectedTotal: 0,
      circuitBlockedTotal: 0,
      queueFullTotal: 0,
    });
    expect(Number(latest?.['enqueueRate'])).toBeGreaterThanOrEqual(0);
    expect(Number(latest?.['drainRate'])).toBeGreaterThanOrEqual(0);
  });

  it('publishes gameplay refetch and patch counters while debug observes the game', async () => {
    gameplayV2Flags.enabled.mockReturnValue(true);
    const normalizedStore = TestBed.inject(GameTableNormalizedV2Store);
    normalizedStore.applyBootstrap(bootstrapV2());
    const channel = broadcastChannels[0];
    channel.emit({
      kind: 'debug_observe',
      gameId: 'game-1',
      observedAt: '2026-05-24T10:00:00.000Z',
    });

    messages.next({
      kind: 'patch.v2',
      gameId: 'game-1',
      version: 3,
      visibility: 'player:player-1',
      ops: [{ op: 'player.life.set', playerId: 'player-1', value: 38 }],
    });
    await vi.waitFor(() => expect(refetchSpy).toHaveBeenCalledTimes(1));

    const latest = channel.sentMessages
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && (item as { kind?: unknown }).kind === 'queue_metrics')
      .at(-1);
    expect(latest).toMatchObject({
      kind: 'queue_metrics',
      gameId: 'game-1',
      'gameplay.refetch.count': 1,
      'gameplay.patch_v2.apply.resync_required': 1,
      'gameplay.patch_v2.apply.version_gap': 1,
    });
    expect(latest?.['gameplay.refetch.reason']).toEqual({ version_gap: 1 });
    expect(latest?.['gameplay.refetch.source']).toEqual({ handlePatchV2: 1 });
  });

  it('applies queue depth cap by dropping only coalescible commands', async () => {
    const channel = broadcastChannels[0];
    channel.emit({
      kind: 'debug_observe',
      gameId: 'game-1',
      observedAt: '2026-05-24T10:00:00.000Z',
    });

    const blocker = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
    const blockerMessage = sentMessage();

    const pending: Promise<unknown>[] = [];
    pending.push(service.sendCommand(context(), 'chat.message', { message: 'sensitive-non-coalescible' }).catch(() => undefined));

    for (let index = 0; index < 240; index += 1) {
      pending.push(service.sendCommand(context(), 'card.position.changed', {
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: `burst-${index}`,
        position: { x: (index % 100) / 100, y: ((index * 3) % 100) / 100, unit: 'ratio' },
      }).catch(() => undefined));
    }
    await Promise.resolve();

    const pressureEvents = channel.sentMessages
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && (item as { kind?: unknown }).kind === 'dead_letter_event')
      .filter((item) => item['reason'] === 'queue_dropped' || item['reason'] === 'queue_full');

    expect(pressureEvents.length).toBeGreaterThan(0);
    expect(pressureEvents.every((event) => event['commandType'] === 'card.position.changed')).toBe(true);
    expect(pressureEvents.some((event) => event['commandType'] === 'chat.message')).toBe(false);

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: blockerMessage.command.clientActionId,
      operations: [{ op: 'player.life.set', playerId: 'player-1', value: 39 }],
    });
    await blocker;
    service.stop();
    await Promise.allSettled(pending);
  });

  it('activates a circuit breaker after repeated rejected acknowledgements and unblocks after cooldown', async () => {
    vi.useFakeTimers();
    try {
      const channel = broadcastChannels[0];
      channel.emit({
        kind: 'debug_observe',
        gameId: 'game-1',
        observedAt: '2026-05-24T10:00:00.000Z',
      });

      for (let index = 0; index < 3; index += 1) {
        const sent = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
        const message = sentMessage();
        messages.next({
          kind: 'command_ack',
          gameId: 'game-1',
          messageId: message.messageId,
          clientActionId: message.command.clientActionId,
          status: 'rejected',
          version: 1,
          error: { code: 'COMMAND_REJECTED', message: `Denied-${index}`, retryable: false },
        });
        await expect(sent).rejects.toThrow(`Denied-${index}`);
      }

      const sendCallCount = send.mock.calls.length;
      await expect(service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 }))
        .rejects.toThrow('Action temporarily blocked after repeated command rejections.');
      await expect(service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 }))
        .rejects.toThrow('Action temporarily blocked after repeated command rejections.');
      expect(send).toHaveBeenCalledTimes(sendCallCount);
      expect(setErrorSpy).toHaveBeenCalledTimes(1);
      expect(onCommandBlockedSpy).toHaveBeenCalledWith(
        'circuit_blocked',
        'life.changed',
        { playerId: 'player-1', delta: -1 },
      );

      const blockedEvent = channel.sentMessages
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .find((item) => item['kind'] === 'dead_letter_event' && item['reason'] === 'circuit_blocked');
      expect(blockedEvent).toBeTruthy();

      vi.advanceTimersByTime(2_001);
      const retried = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
      const retriedMessage = sentMessage();
      expect(send).toHaveBeenCalledTimes(sendCallCount + 1);
      messages.next({
        kind: 'game_patch',
        gameId: 'game-1',
        baseVersion: snapshotState.version,
        version: snapshotState.version + 1,
        clientActionId: retriedMessage.command.clientActionId,
        operations: [{ op: 'player.life.set', playerId: 'player-1', value: 35 }],
      });
      await expect(retried).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects incoming commands as queue_full when queue depth is saturated by non-droppable commands', async () => {
    const channel = broadcastChannels[0];
    channel.emit({
      kind: 'debug_observe',
      gameId: 'game-1',
      observedAt: '2026-05-24T10:00:00.000Z',
    });

    const blocker = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
    const blockerMessage = sentMessage();
    const pending: Promise<unknown>[] = [];

    for (let index = 0; index < 260; index += 1) {
      pending.push(service.sendCommand(context(), 'chat.message', { message: `msg-${index}` }).catch(() => undefined));
    }
    await Promise.resolve();

    const fullEvents = channel.sentMessages
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .filter((item) => item['kind'] === 'dead_letter_event' && item['reason'] === 'queue_full');
    expect(fullEvents.length).toBeGreaterThan(0);
    expect(onCommandBlockedSpy).toHaveBeenCalledWith('queue_full', 'chat.message', expect.any(Object));

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: blockerMessage.command.clientActionId,
      operations: [{ op: 'player.life.set', playerId: 'player-1', value: 39 }],
    });
    await blocker;
    service.stop();
    await Promise.allSettled(pending);
  });

  it('dedupes repeated identical dead letter debug events inside a short time window', async () => {
    const channel = broadcastChannels[0];
    channel.emit({
      kind: 'debug_observe',
      gameId: 'game-1',
      observedAt: '2026-05-24T10:00:00.000Z',
    });

    const blocker = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
    const blockerMessage = sentMessage();
    const pending: Promise<unknown>[] = [];

    for (let index = 0; index < 260; index += 1) {
      pending.push(service.sendCommand(context(), 'chat.message', { message: `dedupe-${index}` }).catch(() => undefined));
    }
    await Promise.resolve();

    const fullEvents = channel.sentMessages
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .filter((item) => item['kind'] === 'dead_letter_event' && item['reason'] === 'queue_full' && item['commandType'] === 'chat.message');
    expect(fullEvents.length).toBe(1);

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: blockerMessage.command.clientActionId,
      operations: [{ op: 'player.life.set', playerId: 'player-1', value: 39 }],
    });
    await blocker;
    service.stop();
    await Promise.allSettled(pending);
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

  it('resolves pending commands when a global resync_required arrives', async () => {
    const sent = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });

    messages.next({
      kind: 'resync_required',
      gameId: 'game-1',
      currentVersion: 2,
      reason: 'version_gap',
    });

    await sent;
    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });

  it('debounces burst resync_required messages into a single refetch', async () => {
    messages.next({
      kind: 'resync_required',
      gameId: 'game-1',
      currentVersion: 2,
      reason: 'version_gap',
    });
    messages.next({
      kind: 'resync_required',
      gameId: 'game-1',
      currentVersion: 2,
      reason: 'version_gap',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });

  it('blocks repeated refetches for the same resync reason and version inside the guard window', async () => {
    messages.next({
      kind: 'resync_required',
      gameId: 'game-1',
      currentVersion: 2,
      reason: 'version_gap',
    });
    await vi.waitFor(() => expect(refetchSpy).toHaveBeenCalledTimes(1));

    messages.next({
      kind: 'resync_required',
      gameId: 'game-1',
      currentVersion: 2,
      reason: 'version_gap',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(refetchSpy).toHaveBeenCalledTimes(1);
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

  it('uses one resync for stale duplicate command_ack states', async () => {
    const sent = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
    const message = sentMessage();

    messages.next({
      kind: 'command_ack',
      gameId: 'game-1',
      messageId: message.messageId,
      clientActionId: message.command.clientActionId,
      status: 'duplicate',
      version: 2,
    });
    await sent;

    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not resync duplicate command_ack when the client is already synchronized', async () => {
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

    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('ignores late rejected ack for a previous command and keeps the current in-flight command', async () => {
    const channel = broadcastChannels[0];
    channel.emit({
      kind: 'debug_observe',
      gameId: 'game-1',
      observedAt: '2026-05-24T10:00:00.000Z',
    });

    const firstSent = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
    const firstMessage = sentMessage();
    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: firstMessage.command.clientActionId,
      operations: [{ op: 'player.life.set', playerId: 'player-1', value: 39 }],
    });
    await firstSent;

    const secondSent = service.sendCommand(context(), 'card.tapped', {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'battlefield-1',
      tapped: true,
    });
    const secondMessage = sentMessage();

    messages.next({
      kind: 'command_ack',
      gameId: 'game-1',
      messageId: firstMessage.messageId,
      clientActionId: firstMessage.command.clientActionId,
      status: 'rejected',
      version: 2,
      error: { code: 'COMMAND_REJECTED', message: 'Late reject', retryable: false },
    });
    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 2,
      version: 3,
      clientActionId: secondMessage.command.clientActionId,
      operations: [{
        op: 'card.state.set',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-1',
        tapped: true,
      }],
    });

    await expect(secondSent).resolves.toBe(true);
    expect(refetchSpy).not.toHaveBeenCalled();

    const latestQueueMetric = channel.sentMessages
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && (item as { kind?: unknown }).kind === 'queue_metrics')
      .at(-1);
    expect(latestQueueMetric?.['lateAckIgnoredTotal']).toBeGreaterThanOrEqual(1);
  });

  it('ignores late duplicate ack and does not trigger resync for the current in-flight command', async () => {
    const firstSent = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
    const firstMessage = sentMessage();
    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: firstMessage.command.clientActionId,
      operations: [{ op: 'player.life.set', playerId: 'player-1', value: 39 }],
    });
    await firstSent;

    const secondSent = service.sendCommand(context(), 'card.tapped', {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'battlefield-1',
      tapped: true,
    });
    const secondMessage = sentMessage();

    messages.next({
      kind: 'command_ack',
      gameId: 'game-1',
      messageId: firstMessage.messageId,
      clientActionId: firstMessage.command.clientActionId,
      status: 'duplicate',
      version: 2,
    });
    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 2,
      version: 3,
      clientActionId: secondMessage.command.clientActionId,
      operations: [{
        op: 'card.state.set',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-1',
        tapped: true,
      }],
    });

    await expect(secondSent).resolves.toBe(true);
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('returns false so callers can use HTTP fallback when websocket is not connected before sending', async () => {
    status.set('connecting');

    await expect(service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 })).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('serializes overlapping commands so the next command uses the latest baseVersion', async () => {
    const firstSent = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
    const firstMessage = sentMessage();
    const secondSent = service.sendCommand(context(), 'card.tapped', {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'battlefield-1',
      tapped: true,
    });

    expect(send).toHaveBeenCalledTimes(1);

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: firstMessage.command.clientActionId,
      operations: [{ op: 'player.life.set', playerId: 'player-1', value: 39 }],
    });
    await firstSent;

    expect(send).toHaveBeenCalledTimes(2);
    const secondMessage = sentMessage();
    expect(secondMessage.command.baseVersion).toBe(2);

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 2,
      version: 3,
      clientActionId: secondMessage.command.clientActionId,
      operations: [{
        op: 'card.state.set',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-1',
        tapped: true,
      }],
    });
    await secondSent;
  });

  it('drains gameplay commands before queued position updates', async () => {
    const blocker = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
    const blockerMessage = sentMessage();
    const position = service.sendCommand(context(), 'card.position.changed', {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'battlefield-1',
      position: { x: 0.2, y: 0.3, unit: 'ratio' },
    });
    const turn = service.sendCommand(context(), 'turn.changed', {
      activePlayerId: 'player-2',
      phase: 'combat',
      number: 2,
    });

    expect(send).toHaveBeenCalledTimes(1);

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: blockerMessage.command.clientActionId,
      operations: [{ op: 'player.life.set', playerId: 'player-1', value: 39 }],
    });
    await blocker;

    expect(send).toHaveBeenCalledTimes(2);
    const turnMessage = sentMessage();
    expect(turnMessage.command.type).toBe('turn.changed');
    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 2,
      version: 3,
      clientActionId: turnMessage.command.clientActionId,
      operations: [{ op: 'turn.set', turn: { activePlayerId: 'player-2', phase: 'combat', number: 2 } }],
    });
    await turn;

    expect(send).toHaveBeenCalledTimes(3);
    const positionMessage = sentMessage();
    expect(positionMessage.command.type).toBe('card.position.changed');
    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 3,
      version: 4,
      clientActionId: positionMessage.command.clientActionId,
      operations: [{
        op: 'card.position.set',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-1',
        position: { x: 0.2, y: 0.3, unit: 'ratio' },
      }],
    });
    await position;
  });

  it('dedupes identical in-flight safe commands and resolves both from a single websocket send', async () => {
    const firstSent = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
    const firstMessage = sentMessage();
    const secondSent = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });

    expect(send).toHaveBeenCalledTimes(1);

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: firstMessage.command.clientActionId,
      operations: [{ op: 'player.life.set', playerId: 'player-1', value: 39 }],
    });

    await expect(firstSent).resolves.toBe(true);
    await expect(secondSent).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not dedupe non-safe in-flight commands', async () => {
    const firstSent = service.sendCommand(context(), 'card.moved', {
      playerId: 'player-1',
      fromZone: 'battlefield',
      toZone: 'graveyard',
      instanceId: 'battlefield-1',
    });
    const firstMessage = sentMessage();
    const secondSent = service.sendCommand(context(), 'card.moved', {
      playerId: 'player-1',
      fromZone: 'battlefield',
      toZone: 'graveyard',
      instanceId: 'battlefield-2',
    });

    expect(send).toHaveBeenCalledTimes(1);
    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: firstMessage.command.clientActionId,
      operations: [{
        op: 'card.remove',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-1',
      }],
    });
    await firstSent;

    expect(send).toHaveBeenCalledTimes(2);
    const secondMessage = sentMessage();
    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 2,
      version: 3,
      clientActionId: secondMessage.command.clientActionId,
      operations: [{
        op: 'card.remove',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-2',
      }],
    });
    await secondSent;
  });

  it('coalesces queued high-frequency commands using the latest payload', async () => {
    const blocker = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
    const blockerMessage = sentMessage();
    const firstPosition = service.sendCommand(context(), 'card.position.changed', {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'battlefield-1',
      position: { x: 0.2, y: 0.3, unit: 'ratio' },
    });
    const secondPosition = service.sendCommand(context(), 'card.position.changed', {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'battlefield-1',
      position: { x: 0.8, y: 0.6, unit: 'ratio' },
    });

    expect(send).toHaveBeenCalledTimes(1);

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: blockerMessage.command.clientActionId,
      operations: [{ op: 'player.life.set', playerId: 'player-1', value: 39 }],
    });
    await blocker;

    expect(send).toHaveBeenCalledTimes(2);
    const coalescedMessage = sentMessage();
    expect(coalescedMessage.command.type).toBe('card.position.changed');
    expect(coalescedMessage.command.payload).toEqual({
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'battlefield-1',
      position: { x: 0.8, y: 0.6, unit: 'ratio' },
    });

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 2,
      version: 3,
      clientActionId: coalescedMessage.command.clientActionId,
      operations: [{
        op: 'card.position.set',
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'battlefield-1',
        position: { x: 0.8, y: 0.6, unit: 'ratio' },
      }],
    });

    await firstPosition;
    await secondPosition;
  });

  it('drops queued turn.changed commands when concede starts locally', async () => {
    const blocker = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
    const blockerMessage = sentMessage();
    const queuedTurn = service.sendCommand(context(), 'turn.changed', {
      activePlayerId: 'player-2',
      phase: 'untap',
      number: 2,
    });
    await Promise.resolve();

    service.prepareForLocalConcede();

    await expect(queuedTurn).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(1);

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: blockerMessage.command.clientActionId,
      operations: [{ op: 'player.life.set', playerId: 'player-1', value: 39 }],
    });
    await blocker;
  });

  it('suppresses the expected conceded rejection for in-flight turn.changed when concede starts', async () => {
    const turnChange = service.sendCommand(context(), 'turn.changed', {
      activePlayerId: 'player-2',
      phase: 'untap',
      number: 2,
    });
    const turnMessage = sentMessage();

    service.prepareForLocalConcede();
    messages.next({
      kind: 'command_ack',
      gameId: 'game-1',
      messageId: turnMessage.messageId,
      clientActionId: turnMessage.command.clientActionId,
      status: 'rejected',
      version: 1,
      error: { code: 'COMMAND_REJECTED', message: 'Conceded players cannot perform game actions.', retryable: false },
    });

    await expect(turnChange).resolves.toBe(true);
    expect(setErrorSpy).not.toHaveBeenCalled();
  });

  it('retries safe commands once after resync_required command_ack', async () => {
    refetchSpy.mockImplementation(async () => {
      snapshotState = {
        ...snapshotState,
        version: 5,
      };
    });

    const sent = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
    const firstMessage = sentMessage();

    messages.next({
      kind: 'command_ack',
      gameId: 'game-1',
      messageId: firstMessage.messageId,
      clientActionId: firstMessage.command.clientActionId,
      status: 'resync_required',
      version: 1,
      error: { code: 'BASE_VERSION_MISMATCH', message: 'Need resync', retryable: true },
    });
    await vi.waitFor(() => expect(refetchSpy).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));

    const retriedMessage = sentMessage();
    expect(retriedMessage.command.baseVersion).toBe(5);
    expect(retriedMessage.command.clientActionId).not.toBe(firstMessage.command.clientActionId);

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 5,
      version: 6,
      clientActionId: retriedMessage.command.clientActionId,
      operations: [{ op: 'player.life.set', playerId: 'player-1', value: 39 }],
    });
    await sent;
  });

  it('retries mismatch without refetch when conflict is concurrent_write and snapshot is already current', async () => {
    const sent = service.sendCommand(context(), 'life.changed', { playerId: 'player-1', delta: -1 });
    const firstMessage = sentMessage();

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 1,
      version: 2,
      clientActionId: 'other-client-action',
      operations: [{ op: 'player.life.set', playerId: 'player-1', value: 39 }],
    });

    messages.next({
      kind: 'command_ack',
      gameId: 'game-1',
      messageId: firstMessage.messageId,
      clientActionId: firstMessage.command.clientActionId,
      status: 'resync_required',
      version: 2,
      error: {
        code: 'BASE_VERSION_MISMATCH',
        message: 'Need resync',
        retryable: true,
        conflict: {
          commandBaseVersion: 1,
          currentVersion: 2,
          delta: 1,
          classification: 'concurrent_write',
        },
      },
    });

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(refetchSpy).not.toHaveBeenCalled();

    const retriedMessage = sentMessage();
    expect(retriedMessage.command.baseVersion).toBe(2);
    expect(retriedMessage.command.clientActionId).not.toBe(firstMessage.command.clientActionId);

    messages.next({
      kind: 'game_patch',
      gameId: 'game-1',
      baseVersion: 2,
      version: 3,
      clientActionId: retriedMessage.command.clientActionId,
      operations: [{ op: 'player.life.set', playerId: 'player-1', value: 38 }],
    });
    await sent;
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

  function sentMessage<TMessage extends GameplayClientMessage = Extract<GameplayClientMessage, { kind: 'command' }>>(): TMessage {
    expect(send).toHaveBeenCalled();

    return send.mock.calls.at(-1)?.[0] as TMessage;
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
      onCommandBlocked: (reason, type, payload) => onCommandBlockedSpy(reason, type, payload),
      onMulliganPatchV2Applied: (patch, snapshot) => onMulliganPatchV2AppliedSpy(patch, snapshot),
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

function bootstrapV2(): BootstrapV2 {
  return {
    game: {
      id: 'game-1',
      status: 'active',
      version: 1,
      viewerId: 'player-1',
      ownerId: 'player-1',
      gamePhase: 'PLAYING',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    },
    players: {
      'player-1': {
        playerId: 'player-1',
        user: { id: 'player-1', email: 'player1@example.test', displayName: 'Player 1', roles: [] },
        displayName: 'Player 1',
        life: 40,
        status: 'active',
        handCount: 0,
        zoneIds: ['player-1:library', 'player-1:hand', 'player-1:battlefield', 'player-1:graveyard', 'player-1:exile', 'player-1:command'],
        zoneCounts: { library: 1, hand: 0, battlefield: 2, graveyard: 0, exile: 0, command: 0 },
        commanderDamage: {},
        counters: {},
        deckName: 'Deck',
      },
      'player-2': {
        playerId: 'player-2',
        user: { id: 'player-2', email: 'player2@example.test', displayName: 'Player 2', roles: [] },
        displayName: 'Player 2',
        life: 40,
        status: 'active',
        handCount: 0,
        zoneIds: ['player-2:library', 'player-2:hand', 'player-2:battlefield', 'player-2:graveyard', 'player-2:exile', 'player-2:command'],
        zoneCounts: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
        commanderDamage: {},
        counters: {},
        deckName: 'Deck',
      },
    },
    zones: {
      'player-1:library': { zoneId: 'player-1:library', playerId: 'player-1', name: 'library', instanceIds: ['library-1'] },
      'player-1:hand': { zoneId: 'player-1:hand', playerId: 'player-1', name: 'hand', instanceIds: [] },
      'player-1:battlefield': { zoneId: 'player-1:battlefield', playerId: 'player-1', name: 'battlefield', instanceIds: ['battlefield-1', 'battlefield-2'] },
      'player-1:graveyard': { zoneId: 'player-1:graveyard', playerId: 'player-1', name: 'graveyard', instanceIds: [] },
      'player-1:exile': { zoneId: 'player-1:exile', playerId: 'player-1', name: 'exile', instanceIds: [] },
      'player-1:command': { zoneId: 'player-1:command', playerId: 'player-1', name: 'command', instanceIds: [] },
      'player-2:library': { zoneId: 'player-2:library', playerId: 'player-2', name: 'library', instanceIds: [] },
      'player-2:hand': { zoneId: 'player-2:hand', playerId: 'player-2', name: 'hand', instanceIds: [] },
      'player-2:battlefield': { zoneId: 'player-2:battlefield', playerId: 'player-2', name: 'battlefield', instanceIds: [] },
      'player-2:graveyard': { zoneId: 'player-2:graveyard', playerId: 'player-2', name: 'graveyard', instanceIds: [] },
      'player-2:exile': { zoneId: 'player-2:exile', playerId: 'player-2', name: 'exile', instanceIds: [] },
      'player-2:command': { zoneId: 'player-2:command', playerId: 'player-2', name: 'command', instanceIds: [] },
    },
    instances: {
      'library-1': { instanceId: 'library-1', cardRef: 'card-1', cardKey: 'card-1', printId: 's1', cardVersion: 'legacy-snapshot-v1', language: 'en', viewerVisibility: 'private', zoneId: 'player-1:library', ownerId: 'player-1', controllerId: 'player-1', tapped: false },
      'battlefield-1': { instanceId: 'battlefield-1', cardRef: 'card-2', cardKey: 'card-2', printId: 's2', cardVersion: 'legacy-snapshot-v1', language: 'en', viewerVisibility: 'public', zoneId: 'player-1:battlefield', ownerId: 'player-1', controllerId: 'player-1', tapped: false, position: { x: 0.1, y: 0.2, unit: 'ratio' } },
      'battlefield-2': { instanceId: 'battlefield-2', cardRef: 'card-3', cardKey: 'card-3', printId: 's3', cardVersion: 'legacy-snapshot-v1', language: 'en', viewerVisibility: 'public', zoneId: 'player-1:battlefield', ownerId: 'player-1', controllerId: 'player-1', tapped: false, position: { x: 0.3, y: 0.4, unit: 'ratio' } },
    },
    zoneCounts: {
      'player-1:library': 1,
      'player-1:hand': 0,
      'player-1:battlefield': 2,
      'player-1:graveyard': 0,
      'player-1:exile': 0,
      'player-1:command': 0,
      'player-2:library': 0,
      'player-2:hand': 0,
      'player-2:battlefield': 0,
      'player-2:graveyard': 0,
      'player-2:exile': 0,
      'player-2:command': 0,
    },
    relations: {
      stack: [],
      arrows: [],
      attachments: [],
      specialEntities: [],
    },
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    staticCards: {
      'card-1': { cardRef: 'card-1', cardKey: 'card-1', printId: 's1', cardVersion: 'legacy-snapshot-v1', language: 'en', viewerVisibility: 'private', scryfallId: 's1', name: 'Top Card', imageUris: null, cardFaces: [], typeLine: 'Land', manaCost: null, colorIdentity: [] },
      'card-2': { cardRef: 'card-2', cardKey: 'card-2', printId: 's2', cardVersion: 'legacy-snapshot-v1', language: 'en', viewerVisibility: 'public', scryfallId: 's2', name: 'Battlefield One', imageUris: null, cardFaces: [], typeLine: 'Creature', manaCost: null, colorIdentity: [] },
      'card-3': { cardRef: 'card-3', cardKey: 'card-3', printId: 's3', cardVersion: 'legacy-snapshot-v1', language: 'en', viewerVisibility: 'public', scryfallId: 's3', name: 'Battlefield Two', imageUris: null, cardFaces: [], typeLine: 'Creature', manaCost: null, colorIdentity: [] },
    },
    chatCursor: null,
    logCursor: null,
  };
}

function catalogCard(scryfallId: string, name: string): Card {
  return {
    id: scryfallId,
    scryfallId,
    name,
    manaCost: null,
    typeLine: 'Basic Land - Forest',
    oracleText: null,
    colors: [],
    colorIdentity: ['G'],
    legalities: {},
    imageUris: { normal: `https://cards.test/${scryfallId}.jpg` },
    cardFaces: [],
    hasRulings: false,
    layout: 'normal',
    commanderLegal: true,
    set: 'tst',
    collectorNumber: '1',
    lang: 'en',
  };
}

class FakeBroadcastChannel {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly sentMessages: unknown[] = [];
  closed = false;

  constructor(readonly name: string, private readonly registry: FakeBroadcastChannel[]) {
    this.registry.push(this);
  }

  postMessage(message: unknown): void {
    this.sentMessages.push(message);
  }

  close(): void {
    this.closed = true;
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }
}
