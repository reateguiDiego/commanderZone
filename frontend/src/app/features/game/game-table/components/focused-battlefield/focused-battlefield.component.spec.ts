import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, Minus, Plus, RotateCcw, X } from 'lucide-angular';
import { GameAttachment, GameBattlefieldStack, GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { PlayerView } from '../../game-table.store';
import { FocusedBattlefieldComponent } from './focused-battlefield.component';

const FOCUSED_GEOMETRY_CACHE_STORAGE_KEY = 'cz_perf_focused_geometry_cache';
const BATTLEFIELD_BOUNDS_STORAGE_KEY = 'cz_perf_battlefield_bounds';

describe('FocusedBattlefieldComponent', () => {
  beforeEach(() => {
    window.localStorage.removeItem(FOCUSED_GEOMETRY_CACHE_STORAGE_KEY);
    window.localStorage.removeItem(BATTLEFIELD_BOUNDS_STORAGE_KEY);
  });

  afterEach(() => {
    window.localStorage.removeItem(FOCUSED_GEOMETRY_CACHE_STORAGE_KEY);
    window.localStorage.removeItem(BATTLEFIELD_BOUNDS_STORAGE_KEY);
  });

  it('exposes the player battlefield as a motion zone', async () => {
    const { fixture } = await renderFocusedBattlefield();

    const battlefield = fixture.nativeElement.querySelector('[data-testid="battlefield-zone"]') as HTMLElement;
    expect(battlefield.dataset['motionZone']).toBe('player-1:battlefield');
  });

  it('keeps the battlefield container stationary when a card enters', async () => {
    const { fixture } = await renderFocusedBattlefield();
    const battlefield = fixture.nativeElement.querySelector('[data-testid="battlefield-zone"]') as HTMLElement;

    fixture.componentRef.setInput('player', playerView([
      { instanceId: 'card-1', name: 'Sol Ring', typeLine: 'Artifact', tapped: false },
      { instanceId: 'card-2', name: 'Arcane Signet', typeLine: 'Artifact', tapped: false },
      { instanceId: 'card-3', name: 'Command Tower', typeLine: 'Land', tapped: false },
      { instanceId: 'entered-card', name: 'Llanowar Elves', typeLine: 'Creature - Elf Druid', tapped: false },
    ]));
    fixture.detectChanges();

    expect(battlefield.classList).not.toContain('board-transitioning');
    expect(cardElement(fixture, 'entered-card').classList).not.toContain('focus-entry-left');
    expect(cardElement(fixture, 'entered-card').classList).not.toContain('focus-entry-right');
    expect(cardElement(fixture, 'entered-card').classList).not.toContain('focus-entry-fade');
  });

  it('marks every card that acts as the active alignment reference', async () => {
    const { fixture } = await renderFocusedBattlefield({
      alignmentGuideFor: () => ({ y: 84, referenceInstanceIds: ['card-1', 'card-2'] }),
    });

    expect(cardElement(fixture, 'card-1').classList).toContain('alignment-reference');
    expect(cardElement(fixture, 'card-2').classList).toContain('alignment-reference');
    expect(cardElement(fixture, 'card-3').classList).not.toContain('alignment-reference');
  });

  it('hides a battlefield card while it is pending transfer to another zone', async () => {
    const { fixture } = await renderFocusedBattlefield({
      isCardTransferPending: (_playerId, _zone, card) => card.instanceId === 'card-1',
    });

    expect(cardElement(fixture, 'card-1').style.visibility).toBe('hidden');
    expect(cardElement(fixture, 'card-2').style.visibility).not.toBe('hidden');
  });

  it('emits a counter delete request from a zero marker', async () => {
    const { fixture } = await renderFocusedBattlefield({
      firstCounter: (card) => card.instanceId === 'card-1' ? { key: 'red', value: 0 } : null,
    });
    const opened = vi.fn();
    fixture.componentInstance.cardCounterDeleteRequested.subscribe(opened);

    const marker = cardElement(fixture, 'card-1').querySelector('.counter-marker') as HTMLElement;
    marker.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    expect(opened).toHaveBeenCalledWith(expect.objectContaining({
      playerId: 'player-1',
      zone: 'battlefield',
      key: 'red',
    }));
  });

  it('renders the battle counter when the active face provides defense', async () => {
    const { fixture } = await renderFocusedBattlefield({
      battlefieldCards: [
        { instanceId: 'battle-1', name: 'Invasion of Zendikar', typeLine: 'Battle - Siege', tapped: false },
      ],
      cardBattleValue: (card) => card.instanceId === 'battle-1' ? 4 : null,
    });

    expect(cardElement(fixture, 'battle-1').querySelector('app-battle-counter')).not.toBeNull();
    expect(cardElement(fixture, 'battle-1').querySelector('app-loyalty-counter')).toBeNull();
  });

  it('forwards battle counter clicks with battlefield context', async () => {
    const { fixture } = await renderFocusedBattlefield({
      battlefieldCards: [
        { instanceId: 'battle-1', name: 'Invasion of Zendikar', typeLine: 'Battle - Siege', tapped: false },
      ],
      cardBattleValue: (card) => card.instanceId === 'battle-1' ? 4 : null,
    });
    const changed = vi.fn();
    fixture.componentInstance.cardBattleChanged.subscribe(changed);

    const battleCounter = cardElement(fixture, 'battle-1').querySelector('.battle-counter') as HTMLElement;
    battleCounter.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));

    expect(changed).toHaveBeenCalledWith(expect.objectContaining({
      playerId: 'player-1',
      zone: 'battlefield',
      card: expect.objectContaining({ instanceId: 'battle-1' }),
      delta: 1,
    }));
  });

  it('forwards saga counter clicks with battlefield context', async () => {
    const { fixture } = await renderFocusedBattlefield({
      battlefieldCards: [
        { instanceId: 'saga-1', name: 'Binding the Old Gods', typeLine: 'Enchantment - Saga', tapped: false },
      ],
    });
    const changed = vi.fn();
    fixture.componentInstance.cardSagaChanged.subscribe(changed);

    const sagaCounter = cardElement(fixture, 'saga-1').querySelector('.saga-counter') as HTMLElement;
    sagaCounter.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));

    expect(changed).toHaveBeenCalledWith(expect.objectContaining({
      playerId: 'player-1',
      zone: 'battlefield',
      card: expect.objectContaining({ instanceId: 'saga-1' }),
      delta: 1,
    }));
  });

  it('does not emit loyalty or saga changes for an opponent battlefield', async () => {
    const { fixture } = await renderFocusedBattlefield({
      isCurrentPlayer: (_playerId) => false,
    });
    const sagaChanged = vi.fn();
    const loyaltyChanged = vi.fn();
    const card = { instanceId: 'opponent-card', name: 'Opponent permanent', tapped: false };
    fixture.componentInstance.cardSagaChanged.subscribe(sagaChanged);
    fixture.componentInstance.cardLoyaltyChanged.subscribe(loyaltyChanged);

    fixture.componentInstance.changeSaga(new MouseEvent('pointerup'), 'player-2', card, 1);
    fixture.componentInstance.changeLoyalty(new MouseEvent('pointerup'), 'player-2', card, 1);

    expect(sagaChanged).not.toHaveBeenCalled();
    expect(loyaltyChanged).not.toHaveBeenCalled();
  });

  it('does not use the card origin owner to authorize a saga change', async () => {
    const { fixture } = await renderFocusedBattlefield({
      battlefieldCards: [
        { instanceId: 'saga-1', ownerId: 'player-2', controllerId: 'player-1', name: 'Binding the Old Gods', typeLine: 'Enchantment - Saga', tapped: false },
      ],
      isCurrentPlayer: (_playerId) => false,
    });
    const changed = vi.fn();
    fixture.componentInstance.cardSagaChanged.subscribe(changed);

    const sagaCounter = cardElement(fixture, 'saga-1').querySelector('.saga-counter') as HTMLElement;
    sagaCounter.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));

    expect(changed).not.toHaveBeenCalled();
  });

  it('allows selecting an opponent card while choosing an arrow target', async () => {
    const { fixture } = await renderFocusedBattlefield({
      isCurrentPlayer: (_playerId) => false,
      allowArrowTargetSelection: true,
    });
    const clicked = vi.fn();
    fixture.componentInstance.cardClicked.subscribe(clicked);

    cardElement(fixture, 'card-1').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(clicked).toHaveBeenCalledWith(expect.objectContaining({
      playerId: 'player-1',
      card: expect.objectContaining({ instanceId: 'card-1' }),
    }));
  });

  it('keeps opponent battlefield clicks inert outside arrow targeting', async () => {
    const { fixture } = await renderFocusedBattlefield({
      isCurrentPlayer: (_playerId) => false,
    });
    const clicked = vi.fn();
    fixture.componentInstance.cardClicked.subscribe(clicked);

    cardElement(fixture, 'card-1').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(clicked).not.toHaveBeenCalled();
  });

  it('highlights every card in an attachment stack while hovering one member', async () => {
    const positions = new Map([
      ['target', { x: 100, y: 200 }],
      ['equipment', { x: 100, y: 182 }],
      ['loose-card', { x: 260, y: 200 }],
    ]);
    const { fixture } = await renderFocusedBattlefield({
      battlefieldCards: [
        { instanceId: 'target', name: 'Baleful Strix', typeLine: 'Creature - Bird', tapped: false },
        { instanceId: 'equipment', name: 'Sword', typeLine: 'Artifact', tapped: false },
        { instanceId: 'loose-card', name: 'Sol Ring', typeLine: 'Artifact', tapped: false },
      ],
      attachments: [attachment('attachment-1', 'equipment', 'target')],
      cardPosition: (card) => positions.get(card.instanceId) ?? null,
    });

    cardElement(fixture, 'equipment').dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    fixture.detectChanges();

    expect(cardElement(fixture, 'target').classList).toContain('attachment-stack-aura');
    expect(cardElement(fixture, 'equipment').classList).toContain('attachment-stack-aura');
    expect(cardElement(fixture, 'loose-card').classList).not.toContain('attachment-stack-aura');

    cardElement(fixture, 'equipment').dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    fixture.detectChanges();

    expect(cardElement(fixture, 'target').classList).not.toContain('attachment-stack-aura');
    expect(cardElement(fixture, 'equipment').classList).not.toContain('attachment-stack-aura');
  });

  it('keeps attachment interaction rules scoped to actual attachments', async () => {
    const equipment = { instanceId: 'equipment', name: 'Sword', typeLine: 'Artifact', tapped: false } satisfies GameCardInstance;
    const landTop = { instanceId: 'land-top', name: 'Plains', typeLine: 'Basic Land - Plains', tapped: false } satisfies GameCardInstance;
    const landUnder = { instanceId: 'land-under', name: 'Island', typeLine: 'Basic Land - Island', tapped: false } satisfies GameCardInstance;
    const { fixture } = await renderFocusedBattlefield({
      battlefieldCards: [
        { instanceId: 'target', name: 'Baleful Strix', typeLine: 'Creature - Bird', tapped: false },
        equipment,
        landTop,
        landUnder,
      ],
      attachments: [attachment('attachment-1', 'equipment', 'target')],
      battlefieldStacks: [battlefieldStack('stack-1', 'land-under', 'land-top')],
      cardPosition: (card) => ({ x: card.instanceId === 'land-under' ? 110 : 100, y: 200 }),
    });
    const doubleClicked = vi.fn();
    fixture.componentInstance.cardDoubleClicked.subscribe(doubleClicked);

    fixture.componentInstance.onCardDoubleClick(new MouseEvent('dblclick'), 'player-1', equipment);
    fixture.componentInstance.onCardDoubleClick(new MouseEvent('dblclick'), 'player-1', landUnder);

    expect(doubleClicked).toHaveBeenCalledTimes(1);
    expect(doubleClicked).toHaveBeenCalledWith(expect.objectContaining({ card: landUnder }));
  });

  it('renders a three-card land stack through the attachment presentation', async () => {
    const positions = new Map([
      ['land-top', { x: 100, y: 200 }],
      ['land-under-a', { x: 110, y: 182 }],
      ['land-under-b', { x: 120, y: 164 }],
    ]);
    const { fixture } = await renderFocusedBattlefield({
      battlefieldCards: [
        { instanceId: 'land-top', name: 'Command Tower', typeLine: 'Land', tapped: false },
        { instanceId: 'land-under-a', name: 'Island', typeLine: 'Basic Land - Island', tapped: false },
        { instanceId: 'land-under-b', name: 'Forest', typeLine: 'Basic Land - Forest', tapped: false },
      ],
      battlefieldStacks: [
        battlefieldStack('stack-a', 'land-under-a', 'land-top'),
        battlefieldStack('stack-b', 'land-under-b', 'land-top'),
      ],
      cardPosition: (card) => positions.get(card.instanceId) ?? null,
    });

    expect(cardElement(fixture, 'land-top').classList).toContain('attachment-stack-target');
    expect(cardElement(fixture, 'land-under-a').classList).toContain('attachment-stack-equipment');
    expect(cardElement(fixture, 'land-under-b').classList).toContain('attachment-stack-equipment');
    expect(cardElement(fixture, 'land-top').classList).not.toContain('land-stack-card');

    cardElement(fixture, 'land-under-a').dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    fixture.detectChanges();

    expect(cardElement(fixture, 'land-top').classList).toContain('attachment-stack-aura');
    expect(cardElement(fixture, 'land-under-b').classList).toContain('attachment-stack-aura');
  });

  it('uses identical display offsets for three-card stacks and attachments', async () => {
    const positions = new Map([
      ['land-top', { x: 100, y: 200 }],
      ['land-under-a', { x: 400, y: 600 }],
      ['land-under-b', { x: 20, y: 20 }],
      ['attachment-target', { x: 300, y: 200 }],
      ['attachment-a', { x: 420, y: 600 }],
      ['attachment-b', { x: 20, y: 20 }],
    ]);
    const { fixture } = await renderFocusedBattlefield({
      battlefieldCards: [
        { instanceId: 'land-top', name: 'Command Tower', typeLine: 'Land', tapped: false },
        { instanceId: 'land-under-a', name: 'Island', typeLine: 'Basic Land - Island', tapped: false },
        { instanceId: 'land-under-b', name: 'Forest', typeLine: 'Basic Land - Forest', tapped: false },
        { instanceId: 'attachment-target', name: 'Baleful Strix', typeLine: 'Creature - Bird', tapped: false },
        { instanceId: 'attachment-a', name: 'Sword', typeLine: 'Artifact - Equipment', tapped: false },
        { instanceId: 'attachment-b', name: 'Hammer', typeLine: 'Artifact - Equipment', tapped: false },
      ],
      battlefieldStacks: [
        battlefieldStack('stack-a', 'land-under-a', 'land-top'),
        battlefieldStack('stack-b', 'land-under-b', 'land-top'),
      ],
      attachments: [
        attachment('attachment-a', 'attachment-a', 'attachment-target'),
        attachment('attachment-b', 'attachment-b', 'attachment-target'),
      ],
      cardPosition: (card) => positions.get(card.instanceId) ?? null,
    });
    const displayPositions = fixture.componentInstance.permanentStackDisplayPositions();

    expect(displayPositions.get('land-top')).toEqual({ x: 100, y: 200 });
    expect(displayPositions.get('land-under-a')).toEqual({ x: 110, y: 182 });
    expect(displayPositions.get('land-under-b')).toEqual({ x: 120, y: 164 });
    expect(displayPositions.get('attachment-target')).toEqual({ x: 300, y: 200 });
    expect(displayPositions.get('attachment-a')).toEqual({ x: 310, y: 182 });
    expect(displayPositions.get('attachment-b')).toEqual({ x: 320, y: 164 });
  });

  it('mirrors stack layers for vertically inverted Grid battlefields', async () => {
    const { fixture } = await renderFocusedBattlefield({
      verticallyInverted: true,
      battlefieldCards: [
        { instanceId: 'target', name: 'Baleful Strix', typeLine: 'Creature - Bird', tapped: false },
        { instanceId: 'equipment', name: 'Sword', typeLine: 'Artifact - Equipment', tapped: false },
      ],
      attachments: [attachment('attachment-1', 'equipment', 'target')],
      cardPosition: (card) => card.instanceId === 'target' ? { x: 100, y: 200 } : { x: 110, y: 182 },
    });

    const displayPositions = fixture.componentInstance.permanentStackDisplayPositions();

    expect(displayPositions.get('target')).toEqual({ x: 100, y: 200 });
    expect(displayPositions.get('equipment')).toEqual({ x: 110, y: 218 });
  });

  it('does not pull the dragged land into a transient stack layout before drop', async () => {
    const positions = new Map([
      ['land-top', { x: 100, y: 200 }],
      ['land-under', { x: 100, y: 182 }],
      ['dragged-land', { x: 118, y: 170 }],
    ]);
    const { fixture } = await renderFocusedBattlefield({
      battlefieldCards: [
        { instanceId: 'land-top', name: 'Command Tower', typeLine: 'Land', tapped: false },
        { instanceId: 'land-under', name: 'Island', typeLine: 'Basic Land - Island', tapped: false },
        { instanceId: 'dragged-land', name: 'Forest', typeLine: 'Basic Land - Forest', tapped: false },
      ],
      cardPosition: (card) => positions.get(card.instanceId) ?? null,
      isDraggingCard: (card) => card.instanceId === 'dragged-land',
    });

    const dragged = cardElement(fixture, 'dragged-land');

    expect(dragged.classList).not.toContain('land-stack-card');
    expect(dragged.style.left).toBe('118px');
    expect(dragged.style.top).toBe('170px');
  });

  it('prevents native dragstart on battlefield background to avoid ghost drags', async () => {
    const { fixture } = await renderFocusedBattlefield();
    const battlefield = fixture.nativeElement.querySelector('[data-testid="battlefield-zone"]') as HTMLElement;
    const event = new Event('dragstart', { bubbles: true, cancelable: true });

    battlefield.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('suppresses triple-click pointerdown interactions on battlefield surface', async () => {
    const { fixture } = await renderFocusedBattlefield();
    const battlefield = fixture.nativeElement.querySelector('[data-testid="battlefield-zone"]') as HTMLElement;
    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, detail: 3 });

    battlefield.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('renders monarch using its physical card image when provided', async () => {
    const monarch = {
      instanceId: 'monarch:entity-1',
      name: 'The Monarch',
      imageUris: { normal: '/cards/the-monarch.jpg' },
      typeLine: 'Card',
      layout: 'monarch',
      tapped: false,
    } satisfies GameCardInstance;
    const { fixture } = await renderFocusedBattlefield({
      mechanicCards: [monarch],
      cardImage: (card) => card.imageUris?.['normal'] ?? null,
    });

    const image = cardElement(fixture, 'monarch:entity-1').querySelector('img') as HTMLImageElement | null;

    expect(image?.getAttribute('src')).toBe('/cards/the-monarch.jpg');
  });

  it('renders initiative using its physical card image when provided', async () => {
    const initiative = {
      instanceId: 'initiative:entity-1',
      name: 'The Initiative',
      imageUris: { normal: '/cards/the-initiative.jpg' },
      typeLine: 'Card',
      layout: 'initiative',
      tapped: false,
    } satisfies GameCardInstance;
    const { fixture } = await renderFocusedBattlefield({
      mechanicCards: [initiative],
      cardImage: (card) => card.imageUris?.['normal'] ?? null,
    });

    const image = cardElement(fixture, 'initiative:entity-1').querySelector('img') as HTMLImageElement | null;

    expect(image?.getAttribute('src')).toBe('/cards/the-initiative.jpg');
  });

  it('renders overlay mechanic cards only once when they also exist in the battlefield zone', async () => {
    const dayNight = {
      instanceId: 'day-night-card',
      name: 'Day // Night',
      typeLine: 'Card // Card',
      layout: 'double_faced_token',
      tapped: false,
      zone: 'battlefield',
    } satisfies GameCardInstance;
    const emblem = {
      instanceId: 'emblem-card',
      name: 'Chandra Emblem',
      typeLine: 'Emblem',
      layout: 'emblem',
      tapped: false,
      zone: 'battlefield',
    } satisfies GameCardInstance;
    const normalCard = {
      instanceId: 'normal-card',
      name: 'Llanowar Elves',
      typeLine: 'Creature - Elf Druid',
      tapped: false,
      zone: 'battlefield',
    } satisfies GameCardInstance;
    const { fixture } = await renderFocusedBattlefield({
      battlefieldCards: [dayNight, emblem, normalCard],
      mechanicCards: [dayNight, emblem],
    });

    expect(cardElements(fixture, 'day-night-card')).toHaveLength(1);
    expect(cardElements(fixture, 'emblem-card')).toHaveLength(1);
    expect(cardElements(fixture, 'normal-card')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('[data-testid="battlefield-mechanics-overlay"]')).not.toBeNull();
  });

  it('keeps measuring every requested card size when focused geometry caching is disabled', async () => {
    const { fixture } = await renderFocusedBattlefield();
    const card = battlefieldCard(fixture, 'card-1');
    prepareBattlefieldForMeasurement(fixture);
    const measured = measureCardElement(cardMeasurementElement(fixture, 'card-1'), { width: 100, height: 140 });
    fixture.componentRef.setInput('cardPosition', () => ({ x: 16, y: 24 }));

    try {
      expect(fixture.componentInstance.displayedCardPosition(card)).toEqual({ x: 16, y: 24 });
      expect(fixture.componentInstance.displayedCardPosition(card)).toEqual({ x: 16, y: 24 });

      expect(measured).toHaveBeenCalledTimes(2);
    } finally {
      measured.mockRestore();
    }
  });

  it('measures an equivalent card only once within a frame when focused geometry caching is enabled', async () => {
    window.localStorage.setItem(FOCUSED_GEOMETRY_CACHE_STORAGE_KEY, '1');
    const { fixture } = await renderFocusedBattlefield();
    const card = battlefieldCard(fixture, 'card-1');
    prepareBattlefieldForMeasurement(fixture);
    const measured = measureCardElement(cardMeasurementElement(fixture, 'card-1'), { width: 100, height: 140 });
    fixture.componentRef.setInput('cardPosition', () => ({ x: 16, y: 24 }));

    try {
      expect(fixture.componentInstance.displayedCardPosition(card)).toEqual({ x: 16, y: 24 });
      expect(fixture.componentInstance.displayedCardPosition(card)).toEqual({ x: 16, y: 24 });

      expect(measured).toHaveBeenCalledTimes(1);
    } finally {
      measured.mockRestore();
    }
  });

  it('caches fallback card measurements within the same frame', async () => {
    window.localStorage.setItem(FOCUSED_GEOMETRY_CACHE_STORAGE_KEY, '1');
    const { fixture } = await renderFocusedBattlefield();
    const card = battlefieldCard(fixture, 'card-1');
    const battlefield = prepareBattlefieldForMeasurement(fixture);
    const measured = measureCardElement(cardMeasurementElement(fixture, 'card-1'), { width: 0, height: 0 });
    const cardLookups = vi.spyOn(battlefield, 'querySelectorAll');
    fixture.componentRef.setInput('cardPosition', () => ({ x: 16, y: 24 }));

    try {
      fixture.componentInstance.displayedCardPosition(card);
      fixture.componentInstance.displayedCardPosition(card);

      expect(measured).toHaveBeenCalledTimes(1);
      expect(cardLookups).toHaveBeenCalledTimes(1);
    } finally {
      cardLookups.mockRestore();
      measured.mockRestore();
    }
  });

  it('keeps focused geometry entries scoped to the measured instance id', async () => {
    window.localStorage.setItem(FOCUSED_GEOMETRY_CACHE_STORAGE_KEY, '1');
    const { fixture } = await renderFocusedBattlefield({
      battlefieldCards: [
        { instanceId: 'card-1', name: 'Llanowar Elves', typeLine: 'Creature - Elf Druid', tapped: false },
        { instanceId: 'card-2', name: 'Sol Ring', typeLine: 'Artifact', tapped: false },
      ],
    });
    const firstCard = battlefieldCard(fixture, 'card-1');
    const secondCard = battlefieldCard(fixture, 'card-2');
    prepareBattlefieldForMeasurement(fixture);
    const firstMeasurement = measureCardElement(cardMeasurementElement(fixture, 'card-1'), { width: 100, height: 140 });
    const secondMeasurement = measureCardElement(cardMeasurementElement(fixture, 'card-2'), { width: 120, height: 168 });
    fixture.componentRef.setInput('cardPosition', (card: GameCardInstance) => card.instanceId === 'card-1'
      ? { x: 16, y: 24 }
      : { x: 40, y: 48 });

    try {
      fixture.componentInstance.displayedCardPosition(firstCard);
      fixture.componentInstance.displayedCardPosition(firstCard);
      fixture.componentInstance.displayedCardPosition(secondCard);
      fixture.componentInstance.displayedCardPosition(secondCard);

      expect(firstMeasurement).toHaveBeenCalledTimes(1);
      expect(secondMeasurement).toHaveBeenCalledTimes(1);
    } finally {
      secondMeasurement.mockRestore();
      firstMeasurement.mockRestore();
    }
  });

  it('remeasures focused geometry after the next animation frame', async () => {
    window.localStorage.setItem(FOCUSED_GEOMETRY_CACHE_STORAGE_KEY, '1');
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextFrame += 1;
      queuedFrames.set(nextFrame, callback);
      return nextFrame;
    });
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frame) => {
      queuedFrames.delete(frame);
    });

    try {
      const { fixture } = await renderFocusedBattlefield();
      flushAnimationFrames(queuedFrames);
      const card = battlefieldCard(fixture, 'card-1');
      prepareBattlefieldForMeasurement(fixture);
      const measured = measureCardElement(cardMeasurementElement(fixture, 'card-1'), { width: 100, height: 140 });
      fixture.componentRef.setInput('cardPosition', () => ({ x: 16, y: 24 }));

      try {
        fixture.componentInstance.displayedCardPosition(card);
        fixture.componentInstance.displayedCardPosition(card);
        expect(measured).toHaveBeenCalledTimes(1);

        flushAnimationFrames(queuedFrames);

        fixture.componentInstance.displayedCardPosition(card);
        expect(measured).toHaveBeenCalledTimes(2);
      } finally {
        measured.mockRestore();
        fixture.destroy();
      }
    } finally {
      cancelAnimationFrame.mockRestore();
      animationFrame.mockRestore();
    }
  });

  it('invalidates a focused geometry entry when its layout key changes', async () => {
    window.localStorage.setItem(FOCUSED_GEOMETRY_CACHE_STORAGE_KEY, '1');
    const { fixture } = await renderFocusedBattlefield();
    const card = battlefieldCard(fixture, 'card-1');
    prepareBattlefieldForMeasurement(fixture);
    const measured = measureCardElement(cardMeasurementElement(fixture, 'card-1'), { width: 100, height: 140 });
    fixture.componentRef.setInput('cardPosition', () => ({ x: 16, y: 24 }));
    fixture.componentRef.setInput('layoutKey', 'layout-a');

    try {
      fixture.componentInstance.displayedCardPosition(card);
      fixture.componentRef.setInput('layoutKey', 'layout-b');
      fixture.componentInstance.displayedCardPosition(card);

      expect(measured).toHaveBeenCalledTimes(2);
    } finally {
      measured.mockRestore();
    }
  });

  it('invalidates a focused geometry entry when its measured layout version changes', async () => {
    window.localStorage.setItem(FOCUSED_GEOMETRY_CACHE_STORAGE_KEY, '1');
    const originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
    const resizeCallbacks: ResizeObserverCallback[] = [];
    class ResizeObserverMock implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }

      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: ResizeObserverMock,
    });

    const queuedFrames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextFrame += 1;
      queuedFrames.set(nextFrame, callback);
      return nextFrame;
    });
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frame) => {
      queuedFrames.delete(frame);
    });

    try {
      const { fixture } = await renderFocusedBattlefield();
      flushAnimationFrames(queuedFrames);
      const card = battlefieldCard(fixture, 'card-1');
      prepareBattlefieldForMeasurement(fixture);
      const measured = measureCardElement(cardMeasurementElement(fixture, 'card-1'), { width: 100, height: 140 });
      fixture.componentRef.setInput('cardPosition', () => ({ x: 16, y: 24 }));

      try {
        fixture.componentInstance.displayedCardPosition(card);
        expect(measured).toHaveBeenCalledTimes(1);

        const resizeCallback = resizeCallbacks.at(-1);
        expect(resizeCallback).toBeDefined();
        resizeCallback!([{ } as ResizeObserverEntry], {} as ResizeObserver);
        const layoutRefreshFrame = [...queuedFrames.keys()].at(-1);
        const layoutRefresh = layoutRefreshFrame === undefined
          ? null
          : queuedFrames.get(layoutRefreshFrame);
        expect(layoutRefresh).not.toBeNull();
        queuedFrames.delete(layoutRefreshFrame!);
        layoutRefresh!(0);

        fixture.componentInstance.displayedCardPosition(card);
        expect(measured).toHaveBeenCalledTimes(2);
      } finally {
        measured.mockRestore();
        fixture.destroy();
      }
    } finally {
      cancelAnimationFrame.mockRestore();
      animationFrame.mockRestore();
      if (originalResizeObserver) {
        Object.defineProperty(globalThis, 'ResizeObserver', originalResizeObserver);
      } else {
        Reflect.deleteProperty(globalThis, 'ResizeObserver');
      }
    }
  });

  it('does not reuse a disconnected measured card element', async () => {
    window.localStorage.setItem(FOCUSED_GEOMETRY_CACHE_STORAGE_KEY, '1');
    const { fixture } = await renderFocusedBattlefield();
    const card = battlefieldCard(fixture, 'card-1');
    const battlefield = prepareBattlefieldForMeasurement(fixture, 200);
    const original = cardMeasurementElement(fixture, 'card-1');
    const originalMeasurement = measureCardElement(original, { width: 100, height: 100 });
    fixture.componentRef.setInput('cardPosition', () => ({ x: 16, y: 100 }));

    try {
      expect(fixture.componentInstance.displayedCardPosition(card)).toEqual({ x: 16, y: 100 });

      original.remove();
      const replacement = document.createElement('button');
      replacement.dataset['testid'] = 'game-card';
      replacement.dataset['cardInstanceId'] = 'card-1';
      battlefield.append(replacement);
      const replacementMeasurement = measureCardElement(replacement, { width: 100, height: 150 });

      try {
        expect(fixture.componentInstance.displayedCardPosition(card)).toEqual({ x: 16, y: 50 });
        expect(originalMeasurement).toHaveBeenCalledTimes(1);
        expect(replacementMeasurement).toHaveBeenCalledTimes(1);
      } finally {
        replacementMeasurement.mockRestore();
      }
    } finally {
      originalMeasurement.mockRestore();
    }
  });

  it('preserves stack and inverted display positions with focused geometry caching enabled', async () => {
    window.localStorage.setItem(FOCUSED_GEOMETRY_CACHE_STORAGE_KEY, '1');
    const positions = new Map([
      ['target', { x: 100, y: 200 }],
      ['equipment', { x: 110, y: 182 }],
    ]);
    const { fixture } = await renderFocusedBattlefield({
      verticallyInverted: true,
      battlefieldCards: [
        { instanceId: 'target', name: 'Baleful Strix', typeLine: 'Creature - Bird', tapped: false },
        { instanceId: 'equipment', name: 'Sword', typeLine: 'Artifact - Equipment', tapped: false },
      ],
      attachments: [attachment('attachment-1', 'equipment', 'target')],
    });
    prepareBattlefieldForMeasurement(fixture, 600);
    const targetMeasurement = measureCardElement(cardMeasurementElement(fixture, 'target'), { width: 100, height: 140 });
    const equipmentMeasurement = measureCardElement(cardMeasurementElement(fixture, 'equipment'), { width: 100, height: 140 });
    fixture.componentRef.setInput('cardPosition', (card: GameCardInstance) => positions.get(card.instanceId) ?? null);

    try {
      const target = battlefieldCard(fixture, 'target');
      const equipment = battlefieldCard(fixture, 'equipment');

      expect(fixture.componentInstance.permanentStackDisplayPositions().get('target')).toEqual({ x: 100, y: 200 });
      expect(fixture.componentInstance.permanentStackDisplayPositions().get('equipment')).toEqual({ x: 110, y: 218 });
      expect(fixture.componentInstance.displayedCardPosition(target)).toEqual({ x: 100, y: 260 });
      expect(fixture.componentInstance.displayedCardPosition(equipment)).toEqual({ x: 110, y: 242 });
    } finally {
      equipmentMeasurement.mockRestore();
      targetMeasurement.mockRestore();
    }
  });

  it('keeps measuring battlefield bounds during displayed positions when the bounds flag is disabled', async () => {
    const { fixture } = await renderFocusedBattlefield();
    const card = battlefieldCard(fixture, 'card-1');
    const battlefield = prepareBattlefieldForMeasurement(fixture, 0);
    Object.defineProperty(battlefield, 'clientWidth', { configurable: true, value: 0 });
    const bounds = vi.spyOn(battlefield, 'getBoundingClientRect').mockReturnValue(
      battlefieldBounds(500, 400),
    );
    const measured = measureCardElement(cardMeasurementElement(fixture, 'card-1'), { width: 100, height: 140 });
    fixture.componentRef.setInput('cardPosition', () => ({ x: 16, y: 300 }));

    try {
      expect(fixture.componentInstance.displayedCardPosition(card)).toEqual({ x: 16, y: 260 });
      expect(fixture.componentInstance.displayedCardPosition(card)).toEqual({ x: 16, y: 260 });

      expect(bounds).toHaveBeenCalledTimes(2);
    } finally {
      measured.mockRestore();
      bounds.mockRestore();
    }
  });

  it('uses premeasured bounds and card geometry without DOM metric reads during displayed positions', async () => {
    window.localStorage.setItem(BATTLEFIELD_BOUNDS_STORAGE_KEY, '1');
    const resizeObserver = mockResizeObserver();
    const animationFrames = mockAnimationFrames();

    try {
      const { fixture } = await renderFocusedBattlefield();
      const card = battlefieldCard(fixture, 'card-1');
      const battlefield = fixture.nativeElement.querySelector('[data-testid="battlefield-zone"]') as HTMLElement;
      const battlefieldMeasurement = measureBattlefieldBoundsWithAccessSpies(
        battlefield,
        battlefieldBounds(500, 400),
      );
      const cardMeasurement = measureCardElementWithAccessSpies(
        cardMeasurementElement(fixture, 'card-1'),
        { width: 100, height: 140 },
      );
      const probeMeasurement = measureCardElementWithAccessSpies(
        battlefieldCardSizeProbe(fixture),
        { width: 110, height: 154 },
      );
      fixture.componentRef.setInput('cardPosition', () => ({ x: 16, y: 300 }));

      try {
        emitLatestResize(resizeObserver.callbacks);
        flushAnimationFrames(animationFrames.queuedFrames);

        expect(fixture.componentInstance.displayedCardPosition(card)).toEqual({ x: 16, y: 260 });
        expect(battlefieldMeasurement.rect).toHaveBeenCalled();
        expect(cardMeasurement.bounds).toHaveBeenCalled();
        expect(probeMeasurement.bounds).toHaveBeenCalled();

        battlefieldMeasurement.rect.mockClear();
        battlefieldMeasurement.clientWidth.mockClear();
        battlefieldMeasurement.clientHeight.mockClear();
        cardMeasurement.bounds.mockClear();
        cardMeasurement.offsetWidth.mockClear();
        cardMeasurement.offsetHeight.mockClear();
        probeMeasurement.bounds.mockClear();
        probeMeasurement.offsetWidth.mockClear();
        probeMeasurement.offsetHeight.mockClear();

        expect(fixture.componentInstance.displayedCardPosition(card)).toEqual({ x: 16, y: 260 });
        expect(fixture.componentInstance.displayedCardPosition(card)).toEqual({ x: 16, y: 260 });
        expect(battlefieldMeasurement.rect).not.toHaveBeenCalled();
        expect(battlefieldMeasurement.clientWidth).not.toHaveBeenCalled();
        expect(battlefieldMeasurement.clientHeight).not.toHaveBeenCalled();
        expect(cardMeasurement.bounds).not.toHaveBeenCalled();
        expect(cardMeasurement.offsetWidth).not.toHaveBeenCalled();
        expect(cardMeasurement.offsetHeight).not.toHaveBeenCalled();
        expect(probeMeasurement.bounds).not.toHaveBeenCalled();
        expect(probeMeasurement.offsetWidth).not.toHaveBeenCalled();
        expect(probeMeasurement.offsetHeight).not.toHaveBeenCalled();
      } finally {
        probeMeasurement.bounds.mockRestore();
        cardMeasurement.bounds.mockRestore();
        battlefieldMeasurement.rect.mockRestore();
        fixture.destroy();
      }
    } finally {
      animationFrames.restore();
      resizeObserver.restore();
    }
  });

  it('uses the premeasured probe size when a card is not mounted', async () => {
    window.localStorage.setItem(BATTLEFIELD_BOUNDS_STORAGE_KEY, '1');
    const resizeObserver = mockResizeObserver();
    const animationFrames = mockAnimationFrames();

    try {
      const { fixture } = await renderFocusedBattlefield();
      const card = battlefieldCard(fixture, 'card-1');
      const battlefield = fixture.nativeElement.querySelector('[data-testid="battlefield-zone"]') as HTMLElement;
      const battlefieldMeasurement = measureBattlefieldBoundsWithAccessSpies(
        battlefield,
        battlefieldBounds(500, 400),
      );
      cardMeasurementElement(fixture, 'card-1').remove();
      const probeMeasurement = measureCardElementWithAccessSpies(
        battlefieldCardSizeProbe(fixture),
        { width: 120, height: 168 },
      );
      fixture.componentRef.setInput('cardPosition', () => ({ x: 16, y: 300 }));

      try {
        emitLatestResize(resizeObserver.callbacks);
        flushAnimationFrames(animationFrames.queuedFrames);
        expect(probeMeasurement.bounds).toHaveBeenCalled();

        battlefieldMeasurement.rect.mockClear();
        battlefieldMeasurement.clientWidth.mockClear();
        battlefieldMeasurement.clientHeight.mockClear();
        probeMeasurement.bounds.mockClear();
        probeMeasurement.offsetWidth.mockClear();
        probeMeasurement.offsetHeight.mockClear();

        expect(fixture.componentInstance.displayedCardPosition(card)).toEqual({ x: 16, y: 232 });
        expect(battlefieldMeasurement.rect).not.toHaveBeenCalled();
        expect(battlefieldMeasurement.clientWidth).not.toHaveBeenCalled();
        expect(battlefieldMeasurement.clientHeight).not.toHaveBeenCalled();
        expect(probeMeasurement.bounds).not.toHaveBeenCalled();
        expect(probeMeasurement.offsetWidth).not.toHaveBeenCalled();
        expect(probeMeasurement.offsetHeight).not.toHaveBeenCalled();
      } finally {
        probeMeasurement.bounds.mockRestore();
        battlefieldMeasurement.rect.mockRestore();
        fixture.destroy();
      }
    } finally {
      animationFrames.restore();
      resizeObserver.restore();
    }
  });

  it('does not queue a bounds refresh for a position-only update', async () => {
    window.localStorage.setItem(BATTLEFIELD_BOUNDS_STORAGE_KEY, '1');
    const animationFrames = mockAnimationFrames();

    try {
      const { fixture } = await renderFocusedBattlefield();

      try {
        flushAnimationFrames(animationFrames.queuedFrames);
        fixture.componentRef.setInput('cardPosition', () => ({ x: 32, y: 48 }));
        fixture.detectChanges();

        expect(animationFrames.queuedFrames.size).toBe(0);
      } finally {
        fixture.destroy();
      }
    } finally {
      animationFrames.restore();
    }
  });

  it('updates inverted stack positions from resized observed battlefield bounds', async () => {
    window.localStorage.setItem(BATTLEFIELD_BOUNDS_STORAGE_KEY, '1');
    const resizeObserver = mockResizeObserver();
    const animationFrames = mockAnimationFrames();

    try {
      const { fixture } = await renderFocusedBattlefield({
        verticallyInverted: true,
        battlefieldCards: [
          { instanceId: 'target', name: 'Baleful Strix', typeLine: 'Creature - Bird', tapped: false },
          { instanceId: 'equipment', name: 'Sword', typeLine: 'Artifact - Equipment', tapped: false },
        ],
        attachments: [attachment('attachment-1', 'equipment', 'target')],
      });
      const battlefield = fixture.nativeElement.querySelector('[data-testid="battlefield-zone"]') as HTMLElement;
      const battlefieldMeasurement = measureBattlefieldBoundsWithAccessSpies(
        battlefield,
        battlefieldBounds(500, 600),
      );
      const targetMeasurement = measureCardElementWithAccessSpies(
        cardMeasurementElement(fixture, 'target'),
        { width: 100, height: 140 },
      );
      const equipmentMeasurement = measureCardElementWithAccessSpies(
        cardMeasurementElement(fixture, 'equipment'),
        { width: 100, height: 140 },
      );
      const probeMeasurement = measureCardElementWithAccessSpies(
        battlefieldCardSizeProbe(fixture),
        { width: 100, height: 140 },
      );
      const positions = new Map([
        ['target', { x: 100, y: 450 }],
        ['equipment', { x: 110, y: 432 }],
      ]);
      fixture.componentRef.setInput('cardPosition', (card: GameCardInstance) => positions.get(card.instanceId) ?? null);

      try {
        emitLatestResize(resizeObserver.callbacks);
        flushAnimationFrames(animationFrames.queuedFrames);

        battlefieldMeasurement.rect.mockClear();
        targetMeasurement.bounds.mockClear();
        targetMeasurement.offsetWidth.mockClear();
        targetMeasurement.offsetHeight.mockClear();
        equipmentMeasurement.bounds.mockClear();
        equipmentMeasurement.offsetWidth.mockClear();
        equipmentMeasurement.offsetHeight.mockClear();
        probeMeasurement.bounds.mockClear();
        probeMeasurement.offsetWidth.mockClear();
        probeMeasurement.offsetHeight.mockClear();

        expect(fixture.componentInstance.displayedCardPosition(battlefieldCard(fixture, 'target'))).toEqual({ x: 100, y: 18 });
        expect(fixture.componentInstance.displayedCardPosition(battlefieldCard(fixture, 'equipment'))).toEqual({ x: 110, y: 0 });
        expect(battlefieldMeasurement.rect).not.toHaveBeenCalled();
        expect(targetMeasurement.bounds).not.toHaveBeenCalled();
        expect(targetMeasurement.offsetWidth).not.toHaveBeenCalled();
        expect(targetMeasurement.offsetHeight).not.toHaveBeenCalled();
        expect(equipmentMeasurement.bounds).not.toHaveBeenCalled();
        expect(equipmentMeasurement.offsetWidth).not.toHaveBeenCalled();
        expect(equipmentMeasurement.offsetHeight).not.toHaveBeenCalled();
        expect(probeMeasurement.bounds).not.toHaveBeenCalled();
        expect(probeMeasurement.offsetWidth).not.toHaveBeenCalled();
        expect(probeMeasurement.offsetHeight).not.toHaveBeenCalled();

        battlefieldMeasurement.rect.mockReturnValue(battlefieldBounds(500, 700));
        emitLatestResize(resizeObserver.callbacks);
        flushAnimationFrames(animationFrames.queuedFrames);
        battlefieldMeasurement.rect.mockClear();
        targetMeasurement.bounds.mockClear();
        targetMeasurement.offsetWidth.mockClear();
        targetMeasurement.offsetHeight.mockClear();
        equipmentMeasurement.bounds.mockClear();
        equipmentMeasurement.offsetWidth.mockClear();
        equipmentMeasurement.offsetHeight.mockClear();
        probeMeasurement.bounds.mockClear();
        probeMeasurement.offsetWidth.mockClear();
        probeMeasurement.offsetHeight.mockClear();

        expect(fixture.componentInstance.displayedCardPosition(battlefieldCard(fixture, 'target'))).toEqual({ x: 100, y: 110 });
        expect(fixture.componentInstance.displayedCardPosition(battlefieldCard(fixture, 'equipment'))).toEqual({ x: 110, y: 92 });
        expect(battlefieldMeasurement.rect).not.toHaveBeenCalled();
        expect(targetMeasurement.bounds).not.toHaveBeenCalled();
        expect(targetMeasurement.offsetWidth).not.toHaveBeenCalled();
        expect(targetMeasurement.offsetHeight).not.toHaveBeenCalled();
        expect(equipmentMeasurement.bounds).not.toHaveBeenCalled();
        expect(equipmentMeasurement.offsetWidth).not.toHaveBeenCalled();
        expect(equipmentMeasurement.offsetHeight).not.toHaveBeenCalled();
        expect(probeMeasurement.bounds).not.toHaveBeenCalled();
        expect(probeMeasurement.offsetWidth).not.toHaveBeenCalled();
        expect(probeMeasurement.offsetHeight).not.toHaveBeenCalled();
      } finally {
        probeMeasurement.bounds.mockRestore();
        equipmentMeasurement.bounds.mockRestore();
        targetMeasurement.bounds.mockRestore();
        battlefieldMeasurement.rect.mockRestore();
        fixture.destroy();
      }
    } finally {
      animationFrames.restore();
      resizeObserver.restore();
    }
  });

  it('cancels the focused geometry cache cleanup frame when destroyed', async () => {
    window.localStorage.setItem(FOCUSED_GEOMETRY_CACHE_STORAGE_KEY, '1');
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextFrame += 1;
      queuedFrames.set(nextFrame, callback);
      return nextFrame;
    });
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frame) => {
      queuedFrames.delete(frame);
    });

    try {
      const { fixture } = await renderFocusedBattlefield();
      flushAnimationFrames(queuedFrames);
      const card = battlefieldCard(fixture, 'card-1');
      prepareBattlefieldForMeasurement(fixture);
      const measured = measureCardElement(cardMeasurementElement(fixture, 'card-1'), { width: 100, height: 140 });
      fixture.componentRef.setInput('cardPosition', () => ({ x: 16, y: 24 }));

      try {
        fixture.componentInstance.displayedCardPosition(card);
        const cacheClearFrame = [...queuedFrames.keys()].at(-1);

        fixture.destroy();

        expect(cacheClearFrame).toBeDefined();
        expect(cancelAnimationFrame).toHaveBeenCalledWith(cacheClearFrame);
        expect(queuedFrames.has(cacheClearFrame!)).toBe(false);
      } finally {
        measured.mockRestore();
      }
    } finally {
      cancelAnimationFrame.mockRestore();
      animationFrame.mockRestore();
    }
  });
});

