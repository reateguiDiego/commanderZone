import { TestBed } from '@angular/core/testing';
import { GameCardInstance } from '../../../../core/models/game.model';
import { GameTablePointerDragService } from './game-table-pointer-drag.service';
import { GameTableZonePointerDragService } from './game-table-zone-pointer-drag.service';

describe('GameTableZonePointerDragService', () => {
  let service: GameTableZonePointerDragService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [GameTablePointerDragService, GameTableZonePointerDragService],
    });
    service = TestBed.inject(GameTableZonePointerDragService);
  });

  it('does not start drags for mouse pointers', () => {
    const zone = zoneElement();

    const started = service.start(pointerEvent({
      currentTarget: zone,
      pointerType: 'mouse',
      clientX: 20,
      clientY: 20,
    }), 'player-1', 'graveyard', card());

    expect(started).toBe(false);
  });

  it('starts drags for mouse pointers when explicitly allowed', () => {
    const zone = zoneElement();
    const exile = document.createElement('button');
    exile.dataset['gameDropZone'] = 'exile';
    exile.dataset['zone'] = 'exile';
    exile.dataset['playerId'] = 'player-1';
    const restore = mockElementsFromPoint([exile]);

    const started = service.start(pointerEvent({
      currentTarget: zone,
      pointerType: 'mouse',
      pointerId: 11,
      clientX: 20,
      clientY: 20,
    }), 'player-1', 'command', { ...card(), instanceId: 'commander-2', zone: 'command' }, { allowMouse: true });
    service.move(pointerEvent({
      pointerType: 'mouse',
      pointerId: 11,
      clientX: 80,
      clientY: 20,
    }));
    const result = service.end(pointerEvent({
      pointerType: 'mouse',
      pointerId: 11,
      clientX: 80,
      clientY: 20,
    }));

    expect(started).toBe(true);
    expect(result?.request).toEqual({
      playerId: 'player-1',
      targetPlayerId: 'player-1',
      fromZone: 'command',
      toZone: 'exile',
      instanceId: 'commander-2',
      rawZone: 'exile',
    });

    restore();
  });

  it('does not start without a top zone card', () => {
    const zone = zoneElement();

    const started = service.start(pointerEvent({
      currentTarget: zone,
      pointerType: 'touch',
      clientX: 20,
      clientY: 20,
    }), 'player-1', 'graveyard', null);

    expect(started).toBe(false);
  });

  it('waits for the movement threshold before starting a touch drag', () => {
    const zone = zoneElement();
    service.start(pointerEvent({
      currentTarget: zone,
      pointerType: 'touch',
      pointerId: 2,
      clientX: 20,
      clientY: 20,
    }), 'player-1', 'graveyard', card());

    const move = service.move(pointerEvent({ pointerId: 2, clientX: 24, clientY: 22 }));

    expect(move).toBeNull();
    expect(service.dragMove()).toBeNull();
  });

  it('does not start while still within the long-press cancellation window', () => {
    const zone = zoneElement();
    service.start(pointerEvent({
      currentTarget: zone,
      pointerType: 'touch',
      pointerId: 2,
      clientX: 20,
      clientY: 20,
    }), 'player-1', 'graveyard', card());

    const move = service.move(pointerEvent({ pointerId: 2, clientX: 31, clientY: 20 }));

    expect(move).toBeNull();
    expect(service.dragMove()).toBeNull();
  });

  it('resolves a battlefield drop request after a touch drag crosses the threshold', () => {
    const zone = zoneElement();
    const battlefield = document.createElement('div');
    battlefield.className = 'battlefield';
    battlefield.dataset['gameDropZone'] = 'battlefield';
    battlefield.dataset['zone'] = 'battlefield';
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
    const restore = mockElementsFromPoint([battlefield]);

    service.start(pointerEvent({
      currentTarget: zone,
      pointerType: 'touch',
      pointerId: 3,
      clientX: 20,
      clientY: 20,
    }), 'player-1', 'graveyard', card());
    service.move(pointerEvent({ pointerId: 3, clientX: 150, clientY: 100 }));
    const result = service.end(pointerEvent({ pointerId: 3, clientX: 150, clientY: 100 }));

    expect(result?.request).toEqual({
      playerId: 'player-1',
      targetPlayerId: 'player-1',
      fromZone: 'graveyard',
      toZone: 'battlefield',
      instanceId: 'graveyard-1',
      rawZone: 'battlefield',
      position: { x: 120, y: 70 },
    });

    restore();
  });

  it('clamps zone pointer drops to the mana row using normal battlefield card size', () => {
    const zone = zoneElement();
    const battlefield = document.createElement('div');
    battlefield.className = 'battlefield';
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
    manaLane.dataset['gameDropZone'] = 'mana';
    manaLane.dataset['zone'] = 'mana';
    manaLane.dataset['playerId'] = 'player-1';
    manaLane.dataset['manaLane'] = '';
    manaLane.getBoundingClientRect = () => ({
      x: 10,
      y: 210,
      width: 500,
      height: 120,
      top: 210,
      right: 510,
      bottom: 330,
      left: 10,
      toJSON: () => ({}),
    } as DOMRect);
    battlefield.appendChild(manaLane);
    const restore = mockElementsFromPoint([manaLane]);

    service.start(pointerEvent({
      currentTarget: zone,
      pointerType: 'touch',
      pointerId: 7,
      clientX: 20,
      clientY: 20,
    }), 'player-1', 'graveyard', card());
    service.move(pointerEvent({ pointerId: 7, clientX: 150, clientY: 240 }));
    const result = service.end(pointerEvent({ pointerId: 7, clientX: 150, clientY: 240 }));

    expect(result?.request).toEqual({
      playerId: 'player-1',
      targetPlayerId: 'player-1',
      fromZone: 'graveyard',
      toZone: 'battlefield',
      instanceId: 'graveyard-1',
      rawZone: 'mana',
      position: { x: 114, y: 141 },
    });

    restore();
  });

  it('resolves hand and pile zones for touch drags', () => {
    const zone = zoneElement();
    const hand = document.createElement('div');
    hand.dataset['gameDropZone'] = 'hand';
    hand.dataset['zone'] = 'hand';
    hand.dataset['playerId'] = 'player-1';
    const restoreHand = mockElementsFromPoint([hand]);

    service.start(pointerEvent({
      currentTarget: zone,
      pointerType: 'pen',
      pointerId: 4,
      clientX: 20,
      clientY: 20,
    }), 'player-1', 'graveyard', card());
    service.move(pointerEvent({ pointerId: 4, clientX: 20, clientY: 80 }));
    expect(service.end(pointerEvent({ pointerId: 4, clientX: 20, clientY: 80 }))?.request?.toZone).toBe('hand');
    restoreHand();

    const exile = document.createElement('button');
    exile.dataset['gameDropZone'] = 'exile';
    exile.dataset['zone'] = 'exile';
    exile.dataset['playerId'] = 'player-1';
    const restoreExile = mockElementsFromPoint([exile]);

    service.start(pointerEvent({
      currentTarget: zone,
      pointerType: 'touch',
      pointerId: 5,
      clientX: 20,
      clientY: 20,
    }), 'player-1', 'graveyard', card());
    service.move(pointerEvent({ pointerId: 5, clientX: 60, clientY: 20 }));
    expect(service.end(pointerEvent({ pointerId: 5, clientX: 60, clientY: 20 }))?.request?.toZone).toBe('exile');
    restoreExile();
  });

  it('resolves command drops only for commander zone cards', () => {
    const zone = zoneElement();
    const command = document.createElement('button');
    command.dataset['gameDropZone'] = 'command';
    command.dataset['zone'] = 'command';
    command.dataset['playerId'] = 'player-1';
    const restore = mockElementsFromPoint([command]);

    service.start(pointerEvent({
      currentTarget: zone,
      pointerType: 'touch',
      pointerId: 8,
      clientX: 20,
      clientY: 20,
    }), 'player-1', 'graveyard', card());
    service.move(pointerEvent({ pointerId: 8, clientX: 60, clientY: 20 }));
    expect(service.end(pointerEvent({ pointerId: 8, clientX: 60, clientY: 20 }))?.request).toBeNull();

    service.start(pointerEvent({
      currentTarget: zone,
      pointerType: 'touch',
      pointerId: 9,
      clientX: 20,
      clientY: 20,
    }), 'player-1', 'graveyard', card(), { knownCommanderInstanceIds: new Set(['graveyard-1']) });
    service.move(pointerEvent({ pointerId: 9, clientX: 60, clientY: 20 }));
    expect(service.end(pointerEvent({ pointerId: 9, clientX: 60, clientY: 20 }))?.request).toEqual({
      playerId: 'player-1',
      targetPlayerId: 'player-1',
      fromZone: 'graveyard',
      toZone: 'command',
      instanceId: 'graveyard-1',
      rawZone: 'command',
    });

    restore();
  });

  it('resolves player drop targets', () => {
    const zone = zoneElement();
    const playerTarget = document.createElement('button');
    playerTarget.dataset['playerDropTarget'] = 'player-2';
    const restore = mockElementsFromPoint([playerTarget]);

    service.start(pointerEvent({
      currentTarget: zone,
      pointerType: 'touch',
      pointerId: 6,
      clientX: 20,
      clientY: 20,
    }), 'player-1', 'graveyard', card());
    service.move(pointerEvent({ pointerId: 6, clientX: 80, clientY: 20 }));
    const result = service.end(pointerEvent({ pointerId: 6, clientX: 80, clientY: 20 }));

    expect(result?.request).toEqual({
      playerId: 'player-1',
      targetPlayerId: 'player-2',
      fromZone: 'graveyard',
      toZone: 'battlefield',
      instanceId: 'graveyard-1',
    });

    restore();
  });
});

function card(): GameCardInstance {
  return { instanceId: 'graveyard-1', name: 'Top Graveyard Card', zone: 'graveyard', tapped: false };
}

function zoneElement(): HTMLElement {
  const zone = document.createElement('button');
  zone.innerHTML = '<span class="zone-art"></span>';
  const zoneArt = zone.querySelector<HTMLElement>('.zone-art')!;
  zoneArt.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width: 100,
    height: 140,
    top: 0,
    right: 100,
    bottom: 140,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect);

  return zone;
}

function mockElementsFromPoint(elements: Element[]): () => void {
  const original = document.elementsFromPoint;
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: vi.fn(() => elements),
  });

  return () => {
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: original,
    });
  };
}

function pointerEvent(patch: Partial<PointerEvent> & { clientX: number; clientY: number }): PointerEvent {
  return {
    button: 0,
    pointerId: 1,
    pointerType: 'touch',
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...patch,
  } as unknown as PointerEvent;
}
