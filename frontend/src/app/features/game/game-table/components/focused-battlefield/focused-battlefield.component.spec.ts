import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, Minus, Plus, RotateCcw, X } from 'lucide-angular';
import { GameAttachment, GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { PlayerView } from '../../game-table.store';
import { FocusedBattlefieldComponent } from './focused-battlefield.component';

describe('FocusedBattlefieldComponent', () => {
  it('exposes the player battlefield as a motion zone', async () => {
    const { fixture } = await renderFocusedBattlefield();

    const battlefield = fixture.nativeElement.querySelector('[data-testid="battlefield-zone"]') as HTMLElement;
    expect(battlefield.dataset['motionZone']).toBe('player-1:battlefield');
  });

  it('anchors the mana pool panel inside the mana row overlay', async () => {
    const { fixture } = await renderFocusedBattlefield({
      canEditManaPool: () => true,
      isManaPoolHidden: () => false,
    });

    const manaLane = fixture.nativeElement.querySelector('[data-mana-lane]') as HTMLElement;
    const manaPanel = fixture.nativeElement.querySelector('app-mana-pool-panel') as HTMLElement;

    expect(manaLane).not.toBeNull();
    expect(manaPanel).not.toBeNull();
    expect(manaLane.contains(manaPanel)).toBe(true);
    expect(manaPanel.classList).toContain('mana-pool-panel-anchor');
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

  it('lands creatures and planeswalkers from the nearest side while the board transitions', async () => {
    const { fixture } = await renderFocusedBattlefield();

    fixture.componentInstance.boardTransitioning.set(true);
    fixture.detectChanges();

    expect(cardElement(fixture, 'card-1').classList).toContain('focus-entry-left');
    expect(cardElement(fixture, 'card-2').classList).toContain('focus-entry-left');
    expect(cardElement(fixture, 'card-3').classList).not.toContain('focus-entry-left');
  });

  it('materializes non creature and non planeswalker cards during focus transitions', async () => {
    const { fixture } = await renderFocusedBattlefield();

    fixture.componentInstance.boardTransitioning.set(true);
    fixture.detectChanges();

    expect(cardElement(fixture, 'card-3').classList).toContain('focus-entry-fade');
  });

  it('does not mark focus entry classes while focus effects are disabled', async () => {
    const { fixture } = await renderFocusedBattlefield({ focusEffectsEnabled: false });

    fixture.componentInstance.boardTransitioning.set(true);
    fixture.detectChanges();

    expect(cardElement(fixture, 'card-1').classList).not.toContain('focus-entry-left');
    expect(cardElement(fixture, 'card-3').classList).not.toContain('focus-entry-fade');
  });

  it('renders land stack layers with the shared horizontal stack offset', async () => {
    const positions = new Map([
      ['land-top', { x: 100, y: 200 }],
      ['land-under', { x: 100, y: 182 }],
    ]);
    const { fixture } = await renderFocusedBattlefield({
      battlefieldCards: [
        { instanceId: 'land-top', name: 'Command Tower', typeLine: 'Land', tapped: false },
        { instanceId: 'land-under', name: 'Island', typeLine: 'Basic Land - Island', tapped: false },
      ],
      cardPosition: (card) => positions.get(card.instanceId) ?? null,
    });

    expect(cardElement(fixture, 'land-top').style.left).toBe('100px');
    expect(cardElement(fixture, 'land-under').style.left).toBe('110px');
    expect(cardElement(fixture, 'land-under').style.top).toBe('182px');
  });

  it('changes land stack vertical spacing slightly with battlefield zoom', async () => {
    const positions = new Map([
      ['land-top', { x: 100, y: 200 }],
      ['land-under', { x: 100, y: 182 }],
    ]);
    const { fixture } = await renderFocusedBattlefield({
      zoomPercent: 70,
      battlefieldCards: [
        { instanceId: 'land-top', name: 'Command Tower', typeLine: 'Land', tapped: false },
        { instanceId: 'land-under', name: 'Island', typeLine: 'Basic Land - Island', tapped: false },
      ],
      cardPosition: (card) => positions.get(card.instanceId) ?? null,
    });

    expect(cardElement(fixture, 'land-under').style.top).toBe('188px');

    fixture.componentRef.setInput('zoomPercent', 140);
    fixture.componentRef.setInput('layoutKey', 140);
    fixture.detectChanges();

    expect(cardElement(fixture, 'land-under').style.top).toBe('175px');
  });

  it('changes attachment stack vertical spacing slightly with battlefield zoom', async () => {
    const positions = new Map([
      ['target', { x: 100, y: 200 }],
      ['equipment', { x: 100, y: 182 }],
    ]);
    const { fixture } = await renderFocusedBattlefield({
      zoomPercent: 70,
      battlefieldCards: [
        { instanceId: 'target', name: 'Baleful Strix', typeLine: 'Creature - Bird', tapped: false },
        { instanceId: 'equipment', name: 'Sword', typeLine: 'Artifact', tapped: false },
      ],
      attachments: [attachment('attachment-1', 'equipment', 'target')],
      cardPosition: (card) => positions.get(card.instanceId) ?? null,
    });

    expect(cardElement(fixture, 'equipment').style.top).toBe('188px');

    fixture.componentRef.setInput('zoomPercent', 140);
    fixture.componentRef.setInput('layoutKey', 140);
    fixture.detectChanges();

    expect(cardElement(fixture, 'equipment').style.top).toBe('175px');
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

  it('moves an overflowing zoomed land stack up as a group', async () => {
    const positions = new Map([
      ['land-top', { x: 100, y: 220 }],
      ['land-under', { x: 100, y: 202 }],
    ]);
    const { fixture } = await renderFocusedBattlefield({
      battlefieldCards: [
        { instanceId: 'land-top', name: 'Forest', typeLine: 'Basic Land - Forest', tapped: false },
        { instanceId: 'land-under', name: 'Swamp', typeLine: 'Basic Land - Swamp', tapped: false },
      ],
      zoomPercent: 120,
      cardPosition: (card) => positions.get(card.instanceId) ?? null,
    });
    const battlefield = fixture.nativeElement.querySelector('[data-testid="battlefield-zone"]') as HTMLElement;
    Object.defineProperty(battlefield, 'clientHeight', { configurable: true, value: 360 });
    Object.defineProperty(cardElement(fixture, 'land-top'), 'offsetHeight', { configurable: true, value: 202 });
    Object.defineProperty(cardElement(fixture, 'land-under'), 'offsetHeight', { configurable: true, value: 202 });

    fixture.componentRef.setInput('layoutKey', 120);
    fixture.detectChanges();

    expect(cardElement(fixture, 'land-top').style.top).toBe('158px');
    expect(cardElement(fixture, 'land-under').style.top).toBe('136.5px');
  });

  it('recomputes measured stack layout after focusing another player at the same zoom', async () => {
    const queuedFrames: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        queuedFrames.push(callback);
        return queuedFrames.length;
      });
    const cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const flushFrames = (): void => {
      while (queuedFrames.length > 0) {
        queuedFrames.shift()?.(0);
      }
    };

    try {
      const firstPlayerPositions = new Map([
        ['first-land-top', { x: 100, y: 120 }],
        ['first-land-under', { x: 100, y: 102 }],
      ]);
      const { fixture } = await renderFocusedBattlefield({
        playerId: 'player-1',
        layoutKey: 120,
        zoomPercent: 120,
        battlefieldCards: [
          { instanceId: 'first-land-top', name: 'Forest', typeLine: 'Basic Land - Forest', tapped: false },
          { instanceId: 'first-land-under', name: 'Swamp', typeLine: 'Basic Land - Swamp', tapped: false },
        ],
        cardPosition: (card) => firstPlayerPositions.get(card.instanceId) ?? null,
      });
      flushFrames();
      fixture.detectChanges();

      const secondPlayerPositions = new Map([
        ['second-land-top', { x: 100, y: 220 }],
        ['second-land-under', { x: 100, y: 202 }],
      ]);
      fixture.componentRef.setInput('player', playerView([
        { instanceId: 'second-land-top', name: 'Forest', typeLine: 'Basic Land - Forest', tapped: false },
        { instanceId: 'second-land-under', name: 'Swamp', typeLine: 'Basic Land - Swamp', tapped: false },
      ], 'player-2'));
      fixture.componentRef.setInput('cardPosition', (card: GameCardInstance) => secondPlayerPositions.get(card.instanceId) ?? null);
      fixture.detectChanges();

      const battlefield = fixture.nativeElement.querySelector('[data-testid="battlefield-zone"]') as HTMLElement;
      Object.defineProperty(battlefield, 'clientHeight', { configurable: true, value: 360 });
      Object.defineProperty(cardElement(fixture, 'second-land-top'), 'offsetHeight', { configurable: true, value: 202 });
      Object.defineProperty(cardElement(fixture, 'second-land-under'), 'offsetHeight', { configurable: true, value: 202 });

      flushFrames();
      fixture.detectChanges();

      expect(cardElement(fixture, 'second-land-top').style.top).toBe('158px');
      expect(cardElement(fixture, 'second-land-under').style.top).toBe('136.5px');
    } finally {
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
    }
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
});

interface RenderFocusedBattlefieldOptions {
  battlefieldCards?: GameCardInstance[];
  playerId?: string;
  layoutKey?: unknown;
  zoomPercent?: number;
  attachments?: readonly GameAttachment[];
  alignmentGuideFor?: (playerId: string) => { y: number; referenceInstanceIds: readonly string[] } | null;
  cardPosition?: (card: GameCardInstance) => { x: number; y: number } | null;
  isCurrentPlayer?: (playerId: string) => boolean;
  allowArrowTargetSelection?: boolean;
  isCardTransferPending?: (playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean;
  firstCounter?: (card: GameCardInstance) => { key: string; value: number } | null;
  cardBattleValue?: (card: GameCardInstance) => number | null;
  focusEffectsEnabled?: boolean;
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
  fixture.componentRef.setInput('focusEffectsEnabled', options.focusEffectsEnabled ?? true);
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
  fixture.componentRef.setInput('attachments', options.attachments ?? []);
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

function attachment(id: string, equipmentInstanceId: string, attachedToInstanceId: string): GameAttachment {
  return {
    id,
    equipmentInstanceId,
    attachedToInstanceId,
    createdAt: '2026-05-29T00:00:00+00:00',
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
