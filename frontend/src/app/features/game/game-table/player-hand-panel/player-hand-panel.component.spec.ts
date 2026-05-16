import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { PlayerView } from '../game-table.store';
import { GameTablePointerDragService } from '../services/game-table-pointer-drag.service';
import { PlayerHandPanelComponent } from './player-hand-panel.component';

describe('PlayerHandPanelComponent', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reveals the hand after a short deliberate hover', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel();

    handArea.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    vi.advanceTimersByTime(199);
    fixture.detectChanges();

    expect(handArea.classList.contains('hand-revealed')).toBe(false);

    vi.advanceTimersByTime(1);
    fixture.detectChanges();

    expect(handArea.classList.contains('hand-revealed')).toBe(true);
  });

  it('reveals the hand from the lower hover strip', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel();
    const hoverStrip = fixture.nativeElement.querySelector('.hand-hover-strip') as HTMLElement;

    hoverStrip.dispatchEvent(new MouseEvent('mouseenter', { clientX: 320 }));
    fixture.detectChanges();
    vi.advanceTimersByTime(200);
    fixture.detectChanges();

    expect(handArea.classList.contains('hand-revealed')).toBe(true);
  });

  it('switches the owner hand to row layout while the hand is hovered', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel();
    const handFan = fixture.nativeElement.querySelector('.hand-fan') as HTMLElement;
    const cardElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;

    handArea.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(200);
    fixture.detectChanges();

    expect(handFan.classList).not.toContain('hand-fan-row');

    cardElement.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(179);
    fixture.detectChanges();

    expect(handFan.classList).not.toContain('hand-fan-row');

    vi.advanceTimersByTime(1);
    fixture.detectChanges();

    expect(handFan.classList).toContain('hand-fan-row');

    handArea.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(259);
    fixture.detectChanges();

    expect(handFan.classList).toContain('hand-fan-row');

    vi.advanceTimersByTime(1);
    fixture.detectChanges();

    expect(handFan.classList).not.toContain('hand-fan-row');
  });

  it('keeps row layout open when the pointer leaves a card but remains inside the hand', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel();
    const handFan = fixture.nativeElement.querySelector('.hand-fan') as HTMLElement;
    const cardElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;

    handArea.dispatchEvent(new MouseEvent('mouseenter'));
    cardElement.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(200);
    fixture.detectChanges();

    expect(handFan.classList).toContain('hand-fan-row');

    cardElement.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(500);
    fixture.detectChanges();

    expect(handFan.classList).toContain('hand-fan-row');
  });

  it('debounces closing row layout when the pointer leaves the hand area', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel();
    const handFan = fixture.nativeElement.querySelector('.hand-fan') as HTMLElement;
    const cardElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;

    handArea.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(200);
    fixture.detectChanges();

    cardElement.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(180);
    fixture.detectChanges();

    expect(handFan.classList).toContain('hand-fan-row');

    handArea.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(259);
    fixture.detectChanges();

    expect(handFan.classList).toContain('hand-fan-row');

    vi.advanceTimersByTime(1);
    fixture.detectChanges();

    expect(handFan.classList).not.toContain('hand-fan-row');
  });

  it('maps vertical wheel movement to horizontal hand scroll in row layout', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel();
    const handRow = fixture.nativeElement.querySelector('[data-testid="hand-zone"]') as HTMLElement;
    const cardElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;

    handArea.dispatchEvent(new MouseEvent('mouseenter'));
    cardElement.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(200);
    fixture.detectChanges();

    Object.defineProperty(handRow, 'scrollWidth', { configurable: true, value: 1400 });
    Object.defineProperty(handRow, 'clientWidth', { configurable: true, value: 520 });
    handRow.scrollLeft = 20;
    const wheelEvent = new WheelEvent('wheel', { cancelable: true, deltaY: 90 });
    handRow.dispatchEvent(wheelEvent);

    expect(handRow.scrollLeft).toBe(110);
    expect(wheelEvent.defaultPrevented).toBe(true);
  });

  it('keeps row layout open while the pointer is over the hand scroll area', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel();
    const handRow = fixture.nativeElement.querySelector('[data-testid="hand-zone"]') as HTMLElement;
    const handFan = fixture.nativeElement.querySelector('.hand-fan') as HTMLElement;
    const cardElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;

    handArea.dispatchEvent(new MouseEvent('mouseenter'));
    cardElement.dispatchEvent(new MouseEvent('mouseenter', { clientX: 220 }));
    vi.advanceTimersByTime(200);
    fixture.detectChanges();

    expect(handFan.classList).toContain('hand-fan-row');

    cardElement.dispatchEvent(new MouseEvent('mouseleave'));
    handRow.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(260);
    fixture.detectChanges();

    expect(handFan.classList).toContain('hand-fan-row');
  });

  it('opens the row in the scroll band where the pointer entered instead of resetting to the start', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel();
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const handRow = fixture.nativeElement.querySelector('[data-testid="hand-zone"]') as HTMLElement;
    const cardElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-2"]') as HTMLElement;

    handArea.getBoundingClientRect = () => ({
      x: 100,
      y: 560,
      width: 500,
      height: 220,
      top: 560,
      right: 600,
      bottom: 780,
      left: 100,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(handRow, 'scrollWidth', { configurable: true, value: 1600 });
    Object.defineProperty(handRow, 'clientWidth', { configurable: true, value: 500 });

    handArea.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(200);
    fixture.detectChanges();

    cardElement.dispatchEvent(new MouseEvent('mouseenter', { clientX: 350 }));
    vi.advanceTimersByTime(180);
    fixture.detectChanges();

    try {
      expect(handRow.scrollLeft).toBe(550);
    } finally {
      animationFrame.mockRestore();
    }
  });

  it('opens the row from the lower hover strip and anchors the scroll to the right band', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel();
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const handRow = fixture.nativeElement.querySelector('[data-testid="hand-zone"]') as HTMLElement;
    const hoverStrip = fixture.nativeElement.querySelector('.hand-hover-strip') as HTMLElement;
    const handFan = fixture.nativeElement.querySelector('.hand-fan') as HTMLElement;

    handArea.getBoundingClientRect = () => ({
      x: 100,
      y: 560,
      width: 500,
      height: 220,
      top: 560,
      right: 600,
      bottom: 780,
      left: 100,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(handRow, 'scrollWidth', { configurable: true, value: 1600 });
    Object.defineProperty(handRow, 'clientWidth', { configurable: true, value: 500 });

    hoverStrip.dispatchEvent(new MouseEvent('mouseenter', { clientX: 540 }));
    vi.advanceTimersByTime(200);
    fixture.detectChanges();

    try {
      expect(handFan.classList).toContain('hand-fan-row');
      expect(handRow.scrollLeft).toBe(1100);
    } finally {
      animationFrame.mockRestore();
    }
  });

  it('sizes the row content with only a small edge allowance when scrolling is needed', async () => {
    const { fixture } = await renderHandPanel();
    const handFan = fixture.nativeElement.querySelector('.hand-fan') as HTMLElement;

    expect(handFan.style.getPropertyValue('--hand-row-width')).toBe('348px');
  });

  it('keeps the hand revealed when focus moves between cards inside the hand', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel();
    const nextFocusTarget = document.createElement('button');
    handArea.appendChild(nextFocusTarget);

    handArea.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(200);
    fixture.detectChanges();

    handArea.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: nextFocusTarget }));
    fixture.detectChanges();

    expect(handArea.classList.contains('hand-revealed')).toBe(true);
  });

  it('reveals the hand after a deliberate active drop target hover', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel({
      isDropZoneHighlighted: (_playerId, zone) => zone === 'hand',
    });

    fixture.detectChanges();
    vi.advanceTimersByTime(999);
    fixture.detectChanges();

    expect(handArea.classList.contains('hand-revealed')).toBe(false);
    expect(fixture.nativeElement.querySelector('.hand-fan')?.classList).not.toContain('hand-fan-row');

    vi.advanceTimersByTime(1);
    fixture.detectChanges();

    expect(handArea.classList.contains('hand-revealed')).toBe(true);
    expect(fixture.nativeElement.querySelector('.hand-fan')?.classList).toContain('hand-fan-row');
  });

  it('keeps hand row layout while a hand context menu is open', async () => {
    const { fixture, handArea } = await renderHandPanel({
      hasOpenHandContextMenu: true,
    });

    expect(handArea.classList.contains('hand-revealed')).toBe(true);
    expect(fixture.nativeElement.querySelector('.hand-fan')?.classList).toContain('hand-fan-row');
  });

  it('shows focused opponent hands face down without card hover interactions', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel({
      readOnly: true,
      showCardsFaceDown: true,
      handZoneCount: 4,
      hand: [],
    });
    const previewShown = vi.fn();
    fixture.componentInstance.cardPreviewShown.subscribe(previewShown);

    expect(handArea.classList.contains('hand-revealed')).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('.face-down').length).toBe(4);

    const cardElement = fixture.nativeElement.querySelector('[data-card-instance-id="player-1-hidden-hand-0"]') as HTMLElement;
    cardElement.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(200);
    fixture.detectChanges();

    expect(previewShown).not.toHaveBeenCalled();
    expect(cardElement.classList).not.toContain('hover-lifted');
    expect(fixture.nativeElement.querySelector('.hand-fan')?.classList).not.toContain('hand-fan-row');
  });

  it('keeps opponent hands in fan layout even when they are highlighted as a drop target', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel({
      readOnly: true,
      showCardsFaceDown: true,
      handZoneCount: 2,
      hand: [],
      hasActiveCardDrag: true,
      isDropZoneHighlighted: (_playerId, zone) => zone === 'hand',
    });
    const handFan = fixture.nativeElement.querySelector('.hand-fan') as HTMLElement;

    handArea.dispatchEvent(new MouseEvent('mouseenter', { clientX: 240 }));
    vi.advanceTimersByTime(1000);
    fixture.detectChanges();

    expect(handArea.classList).toContain('hand-revealed');
    expect(handFan.classList).not.toContain('hand-fan-row');
  });

  it('does not open card menus or start pointer drags for read-only hands', async () => {
    const { fixture } = await renderHandPanel({
      readOnly: true,
    });
    const menuOpened = vi.fn();
    fixture.componentInstance.cardMenuOpened.subscribe(menuOpened);
    const cardElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;

    cardElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    cardElement.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 20,
      clientY: 20,
      pointerId: 1,
    }));
    fixture.detectChanges();

    expect(menuOpened).not.toHaveBeenCalled();
    expect(fixture.componentInstance.pointerDrag()).toBeNull();
  });

  it('does not start a hand drag from transparent card chrome outside the card visual', async () => {
    const { fixture } = await renderHandPanel();
    const draggedCard = fixture.componentInstance.player().state.zones.hand[0]!;
    const sourceElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;
    const visualElement = sourceElement.querySelector<HTMLElement>('.card-visual')!;

    visualElement.getBoundingClientRect = () => ({
      x: 40,
      y: 40,
      width: 100,
      height: 140,
      top: 40,
      right: 140,
      bottom: 180,
      left: 40,
      toJSON: () => ({}),
    } as DOMRect);

    fixture.componentInstance.startHandPointerDrag(pointerEvent({
      currentTarget: sourceElement,
      target: sourceElement,
      pointerId: 1,
      clientX: 20,
      clientY: 20,
    }), 'player-1', draggedCard);

    expect(fixture.componentInstance.pointerDrag()).toBeNull();
  });

  it('starts a hand drag when the pointer contacts the visible card', async () => {
    const { fixture } = await renderHandPanel();
    const draggedCard = fixture.componentInstance.player().state.zones.hand[0]!;
    const sourceElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;
    const visualElement = sourceElement.querySelector<HTMLElement>('.card-visual')!;

    visualElement.getBoundingClientRect = () => ({
      x: 40,
      y: 40,
      width: 100,
      height: 140,
      top: 40,
      right: 140,
      bottom: 180,
      left: 40,
      toJSON: () => ({}),
    } as DOMRect);

    fixture.componentInstance.startHandPointerDrag(pointerEvent({
      currentTarget: sourceElement,
      target: visualElement,
      pointerId: 1,
      clientX: 72,
      clientY: 96,
    }), 'player-1', draggedCard);

    expect(fixture.componentInstance.pointerDrag()).toEqual(expect.objectContaining({
      card: draggedCard,
      offsetX: 32,
      offsetY: 56,
    }));
  });

  it('expands the horizontal drop target only for compact non-empty hands', async () => {
    const compact = await renderHandPanel({
      hand: [
        { instanceId: 'card-1', name: 'Arcane Signet', tapped: false },
        { instanceId: 'card-2', name: 'Sol Ring', tapped: false },
        { instanceId: 'card-3', name: 'Command Tower', tapped: false },
        { instanceId: 'card-4', name: 'Cultivate', tapped: false },
      ],
    });

    expect(compact.fixture.nativeElement.querySelector('.hand-fan')?.classList)
      .toContain('hand-fan-compact-drop-target');

    compact.fixture.componentRef.setInput('player', playerView([
      { instanceId: 'card-1', name: 'Arcane Signet', tapped: false },
      { instanceId: 'card-2', name: 'Sol Ring', tapped: false },
      { instanceId: 'card-3', name: 'Command Tower', tapped: false },
      { instanceId: 'card-4', name: 'Cultivate', tapped: false },
      { instanceId: 'card-5', name: 'Swords to Plowshares', tapped: false },
    ]));
    compact.fixture.detectChanges();

    expect(compact.fixture.nativeElement.querySelector('.hand-fan')?.classList)
      .not.toContain('hand-fan-compact-drop-target');
  });

  it('does not reveal during an external drag when reveal is temporarily blocked', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel({
      hasActiveCardDrag: true,
      externalRevealAllowed: false,
    });

    handArea.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    vi.advanceTimersByTime(240);
    fixture.detectChanges();

    expect(handArea.classList.contains('hand-revealed')).toBe(false);
  });

  it('reveals after an external drag becomes allowed while the pointer is already over hand', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel({
      hasActiveCardDrag: true,
      externalRevealAllowed: false,
    });

    handArea.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    fixture.componentRef.setInput('externalRevealAllowed', true);
    fixture.detectChanges();
    vi.advanceTimersByTime(200);
    fixture.detectChanges();

    expect(handArea.classList.contains('hand-revealed')).toBe(true);
  });

  it('keeps the hand revealed while an own hand reorder is active even if external reveal is blocked', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel();
    const draggedCard = fixture.componentInstance.player().state.zones.hand[0]!;
    const sourceElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;
    const handZone = fixture.nativeElement.querySelector('[data-testid="hand-zone"]') as HTMLElement;
    const handFan = fixture.nativeElement.querySelector('.hand-fan') as HTMLElement;
    const originalElementsFromPoint = document.elementsFromPoint;

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [handZone]),
    });

    handArea.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(200);
    fixture.detectChanges();

    fixture.componentInstance.startHandPointerDrag(
      pointerEvent({ currentTarget: sourceElement, pointerId: 1, clientX: 20, clientY: 20 }),
      'player-1',
      draggedCard,
    );
    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 55, clientY: 22 }));
    fixture.componentRef.setInput('hasActiveCardDrag', true);
    fixture.componentRef.setInput('externalRevealAllowed', false);
    handArea.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();

    expect(fixture.componentInstance.pointerDrag()?.mode).toBe('reorder');
    expect(handArea.classList).toContain('hand-revealed');
    expect(handArea.classList).toContain('hand-dragging');
    expect(handFan.classList).toContain('hand-fan-row');

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('hides the hand reveal while an own drag is targeting outside the hand', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel();
    const draggedCard = fixture.componentInstance.player().state.zones.hand[0]!;
    const sourceElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;

    handArea.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(200);
    fixture.detectChanges();

    fixture.componentInstance.startHandPointerDrag(
      pointerEvent({ currentTarget: sourceElement, pointerId: 1, clientX: 20, clientY: 20 }),
      'player-1',
      draggedCard,
    );
    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 20, clientY: -12 }));
    fixture.detectChanges();

    expect(fixture.componentInstance.pointerDrag()?.mode).toBe('transfer');
    expect(handArea.classList).not.toContain('hand-revealed');
  });

  it('marks hand cards as alignment references while hand is the drop target', async () => {
    vi.useFakeTimers();
    const { fixture } = await renderHandPanel({
      isDropZoneHighlighted: (_playerId, zone) => zone === 'hand',
    });

    vi.advanceTimersByTime(1000);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]')?.classList)
      .toContain('alignment-reference');
    expect(fixture.nativeElement.querySelector('[data-card-instance-id="card-2"]')?.classList)
      .toContain('alignment-reference');
  });

  it('uses the hand fan as the highlighted drop target when the hand has one card', async () => {
    vi.useFakeTimers();
    const { fixture } = await renderHandPanel({
      hand: [{ instanceId: 'card-1', name: 'Arcane Signet', tapped: false }],
      hasActiveCardDrag: true,
      isDropZoneHighlighted: (_playerId, zone) => zone === 'hand',
    });

    vi.advanceTimersByTime(1000);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="empty-hand-drop-target"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.hand-fan')?.classList).toContain('drop-target-active');
    expect(fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]')?.classList).toContain('alignment-reference');
  });

  it('keeps the fan centered when a new card is added without hand hover', async () => {
    const { fixture } = await renderHandPanel();
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      window.setTimeout(() => callback(0), 0);
      return 1;
    });
    const scrollRow = fixture.nativeElement.querySelector('[data-testid="hand-zone"]') as HTMLElement;
    Object.defineProperty(scrollRow, 'scrollWidth', { configurable: true, value: 1200 });
    Object.defineProperty(scrollRow, 'clientWidth', { configurable: true, value: 400 });

    fixture.componentRef.setInput('player', playerView([
      { instanceId: 'card-1', name: 'Arcane Signet', tapped: false },
      { instanceId: 'card-2', name: 'Sol Ring', tapped: false },
      { instanceId: 'card-3', name: 'Cultivate', tapped: false },
    ]));
    fixture.detectChanges();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(scrollRow.scrollLeft).toBe(0);
    animationFrame.mockRestore();
  });

  it('uses the clipped hand row as the hand drop zone instead of the oversized visual fan', async () => {
    const { fixture } = await renderHandPanel();
    const scrollRow = fixture.nativeElement.querySelector('[data-testid="hand-zone"]') as HTMLElement;
    const handFan = fixture.nativeElement.querySelector('.hand-fan') as HTMLElement;
    const dragOver = vi.fn();
    fixture.componentInstance.handDragOver.subscribe(dragOver);

    scrollRow.dispatchEvent(new Event('dragover', { bubbles: true }));

    expect(scrollRow.getAttribute('data-game-drop-zone')).toBe('hand');
    expect(handFan.getAttribute('data-game-drop-zone')).toBeNull();
    expect(dragOver).toHaveBeenCalledOnce();
  });

  it('keeps an empty hand as a compact drop target during a card drag', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel({
      hand: [],
      hasActiveCardDrag: true,
      isDropZoneHighlighted: (_playerId, zone) => zone === 'hand',
    });
    const dropTarget = fixture.nativeElement.querySelector('[data-testid="empty-hand-drop-target"]') as HTMLElement;
    const dragOver = vi.fn();
    fixture.componentInstance.handDragOver.subscribe(dragOver);

    dropTarget.dispatchEvent(new Event('dragover', { bubbles: true }));
    vi.advanceTimersByTime(1000);
    fixture.detectChanges();

    expect(handArea.classList).toContain('hand-external-dragging');
    expect(fixture.nativeElement.querySelector('.hand-fan')).toBeNull();
    expect(dropTarget.classList).toContain('drop-target-active');
    expect(dropTarget.getAttribute('data-game-drop-zone')).toBe('hand');
    expect(dragOver).toHaveBeenCalledOnce();
  });

  it('does not expand the hand drop hit area when no card is being dragged', async () => {
    const { fixture, handArea } = await renderHandPanel({ hand: [] });
    const dropTarget = fixture.nativeElement.querySelector('[data-testid="empty-hand-drop-target"]') as HTMLElement;

    expect(handArea.classList).not.toContain('hand-external-dragging');
    expect(dropTarget).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.hand-fan')).toBeNull();
  });

  it('hides the hovered card preview and keeps a floating drag preview while reordering', async () => {
    const { fixture } = await renderHandPanel();
    const draggedCard = fixture.componentInstance.player().state.zones.hand[0]!;
    const previewHidden = vi.fn();
    fixture.componentInstance.cardPreviewHidden.subscribe(previewHidden);
    const sourceElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;

    fixture.componentInstance.startHandPointerDrag(pointerEvent({ currentTarget: sourceElement, pointerId: 1, clientX: 20, clientY: 20 }), 'player-1', draggedCard);
    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 50, clientY: 22 }));
    fixture.detectChanges();

    expect(previewHidden).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]')?.classList).toContain('dragging');
    expect(fixture.nativeElement.querySelector('.hand-floating-card')?.textContent).toContain('Arcane Signet');
  });

  it('keeps the hand fan while dragging every selected hand card from a multi-card hand', async () => {
    const { fixture } = await renderHandPanel({
      isSelected: (instanceId) => ['card-1', 'card-2'].includes(instanceId),
    });
    const draggedCard = fixture.componentInstance.player().state.zones.hand[0]!;
    const sourceElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;

    fixture.componentInstance.startHandPointerDrag(pointerEvent({ currentTarget: sourceElement, pointerId: 1, clientX: 20, clientY: 20 }), 'player-1', draggedCard);
    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 50, clientY: 22 }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="empty-hand-drop-target"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.hand-fan')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]')?.classList).toContain('dragging');
    expect(fixture.nativeElement.querySelector('[data-card-instance-id="card-2"]')?.classList).toContain('dragging');
    expect(fixture.nativeElement.querySelector('.hand-drag-count-badge')?.textContent?.trim()).toBe('2');
  });

  it('passes drop feedback state to arriving hand cards', async () => {
    const { fixture } = await renderHandPanel({
      hand: [{ instanceId: 'card-1', name: 'Arcane Signet', tapped: false }],
      isCardDropSettling: (_playerId, _zone, card) => card.instanceId === 'card-1',
    });

    expect(fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]')?.classList).toContain('drop-settling');
  });

  it('presents only the newly arrived hand card before it joins the fan', async () => {
    vi.useFakeTimers();
    const { fixture } = await renderHandPanel({
      hand: [
        { instanceId: 'card-1', name: 'Arcane Signet', tapped: false },
        { instanceId: 'card-2', name: 'Sol Ring', tapped: false },
      ],
    });

    fixture.componentRef.setInput('player', playerView([
      { instanceId: 'card-1', name: 'Arcane Signet', tapped: false },
      { instanceId: 'card-3', name: 'Cultivate', tapped: false },
      { instanceId: 'card-2', name: 'Sol Ring', tapped: false },
    ]));
    fixture.detectChanges();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]')?.classList).not.toContain('hand-arrival-before');
    expect(fixture.nativeElement.querySelector('[data-card-instance-id="card-2"]')?.classList).not.toContain('hand-arrival-after');
    expect(fixture.nativeElement.querySelector('[data-card-instance-id="card-3"]')?.classList).toContain('hand-arrival-new');
    expect(fixture.nativeElement.querySelector('[data-card-instance-id="card-3"]')?.classList).not.toContain('hand-arrival-before');
    expect(fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]')?.classList).not.toContain('hand-settling');

    vi.advanceTimersByTime(2000);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-card-instance-id="card-3"]')?.classList).not.toContain('hand-arrival-new');
  });

  it('does not use the presentation arrival animation for hand cards added by drag and drop', async () => {
    const { fixture } = await renderHandPanel({
      hand: [
        { instanceId: 'card-1', name: 'Arcane Signet', tapped: false },
        { instanceId: 'card-2', name: 'Sol Ring', tapped: false },
      ],
      isCardDropSettling: (_playerId, _zone, card) => card.instanceId === 'card-3',
    });

    fixture.componentRef.setInput('player', playerView([
      { instanceId: 'card-1', name: 'Arcane Signet', tapped: false },
      { instanceId: 'card-3', name: 'Cultivate', tapped: false },
      { instanceId: 'card-2', name: 'Sol Ring', tapped: false },
    ]));
    fixture.detectChanges();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-card-instance-id="card-3"]')?.classList).not.toContain('hand-arrival-new');
    expect(fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]')?.classList).not.toContain('hand-arrival-before');
  });

  it('hides a hand card while it is pending transfer to another zone', async () => {
    const { fixture } = await renderHandPanel({
      hand: [{ instanceId: 'card-1', name: 'Arcane Signet', tapped: false }],
      isCardTransferPending: (_playerId, _zone, card) => card.instanceId === 'card-1',
    });

    expect(fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]')?.classList).toContain('dragging');
  });

  it('shows the empty hand drop target while dragging the last visible hand card', async () => {
    const { fixture } = await renderHandPanel({
      hand: [{ instanceId: 'card-1', name: 'Arcane Signet', tapped: false }],
    });
    const draggedCard = fixture.componentInstance.player().state.zones.hand[0]!;
    const sourceElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;

    fixture.componentInstance.startHandPointerDrag(pointerEvent({ currentTarget: sourceElement, pointerId: 1, clientX: 20, clientY: 80 }), 'player-1', draggedCard);
    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 20, clientY: 40 }));
    fixture.detectChanges();

    const emptyTarget = fixture.nativeElement.querySelector('[data-testid="empty-hand-drop-target"]') as HTMLElement;

    expect(emptyTarget).not.toBeNull();
    expect(emptyTarget.getAttribute('data-game-drop-zone')).toBe('hand');
    expect(getComputedStyle(emptyTarget).pointerEvents).toBe('auto');
    expect(emptyTarget.classList).not.toContain('drop-target-active');
    expect(fixture.nativeElement.querySelector('.hand-fan')).toBeNull();
    expect(fixture.nativeElement.querySelector('.hand-floating-card')?.textContent).toContain('Arcane Signet');
  });

  it('keeps the last hand card visible while pointer drag is still pending', async () => {
    const { fixture } = await renderHandPanel({
      hand: [{ instanceId: 'card-1', name: 'Arcane Signet', tapped: false }],
    });
    const draggedCard = fixture.componentInstance.player().state.zones.hand[0]!;
    const sourceElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;

    fixture.componentInstance.startHandPointerDrag(
      pointerEvent({ currentTarget: sourceElement, pointerId: 1, clientX: 20, clientY: 80 }),
      'player-1',
      draggedCard,
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="empty-hand-drop-target"]')).toBeNull();
    expect(sourceElement.classList).not.toContain('dragging');
    expect(fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]')).not.toBeNull();
  });

  it('activates the empty hand drop target when the last dragged hand card returns over the hand', async () => {
    const { fixture } = await renderHandPanel({
      hand: [{ instanceId: 'card-1', name: 'Arcane Signet', tapped: false }],
    });
    const draggedCard = fixture.componentInstance.player().state.zones.hand[0]!;
    const sourceElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;
    const handTarget = document.createElement('div');
    handTarget.dataset['gameDropZone'] = 'hand';
    handTarget.dataset['zone'] = 'hand';
    handTarget.dataset['playerId'] = 'player-1';
    const originalElementsFromPoint = document.elementsFromPoint;

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn()
        .mockReturnValueOnce([])
        .mockReturnValueOnce([])
        .mockReturnValue([handTarget]),
    });

    fixture.componentInstance.startHandPointerDrag(pointerEvent({ currentTarget: sourceElement, pointerId: 1, clientX: 20, clientY: 80 }), 'player-1', draggedCard);
    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 20, clientY: 40 }));
    fixture.detectChanges();

    let emptyTarget = fixture.nativeElement.querySelector('[data-testid="empty-hand-drop-target"]') as HTMLElement;
    expect(emptyTarget).not.toBeNull();
    expect(emptyTarget.classList).not.toContain('drop-target-active');

    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 20, clientY: 90 }));
    fixture.detectChanges();

    emptyTarget = fixture.nativeElement.querySelector('[data-testid="empty-hand-drop-target"]') as HTMLElement;
    expect(emptyTarget).not.toBeNull();
    expect(emptyTarget.classList).toContain('drop-target-active');

    fixture.componentInstance.endHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 20, clientY: 90 }));
    fixture.detectChanges();

    emptyTarget = fixture.nativeElement.querySelector('[data-testid="empty-hand-drop-target"]') as HTMLElement;
    expect(emptyTarget).toBeNull();

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('clears the active empty hand drop target when the last-card drag is cancelled', async () => {
    const { fixture } = await renderHandPanel({
      hand: [{ instanceId: 'card-1', name: 'Arcane Signet', tapped: false }],
    });
    const draggedCard = fixture.componentInstance.player().state.zones.hand[0]!;
    const sourceElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;
    const handTarget = document.createElement('div');
    handTarget.dataset['gameDropZone'] = 'hand';
    handTarget.dataset['zone'] = 'hand';
    handTarget.dataset['playerId'] = 'player-1';
    const originalElementsFromPoint = document.elementsFromPoint;

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [handTarget]),
    });

    fixture.componentInstance.startHandPointerDrag(pointerEvent({ currentTarget: sourceElement, pointerId: 1, clientX: 20, clientY: 80 }), 'player-1', draggedCard);
    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 50, clientY: 82 }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="empty-hand-drop-target"]')?.classList)
      .toContain('drop-target-active');

    fixture.componentInstance.cancelHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 50, clientY: 82 }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="empty-hand-drop-target"]')).toBeNull();

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('starts card drag when pointerdown starts on a hand card', async () => {
    vi.useFakeTimers();
    const { fixture, handArea } = await renderHandPanel();
    const cardElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;
    const handFan = fixture.nativeElement.querySelector('.hand-fan') as HTMLElement;
    const originalElementsFromPoint = document.elementsFromPoint;

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [handFan]),
    });

    handArea.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    cardElement.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(150);
    fixture.detectChanges();

    const visualElement = cardElement.querySelector<HTMLElement>('.card-visual') ?? cardElement;
    visualElement.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 20,
      clientY: 20,
      pointerId: 1,
    }));
    fixture.detectChanges();

    expect(cardElement.classList).not.toContain('dragging');

    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 55, clientY: 22 }));
    fixture.detectChanges();

    expect(fixture.componentInstance.pointerDrag()?.mode).toBe('reorder');
    expect(cardElement.classList).toContain('dragging');

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('drops hand targeting when a dragged hand card leaves above the revealed hand body below the retention threshold', async () => {
    const { fixture, handArea } = await renderHandPanel();
    handArea.style.setProperty('--hand-hidden-offset', '80px');
    const draggedCard = fixture.componentInstance.player().state.zones.hand[0]!;
    const sourceElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;
    const handZone = fixture.nativeElement.querySelector('[data-testid="hand-zone"]') as HTMLElement;

    sourceElement.getBoundingClientRect = () => ({
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
    handZone.getBoundingClientRect = () => ({
      x: 0,
      y: 80,
      width: 300,
      height: 80,
      top: 80,
      right: 300,
      bottom: 160,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fixture.componentInstance.startHandPointerDrag(pointerEvent({ currentTarget: sourceElement, pointerId: 1, clientX: 50, clientY: 120 }), 'player-1', draggedCard);
    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 80, clientY: 150 }));
    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 80, clientY: 50 }));
    fixture.detectChanges();

    expect(fixture.componentInstance.pointerDrag()?.mode).toBe('transfer');
    expect(handArea.classList).not.toContain('hand-revealed');
  });

  it('keeps hand targeting when the dragged hand card extends below the revealed hand but enough stays visible', async () => {
    const { fixture } = await renderHandPanel();
    const draggedCard = fixture.componentInstance.player().state.zones.hand[0]!;
    const sourceElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;
    const handZone = fixture.nativeElement.querySelector('[data-testid="hand-zone"]') as HTMLElement;

    sourceElement.getBoundingClientRect = () => ({
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
    handZone.getBoundingClientRect = () => ({
      x: 0,
      y: 80,
      width: 300,
      height: 80,
      top: 80,
      right: 300,
      bottom: 160,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fixture.componentInstance.startHandPointerDrag(pointerEvent({ currentTarget: sourceElement, pointerId: 1, clientX: 50, clientY: 120 }), 'player-1', draggedCard);
    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 80, clientY: 120 }));
    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 80, clientY: 180 }));
    fixture.detectChanges();

    expect(fixture.componentInstance.pointerDrag()?.mode).toBe('reorder');
  });

  it('does not start hand reorder when the card is dragged upward', async () => {
    const { fixture } = await renderHandPanel();
    const draggedCard = fixture.componentInstance.player().state.zones.hand[0]!;
    const sourceElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;

    fixture.componentInstance.startHandPointerDrag(pointerEvent({ currentTarget: sourceElement, pointerId: 1, clientX: 50, clientY: 80 }), 'player-1', draggedCard);
    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 52, clientY: 45 }));
    fixture.detectChanges();

    expect(fixture.componentInstance.pointerDrag()?.mode).toBe('transfer');
    expect(fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]')?.classList).toContain('dragging');
    expect(fixture.nativeElement.querySelector('.hand-floating-card')?.textContent).toContain('Arcane Signet');
  });

  it('emits a pointer move when a hand card is dragged out to the battlefield', async () => {
    const { fixture } = await renderHandPanel();
    const draggedCard = fixture.componentInstance.player().state.zones.hand[0]!;
    const moved = vi.fn();
    fixture.componentInstance.handCardPointerMoved.subscribe(moved);
    const sourceElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;
    sourceElement.getBoundingClientRect = () => ({
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
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [battlefield]),
    });

    fixture.componentInstance.startHandPointerDrag(pointerEvent({ currentTarget: sourceElement, pointerId: 1, clientX: 100, clientY: 120 }), 'player-1', draggedCard);
    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 120, clientY: 70 }));
    fixture.componentInstance.endHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 150, clientY: 100 }));

    expect(moved).toHaveBeenCalledWith({
      playerId: 'player-1',
      targetPlayerId: 'player-1',
      movedInstanceId: 'card-1',
      toZone: 'battlefield',
      position: { x: 40, y: 0 },
    });

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('emits a pointer move when a hand card is dragged to a pile zone', async () => {
    const { fixture } = await renderHandPanel();
    const draggedCard = fixture.componentInstance.player().state.zones.hand[0]!;
    const moved = vi.fn();
    fixture.componentInstance.handCardPointerMoved.subscribe(moved);
    const sourceElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;
    sourceElement.getBoundingClientRect = () => ({
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
    const graveyard = document.createElement('button');
    graveyard.dataset['gameDropZone'] = 'graveyard';
    graveyard.dataset['zone'] = 'graveyard';
    graveyard.dataset['playerId'] = 'player-1';
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [graveyard]),
    });

    fixture.componentInstance.startHandPointerDrag(pointerEvent({ currentTarget: sourceElement, pointerId: 1, clientX: 50, clientY: 120 }), 'player-1', draggedCard);
    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 50, clientY: 70 }));
    fixture.componentInstance.endHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 50, clientY: 70 }));

    expect(moved).toHaveBeenCalledWith({
      playerId: 'player-1',
      targetPlayerId: 'player-1',
      movedInstanceId: 'card-1',
      toZone: 'graveyard',
    });

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('switches from hand reorder preview to zone transfer when the pointer leaves the hand', async () => {
    vi.useFakeTimers();
    const { fixture } = await renderHandPanel();
    const draggedCard = fixture.componentInstance.player().state.zones.hand[0]!;
    const dropTargetChanged = vi.fn();
    const moved = vi.fn();
    fixture.componentInstance.handPointerDropTargetChanged.subscribe(dropTargetChanged);
    fixture.componentInstance.handCardPointerMoved.subscribe(moved);
    const sourceElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;
    sourceElement.getBoundingClientRect = () => ({
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
    const handFan = fixture.nativeElement.querySelector('.hand-fan') as HTMLElement;
    const targetElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-2"]') as HTMLElement;
    targetElement.getBoundingClientRect = () => ({
      x: 100,
      y: 0,
      width: 100,
      height: 140,
      top: 0,
      right: 200,
      bottom: 140,
      left: 100,
      toJSON: () => ({}),
    } as DOMRect);
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
    const originalElementsFromPoint = document.elementsFromPoint;
    const elementsFromPoint = vi.fn()
      .mockReturnValueOnce([handFan])
      .mockReturnValueOnce([handFan])
      .mockReturnValue([battlefield]);
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: elementsFromPoint,
    });

    fixture.componentInstance.startHandPointerDrag(pointerEvent({ currentTarget: sourceElement, pointerId: 1, clientX: 20, clientY: 20 }), 'player-1', draggedCard);
    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 110, clientY: 22 }));
    fixture.detectChanges();

    expect(fixture.componentInstance.pointerDrag()?.mode).toBe('reorder');
    expect(fixture.nativeElement.querySelector('.hand-drop-slot-before')).toBeNull();

    vi.advanceTimersByTime(120);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.hand-drop-slot-before')).not.toBeNull();

    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 150, clientY: 100 }));
    fixture.detectChanges();

    expect(fixture.componentInstance.pointerDrag()?.mode).toBe('transfer');
    expect(fixture.nativeElement.querySelector('.hand-drop-slot-before')).toBeNull();
    expect(dropTargetChanged).toHaveBeenLastCalledWith({
      targetPlayerId: 'player-1',
      toZone: 'battlefield',
      kind: 'zone',
      rawZone: 'battlefield',
      draggedInstanceId: 'card-1',
      position: { x: 120, y: 70 },
    });

    fixture.componentInstance.endHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 150, clientY: 100 }));

    expect(moved).toHaveBeenCalledWith({
      playerId: 'player-1',
      targetPlayerId: 'player-1',
      movedInstanceId: 'card-1',
      toZone: 'battlefield',
      position: { x: 120, y: 70 },
    });

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('renders a simple insertion line and emits the pointer reorder', async () => {
    vi.useFakeTimers();
    const { fixture } = await renderHandPanel();
    const [draggedCard, targetCard] = fixture.componentInstance.player().state.zones.hand;
    const reordered = vi.fn();
    fixture.componentInstance.handCardPointerReordered.subscribe(reordered);
    const sourceElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLElement;
    const handZone = fixture.nativeElement.querySelector('[data-testid="hand-zone"]') as HTMLElement;
    const handFan = fixture.nativeElement.querySelector('.hand-fan') as HTMLElement;
    const targetElement = fixture.nativeElement.querySelector('[data-card-instance-id="card-2"]') as HTMLElement;
    handZone.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 420,
      height: 190,
      top: 0,
      right: 420,
      bottom: 190,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    targetElement.getBoundingClientRect = () => ({
      x: 100,
      y: 0,
      width: 100,
      height: 140,
      top: 0,
      right: 200,
      bottom: 140,
      left: 100,
      toJSON: () => ({}),
    } as DOMRect);
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [handFan]),
    });

    fixture.componentInstance.startHandPointerDrag(pointerEvent({ currentTarget: sourceElement, pointerId: 1, clientX: 20, clientY: 20 }), 'player-1', draggedCard!);
    fixture.componentInstance.moveHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 110, clientY: 22 }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.hand-drop-slot-before')).toBeNull();

    vi.advanceTimersByTime(120);
    fixture.detectChanges();

    const slot = fixture.nativeElement.querySelector('.hand-drop-slot-before');
    const target = fixture.nativeElement.querySelector('[data-card-instance-id="card-2"]');

    expect(slot).not.toBeNull();
    expect(slot.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fixture.componentInstance.endHandPointerDrag(pointerEvent({ pointerId: 1, clientX: 110, clientY: 20 }));
    fixture.detectChanges();

    expect(reordered).toHaveBeenCalledWith({
      playerId: 'player-1',
      movedInstanceId: 'card-1',
      targetInstanceId: targetCard!.instanceId,
      placement: 'before',
    });
    expect(handFan.classList).toContain('hand-fan-row');

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });
});