interface RenderFocusedBattlefieldOptions {
  battlefieldCards?: GameCardInstance[];
  playerId?: string;
  layoutKey?: unknown;
  zoomPercent?: number;
  verticallyInverted?: boolean;
  attachments?: readonly GameAttachment[];
  battlefieldStacks?: readonly GameBattlefieldStack[];
  alignmentGuideFor?: (playerId: string) => { y: number; referenceInstanceIds: readonly string[] } | null;
  cardPosition?: (card: GameCardInstance) => { x: number; y: number } | null;
  isCurrentPlayer?: (playerId: string) => boolean;
  allowArrowTargetSelection?: boolean;
  isCardTransferPending?: (playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean;
  firstCounter?: (card: GameCardInstance) => { key: string; value: number } | null;
  cardBattleValue?: (card: GameCardInstance) => number | null;
  isDraggingCard?: (card: GameCardInstance) => boolean;
  canEditManaPool?: (playerId: string) => boolean;
  isManaPoolHidden?: (playerId: string) => boolean;
  mechanicCards?: readonly GameCardInstance[];
  cardImage?: (card: GameCardInstance) => string | null;
}

async function renderFocusedBattlefield(options: RenderFocusedBattlefieldOptions = {}): Promise<{ fixture: ComponentFixture<FocusedBattlefieldComponent> }> {
  await TestBed.configureTestingModule({
    imports: [FocusedBattlefieldComponent],
    providers: [
      importProvidersFrom(LucideAngularModule.pick({ Minus, Plus, RotateCcw, X })),
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(FocusedBattlefieldComponent);
  fixture.componentRef.setInput('player', playerView(options.battlefieldCards, options.playerId));
  fixture.componentRef.setInput('isCurrentPlayer', options.isCurrentPlayer ?? ((_playerId: string) => true));
  fixture.componentRef.setInput('allowArrowTargetSelection', options.allowArrowTargetSelection ?? false);
  fixture.componentRef.setInput('mechanicCards', options.mechanicCards ?? []);
  fixture.componentRef.setInput('isDropZoneHighlighted', (_playerId: string, _zone: GameZoneName) => false);
  fixture.componentRef.setInput('cardPosition', options.cardPosition ?? ((_card: GameCardInstance) => null));
  fixture.componentRef.setInput('isSelected', (_instanceId: string) => false);
  fixture.componentRef.setInput('isDraggingCard', options.isDraggingCard ?? ((_card: GameCardInstance) => false));
  fixture.componentRef.setInput('canDragBattlefieldCard', (_playerId: string, _card: GameCardInstance) => true);
  fixture.componentRef.setInput('isPendingBattlefieldTransfer', (_card: GameCardInstance) => false);
  fixture.componentRef.setInput('cardImage', options.cardImage ?? ((_card: GameCardInstance) => null));
  fixture.componentRef.setInput('shouldShowPowerToughness', (_card: GameCardInstance) => false);
  fixture.componentRef.setInput('cardPowerValue', (_card: GameCardInstance) => 0);
  fixture.componentRef.setInput('cardToughnessValue', (_card: GameCardInstance) => 0);
  fixture.componentRef.setInput('cardBattleValue', options.cardBattleValue ?? ((_card: GameCardInstance) => null));
  fixture.componentRef.setInput('cardLoyaltyValue', (_card: GameCardInstance) => null);
  fixture.componentRef.setInput('firstCounter', options.firstCounter ?? ((_card: GameCardInstance) => null));
  fixture.componentRef.setInput('alignmentGuideFor', options.alignmentGuideFor ?? ((_playerId: string) => null));
  fixture.componentRef.setInput('isManaLaneHighlighted', (_playerId: string) => false);
  fixture.componentRef.setInput('canEditManaPool', options.canEditManaPool ?? ((_playerId: string) => false));
  fixture.componentRef.setInput('isManaPoolHidden', options.isManaPoolHidden ?? ((_playerId: string) => false));
  fixture.componentRef.setInput('layoutKey', options.layoutKey ?? null);
  fixture.componentRef.setInput('zoomPercent', options.zoomPercent ?? 100);
  fixture.componentRef.setInput('verticallyInverted', options.verticallyInverted ?? false);
  fixture.componentRef.setInput('attachments', options.attachments ?? []);
  fixture.componentRef.setInput('battlefieldStacks', options.battlefieldStacks ?? []);
  fixture.componentRef.setInput('isCardTransferPending', options.isCardTransferPending ?? ((_playerId: string, _zone: GameZoneName, _card: GameCardInstance) => false));
  fixture.detectChanges();

  return { fixture };
}

function cardElement(fixture: ComponentFixture<FocusedBattlefieldComponent>, instanceId: string): HTMLElement {
  return fixture.nativeElement.querySelector(`[data-card-instance-id="${instanceId}"]`);
}

function cardElements(fixture: ComponentFixture<FocusedBattlefieldComponent>, instanceId: string): HTMLElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll(`[data-card-instance-id="${instanceId}"]`));
}

function battlefieldCard(
  fixture: ComponentFixture<FocusedBattlefieldComponent>,
  instanceId: string,
): GameCardInstance {
  const card = fixture.componentInstance.player().state.zones.battlefield
    .find((candidate) => candidate.instanceId === instanceId);
  if (!card) {
    throw new Error(`Missing battlefield card ${instanceId}.`);
  }

  return card;
}

function prepareBattlefieldForMeasurement(
  fixture: ComponentFixture<FocusedBattlefieldComponent>,
  height = 600,
): HTMLElement {
  const battlefield = fixture.nativeElement.querySelector('[data-testid="battlefield-zone"]') as HTMLElement;
  Object.defineProperty(battlefield, 'clientHeight', { configurable: true, value: height });

  return battlefield;
}

function cardMeasurementElement(
  fixture: ComponentFixture<FocusedBattlefieldComponent>,
  instanceId: string,
): HTMLElement {
  return fixture.nativeElement.querySelector(
    `[data-testid="game-card"][data-card-instance-id="${instanceId}"]`,
  ) as HTMLElement;
}

function battlefieldCardSizeProbe(fixture: ComponentFixture<FocusedBattlefieldComponent>): HTMLElement {
  return fixture.nativeElement.querySelector('[data-battlefield-card-size-probe]') as HTMLElement;
}

function measureCardElement(
  element: HTMLElement,
  size: { readonly width: number; readonly height: number },
) {
  Object.defineProperty(element, 'offsetWidth', { configurable: true, value: size.width });
  Object.defineProperty(element, 'offsetHeight', { configurable: true, value: size.height });

  return vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    width: size.width,
    height: size.height,
  } as DOMRect);
}

