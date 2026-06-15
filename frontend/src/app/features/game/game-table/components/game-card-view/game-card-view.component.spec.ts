import { ComponentFixture, TestBed } from '@angular/core/testing';
import { importProvidersFrom } from '@angular/core';
import { CircleQuestionMark, Layers3, Link, LucideAngularModule, RotateCw } from 'lucide-angular';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { CARD_PREVIEW_HOVER_DELAY_MS } from '../../models/card-preview.model';
import { GameCardViewComponent } from './game-card-view.component';

describe('GameCardViewComponent', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits before lifting a hovered hand card', async () => {
    vi.useFakeTimers();
    const { fixture, cardElement } = await renderHandCard();

    cardElement.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    vi.advanceTimersByTime(CARD_PREVIEW_HOVER_DELAY_MS - 1);
    fixture.detectChanges();

    expect(cardElement.classList.contains('hover-lifted')).toBe(false);

    vi.advanceTimersByTime(1);
    fixture.detectChanges();

    expect(cardElement.classList.contains('hover-lifted')).toBe(true);
  });

  it('keeps a hovered hand card lifted when clicked to avoid a selection bounce', async () => {
    vi.useFakeTimers();
    const { fixture, cardElement } = await renderHandCard();
    const hoverCleared = vi.fn();
    fixture.componentInstance.cardMouseLeft.subscribe(hoverCleared);

    cardElement.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(CARD_PREVIEW_HOVER_DELAY_MS);
    fixture.detectChanges();

    cardElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(cardElement.classList).toContain('hover-lifted');
    expect(hoverCleared).not.toHaveBeenCalled();
  });

  it('cancels hand card lifting when hover ends first', async () => {
    vi.useFakeTimers();
    const { fixture, cardElement } = await renderHandCard();

    cardElement.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(50);
    cardElement.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(50);
    fixture.detectChanges();

    expect(cardElement.classList.contains('hover-lifted')).toBe(false);
  });

  it('blocks hand card hover interactions until the hand is revealed', async () => {
    vi.useFakeTimers();
    const { fixture, cardElement } = await renderHandCard(false);
    const previewShown = vi.fn();
    fixture.componentInstance.cardMouseEntered.subscribe(previewShown);

    cardElement.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(CARD_PREVIEW_HOVER_DELAY_MS);
    fixture.detectChanges();

    expect(previewShown).not.toHaveBeenCalled();
    expect(cardElement.classList.contains('hover-lifted')).toBe(false);

    fixture.componentRef.setInput('hoverInteractionsEnabled', true);
    fixture.detectChanges();
    vi.advanceTimersByTime(CARD_PREVIEW_HOVER_DELAY_MS - 1);
    fixture.detectChanges();

    expect(previewShown).toHaveBeenCalledOnce();
    expect(cardElement.classList.contains('hover-lifted')).toBe(false);

    vi.advanceTimersByTime(1);
    fixture.detectChanges();

    expect(cardElement.classList.contains('hover-lifted')).toBe(true);
  });

  it('marks hand cards as motion active while a parent GSAP handoff is running', async () => {
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('motionActive', true);
    fixture.detectChanges();

    expect(cardElement.classList).toContain('hand-motion-active');
  });

  it('does not clear an existing hover lift when hand motion starts', async () => {
    vi.useFakeTimers();
    const { fixture, cardElement } = await renderHandCard();

    cardElement.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(CARD_PREVIEW_HOVER_DELAY_MS);
    fixture.detectChanges();
    expect(cardElement.classList).toContain('hover-lifted');

    fixture.componentRef.setInput('motionActive', true);
    fixture.detectChanges();

    expect(cardElement.classList).toContain('hover-lifted');
  });

  it('sets fan layout variables for hand cards', async () => {
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('handIndex', 0);
    fixture.componentRef.setInput('handCount', 7);
    fixture.detectChanges();

    expect(Number.parseFloat(cardElement.style.getPropertyValue('--hand-fan-rotation'))).toBeLessThan(0);
    expect(cardElement.style.getPropertyValue('--hand-fan-lift')).toBe('0px');
    expect(Number.parseFloat(cardElement.style.getPropertyValue('--hand-fan-splay'))).toBeLessThan(0);
    expect(Number.parseFloat(cardElement.style.getPropertyValue('--hand-fan-arc'))).toBeGreaterThan(0);
    expect(cardElement.style.getPropertyValue('--hand-depth')).toBe('0');
    expect(Number.parseFloat(cardElement.style.getPropertyValue('--hand-fan-counter-rotation'))).toBeGreaterThan(0);
    expect(cardElement.style.getPropertyValue('--hand-overlap-px')).toBe('');
  });

  it('uses a gentle hand fan rotation step between adjacent cards', async () => {
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('handIndex', 2);
    fixture.componentRef.setInput('handCount', 7);
    fixture.detectChanges();
    const leftRotation = Number.parseFloat(cardElement.style.getPropertyValue('--hand-fan-rotation'));

    fixture.componentRef.setInput('handIndex', 3);
    fixture.detectChanges();
    const middleRotation = Number.parseFloat(cardElement.style.getPropertyValue('--hand-fan-rotation'));

    expect(Math.abs(middleRotation - leftRotation)).toBeLessThanOrEqual(1.5);
  });

  it('raises the middle hand card to the top of the fan', async () => {
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('handIndex', 3);
    fixture.componentRef.setInput('handCount', 7);
    fixture.detectChanges();

    expect(Number.parseFloat(cardElement.style.getPropertyValue('--hand-fan-arc'))).toBeLessThan(0);
  });

  it('keeps the two middle cards highest for even hands', async () => {
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('handIndex', 2);
    fixture.componentRef.setInput('handCount', 6);
    fixture.detectChanges();
    const leftMiddleArc = Number.parseFloat(cardElement.style.getPropertyValue('--hand-fan-arc'));

    fixture.componentRef.setInput('handIndex', 3);
    fixture.detectChanges();
    const rightMiddleArc = Number.parseFloat(cardElement.style.getPropertyValue('--hand-fan-arc'));

    expect(leftMiddleArc).toBe(rightMiddleArc);
    expect(leftMiddleArc).toBeLessThan(0);
  });

  it('lowers both edges of the fan relative to the middle', async () => {
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('handIndex', 0);
    fixture.componentRef.setInput('handCount', 7);
    fixture.detectChanges();
    const leftEdgeArc = Number.parseFloat(cardElement.style.getPropertyValue('--hand-fan-arc'));

    fixture.componentRef.setInput('handIndex', 3);
    fixture.detectChanges();
    const middleArc = Number.parseFloat(cardElement.style.getPropertyValue('--hand-fan-arc'));

    fixture.componentRef.setInput('handIndex', 6);
    fixture.detectChanges();
    const rightEdgeArc = Number.parseFloat(cardElement.style.getPropertyValue('--hand-fan-arc'));

    expect(leftEdgeArc).toBeGreaterThan(middleArc);
    expect(rightEdgeArc).toBeGreaterThan(middleArc);
  });

  it('uses straight row variables while hand ordering is active', async () => {
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('handIndex', 0);
    fixture.componentRef.setInput('handCount', 7);
    fixture.componentRef.setInput('handLayout', 'row');
    fixture.detectChanges();

    expect(cardElement.classList).toContain('hand-row-layout');
    expect(Number.parseFloat(cardElement.style.getPropertyValue('--hand-row-distance'))).toBeLessThan(0);
  });

  it('marks the active hovered hand card before hover lift starts', async () => {
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('activeHoverInstanceId', 'card-1');
    fixture.detectChanges();

    expect(cardElement.classList).toContain('hand-active-hover');
    expect(cardElement.classList).not.toContain('hover-lifted');
  });

  it('applies battlefield focus entry classes by entry mode', async () => {
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('battlefieldFocusEntry', 'fade');
    fixture.detectChanges();

    expect(cardElement.classList).toContain('focus-entry-fade');
    expect(cardElement.classList).not.toContain('focus-entry-left');
  });

  it('uses the normal battlefield hover glow for land stack cards after the behind-pile delay', async () => {
    vi.useFakeTimers();
    const { fixture, cardElement } = await renderHandCard();
    const previewShown = vi.fn();
    fixture.componentInstance.cardMouseEntered.subscribe(previewShown);

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('landStackRole', 'under');
    fixture.componentRef.setInput('landStackLayer', 2);
    fixture.detectChanges();

    expect(cardElement.style.zIndex).toBe('40');

    cardElement.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    vi.advanceTimersByTime(CARD_PREVIEW_HOVER_DELAY_MS);
    fixture.detectChanges();

    expect(cardElement.classList).not.toContain('hover-lifted');
    expect(cardElement.classList).not.toContain('battlefield-preview-active');
    expect(cardElement.style.zIndex).toBe('40');

    vi.advanceTimersByTime(CARD_PREVIEW_HOVER_DELAY_MS);
    fixture.detectChanges();

    expect(previewShown).toHaveBeenCalled();
    expect(cardElement.classList).toContain('hover-lifted');
    expect(cardElement.classList).toContain('battlefield-preview-active');
    expect(cardElement.style.zIndex).toBe('96');

    cardElement.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    fixture.detectChanges();

    expect(cardElement.classList).not.toContain('battlefield-preview-active');
    expect(cardElement.style.zIndex).toBe('40');
  });

  it('keeps selected under-stack cards below the stack top card', async () => {
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('selected', true);
    fixture.componentRef.setInput('landStackRole', 'under');
    fixture.componentRef.setInput('landStackLayer', 2);
    fixture.detectChanges();

    expect(cardElement.classList).toContain('selected');
    expect(cardElement.style.zIndex).toBe('40');
  });

  it('keeps attachment stack targets eligible for the normal battlefield hover glow', async () => {
    vi.useFakeTimers();
    const { fixture, cardElement } = await renderHandCard();
    const previewShown = vi.fn();
    fixture.componentInstance.cardMouseEntered.subscribe(previewShown);

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('attachmentStackRole', 'target');
    fixture.detectChanges();

    cardElement.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    vi.advanceTimersByTime(CARD_PREVIEW_HOVER_DELAY_MS);
    fixture.detectChanges();

    expect(previewShown).toHaveBeenCalled();
    expect(cardElement.classList).toContain('hover-lifted');
    expect(cardElement.classList).toContain('battlefield-preview-active');
    expect(cardElement.style.zIndex).toBe('96');
  });

  it('uses the normal battlefield hover glow for attached cards under a target after the behind-pile delay', async () => {
    vi.useFakeTimers();
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('attachmentStackRole', 'equipment');
    fixture.componentRef.setInput('attachmentStackLayer', 1);
    fixture.detectChanges();

    expect(cardElement.style.zIndex).toBe('41');

    cardElement.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    vi.advanceTimersByTime(CARD_PREVIEW_HOVER_DELAY_MS);
    fixture.detectChanges();

    expect(cardElement.classList).not.toContain('hover-lifted');
    expect(cardElement.classList).not.toContain('battlefield-preview-active');
    expect(cardElement.style.zIndex).toBe('41');

    vi.advanceTimersByTime(CARD_PREVIEW_HOVER_DELAY_MS);
    fixture.detectChanges();

    expect(cardElement.classList).toContain('hover-lifted');
    expect(cardElement.classList).toContain('battlefield-preview-active');
    expect(cardElement.style.zIndex).toBe('96');
  });

  it('renders the attachment drop preview with the shared stack badge surface', async () => {
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('landStackDropTarget', true);
    fixture.componentRef.setInput('landStackDropKind', 'attachment');
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector('.land-stack-preview-badge') as HTMLElement | null;

    expect(cardElement.classList).toContain('land-stack-drop-target');
    expect(cardElement.classList).toContain('attachment-stack-drop-target');
    expect(badge?.parentElement).toBe(cardElement);
    expect(badge?.textContent?.trim()).toBe('Attach');
    expect(badge?.querySelector('lucide-icon[name="link"]')).not.toBeNull();
  });

  it('renders the land stack drop preview as a stack badge', async () => {
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('landStackDropTarget', true);
    fixture.componentRef.setInput('landStackDropKind', 'land');
    fixture.componentRef.setInput('landStackDropSize', 3);
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector('.land-stack-preview-badge') as HTMLElement | null;

    expect(cardElement.classList).toContain('land-stack-drop-target');
    expect(cardElement.classList).not.toContain('attachment-stack-drop-target');
    expect(badge?.textContent?.trim()).toBe('Stack');
    expect(badge?.querySelector('lucide-icon[name="layers-3"]')).not.toBeNull();
  });

  it('emits pointerdown so containers can start their card drag flow', async () => {
    const { fixture, cardElement } = await renderHandCard();
    const pointerDown = vi.fn();
    fixture.componentInstance.cardPointerDown.subscribe(pointerDown);

    cardElement.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 1,
    }));

    expect(pointerDown).toHaveBeenCalledWith({
      event: expect.any(PointerEvent),
      card: fixture.componentInstance.card(),
    });
  });

  it('emits pointerdown even before the card hover is activated', async () => {
    const { fixture, cardElement } = await renderHandCard();
    const pointerDown = vi.fn();
    fixture.componentInstance.cardPointerDown.subscribe(pointerDown);

    cardElement.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 1,
    }));

    expect(pointerDown).toHaveBeenCalledOnce();
  });

  it('renders a default location pin for battlefield dungeon cards', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('card', { ...gameCard(), typeLine: 'Dungeon', layout: 'normal' });
    fixture.detectChanges();

    const pin = fixture.nativeElement.querySelector('app-dungeon-location-pin') as HTMLElement | null;
    expect(pin).not.toBeNull();
    expect(pin?.style.left).toBe('50%');
    expect(pin?.style.top).toBe('50%');
  });

  it('renders a default location pin for legacy official dungeon cards without layout metadata', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('card', {
      ...gameCard(),
      name: 'Dungeon of the Mad Mage',
      typeLine: null,
      layout: null,
    });
    fixture.detectChanges();

    const pin = fixture.nativeElement.querySelector('app-dungeon-location-pin') as HTMLElement | null;
    expect(pin).not.toBeNull();
    expect(pin?.style.left).toBe('50%');
    expect(pin?.style.top).toBe('50%');
  });

  it('emits a clamped dungeon marker position after dragging the pin inside the card', async () => {
    const { fixture } = await renderHandCard();
    const changed = vi.fn();
    fixture.componentInstance.dungeonMarkerChanged.subscribe(changed);

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('card', { ...gameCard(), typeLine: 'Dungeon', dungeonMarker: { x: 0.2, y: 0.3 } });
    fixture.detectChanges();

    const visual = fixture.nativeElement.querySelector('.card-visual') as HTMLElement;
    const pin = fixture.nativeElement.querySelector('app-dungeon-location-pin') as HTMLElement;
    vi.spyOn(visual, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      right: 110,
      bottom: 220,
      width: 100,
      height: 200,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    } as DOMRect);
    pin.setPointerCapture = vi.fn();
    pin.hasPointerCapture = vi.fn(() => true);
    pin.releasePointerCapture = vi.fn();

    pin.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 7, clientX: 40, clientY: 80 }));
    pin.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 0, pointerId: 7, clientX: 140, clientY: -10 }));
    pin.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 7, clientX: 140, clientY: -10 }));

    fixture.detectChanges();

    expect(changed).toHaveBeenCalledWith({
      event: expect.any(PointerEvent),
      card: fixture.componentInstance.card(),
      marker: { x: 1, y: 0 },
    });
    expect(pin.style.left).toBe('100%');
    expect(pin.style.top).toBe('0%');

    fixture.componentRef.setInput('card', { ...gameCard(), typeLine: 'Dungeon', dungeonMarker: { x: 1, y: 0 } });
    fixture.detectChanges();

    expect(pin.style.left).toBe('100%');
    expect(pin.style.top).toBe('0%');
  });

  it('keeps the grabbed pin point under the pointer while dragging the dungeon marker', async () => {
    const { fixture } = await renderHandCard();
    const changed = vi.fn();
    fixture.componentInstance.dungeonMarkerChanged.subscribe(changed);

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('card', { ...gameCard(), typeLine: 'Dungeon', dungeonMarker: { x: 0.5, y: 0.5 } });
    fixture.detectChanges();

    const visual = fixture.nativeElement.querySelector('.card-visual') as HTMLElement;
    const pin = fixture.nativeElement.querySelector('app-dungeon-location-pin') as HTMLElement;
    vi.spyOn(visual, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      right: 110,
      bottom: 220,
      width: 100,
      height: 200,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    } as DOMRect);
    pin.setPointerCapture = vi.fn();
    pin.hasPointerCapture = vi.fn(() => true);
    pin.releasePointerCapture = vi.fn();

    pin.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 7, clientX: 60, clientY: 90 }));
    pin.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 0, pointerId: 7, clientX: 70, clientY: 120 }));
    pin.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 7, clientX: 70, clientY: 120 }));

    expect(changed).toHaveBeenCalledWith({
      event: expect.any(PointerEvent),
      card: fixture.componentInstance.card(),
      marker: { x: 0.6, y: 0.65 },
    });
  });

  it('keeps the dungeon marker inside the visible card bounds while dragging near the edges', async () => {
    const { fixture } = await renderHandCard();
    const changed = vi.fn();
    fixture.componentInstance.dungeonMarkerChanged.subscribe(changed);

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('card', { ...gameCard(), typeLine: 'Dungeon', dungeonMarker: { x: 0.5, y: 0.5 } });
    fixture.detectChanges();

    const visual = fixture.nativeElement.querySelector('.card-visual') as HTMLElement;
    const pin = fixture.nativeElement.querySelector('app-dungeon-location-pin') as HTMLElement;
    vi.spyOn(visual, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      right: 110,
      bottom: 220,
      width: 100,
      height: 200,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(pin, 'getBoundingClientRect').mockReturnValue({
      left: 45,
      top: 84,
      right: 75,
      bottom: 120,
      width: 30,
      height: 36,
      x: 45,
      y: 84,
      toJSON: () => ({}),
    } as DOMRect);
    pin.setPointerCapture = vi.fn();
    pin.hasPointerCapture = vi.fn(() => true);
    pin.releasePointerCapture = vi.fn();

    pin.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 7, clientX: 60, clientY: 120 }));
    pin.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 0, pointerId: 7, clientX: -50, clientY: -50 }));
    pin.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 7, clientX: -50, clientY: -50 }));

    const marker = changed.mock.calls.at(-1)?.[0].marker;
    expect(marker.x).toBeCloseTo(0.126);
    expect(marker.y).toBeCloseTo(0.1548);
  });

  it('updates the hover preview marker while dragging the dungeon marker', async () => {
    const { fixture } = await renderHandCard();
    const previewRequested = vi.fn();
    const previewMarkerChanged = vi.fn();
    const previewHidden = vi.fn();
    fixture.componentInstance.cardPreviewRequested.subscribe(previewRequested);
    fixture.componentInstance.dungeonMarkerPreviewChanged.subscribe(previewMarkerChanged);
    fixture.componentInstance.cardMouseLeft.subscribe(previewHidden);

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('card', { ...gameCard(), typeLine: 'Dungeon', dungeonMarker: { x: 0.5, y: 0.5 } });
    fixture.detectChanges();

    const visual = fixture.nativeElement.querySelector('.card-visual') as HTMLElement;
    const cardElement = fixture.nativeElement.querySelector('[data-testid="game-card"]') as HTMLElement;
    const pin = fixture.nativeElement.querySelector('app-dungeon-location-pin') as HTMLElement;
    const rect = {
      left: 10,
      top: 20,
      right: 110,
      bottom: 220,
      width: 100,
      height: 200,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    } as DOMRect;
    vi.spyOn(visual, 'getBoundingClientRect').mockReturnValue(rect);
    vi.spyOn(cardElement, 'getBoundingClientRect').mockReturnValue(rect);
    pin.setPointerCapture = vi.fn();
    pin.hasPointerCapture = vi.fn(() => true);
    pin.releasePointerCapture = vi.fn();

    pin.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 7, clientX: 60, clientY: 90 }));
    cardElement.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, pointerId: 7, clientX: 70, clientY: 120 }));
    pin.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 0, pointerId: 7, clientX: 70, clientY: 120 }));
    await nextAnimationFrame();

    const preview = previewRequested.mock.calls.at(-1)?.[0];
    const markerPreview = previewMarkerChanged.mock.calls.at(-1)?.[0];
    expect(previewHidden).not.toHaveBeenCalled();
    expect(preview).toEqual(expect.objectContaining({
      card: expect.objectContaining({
        dungeonMarker: { x: 0.5, y: 0.5 },
      }),
      sourceRect: expect.objectContaining({
        left: 10,
        top: 20,
        width: 100,
        height: 200,
      }),
    }));
    expect(previewRequested).toHaveBeenCalledOnce();
    expect(markerPreview).toEqual(expect.objectContaining({
      card: fixture.componentInstance.card(),
      marker: { x: 0.6, y: 0.65 },
    }));
  });

  it('emits double click output from touch double tap', async () => {
    vi.useFakeTimers();
    const { fixture, cardElement } = await renderHandCard();
    const doubleClicked = vi.fn();
    fixture.componentInstance.cardDoubleClicked.subscribe(doubleClicked);

    tap(cardElement, { pointerType: 'touch', pointerId: 1, clientX: 20, clientY: 30 });
    vi.advanceTimersByTime(140);
    const secondUp = tap(cardElement, { pointerType: 'touch', pointerId: 2, clientX: 21, clientY: 30 });

    expect(doubleClicked).toHaveBeenCalledWith({
      event: secondUp,
      card: fixture.componentInstance.card(),
    });
  });

  it('does not emit double click output for battlefield emblems or dungeons', async () => {
    const { fixture, cardElement } = await renderHandCard();
    const doubleClicked = vi.fn();
    fixture.componentInstance.cardDoubleClicked.subscribe(doubleClicked);

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('card', { ...gameCard(), typeLine: 'Emblem', layout: 'emblem' });
    fixture.detectChanges();

    cardElement.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));

    fixture.componentRef.setInput('card', { ...gameCard(), typeLine: 'Dungeon', layout: 'dungeon' });
    fixture.detectChanges();

    cardElement.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));

    expect(doubleClicked).not.toHaveBeenCalled();
  });

  it('does not emit touch double tap when the gesture moves like a drag', async () => {
    vi.useFakeTimers();
    const { fixture, cardElement } = await renderHandCard();
    const doubleClicked = vi.fn();
    fixture.componentInstance.cardDoubleClicked.subscribe(doubleClicked);

    cardElement.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 1,
      pointerType: 'touch',
      clientX: 20,
      clientY: 30,
    }));
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      button: 0,
      pointerId: 1,
      pointerType: 'touch',
      clientX: 38,
      clientY: 30,
    }));
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      pointerId: 1,
      pointerType: 'touch',
      clientX: 38,
      clientY: 30,
    }));
    vi.advanceTimersByTime(140);
    tap(cardElement, { pointerType: 'touch', pointerId: 2, clientX: 20, clientY: 30 });

    expect(doubleClicked).not.toHaveBeenCalled();
  });

  it('applies drop feedback classes without removing existing selected state', async () => {
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('selected', true);
    fixture.componentRef.setInput('dropSettling', true);
    fixture.detectChanges();

    expect(cardElement.classList).toContain('selected');
    expect(cardElement.classList).toContain('drop-settling');
  });

  it('applies the stat drop class independently from normal drop settling', async () => {
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('statDropSettling', true);
    fixture.detectChanges();

    expect(cardElement.classList).toContain('stat-drop-settling');
    expect(cardElement.classList).not.toContain('drop-settling');
  });

  it('renders a planeswalker loyalty counter when loyalty is present', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('loyaltyValue', 3);
    fixture.detectChanges();

    const loyaltyCounter = fixture.nativeElement.querySelector('.loyalty-counter') as HTMLElement | null;
    expect(loyaltyCounter).not.toBeNull();
    expect(loyaltyCounter?.textContent?.trim()).toBe('3');
    expect(fixture.nativeElement.querySelector('.power-toughness-overlay')).toBeNull();
  });

  it('passes battlefield entry settling to the loyalty counter', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('loyaltyValue', 3);
    fixture.componentRef.setInput('statDropSettling', true);
    fixture.detectChanges();

    const loyaltyCounter = fixture.nativeElement.querySelector('.loyalty-counter') as HTMLElement;
    expect(loyaltyCounter.classList).toContain('entry-settling');
  });

  it('hides power toughness and loyalty overlays while the card is face down', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('showPowerToughness', true);
    fixture.componentRef.setInput('powerValue', 2);
    fixture.componentRef.setInput('toughnessValue', 2);
    fixture.componentRef.setInput('loyaltyValue', 3);
    fixture.componentRef.setInput('faceDown', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.power-toughness-overlay')).toBeNull();
    expect(fixture.nativeElement.querySelector('.loyalty-counter')).toBeNull();
  });

  it('plays the stat arrival animation when power toughness appears', async () => {
    vi.useFakeTimers();
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('showPowerToughness', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('showPowerToughness', true);
    fixture.componentRef.setInput('powerValue', 0);
    fixture.componentRef.setInput('toughnessValue', 0);
    fixture.detectChanges();

    expect(cardElement.classList).toContain('stat-overlay-arriving');

    vi.advanceTimersByTime(1240);
    fixture.detectChanges();

    expect(cardElement.classList).not.toContain('stat-overlay-arriving');
  });

  it('marks token copies with a readable badge', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('card', { ...gameCard(), isToken: true, isTokenCopy: true });
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector('.token-copy-marker') as HTMLElement | null;
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('title')).toBe('Esta carta es un token copy');
  });

  it('does not mark regular tokens as token copies', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('card', { ...gameCard(), isToken: true, isTokenCopy: false });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.token-copy-marker')).toBeNull();
  });

  it('shows the rulings marker for visible non-token battlefield cards with persisted rulings metadata', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('card', {
      ...gameCard(),
      scryfallId: 'e71c8c39-3fbb-4a42-9cf6-b3224f5a56fc',
      hasRulings: true,
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.oracle-rulings-marker')).not.toBeNull();
  });

  it('hides the rulings marker when the backend metadata says there are no rulings', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('card', {
      ...gameCard(),
      scryfallId: '33333333-3fbb-4a42-9cf6-b3224f5a56fc',
      hasRulings: false,
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.oracle-rulings-marker')).toBeNull();
  });

  it('hides the rulings marker for hidden or face-down cards', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('card', {
      ...gameCard(),
      scryfallId: 'e71c8c39-3fbb-4a42-9cf6-b3224f5a56fc',
      hasRulings: true,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.oracle-rulings-marker')).not.toBeNull();

    fixture.componentRef.setInput('hidden', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.oracle-rulings-marker')).toBeNull();

    fixture.componentRef.setInput('hidden', false);
    fixture.componentRef.setInput('faceDown', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.oracle-rulings-marker')).toBeNull();
  });

  it('hides the rulings marker for tokens and token copies', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('card', {
      ...gameCard(),
      scryfallId: 'e71c8c39-3fbb-4a42-9cf6-b3224f5a56fc',
      hasRulings: true,
      isToken: true,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.oracle-rulings-marker')).toBeNull();

    fixture.componentRef.setInput('card', {
      ...gameCard(),
      scryfallId: 'e71c8c39-3fbb-4a42-9cf6-b3224f5a56fc',
      hasRulings: true,
      isToken: false,
      isTokenCopy: true,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.oracle-rulings-marker')).toBeNull();
  });

  it('does not show the rulings marker in hand mode', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('card', {
      ...gameCard(),
      scryfallId: 'e71c8c39-3fbb-4a42-9cf6-b3224f5a56fc',
      hasRulings: true,
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.oracle-rulings-marker')).toBeNull();
  });

  it('opens scryfall rulings in a new tab from the rulings marker without triggering card click', async () => {
    const { fixture } = await renderHandCard();
    const clicked = vi.fn();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    fixture.componentInstance.cardClicked.subscribe(clicked);

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('card', {
      ...gameCard(),
      scryfallId: '11111111-3fbb-4a42-9cf6-b3224f5a56fc',
      hasRulings: true,
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.oracle-rulings-marker')).not.toBeNull();

    const marker = fixture.nativeElement.querySelector('.oracle-rulings-marker') as HTMLElement;
    marker?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(open).toHaveBeenCalledWith(
      'https://scryfall.com/card/11111111-3fbb-4a42-9cf6-b3224f5a56fc#rulings',
      '_blank',
      'noopener',
    );
    expect(clicked).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('does not open scryfall when the card is not eligible for the rulings marker', async () => {
    const { fixture } = await renderHandCard();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('card', {
      ...gameCard(),
      scryfallId: '22222222-3fbb-4a42-9cf6-b3224f5a56fc',
      hasRulings: true,
      isToken: true,
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.oracle-rulings-marker')).toBeNull();
    fixture.componentInstance.openRulings(new MouseEvent('click'));
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('plays a face flip animation when the active face changes on the same card', async () => {
    vi.useFakeTimers();
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('card', { ...gameCard(), activeFaceIndex: 1 });
    fixture.detectChanges();

    expect(cardElement.classList).toContain('face-flipping');

    vi.advanceTimersByTime(620);
    fixture.detectChanges();

    expect(cardElement.classList).not.toContain('face-flipping');
  });

  it('plays a face flip animation when the card turns face down or face up', async () => {
    vi.useFakeTimers();
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('card', { ...gameCard(), faceDown: true });
    fixture.detectChanges();

    expect(cardElement.classList).toContain('face-flipping');

    vi.advanceTimersByTime(620);
    fixture.detectChanges();

    fixture.componentRef.setInput('card', { ...gameCard(), faceDown: false });
    fixture.detectChanges();

    expect(cardElement.classList).toContain('face-flipping');
  });

  it('plays a face flip animation when the effective face-down input changes', async () => {
    vi.useFakeTimers();
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('faceDown', true);
    fixture.detectChanges();

    expect(cardElement.classList).toContain('face-flipping');

    vi.advanceTimersByTime(620);
    fixture.detectChanges();

    fixture.componentRef.setInput('faceDown', false);
    fixture.detectChanges();

    expect(cardElement.classList).toContain('face-flipping');
  });

  it('shows a centered face look affordance for double-faced cards and previews the other face', async () => {
    const { fixture, cardElement } = await renderHandCard();
    const clicked = vi.fn();
    const doubleClicked = vi.fn();
    const menuOpened = vi.fn();
    const previewShown = vi.fn();
    fixture.componentInstance.cardClicked.subscribe(clicked);
    fixture.componentInstance.cardDoubleClicked.subscribe(doubleClicked);
    fixture.componentInstance.cardMenuOpened.subscribe(menuOpened);
    fixture.componentInstance.cardMouseEntered.subscribe(previewShown);

    expect(fixture.nativeElement.querySelector('.double-face-toggle')).toBeNull();

    fixture.componentRef.setInput('card', {
      ...gameCard(),
      name: 'Birgi, God of Storytelling // Harnfel, Horn of Bounty',
      cardFaces: [
        cardFace('Birgi, God of Storytelling'),
        cardFace('Harnfel, Horn of Bounty'),
      ],
    });
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('.double-face-toggle') as HTMLElement | null;

    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('title')).toBe('Look at other face');
    expect(toggle?.getAttribute('aria-label')).toBe('Look at other face');
    expect(toggle?.querySelector('lucide-icon[name="rotate-cw"]')).not.toBeNull();

    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(previewShown).toHaveBeenCalledWith(expect.objectContaining({
      card: expect.objectContaining({ activeFaceIndex: 1 }),
    }));

    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(previewShown).toHaveBeenLastCalledWith(expect.objectContaining({
      card: expect.objectContaining({ activeFaceIndex: 0 }),
    }));

    toggle?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(clicked).not.toHaveBeenCalled();
    expect(doubleClicked).not.toHaveBeenCalled();
    expect(menuOpened).not.toHaveBeenCalled();

    toggle?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    expect(menuOpened).toHaveBeenCalledWith(expect.objectContaining({
      card: expect.objectContaining({ instanceId: 'card-1' }),
    }));

    cardElement.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    cardElement.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));

    const lastPreview = previewShown.mock.calls.at(-1)?.[0];
    expect(lastPreview?.card.instanceId).toBe('card-1');
    expect(lastPreview?.card.activeFaceIndex).toBeUndefined();
  });

  it('shows a smaller face look affordance in mini mode and emits the alternate preview request', async () => {
    await TestBed.configureTestingModule({
      imports: [GameCardViewComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ CircleQuestionMark, Link, Layers3, RotateCw }))],
    }).compileComponents();

    const fixture = TestBed.createComponent(GameCardViewComponent);
    const previewRequested = vi.fn();
    const clicked = vi.fn();
    fixture.componentInstance.cardFaceLookRequested.subscribe(previewRequested);
    fixture.componentInstance.cardClicked.subscribe(clicked);
    fixture.componentRef.setInput('mode', 'mini');
    fixture.componentRef.setInput('card', {
      ...gameCard(),
      cardFaces: [
        cardFace('Birgi, God of Storytelling'),
        cardFace('Harnfel, Horn of Bounty'),
      ],
    });
    fixture.componentRef.setInput('playerId', 'player-1');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.detectChanges();

    const miniCard = fixture.nativeElement.querySelector('[data-testid="mini-battlefield-card"]') as HTMLElement;
    const toggle = miniCard.querySelector('.double-face-toggle') as HTMLElement | null;

    expect(toggle).not.toBeNull();
    expect(toggle?.querySelector('lucide-icon[name="rotate-cw"]')).not.toBeNull();

    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(previewRequested).toHaveBeenNthCalledWith(1, expect.objectContaining({
      card: expect.objectContaining({ activeFaceIndex: 1 }),
    }));
    expect(previewRequested).toHaveBeenNthCalledWith(2, expect.objectContaining({
      card: expect.objectContaining({ activeFaceIndex: 0 }),
    }));
    expect(clicked).not.toHaveBeenCalled();
  });

  it('does not show the face toggle affordance for hidden double-faced cards', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('card', {
      ...gameCard(),
      name: 'Birgi, God of Storytelling // Harnfel, Horn of Bounty',
      hidden: true,
      cardFaces: [
        cardFace('Birgi, God of Storytelling'),
        cardFace('Harnfel, Horn of Bounty'),
      ],
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.double-face-toggle')).toBeNull();
  });

  it('does not show the face toggle affordance when the second face has no image uri', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('card', {
      ...gameCard(),
      cardFaces: [
        cardFace('Visible Face'),
        emptyCardFace(),
      ],
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.double-face-toggle')).toBeNull();
  });

  it('plays the face flip animation on stable battlefield cards', async () => {
    vi.useFakeTimers();
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.detectChanges();

    fixture.componentRef.setInput('card', { ...gameCard(), activeFaceIndex: 1 });
    fixture.detectChanges();

    expect(cardElement.classList).toContain('face-flipping');

    vi.advanceTimersByTime(620);
    fixture.detectChanges();

    expect(cardElement.classList).not.toContain('face-flipping');
  });

  it('does not combine the face flip animation with battlefield focus entry', async () => {
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('mode', 'battlefield');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('battlefieldFocusEntry', 'left');
    fixture.detectChanges();

    fixture.componentRef.setInput('card', { ...gameCard(), activeFaceIndex: 1 });
    fixture.detectChanges();

    expect(cardElement.classList).not.toContain('face-flipping');
  });

  it('emits card counter changes from marker rail interactions', async () => {
    const { fixture } = await renderHandCard();
    const counterChanged = vi.fn();
    fixture.componentInstance.counterChanged.subscribe(counterChanged);

    fixture.componentRef.setInput('card', { ...gameCard(), counters: { red: 2 } });
    fixture.detectChanges();

    const marker = fixture.nativeElement.querySelector('.counter-marker') as HTMLElement;
    marker.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    marker.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    expect(counterChanged).toHaveBeenNthCalledWith(1, {
      event: expect.any(PointerEvent),
      card: fixture.componentInstance.card(),
      key: 'red',
      delta: 1,
    });
    expect(counterChanged).toHaveBeenNthCalledWith(2, {
      event: expect.any(MouseEvent),
      card: fixture.componentInstance.card(),
      key: 'red',
      delta: -1,
    });
  });

  it('keeps zero-value counters visible so they can be adjusted from the marker rail', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('card', { ...gameCard(), counters: { '+1/+1': 0 } });
    fixture.detectChanges();

    const marker = fixture.nativeElement.querySelector('.counter-marker') as HTMLElement | null;
    expect(marker).not.toBeNull();
    expect(marker?.textContent).toContain('+1/+1');
    expect(marker?.textContent).toContain('0');
  });

  it('emits a delete request when a zero-value counter is right-clicked', async () => {
    const { fixture } = await renderHandCard();
    const deleteRequested = vi.fn();
    fixture.componentInstance.counterDeleteRequested.subscribe(deleteRequested);

    fixture.componentRef.setInput('card', { ...gameCard(), counters: { red: 0 } });
    fixture.detectChanges();

    const marker = fixture.nativeElement.querySelector('.counter-marker') as HTMLElement;
    marker.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    expect(deleteRequested).toHaveBeenCalledWith({
      event: expect.any(MouseEvent),
      card: fixture.componentInstance.card(),
      key: 'red',
    });
  });

  it('emits loyalty changes from the loyalty counter', async () => {
    const { fixture } = await renderHandCard();
    const loyaltyChanged = vi.fn();
    fixture.componentInstance.loyaltyChanged.subscribe(loyaltyChanged);

    fixture.componentRef.setInput('loyaltyValue', 3);
    fixture.detectChanges();

    const loyaltyCounter = fixture.nativeElement.querySelector('.loyalty-counter') as HTMLElement;
    loyaltyCounter.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    loyaltyCounter.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 2 }));

    expect(loyaltyChanged).toHaveBeenNthCalledWith(1, {
      event: expect.any(Event),
      card: fixture.componentInstance.card(),
      delta: 1,
    });
    expect(loyaltyChanged).toHaveBeenNthCalledWith(2, {
      event: expect.any(Event),
      card: fixture.componentInstance.card(),
      delta: -1,
    });
  });

  it('does not emit duplicate loyalty changes from click or contextmenu fallbacks', async () => {
    const { fixture } = await renderHandCard();
    const loyaltyChanged = vi.fn();
    fixture.componentInstance.loyaltyChanged.subscribe(loyaltyChanged);

    fixture.componentRef.setInput('loyaltyValue', 3);
    fixture.detectChanges();

    const loyaltyCounter = fixture.nativeElement.querySelector('.loyalty-counter') as HTMLElement;
    loyaltyCounter.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    loyaltyCounter.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }));

    expect(loyaltyChanged).not.toHaveBeenCalled();
  });

  it('marks a power increase with the gold stat pulse', async () => {
    vi.useFakeTimers();
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('showPowerToughness', true);
    fixture.componentRef.setInput('powerValue', 2);
    fixture.componentRef.setInput('toughnessValue', 2);
    fixture.detectChanges();

    fixture.componentRef.setInput('powerValue', 3);
    fixture.detectChanges();

    const [powerElement, toughnessElement] = statElements(fixture);
    expect(powerElement.classList).toContain('stat-pulse-increase');
    expect(powerElement.classList).not.toContain('stat-pulse-decrease');
    expect(toughnessElement.classList).not.toContain('stat-pulse-increase');

    vi.advanceTimersByTime(900);
    fixture.detectChanges();

    expect(powerElement.classList).not.toContain('stat-pulse-increase');
  });

  it('keeps the stat pulse alive while repeated changes keep arriving', async () => {
    vi.useFakeTimers();
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('showPowerToughness', true);
    fixture.componentRef.setInput('powerValue', 2);
    fixture.componentRef.setInput('toughnessValue', 2);
    fixture.detectChanges();

    fixture.componentRef.setInput('powerValue', 3);
    fixture.detectChanges();
    vi.advanceTimersByTime(300);
    fixture.componentRef.setInput('powerValue', 4);
    fixture.detectChanges();
    vi.advanceTimersByTime(899);
    fixture.detectChanges();

    const [powerElement] = statElements(fixture);
    expect(powerElement.classList).toContain('stat-pulse-increase');

    vi.advanceTimersByTime(1);
    fixture.detectChanges();

    expect(powerElement.classList).not.toContain('stat-pulse-increase');
  });

  it('marks a toughness decrease with the red stat pulse', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('showPowerToughness', true);
    fixture.componentRef.setInput('powerValue', 2);
    fixture.componentRef.setInput('toughnessValue', 3);
    fixture.detectChanges();

    fixture.componentRef.setInput('toughnessValue', 2);
    fixture.detectChanges();

    const [_powerElement, toughnessElement] = statElements(fixture);
    expect(toughnessElement.classList).toContain('stat-pulse-decrease');
    expect(toughnessElement.classList).not.toContain('stat-pulse-increase');
  });

  it('does not render marker rails in mini mode', async () => {
    await TestBed.configureTestingModule({
      imports: [GameCardViewComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ CircleQuestionMark, Link, Layers3, RotateCw }))],
    }).compileComponents();

    const fixture = TestBed.createComponent(GameCardViewComponent);
    fixture.componentRef.setInput('mode', 'mini');
    fixture.componentRef.setInput('card', { ...gameCard(), counters: { red: 1 }, isTokenCopy: true });
    fixture.componentRef.setInput('playerId', 'player-1');
    fixture.componentRef.setInput('zone', 'battlefield');
    fixture.componentRef.setInput('miniLeftPx', 0);
    fixture.componentRef.setInput('miniTopPx', 0);
    fixture.componentRef.setInput('miniWidthPx', 40);
    fixture.componentRef.setInput('miniHeightPx', 56);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="mini-battlefield-card"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-card-marker-rail')).toBeNull();
  });
});