interface RenderHandPanelOptions {
  hand?: GameCardInstance[];
  hasActiveCardDrag?: boolean;
  externalRevealAllowed?: boolean;
  readOnly?: boolean;
  showCardsFaceDown?: boolean;
  hasOpenHandContextMenu?: boolean;
  handZoneCount?: number;
  isDropZoneHighlighted?: (playerId: string, zone: GameZoneName) => boolean;
  isCardDropSettling?: (playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean;
  isCardTransferPending?: (playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean;
  isSelected?: (instanceId: string) => boolean;
}

async function renderHandPanel(options: RenderHandPanelOptions = {}): Promise<{ fixture: ComponentFixture<PlayerHandPanelComponent>; handArea: HTMLElement }> {
  await TestBed.configureTestingModule({
    imports: [PlayerHandPanelComponent],
    providers: [GameTablePointerDragService],
  }).compileComponents();

  const fixture = TestBed.createComponent(PlayerHandPanelComponent);
  fixture.componentRef.setInput('player', playerView(options.hand));
  fixture.componentRef.setInput('zoneCount', (player: PlayerView, zone: GameZoneName) => {
    if (zone === 'hand' && options.handZoneCount !== undefined) {
      return options.handZoneCount;
    }

    return player.state.zones[zone].length;
  });
  fixture.componentRef.setInput('cardImage', (_card: GameCardInstance) => null);
  fixture.componentRef.setInput('isSelected', options.isSelected ?? ((_instanceId: string) => false));
  fixture.componentRef.setInput('isDraggingCard', (_card: GameCardInstance) => false);
  fixture.componentRef.setInput('isHandDropTarget', (_playerId: string, _card: GameCardInstance, _placement: 'before' | 'after') => false);
  fixture.componentRef.setInput('isDropZoneHighlighted', options.isDropZoneHighlighted ?? ((_playerId: string, _zone: GameZoneName) => false));
  fixture.componentRef.setInput('isCardDropSettling', options.isCardDropSettling ?? ((_playerId: string, _zone: GameZoneName, _card: GameCardInstance) => false));
  fixture.componentRef.setInput('isCardTransferPending', options.isCardTransferPending ?? ((_playerId: string, _zone: GameZoneName, _card: GameCardInstance) => false));
  fixture.componentRef.setInput('hasActiveCardDrag', options.hasActiveCardDrag ?? false);
  fixture.componentRef.setInput('externalRevealAllowed', options.externalRevealAllowed ?? true);
  fixture.componentRef.setInput('readOnly', options.readOnly ?? false);
  fixture.componentRef.setInput('showCardsFaceDown', options.showCardsFaceDown ?? false);
  fixture.componentRef.setInput('hasOpenHandContextMenu', options.hasOpenHandContextMenu ?? false);
  fixture.detectChanges();

  return {
    fixture,
    handArea: fixture.nativeElement.querySelector('[data-testid="hand-area"]'),
  };
}

function pointerEvent(patch: Partial<PointerEvent> & { pointerId: number; clientX: number; clientY: number }): PointerEvent {
  return {
    button: 0,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    currentTarget: document.createElement('button'),
    ...patch,
  } as unknown as PointerEvent;
}

function playerView(hand: GameCardInstance[] = [
  { instanceId: 'card-1', name: 'Arcane Signet', tapped: false },
  { instanceId: 'card-2', name: 'Sol Ring', tapped: false },
]): PlayerView {
  return {
    id: 'player-1',
    state: {
      user: { id: 'user-1', email: 'user@test', displayName: 'User', roles: [] },
      status: 'active',
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
      commanderDamage: {},
      counters: {},
    },
  };
}
