import { TestBed } from '@angular/core/testing';
import { GameCardInstance, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';
import { GameTableBattlefieldDragState } from '../state/game-table-battlefield-drag.state';
import { GameTableBattlefieldDragContext, GameTableBattlefieldDragCoordinatorService } from './game-table-battlefield-drag-coordinator.service';
import { GameTableDragService } from './game-table-drag.service';
import { GameTablePointerDragService } from './game-table-pointer-drag.service';

describe('GameTableBattlefieldDragCoordinatorService', () => {
  let service: GameTableBattlefieldDragCoordinatorService;
  let state: GameTableBattlefieldDragState;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        GameTableBattlefieldDragCoordinatorService,
        GameTableBattlefieldDragState,
        GameTableDragService,
        GameTablePointerDragService,
      ],
    });

    service = TestBed.inject(GameTableBattlefieldDragCoordinatorService);
    state = TestBed.inject(GameTableBattlefieldDragState);
    document.body.replaceChildren();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('preserves x when an active alignment guide snaps y', () => {
    const position = service.positionWithAlignmentGuide(contextWithSnapshot(snapshotWithBattlefield([
      card('reference', { x: 20, y: 90 }),
    ])), 'player-1', 'dragged', { x: 123, y: 96 }, 90);

    expect(position).toEqual({ x: 123, y: 90 });
  });

  it('preserves x when external battlefield alignment snaps y', () => {
    const position = service.updateExternalBattlefieldAlignmentGuide(
      contextWithSnapshot(snapshotWithBattlefield([
        card('reference', { x: 20, y: 90 }),
      ])),
      'player-1',
      'dragged',
      { x: 321, y: 96 },
    );

    expect(position).toEqual({ x: 321, y: 90 });
    expect(state.alignmentGuide()).toEqual({
      playerId: 'player-1',
      y: 90,
      referenceInstanceIds: ['reference'],
    });
  });

  it('preserves x when mana row snaps y', () => {
    const battlefield = document.createElement('div');
    battlefield.className = 'battlefield';
    battlefield.dataset['playerId'] = 'player-1';
    const manaLane = document.createElement('div');
    manaLane.dataset['manaLane'] = '';
    Object.defineProperty(manaLane, 'offsetTop', { configurable: true, value: 200 });
    battlefield.appendChild(manaLane);
    document.body.appendChild(battlefield);

    expect(service.positionWithManaLane('player-1', { x: 234, y: 88 })).toEqual({ x: 234, y: 208 });
  });
});

function contextWithSnapshot(snapshot: GameSnapshot): GameTableBattlefieldDragContext {
  return {
    zones: ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'],
    snapshot: () => snapshot,
    selectedCards: () => [],
    findCard: (playerId: string, zone: GameZoneName, instanceId: string) =>
      snapshot.players[playerId]?.zones[zone].find((candidate) => candidate.instanceId === instanceId) ?? null,
    updateLocalCardPosition: () => undefined,
  };
}

function snapshotWithBattlefield(battlefield: GameCardInstance[]): GameSnapshot {
  return {
    version: 1,
    players: {
      'player-1': {
        user: { id: 'user-1', email: 'user@test', displayName: 'User', roles: [] },
        life: 40,
        zones: {
          library: [],
          hand: [],
          battlefield,
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
    createdAt: '',
  };
}

function card(instanceId: string, position: { x: number; y: number }): GameCardInstance {
  return {
    instanceId,
    name: instanceId,
    tapped: false,
    position,
  };
}