async function renderHandCard(
  hoverInteractionsEnabled = true,
): Promise<{ fixture: ComponentFixture<GameCardViewComponent>; cardElement: HTMLButtonElement }> {
  await TestBed.configureTestingModule({
    imports: [GameCardViewComponent],
    providers: [importProvidersFrom(LucideAngularModule.pick({ CircleQuestionMark, Link, Layers3, RotateCw }))],
  }).compileComponents();

  const fixture = TestBed.createComponent(GameCardViewComponent);
  fixture.componentRef.setInput('mode', 'hand');
  fixture.componentRef.setInput('card', gameCard());
  fixture.componentRef.setInput('playerId', 'player-1');
  fixture.componentRef.setInput('zone', 'hand');
  fixture.componentRef.setInput('hoverInteractionsEnabled', hoverInteractionsEnabled);
  fixture.detectChanges();

  return {
    fixture,
    cardElement: fixture.nativeElement.querySelector('[data-testid="game-card"]'),
  };
}

function gameCard(): GameCardInstance {
  return {
    instanceId: 'card-1',
    name: 'Arcane Signet',
    tapped: false,
  };
}

function cardFace(name: string) {
  return {
    name,
    manaCost: null,
    typeLine: null,
    oracleText: null,
    power: null,
    toughness: null,
    loyalty: null,
    colors: [],
    imageUris: { normal: `/cards/${name}.jpg` },
  };
}

function emptyCardFace() {
  return {
    name: null,
    manaCost: null,
    typeLine: null,
    oracleText: null,
    power: null,
    toughness: null,
    loyalty: null,
    colors: [],
    imageUris: {},
  };
}

function statElements(fixture: ComponentFixture<GameCardViewComponent>): [HTMLElement, HTMLElement] {
  const elements = Array.from(fixture.nativeElement.querySelectorAll('.power-toughness-overlay span')) as HTMLElement[];
  expect(elements.length).toBe(2);

  return [elements[0]!, elements[1]!];
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function tap(target: EventTarget, init: PointerEventInit): PointerEvent {
  target.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  }));
  const up = new PointerEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
  window.dispatchEvent(up);
  return up;
}