function measureCardElementWithAccessSpies(
  element: HTMLElement,
  size: { readonly width: number; readonly height: number },
) {
  const offsetWidth = vi.fn(() => size.width);
  const offsetHeight = vi.fn(() => size.height);
  Object.defineProperty(element, 'offsetWidth', { configurable: true, get: offsetWidth });
  Object.defineProperty(element, 'offsetHeight', { configurable: true, get: offsetHeight });

  const bounds = vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    width: size.width,
    height: size.height,
  } as DOMRect);

  return { bounds, offsetWidth, offsetHeight };
}

function measureBattlefieldBoundsWithAccessSpies(
  element: HTMLElement,
  bounds: DOMRect,
) {
  const clientWidth = vi.fn(() => 0);
  const clientHeight = vi.fn(() => 0);
  Object.defineProperty(element, 'clientWidth', { configurable: true, get: clientWidth });
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: clientHeight });

  const rect = vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(bounds);

  return { rect, clientWidth, clientHeight };
}

function flushAnimationFrames(queuedFrames: Map<number, FrameRequestCallback>): void {
  const callbacks = [...queuedFrames.values()];
  queuedFrames.clear();
  callbacks.forEach((callback) => callback(0));
}

function mockAnimationFrames(): {
  readonly queuedFrames: Map<number, FrameRequestCallback>;
  readonly restore: () => void;
} {
  const queuedFrames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    nextFrame += 1;
    queuedFrames.set(nextFrame, callback);
    return nextFrame;
  });
  const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frame) => {
    queuedFrames.delete(frame);
  });

  return {
    queuedFrames,
    restore: () => {
      cancelAnimationFrame.mockRestore();
      animationFrame.mockRestore();
    },
  };
}

