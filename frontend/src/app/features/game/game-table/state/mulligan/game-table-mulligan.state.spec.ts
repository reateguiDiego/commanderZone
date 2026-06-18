import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { GameCardInstance, GamePlayerState, GameSnapshot } from '../../../../../core/models/game.model';
import { GameplayMulliganPrivateStateMessage } from '../../../../../core/models/game-realtime.model';
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

function card(instanceId: string): GameCardInstance {
  return {
    instanceId,
    name: instanceId,
    tapped: false,
    zone: 'hand',
  };
}
