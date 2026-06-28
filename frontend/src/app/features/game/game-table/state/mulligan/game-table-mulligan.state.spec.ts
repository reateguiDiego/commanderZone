import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { GameCardInstance, GamePlayerState, GameSnapshot } from '../../../../../core/models/game.model';
import { GameplayMulliganPrivateStateMessage, GameplayPatchV2Message } from '../../../../../core/models/game-realtime.model';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTableMulliganState } from './game-table-mulligan.state';

describe('GameTableMulliganState', () => {
  let core: GameTableCoreState;
  let mulligan: GameTableMulliganState;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        GameTableCoreState,
        GameTableMulliganState,
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'game-1' }) } },
        },
      ],
    });

    core = TestBed.inject(GameTableCoreState);
    mulligan = TestBed.inject(GameTableMulliganState);
  });

  it('keeps the local player and hand references stable when only another player public mulligan status changes', () => {
    const snapshot = snapshotFixture();
    core.snapshot.set(snapshot);
    const localPlayerBefore = snapshot.players['player-1'];
    const localHandBefore = localPlayerBefore.zones.hand;

    mulligan.handlePublicState({
      kind: 'mulligan.public_state',
      gameId: 'game-1',
      version: 2,
      gamePhase: 'MULLIGAN',
      players: [
        publicPlayer('player-1', 2, 'DECIDING', false),
        publicPlayer('player-2', 7, 'READY', true),
      ],
    });

    const nextSnapshot = core.snapshot();

    expect(nextSnapshot).not.toBe(snapshot);
    expect(nextSnapshot?.players['player-1']).toBe(localPlayerBefore);
    expect(nextSnapshot?.players['player-1'].zones.hand).toBe(localHandBefore);
    expect(nextSnapshot?.players['player-2']).not.toBe(snapshot.players['player-2']);
    expect(nextSnapshot?.players['player-2'].mulligan?.status).toBe('READY');
  });

  it('ignores duplicate private state without recreating the snapshot', () => {
    const snapshot = snapshotFixture();
    core.snapshot.set(snapshot);
    const privateState: GameplayMulliganPrivateStateMessage = {
      kind: 'mulligan.private_state' as const,
      gameId: 'game-1',
      version: 1,
      playerId: 'player-1',
      hand: snapshot.players['player-1'].zones.hand,
      mulligan: {
        rule: 'LONDON',
        mulligansTaken: 0,
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
    };

    mulligan.handlePrivateState(privateState);

    expect(core.snapshot()).toBe(snapshot);
  });

  it('stores compact private state while hydrating the owner hand from existing cards', () => {
    const snapshot = snapshotFixture();
    core.snapshot.set(snapshot);

    mulligan.handlePrivateState({
      kind: 'mulligan.private_state',
      gameId: 'game-1',
      version: 2,
      playerId: 'player-1',
      hand: [
        { instanceId: 'card-1', cardKey: 'card:sol-ring' },
        { instanceId: 'card-2', cardKey: 'card:island' },
      ],
      mulligan: privateMulliganState(),
    });

    const privateHand = mulligan.privateState()?.hand ?? [];
    const hydratedHand = mulligan.privateHandFor('player-1') ?? [];

    expect(privateHand[0]).toEqual({ instanceId: 'card-1', cardKey: 'card:sol-ring' });
    expect((privateHand[0] as GameCardInstance).imageUris).toBeUndefined();
    expect(hydratedHand.map((card) => card.name)).toEqual(['card-1', 'card-2']);
    expect(core.snapshot()?.players['player-1'].zones.hand.map((card) => card.instanceId)).toEqual(['card-1', 'card-2']);
  });

  it('clears pending take and keeps compact private hand identity after a mulligan patch.v2', () => {
    const nextSnapshot = {
      ...snapshotFixture(),
      version: 2,
      players: {
        ...snapshotFixture().players,
        'player-1': player('player-1', [
          card('runtime-a', 'Runtime Card A'),
          card('runtime-b', 'Runtime Card B'),
        ], 'DECIDING', false),
      },
    };
    core.snapshot.set(nextSnapshot);
    expect(mulligan.beginAction()).toBe(true);

    mulligan.handlePatchV2Applied({
      kind: 'patch.v2',
      gameId: 'game-1',
      version: 2,
      visibility: 'player:player-1',
      ops: [
        {
          op: 'mulligan.private_state.set',
          playerId: 'player-1',
          state: {
            status: 'DECIDING',
            effectiveMulligans: 0,
            handSize: 2,
            cardsToBottom: 0,
            bottomPending: false,
            scryPending: false,
          },
        },
        {
          op: 'mulligan.hand.replace_private',
          playerId: 'player-1',
          hand: [
            { instanceId: 'runtime-a', cardKey: 'card:a', printId: 'print:a', cardVersion: 'v-a', language: 'en', viewerVisibility: 'private' },
            { instanceId: 'runtime-b', cardKey: 'card:b', printId: 'print:b', cardVersion: 'v-b', language: 'en', viewerVisibility: 'private' },
          ],
          staticCards: {
            'card:a': { cardRef: 'card:a', cardKey: 'card:a', printId: 'print:a', cardVersion: 'v-a', language: 'en', viewerVisibility: 'private', name: 'Runtime Card A', imageUris: null, cardFaces: [] },
            'card:b': { cardRef: 'card:b', cardKey: 'card:b', printId: 'print:b', cardVersion: 'v-b', language: 'en', viewerVisibility: 'private', name: 'Runtime Card B', imageUris: null, cardFaces: [] },
          },
        },
      ],
    } satisfies GameplayPatchV2Message, nextSnapshot);

    expect(mulligan.pendingAction()).toBe(false);
    expect(mulligan.privateState()?.hand).toEqual([
      { instanceId: 'runtime-a', cardKey: 'card:a', printId: 'print:a', cardVersion: 'v-a', language: 'en', viewerVisibility: 'private' },
      { instanceId: 'runtime-b', cardKey: 'card:b', printId: 'print:b', cardVersion: 'v-b', language: 'en', viewerVisibility: 'private' },
    ]);
    expect(mulligan.privateHandFor('player-1')?.map((card) => card.name)).toEqual(['Runtime Card A', 'Runtime Card B']);
  });

  it('keeps duplicate card keys distinct by instanceId in compact private state', () => {
    const snapshot = snapshotFixture();
    core.snapshot.set(snapshot);

    mulligan.handlePrivateState({
      kind: 'mulligan.private_state',
      gameId: 'game-1',
      version: 2,
      playerId: 'player-1',
      hand: [
        { instanceId: 'copy-a', cardKey: 'card:brainstorm' },
        { instanceId: 'copy-b', cardKey: 'card:brainstorm' },
      ],
      mulligan: privateMulliganState({ bottomSelectionCount: 2, needsBottomSelection: true }),
    });

    expect(mulligan.privateState()?.hand.map((card) => card.instanceId)).toEqual(['copy-a', 'copy-b']);
    expect(mulligan.privateHandFor('player-1')?.map((card) => card.instanceId)).toEqual(['copy-a', 'copy-b']);
  });

  it('strips avatar blobs from public mulligan state events', () => {
    core.snapshot.set(snapshotFixture());

    mulligan.handlePublicState({
      kind: 'mulligan.public_state',
      gameId: 'game-1',
      version: 2,
      gamePhase: 'MULLIGAN',
      players: [
        {
          ...publicPlayer('player-1', 2, 'DECIDING', false),
          avatarImageData: 'data:image/png;base64,heavy',
        },
      ],
    });

    expect(mulligan.publicState()?.players[0]?.avatarImageData).toBeUndefined();
  });
});