function battlefieldBounds(width: number, height: number): DOMRect {
  return {
    width,
    height,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
  } as DOMRect;
}

function mockResizeObserver(): { readonly callbacks: ResizeObserverCallback[]; readonly restore: () => void } {
  const originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  const callbacks: ResizeObserverCallback[] = [];
  class ResizeObserverMock implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
    }

    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  });

  return {
    callbacks,
    restore: () => {
      if (originalResizeObserver) {
        Object.defineProperty(globalThis, 'ResizeObserver', originalResizeObserver);
      } else {
        Reflect.deleteProperty(globalThis, 'ResizeObserver');
      }
    },
  };
}

function emitLatestResize(callbacks: readonly ResizeObserverCallback[]): void {
  const callback = callbacks.at(-1);
  if (!callback) {
    throw new Error('Expected FocusedBattlefieldComponent to register a ResizeObserver.');
  }

  callback([{ } as ResizeObserverEntry], {} as ResizeObserver);
}

function attachment(id: string, equipmentInstanceId: string, attachedToInstanceId: string): GameAttachment {
  return {
    id,
    equipmentInstanceId,
    attachedToInstanceId,
    createdAt: '2026-05-29T00:00:00+00:00',
  };
}

function battlefieldStack(id: string, stackedInstanceId: string, stackTopInstanceId: string): GameBattlefieldStack {
  return {
    id,
    stackedInstanceId,
    stackTopInstanceId,
    createdAt: '2026-09-08T10:00:00+00:00',
  };
}

function playerView(battlefieldCards?: GameCardInstance[], playerId = 'player-1'): PlayerView {
  return {
    id: playerId,
    state: {
      user: { id: playerId, email: 'user@test', displayName: 'User', roles: [] },
      status: 'active',
      life: 40,
      zones: {
        library: [],
        hand: [],
        battlefield: battlefieldCards ?? [
          { instanceId: 'card-1', name: 'Llanowar Elves', typeLine: 'Creature - Elf Druid', tapped: false },
          { instanceId: 'card-2', name: 'Liliana of the Veil', typeLine: 'Legendary Planeswalker - Liliana', tapped: false },
          { instanceId: 'card-3', name: 'Sol Ring', typeLine: 'Artifact', tapped: false },
        ],
        graveyard: [],
        exile: [],
        command: [],
      },
      zoneCounts: {
        library: 0,
        hand: 0,
        battlefield: 3,
        graveyard: 0,
        exile: 0,
        command: 0,
      },
      commanderDamage: {},
      counters: {},
    },
  };
}
