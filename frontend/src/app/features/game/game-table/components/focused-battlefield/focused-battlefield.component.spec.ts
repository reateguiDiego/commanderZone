import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, Minus, Plus, RotateCcw, X } from 'lucide-angular';
import { GameAttachment, GameBattlefieldStack, GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { PlayerView } from '../../game-table.store';
import { landStackOffsetY } from '../../utils/land-stack';
import { FocusedBattlefieldComponent } from './focused-battlefield.component';

describe('FocusedBattlefieldComponent', () => {
  it('exposes the player battlefield as a motion zone', async () => {
    const { fixture } = await renderFocusedBattlefield();

    const battlefield = fixture.nativeElement.querySelector('[data-testid="battlefield-zone"]') as HTMLElement;
    expect(battlefield.dataset['motionZone']).toBe('player-1:battlefield');
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

  it.each([70, 100, 140])('keeps attachment and battlefield-stack offsets proportional at BF zoom %i', async (zoomPercent) => {
    const positions = new Map([
      ['target', { x: 200, y: 260 }],
      ['equipment', { x: 420, y: 260 }],
      ['stack-root', { x: 500, y: 300 }],
      ['stack-member', { x: 700, y: 300 }],
    ]);
    const { fixture } = await renderFocusedBattlefield({
      zoomPercent,
      battlefieldCards: [
        { instanceId: 'target', name: 'Target', typeLine: 'Creature', tapped: false },
        { instanceId: 'equipment', name: 'Equipment', typeLine: 'Artifact', tapped: false },
        { instanceId: 'stack-root', name: 'Root land', typeLine: 'Land', tapped: false },
        { instanceId: 'stack-member', name: 'Member land', typeLine: 'Land', tapped: false },
      ],
      attachments: [attachment('attachment-1', 'equipment', 'target')],
      battlefieldStacks: [{
        id: 'stack-1',
        relationType: 'battlefield_stack',
        rootInstanceId: 'stack-root',
        orderedMemberIds: ['stack-root', 'stack-member'],
        stackKind: 'land',
        effectVersion: 1,
        createdAtVersion: 2,
      }],
      cardPosition: (card) => positions.get(card.instanceId) ?? null,
    });
    const size = fixture.componentInstance.relationCardSize();
    const attachmentPositions = fixture.componentInstance.attachmentStackDisplayPositions();
    const stackPositions = fixture.componentInstance.landStackDisplayPositions();

    expect((attachmentPositions.get('equipment')!.x - attachmentPositions.get('target')!.x) / size.width).toBeCloseTo(0.085, 8);
    expect((attachmentPositions.get('equipment')!.y - attachmentPositions.get('target')!.y) / size.height).toBeCloseTo(-0.11, 8);
    expect((stackPositions.get('stack-member')!.x - stackPositions.get('stack-root')!.x) / size.width).toBeCloseTo(0.085, 8);
    expect((stackPositions.get('stack-member')!.y - stackPositions.get('stack-root')!.y) / size.height).toBeCloseTo(-0.11, 8);
  });

  it('fans a dense stack downward from the shared top-half ratio regardless of local viewport pressure', async () => {
    const stackCards = Array.from({ length: 8 }, (_, index) => ({
      instanceId: `stack-${index}`,
      name: `Land ${index}`,
      typeLine: 'Land',
      tapped: false,
      position: index === 0 ? { x: 0.05, y: 0.05, unit: 'ratio' as const } : undefined,
    } satisfies GameCardInstance));
    const { fixture } = await renderFocusedBattlefield({
      battlefieldCards: stackCards,
      battlefieldStacks: [{
        id: 'stack-dense',
        relationType: 'battlefield_stack',
        rootInstanceId: 'stack-0',
        orderedMemberIds: stackCards.map((card) => card.instanceId),
        stackKind: 'land',
        effectVersion: 1,
        createdAtVersion: 2,
      }],
      cardPosition: (card) => card.instanceId === 'stack-0' ? { x: 20, y: 500 } : { x: 300, y: 300 },
    });
    const battlefield = fixture.nativeElement.querySelector('[data-testid="battlefield-zone"]') as HTMLElement;
    Object.defineProperty(battlefield, 'clientHeight', { configurable: true, value: 600 });
    fixture.componentRef.setInput('layoutKey', 'measured-top-edge');
    fixture.detectChanges();

    const positions = fixture.componentInstance.landStackDisplayPositions();
    expect(positions.get('stack-1')!.y).toBeGreaterThan(positions.get('stack-0')!.y);
    expect(positions.get('stack-7')!.y).toBeGreaterThan(positions.get('stack-1')!.y);
    expect(positions.get('stack-7')!.y + fixture.componentInstance.relationCardSize().height).toBeLessThanOrEqual(600);
  });

  it('translates a top-left relation group below the focused-player summary without changing member offsets', async () => {
    const stackCards = Array.from({ length: 4 }, (_, index) => ({
      instanceId: `overlay-stack-${index}`,
      name: `Land ${index}`,
      typeLine: 'Land',
      tapped: false,
      position: index === 0 ? { x: 0.01, y: 0.12, unit: 'ratio' as const } : undefined,
    } satisfies GameCardInstance));
    const { fixture } = await renderFocusedBattlefield({
      battlefieldCards: stackCards,
      battlefieldStacks: [{
        id: 'overlay-stack',
        relationType: 'battlefield_stack',
        rootInstanceId: 'overlay-stack-0',
        orderedMemberIds: stackCards.map((card) => card.instanceId),
        stackKind: 'land',
        effectVersion: 1,
        createdAtVersion: 2,
      }],
      cardPosition: (card) => card.instanceId === 'overlay-stack-0' ? { x: 20, y: 30 } : { x: 300, y: 300 },
    });
    const battlefield = fixture.nativeElement.querySelector('[data-testid="battlefield-zone"]') as HTMLElement;
    Object.defineProperty(battlefield, 'clientHeight', { configurable: true, value: 600 });
    battlefield.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    battlefield.parentElement!.classList.add('focused-board');
    const summary = document.createElement('div');
    summary.dataset['testid'] = 'battlefield-owner-summary';
    summary.getBoundingClientRect = () => new DOMRect(0, 0, 300, 80);
    battlefield.parentElement!.appendChild(summary);
    fixture.componentRef.setInput('layoutKey', 'measured-owner-summary');
    fixture.detectChanges();

    const positions = fixture.componentInstance.landStackDisplayPositions();
    const root = positions.get('overlay-stack-0')!;
    const member = positions.get('overlay-stack-1')!;
    expect(root.y).toBeGreaterThanOrEqual(84);
    expect(member.y - root.y).toBeCloseTo(landStackOffsetY(fixture.componentInstance.relationCardSize().height), 8);
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

  it('keeps a primary background pointer pending below the threshold and clears on an empty click', async () => {
    const { fixture } = await renderFocusedBattlefield({ marqueeEnabled: true });
    const component = fixture.componentInstance;
    const battlefield = battlefieldElement(fixture);
    const cleared = vi.fn();
    component.battlefieldEmptyClicked.subscribe(cleared);

    component.beginMarqueePointer(marqueePointer(battlefield, 40, 40));
    component.moveMarqueePointer(marqueePointer(battlefield, 43, 43));

    expect(component.selectionInteraction().kind).toBe('pointerPending');
    expect(component.marqueeVisualRect()).toBeNull();

    component.endMarqueePointer(marqueePointer(battlefield, 43, 43));
    component.onBattlefieldBackgroundClick({ target: battlefield, stopPropagation: vi.fn() } as unknown as MouseEvent);

    expect(component.selectionInteraction().kind).toBe('idle');
    expect(cleared).toHaveBeenCalledOnce();
  });

  it.each([
    ['left-to-right/down', 20, 20, 220, 160],
    ['right-to-left/down', 220, 20, 20, 160],
    ['left-to-right/up', 20, 160, 220, 20],
    ['right-to-left/up', 220, 160, 20, 20],
  ])('commits center-hit marquee candidates in the %s direction', async (_label, startX, startY, endX, endY) => {
    const { fixture } = await renderFocusedBattlefield({ marqueeEnabled: true });
    installMarqueeGeometry(fixture, {
      'card-1': new DOMRect(80, 60, 80, 100),
      'card-2': new DOMRect(260, 60, 80, 100),
      'card-3': new DOMRect(390, 60, 80, 100),
    });
    const committed = vi.fn();
    fixture.componentInstance.marqueeSelectionCommitted.subscribe(committed);
    performMarquee(fixture, { x: startX, y: startY }, { x: endX, y: endY });

    expect(committed).toHaveBeenCalledWith(expect.objectContaining({
      playerId: 'player-1',
      cards: [expect.objectContaining({ instanceId: 'card-1' })],
      mode: 'replace',
    }));
    expect(fixture.componentInstance.lastMarqueeMetrics()).toMatchObject({
      boundsCaptures: 1,
      layoutReads: 4,
      candidateCount: 3,
      outcome: 'commit',
    });
  });

  it('uses the visual center rather than any overlap for candidate hit testing', async () => {
    const { fixture } = await renderFocusedBattlefield({ marqueeEnabled: true });
    installMarqueeGeometry(fixture, {
      'card-1': new DOMRect(80, 80, 80, 100),
      'card-2': new DOMRect(145, 145, 100, 100),
      'card-3': new DOMRect(300, 300, 80, 100),
    });
    const committed = vi.fn();
    fixture.componentInstance.marqueeSelectionCommitted.subscribe(committed);

    performMarquee(fixture, { x: 0, y: 0 }, { x: 160, y: 160 });

    expect(committed.mock.calls[0]?.[0].cards.map((card: GameCardInstance) => card.instanceId)).toEqual(['card-1']);
  });

  it('previews and commits Shift-add and Ctrl-toggle against the stable base selection', async () => {
    const { fixture } = await renderFocusedBattlefield({
      marqueeEnabled: true,
      selectedInstanceIds: ['card-1'],
      isSelected: (instanceId) => instanceId === 'card-1',
    });
    installMarqueeGeometry(fixture, {
      'card-1': new DOMRect(80, 60, 80, 100),
      'card-2': new DOMRect(220, 60, 80, 100),
      'card-3': new DOMRect(390, 60, 80, 100),
    });
    const committed = vi.fn();
    fixture.componentInstance.marqueeSelectionCommitted.subscribe(committed);

    performMarquee(fixture, { x: 180, y: 20 }, { x: 330, y: 180 }, { shiftKey: true });
    expect(committed.mock.calls[0]?.[0].cards.map((card: GameCardInstance) => card.instanceId)).toEqual(['card-1', 'card-2']);

    performMarquee(fixture, { x: 20, y: 20 }, { x: 330, y: 180 }, { ctrlKey: true });
    expect(committed.mock.calls[1]?.[0].cards.map((card: GameCardInstance) => card.instanceId)).toEqual(['card-2']);
  });

  it('treats visible attachments independently and collapses a battlefield stack to its visual root', async () => {
    const cards = [
      { instanceId: 'target', name: 'Target', typeLine: 'Creature', tapped: false },
      { instanceId: 'equipment', name: 'Equipment', typeLine: 'Artifact', tapped: false },
      { instanceId: 'stack-root', name: 'Island', typeLine: 'Land', tapped: false },
      { instanceId: 'stack-member', name: 'Forest', typeLine: 'Land', tapped: false },
    ] satisfies GameCardInstance[];
    const { fixture } = await renderFocusedBattlefield({
      marqueeEnabled: true,
      battlefieldCards: cards,
      attachments: [attachment('attachment-1', 'equipment', 'target')],
      battlefieldStacks: [{
        id: 'stack-1', relationType: 'battlefield_stack', rootInstanceId: 'stack-root',
        orderedMemberIds: ['stack-root', 'stack-member'], stackKind: 'land', effectVersion: 1, createdAtVersion: 1,
      }],
      cardPosition: (card) => card.instanceId === 'stack-root' ? { x: 240, y: 80 } : { x: 40, y: 80 },
    });
    installMarqueeGeometry(fixture, Object.fromEntries(cards.map((card, index) => [
      card.instanceId,
      new DOMRect(30 + index * 100, 40, 80, 100),
    ])));
    const committed = vi.fn();
    fixture.componentInstance.marqueeSelectionCommitted.subscribe(committed);

    performMarquee(fixture, { x: 0, y: 0 }, { x: 500, y: 200 });

    expect(committed.mock.calls[0]?.[0].cards.map((card: GameCardInstance) => card.instanceId)).toEqual([
      'target', 'equipment', 'stack-root',
    ]);
  });

  it('cancels marquee on Escape/layout changes without committing or clearing the base selection', async () => {
    const { fixture } = await renderFocusedBattlefield({
      marqueeEnabled: true,
      selectedInstanceIds: ['card-1'],
      isSelected: (instanceId) => instanceId === 'card-1',
    });
    installMarqueeGeometry(fixture, {
      'card-1': new DOMRect(80, 60, 80, 100),
      'card-2': new DOMRect(220, 60, 80, 100),
      'card-3': new DOMRect(390, 60, 80, 100),
    });
    const committed = vi.fn();
    const cleared = vi.fn();
    fixture.componentInstance.marqueeSelectionCommitted.subscribe(committed);
    fixture.componentInstance.battlefieldEmptyClicked.subscribe(cleared);
    const battlefield = battlefieldElement(fixture);

    fixture.componentInstance.beginMarqueePointer(marqueePointer(battlefield, 20, 20));
    fixture.componentInstance.moveMarqueePointer(marqueePointer(battlefield, 330, 180));
    expect(fixture.componentInstance.cancelActiveSelectionInteraction()).toBe(true);
    expect(fixture.componentInstance.selectionInteraction().kind).toBe('idle');
    expect(fixture.componentInstance.isVisuallySelected(fixture.componentInstance.battlefieldCards()[0]!)).toBe(true);
    expect(committed).not.toHaveBeenCalled();

    fixture.componentInstance.beginMarqueePointer(marqueePointer(battlefield, 20, 20));
    fixture.componentInstance.moveMarqueePointer(marqueePointer(battlefield, 330, 180));
    fixture.componentInstance.cancelMarqueeForLayoutChange();
    fixture.componentInstance.onBattlefieldBackgroundClick({ target: battlefield, stopPropagation: vi.fn() } as unknown as MouseEvent);
    expect(fixture.componentInstance.lastMarqueeMetrics()?.outcome).toBe('cancel');
    expect(committed).not.toHaveBeenCalled();
    expect(cleared).not.toHaveBeenCalled();
  });

  it('rejects touch marquee, accepts pen, and cancels a pending gesture on multitouch-compatible touch input', async () => {
    const { fixture } = await renderFocusedBattlefield({ marqueeEnabled: true });
    const battlefield = battlefieldElement(fixture);

    fixture.componentInstance.beginMarqueePointer(marqueePointer(battlefield, 20, 20, { pointerType: 'touch' }));
    expect(fixture.componentInstance.selectionInteraction().kind).toBe('idle');

    fixture.componentInstance.beginMarqueePointer(marqueePointer(battlefield, 20, 20, { pointerType: 'pen' }));
    expect(fixture.componentInstance.selectionInteraction().kind).toBe('pointerPending');
    fixture.componentInstance.beginMarqueePointer(marqueePointer(cardElement(fixture, 'card-1'), 25, 25, { pointerId: 2, pointerType: 'touch' }));
    expect(fixture.componentInstance.selectionInteraction().kind).toBe('idle');
  });

  it('captures 100 candidate bounds once, throttles preview through rAF, and releases all interaction state', async () => {
    const cards = Array.from({ length: 100 }, (_, index) => ({
      instanceId: `dense-${index}`,
      name: `Dense ${index}`,
      typeLine: index % 4 === 0 ? 'Creature' : 'Token',
      tapped: false,
    } satisfies GameCardInstance));
    const { fixture } = await renderFocusedBattlefield({ marqueeEnabled: true, battlefieldCards: cards });
    installMarqueeGeometry(fixture, Object.fromEntries(cards.map((card, index) => [
      card.instanceId,
      new DOMRect(10 + (index % 10) * 70, 10 + Math.floor(index / 10) * 55, 60, 80),
    ])));
    const battlefield = battlefieldElement(fixture);

    fixture.componentInstance.beginMarqueePointer(marqueePointer(battlefield, 0, 0));
    for (let index = 1; index <= 20; index += 1) {
      fixture.componentInstance.moveMarqueePointer(marqueePointer(battlefield, 10 + index * 35, 10 + index * 25));
    }
    fixture.componentInstance.endMarqueePointer(marqueePointer(battlefield, 710, 510));

    expect(fixture.componentInstance.selectionInteraction().kind).toBe('idle');
    expect(fixture.componentInstance.marqueeVisualRect()).toBeNull();
    expect(fixture.componentInstance.lastMarqueeMetrics()).toMatchObject({
      pointerMoves: 20,
      boundsCaptures: 1,
      layoutReads: 101,
      candidateCount: 100,
      outcome: 'commit',
    });
    expect(fixture.componentInstance.lastMarqueeMetrics()!.animationFrames).toBeLessThanOrEqual(20);
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
  battlefieldStacks?: readonly GameBattlefieldStack[];
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
  selectedInstanceIds?: readonly string[];
  isSelected?: (instanceId: string) => boolean;
  marqueeEnabled?: boolean;
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
  fixture.componentRef.setInput('selectedInstanceIds', options.selectedInstanceIds ?? []);
  fixture.componentRef.setInput('isSelected', options.isSelected ?? ((_instanceId: string) => false));
  fixture.componentRef.setInput('marqueeEnabled', options.marqueeEnabled ?? false);
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
  fixture.componentRef.setInput('battlefieldStacks', options.battlefieldStacks ?? []);
  fixture.componentRef.setInput('isCardTransferPending', options.isCardTransferPending ?? ((_playerId: string, _zone: GameZoneName, _card: GameCardInstance) => false));
  fixture.detectChanges();

  return { fixture };
}

function cardElement(fixture: ComponentFixture<FocusedBattlefieldComponent>, instanceId: string): HTMLElement {
  return fixture.nativeElement.querySelector(`[data-card-instance-id="${instanceId}"]`);
}

function battlefieldElement(fixture: ComponentFixture<FocusedBattlefieldComponent>): HTMLElement {
  return fixture.nativeElement.querySelector('[data-testid="battlefield-zone"]');
}

function installMarqueeGeometry(
  fixture: ComponentFixture<FocusedBattlefieldComponent>,
  cardRects: Record<string, DOMRect>,
): void {
  battlefieldElement(fixture).getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  for (const [instanceId, rect] of Object.entries(cardRects)) {
    cardElement(fixture, instanceId).getBoundingClientRect = () => rect;
  }
}

function marqueePointer(
  target: HTMLElement,
  clientX: number,
  clientY: number,
  options: Partial<PointerEvent> = {},
): PointerEvent {
  return {
    button: 0,
    clientX,
    clientY,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    isPrimary: true,
    pointerId: 1,
    pointerType: 'mouse',
    target,
    preventDefault: vi.fn(),
    ...options,
  } as unknown as PointerEvent;
}

function performMarquee(
  fixture: ComponentFixture<FocusedBattlefieldComponent>,
  start: { x: number; y: number },
  end: { x: number; y: number },
  modifiers: Partial<PointerEvent> = {},
): void {
  const battlefield = battlefieldElement(fixture);
  fixture.componentInstance.beginMarqueePointer(marqueePointer(battlefield, start.x, start.y, modifiers));
  fixture.componentInstance.moveMarqueePointer(marqueePointer(battlefield, end.x, end.y, modifiers));
  fixture.componentInstance.endMarqueePointer(marqueePointer(battlefield, end.x, end.y, modifiers));
  fixture.detectChanges();
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