function snapshotFixture(): GameSnapshot {
  return {
    version: 1,
    gamePhase: 'MULLIGAN',
    mulligan: { rule: 'LONDON', firstMulliganFree: true },
    players: {
      'player-1': player('player-1', [card('card-1'), card('card-2')], 'DECIDING', false),
      'player-2': player('player-2', [], 'DECIDING', false),
    },
    turn: { activePlayerId: 'player-1', phase: 'main', number: 1 },
    stack: [],
    arrows: [],
    attachments: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-01-01T00:00:00+00:00',
  };
}

function player(
  id: string,
  hand: GameCardInstance[],
  status: 'DECIDING' | 'SCRYING' | 'READY',
  ready: boolean,
): GamePlayerState {
  return {
    user: { id, email: `${id}@example.test`, displayName: id, roles: [] },
    life: 40,
    zones: {
      library: [],
      hand,
      battlefield: [],
      graveyard: [],
      exile: [],
      command: [],
    },
    zoneCounts: {
      library: 0,
      hand: hand.length,
      battlefield: 0,
      graveyard: 0,
      exile: 0,
      command: 0,
    },
    handCount: hand.length,
    mulligan: {
      rule: 'LONDON',
      mulligansTaken: 0,
      effectiveMulligans: 0,
      drawCount: 7,
      bottomSelectionCount: 0,
      finalHandSize: 7,
      needsBottomSelection: false,
      bottomOrderMode: 'PLAYER_CHOSEN_ORDER',
      needsScryAfterKeep: false,
      canTakeAnotherMulligan: true,
      status,
      ready,
      handCount: hand.length,
    },
    commanderDamage: {},
    counters: {},
  };
}

function publicPlayer(
  playerId: string,
  handCount: number,
  status: 'DECIDING' | 'SCRYING' | 'READY',
  ready: boolean,
) {
  return {
    playerId,
    displayName: playerId,
    handCount,
    mulligansTaken: 0,
    effectiveMulligans: 0,
    status,
    ready,
  };
}

function privateMulliganState(patch: Partial<GameplayMulliganPrivateStateMessage['mulligan']> = {}): GameplayMulliganPrivateStateMessage['mulligan'] {
  return {
    rule: 'LONDON',
    mulligansTaken: 0,
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
    ...patch,
  };
}

function card(instanceId: string, name = instanceId): GameCardInstance {
  return {
    instanceId,
    name,
    imageUris: { normal: `https://cards.test/${instanceId}.jpg` },
    tapped: false,
    zone: 'hand',
  };
}
