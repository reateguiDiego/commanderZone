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

  it('does not activate mana row aid when only the dragged card overlaps the lane', () => {
    const { battlefield, cardElement } = appendBattlefieldWithManaLane();
    const selectedCard = card('dragged', { x: 20, y: 170 });
    const updateLocalCardPosition = vi.fn();
    cardElement.dataset['cardInstanceId'] = selectedCard.instanceId;
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [battlefield]),
    });

    service.updateBattlefieldDragAid(pointerEvent(150, 232), selectedCard.instanceId, {
      ...contextWithSnapshot(snapshotWithBattlefield([selectedCard])),
      selectedCards: () => [{ playerId: 'player-1', zone: 'battlefield', card: selectedCard }],
      updateLocalCardPosition,
    });

    expect(state.manaLaneDropPlayerId()).toBeNull();
    expect(updateLocalCardPosition).not.toHaveBeenCalled();

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('activates mana row aid when the dragged card top edge reaches the lane', () => {
    const { battlefield, cardElement } = appendBattlefieldWithManaLane();
    const selectedCard = card('dragged', { x: 20, y: 240 });
    const updateLocalCardPosition = vi.fn();
    cardElement.dataset['cardInstanceId'] = selectedCard.instanceId;
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [battlefield]),
    });

    service.updateBattlefieldDragAid(pointerEvent(150, 260), selectedCard.instanceId, {
      ...contextWithSnapshot(snapshotWithBattlefield([selectedCard])),
      selectedCards: () => [{ playerId: 'player-1', zone: 'battlefield', card: selectedCard }],
      updateLocalCardPosition,
    });

    expect(state.manaLaneDropPlayerId()).toBe('player-1');
    expect(updateLocalCardPosition).toHaveBeenCalledWith('player-1', selectedCard.instanceId, { x: 20, y: 248 });

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('activates mana row aid when the dragged card top is inside the lower mana band', () => {
    const { battlefield, cardElement } = appendBattlefieldWithManaLane();
    const selectedCard = card('dragged', { x: 20, y: 280 });
    const updateLocalCardPosition = vi.fn();
    cardElement.dataset['cardInstanceId'] = selectedCard.instanceId;
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [battlefield]),
    });

    service.updateBattlefieldDragAid(pointerEvent(150, 300), selectedCard.instanceId, {
      ...contextWithSnapshot(snapshotWithBattlefield([selectedCard])),
      selectedCards: () => [{ playerId: 'player-1', zone: 'battlefield', card: selectedCard }],
      updateLocalCardPosition,
    });

    expect(state.manaLaneDropPlayerId()).toBe('player-1');
    expect(updateLocalCardPosition).toHaveBeenCalledWith('player-1', selectedCard.instanceId, { x: 20, y: 248 });

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
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

function appendBattlefieldWithManaLane(): { battlefield: HTMLElement; cardElement: HTMLElement } {
  const battlefield = document.createElement('div');
  battlefield.className = 'battlefield';
  battlefield.dataset['playerId'] = 'player-1';
  battlefield.getBoundingClientRect = () => ({
    x: 10,
    y: 10,
    width: 500,
    height: 320,
    top: 10,
    right: 510,
    bottom: 330,
    left: 10,
    toJSON: () => ({}),
  } as DOMRect);
  const manaLane = document.createElement('div');
  manaLane.dataset['manaLane'] = '';
  Object.defineProperty(manaLane, 'offsetTop', { configurable: true, value: 240 });
  manaLane.getBoundingClientRect = () => ({
    x: 10,
    y: 250,
    width: 500,
    height: 60,
    top: 250,
    right: 510,
    bottom: 310,
    left: 10,
    toJSON: () => ({}),
  } as DOMRect);
  const cardElement = document.createElement('button');
  cardElement.dataset['testid'] = 'game-card';
  cardElement.dataset['zone'] = 'battlefield';
  cardElement.getBoundingClientRect = () => ({
    x: 30,
    y: 180,
    width: 100,
    height: 140,
    top: 180,
    right: 130,
    bottom: 320,
    left: 30,
    toJSON: () => ({}),
  } as DOMRect);
  battlefield.append(manaLane, cardElement);
  document.body.appendChild(battlefield);

  return { battlefield, cardElement };
}

function pointerEvent(clientX: number, clientY: number): PointerEvent {
  return { clientX, clientY } as PointerEvent;
}
