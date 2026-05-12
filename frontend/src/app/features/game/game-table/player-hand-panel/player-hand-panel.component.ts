import { AfterViewChecked, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnChanges, OnDestroy, inject, input, output, signal } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { PrettyScrollDirective } from '../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { PlayerView } from '../game-table.store';
import { GameCardViewComponent } from '../game-card-view/game-card-view.component';
import { GameTablePointerDragService, HandPointerDropPreview, PointerDropTarget } from '../services/game-table-pointer-drag.service';

interface HandZoneDropEvent {
  event: DragEvent;
  playerId: string;
}

interface HandCardMouseEvent {
  event: MouseEvent;
  playerId: string;
  card: GameCardInstance;
}

interface HandCardPreviewEvent {
  card: GameCardInstance;
  playerId: string;
  zone: GameZoneName;
}

interface HandPointerReorderEvent {
  playerId: string;
  movedInstanceId: string;
  targetInstanceId: string;
  placement: 'before' | 'after';
}

interface HandPointerZoneMoveEvent {
  playerId: string;
  targetPlayerId: string;
  movedInstanceId: string;
  toZone: GameZoneName;
  rawZone?: string;
  position?: { x: number; y: number };
}

type HandPointerDragMode = 'pending' | 'reorder' | 'transfer';

interface HandPointerDrag {
  playerId: string;
  card: GameCardInstance;
  pointerId: number;
  startX: number;
  startY: number;
  cardWidth: number;
  cardHeight: number;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  mode: HandPointerDragMode;
  preview: HandPointerDropPreview | null;
  overOwnHand: boolean;
}

interface ResolvedHandPointerDrag {
  mode: Exclude<HandPointerDragMode, 'pending'>;
  preview: HandPointerDropPreview | null;
  target: PointerDropTarget | null;
  overOwnHand: boolean;
}

@Component({
  selector: 'app-player-hand-panel',
  imports: [GameCardViewComponent, PrettyScrollDirective],
  templateUrl: './player-hand-panel.component.html',
  styleUrl: './player-hand-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayerHandPanelComponent implements AfterViewChecked, OnChanges, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly pointerDragService = inject(GameTablePointerDragService);
  private readonly revealDelayMs = 200;
  private readonly reorderPreviewDelayMs = 120;
  private readonly reorderHorizontalThreshold = 22;
  private readonly transferVerticalThreshold = 12;
  private readonly ownHandHorizontalRetentionOverlap = 0.4;
  private readonly ownHandTopExitRatio = 0.35;
  private revealTimer: number | null = null;
  private reorderPreviewTimer: number | null = null;
  private pendingReorderPreview: HandPointerDropPreview | null = null;
  private previousHandCount: number | null = null;
  private previousHandSignature = '';
  private previousHandRects = new Map<string, DOMRect>();
  private handAnimationTimers: number[] = [];
  private handArrivalTimer: number | null = null;
  private handArrivalAnchorIndex: number | null = null;
  private handArrivalPreviousIds = new Set<string>();
  private focusInside = false;
  private pointerInside = false;
  private suppressedClickInstanceId: string | null = null;

  readonly player = input.required<PlayerView>();
  readonly zoneCount = input.required<(player: PlayerView, zone: GameZoneName) => number>();
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();
  readonly isSelected = input.required<(instanceId: string) => boolean>();
  readonly isDraggingCard = input.required<(card: GameCardInstance) => boolean>();
  readonly isHandDropTarget = input.required<(playerId: string, card: GameCardInstance, placement: 'before' | 'after') => boolean>();
  readonly isDropZoneHighlighted = input.required<(playerId: string, zone: GameZoneName) => boolean>();
  readonly isCardDropSettling = input<(playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean>(() => false);
  readonly isCardTransferPending = input<(playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean>(() => false);
  readonly interactionFrozen = input(false);
  readonly hasActiveCardDrag = input(false);
  readonly externalRevealAllowed = input(true);

  readonly handDragOver = output<HandZoneDropEvent>();
  readonly handDropped = output<HandZoneDropEvent>();
  readonly handCardClicked = output<HandCardMouseEvent>();
  readonly cardMenuOpened = output<HandCardMouseEvent>();
  readonly cardPreviewShown = output<HandCardPreviewEvent>();
  readonly cardPreviewHidden = output<void>();
  readonly handCardPointerReordered = output<HandPointerReorderEvent>();
  readonly handCardPointerMoved = output<HandPointerZoneMoveEvent>();
  readonly handPointerDropTargetChanged = output<PointerDropTarget | null>();

  readonly handRevealed = signal(false);
  readonly pointerDrag = signal<HandPointerDrag | null>(null);
  readonly handArrivalActive = signal(false);

  ngAfterViewChecked(): void {
    const hand = this.player().state.zones.hand;
    const handCount = hand.length;
    const handSignature = hand.map((card) => card.instanceId).join('|');
    const previousIds = this.previousHandSignature ? this.previousHandSignature.split('|') : [];
    const isExternalArrival = this.previousHandCount !== null
      && handCount > this.previousHandCount
      && handSignature !== this.previousHandSignature;
    this.animateHandLayoutChange(handSignature !== this.previousHandSignature && this.previousHandSignature !== '' && !isExternalArrival);
    if (isExternalArrival) {
      this.animateHandArrival(hand, previousIds);
    }
    if (this.previousHandCount !== null && handCount > this.previousHandCount) {
      this.scrollHandToEnd();
    }

    this.previousHandCount = handCount;
    this.previousHandSignature = handSignature;
  }

  ngOnChanges(): void {
    if (this.hasOwnPointerDrag()) {
      this.keepHandRevealedDuringOwnPointerDrag();
      return;
    }

    if (this.isExternalCardDrag() && !this.externalRevealAllowed()) {
      this.hideHand();
      return;
    }

    if (this.pointerInside && !this.interactionFrozen() && this.canRevealFromPointer()) {
      this.scheduleHandReveal();
      return;
    }

    if (!this.interactionFrozen() && !this.pointerInside && !this.focusInside) {
      this.hideHand();
    }
  }

  ngOnDestroy(): void {
    this.clearRevealTimer();
    this.clearReorderPreviewTimer();
    this.clearHandAnimationTimers();
    this.clearHandArrivalTimer();
  }

  @HostListener('window:pointermove', ['$event'])
  moveHandPointerDrag(event: PointerEvent): void {
    const drag = this.pointerDrag();
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    const intendedMode = drag.mode === 'pending' ? this.nextPointerDragMode(deltaX, deltaY) : drag.mode;
    if (intendedMode === 'pending') {
      return;
    }

    event.preventDefault();
    const resolved = this.resolvePointerDrag(event, drag, intendedMode);
    const visiblePreview = this.visibleReorderPreview(drag, resolved);
    this.handPointerDropTargetChanged.emit(resolved.target);
    this.pointerDrag.set({
      ...drag,
      mode: resolved.mode,
      x: event.clientX - drag.offsetX,
      y: event.clientY - drag.offsetY,
      preview: visiblePreview,
      overOwnHand: resolved.overOwnHand,
    });
  }

  @HostListener('window:pointerup', ['$event'])
  endHandPointerDrag(event: PointerEvent): void {
    const drag = this.pointerDrag();
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    this.clearReorderPreviewTimer();
    this.handPointerDropTargetChanged.emit(null);
    if (drag.mode === 'pending') {
      this.pointerDrag.set(null);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.suppressedClickInstanceId = drag.card.instanceId;

    const resolved = this.resolvePointerDrag(event, drag, drag.mode);

    if (resolved?.mode === 'reorder' && resolved.preview) {
      this.handCardPointerReordered.emit({
        playerId: drag.playerId,
        movedInstanceId: drag.card.instanceId,
        targetInstanceId: resolved.preview.targetInstanceId,
        placement: resolved.preview.placement,
      });
      this.pointerDrag.set(null);
      return;
    }

    if (resolved?.mode === 'transfer') {
      if (resolved.target) {
        this.handCardPointerMoved.emit({
          playerId: drag.playerId,
          targetPlayerId: resolved.target.targetPlayerId,
          movedInstanceId: drag.card.instanceId,
          toZone: resolved.target.toZone,
          ...(resolved.target.rawZone === 'mana' ? { rawZone: resolved.target.rawZone } : {}),
          ...(resolved.target.position ? { position: resolved.target.position } : {}),
        });
      }
    }
    this.pointerDrag.set(null);
  }

  @HostListener('window:pointercancel', ['$event'])
  cancelHandPointerDrag(event: PointerEvent): void {
    const drag = this.pointerDrag();
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    this.pointerDrag.set(null);
    this.clearReorderPreviewTimer();
    this.handPointerDropTargetChanged.emit(null);
  }

  enterHand(): void {
    this.pointerInside = true;
    if (this.hasOwnPointerDrag()) {
      this.keepHandRevealedDuringOwnPointerDrag();
      return;
    }

    if (this.interactionFrozen() || !this.canRevealFromPointer()) {
      this.hideHand();
      return;
    }

    this.scheduleHandReveal();
  }

  leaveHand(): void {
    this.pointerInside = false;
    if (this.hasOwnPointerDrag()) {
      return;
    }

    if (!this.focusInside && !this.interactionFrozen()) {
      this.hideHand();
    }
  }

  focusHand(): void {
    if (this.interactionFrozen()) {
      return;
    }
    this.focusInside = true;
    this.scheduleHandReveal();
  }

  blurHand(event: FocusEvent): void {
    const currentTarget = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (currentTarget?.contains(nextTarget)) {
      return;
    }

    this.focusInside = false;
    if (!this.pointerInside && !this.interactionFrozen()) {
      this.hideHand();
    }
  }

  startHandPointerDrag(event: PointerEvent, playerId: string, card: GameCardInstance): void {
    if (event.button !== 0) {
      return;
    }

    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    target?.setPointerCapture?.(event.pointerId);
    const bounds = target?.getBoundingClientRect();
    const cardWidth = bounds?.width || 103;
    const cardHeight = bounds?.height || 144;
    const offsetX = bounds && bounds.width > 0 ? Math.max(0, Math.min(cardWidth, event.clientX - bounds.left)) : cardWidth / 2;
    const offsetY = bounds && bounds.height > 0 ? Math.max(0, Math.min(cardHeight, event.clientY - bounds.top)) : cardHeight / 2;
    this.clearReorderPreviewTimer();
    this.keepHandRevealedDuringOwnPointerDrag();
    this.cardPreviewHidden.emit();
    this.pointerDrag.set({
      playerId,
      card,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cardWidth,
      cardHeight,
      offsetX,
      offsetY,
      x: event.clientX - offsetX,
      y: event.clientY - offsetY,
      mode: 'pending',
      preview: null,
      overOwnHand: false,
    });
  }

  handDropPlacement(card: GameCardInstance): 'before' | 'after' | null {
    const preview = this.pointerDrag()?.preview;
    if (preview?.targetInstanceId === card.instanceId) {
      return preview.placement;
    }

    if (this.isHandDropTarget()(this.player().id, card, 'before')) {
      return 'before';
    }

    return this.isHandDropTarget()(this.player().id, card, 'after') ? 'after' : null;
  }

  handArrivalSide(card: GameCardInstance, index: number): 'before' | 'after' | null {
    if (!this.handArrivalActive() || this.handArrivalAnchorIndex === null || !this.handArrivalPreviousIds.has(card.instanceId)) {
      return null;
    }

    return index < this.handArrivalAnchorIndex ? 'before' : 'after';
  }

  isHandVisuallyRevealed(): boolean {
    const drag = this.pointerDrag();
    const highlighted = this.isHandDropReceiverHighlighted();

    if (drag?.mode === 'pending') {
      return this.handRevealed() || highlighted;
    }

    if (drag) {
      return highlighted;
    }

    return this.handRevealed() || highlighted;
  }

  isPointerDragActive(): boolean {
    const drag = this.pointerDrag();

    return Boolean(drag && drag.mode !== 'pending');
  }

  shouldRenderEmptyHandDropTarget(): boolean {
    const hand = this.player().state.zones.hand;
    if (hand.length === 0) {
      return true;
    }

    const drag = this.pointerDrag();

    return hand.length === 1
      && Boolean(drag && drag.mode !== 'pending' && drag.card.instanceId === hand[0]?.instanceId);
  }

  hasCompactHandDropTarget(): boolean {
    const handCount = this.player().state.zones.hand.length;

    return handCount >= 1 && handCount <= 4;
  }

  isEmptyHandDropTargetActive(): boolean {
    const drag = this.pointerDrag();

    return this.isHandDropReceiverHighlighted() || Boolean(drag && drag.mode !== 'pending' && drag.overOwnHand);
  }

  isDraggingHandCard(card: GameCardInstance): boolean {
    const drag = this.pointerDrag();
    if (drag && drag.mode !== 'pending' && this.isSelected()(drag.card.instanceId)) {
      return this.isSelected()(card.instanceId);
    }

    return Boolean(drag && drag.mode !== 'pending' && drag.card.instanceId === card.instanceId)
      || this.isDraggingCard()(card)
      || this.isCardTransferPending()(this.player().id, 'hand', card);
  }

  floatingDragCount(): number {
    const drag = this.pointerDrag();
    if (!drag || !this.isSelected()(drag.card.instanceId)) {
      return 1;
    }

    return Math.max(1, this.player().state.zones.hand.filter((card) => this.isSelected()(card.instanceId)).length);
  }

  floatingCardImage(): string | null {
    const card = this.pointerDrag()?.card;

    return card ? this.cardImage()(card) : null;
  }

  isHandDropReceiverHighlighted(): boolean {
    const handPlayer = this.player();
    const drag = this.pointerDrag();

    return this.isDropZoneHighlighted()(handPlayer.id, 'hand')
      || Boolean(drag && (drag.mode === 'reorder' || drag.mode !== 'pending' && drag.overOwnHand));
  }

  handleHandCardClick(event: MouseEvent, playerId: string, card: GameCardInstance): void {
    if (this.suppressedClickInstanceId === card.instanceId) {
      this.suppressedClickInstanceId = null;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    this.handCardClicked.emit({ event, playerId, card });
  }

  stopDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  private scheduleHandReveal(): void {
    this.clearRevealTimer();
    this.revealTimer = window.setTimeout(() => {
      this.handRevealed.set(true);
      this.revealTimer = null;
    }, this.revealDelayMs);
  }

  private canRevealFromPointer(): boolean {
    return !this.isExternalCardDrag() || this.externalRevealAllowed();
  }

  private isExternalCardDrag(): boolean {
    return this.hasActiveCardDrag() && !this.hasOwnPointerDrag();
  }

  private hasOwnPointerDrag(): boolean {
    return this.pointerDrag() !== null;
  }

  private keepHandRevealedDuringOwnPointerDrag(): void {
    this.clearRevealTimer();
    this.handRevealed.set(true);
  }

  private hideHand(): void {
    this.clearRevealTimer();
    this.handRevealed.set(false);
  }

  private clearRevealTimer(): void {
    if (this.revealTimer === null) {
      return;
    }

    window.clearTimeout(this.revealTimer);
    this.revealTimer = null;
  }

  private visibleReorderPreview(drag: HandPointerDrag, resolved: ResolvedHandPointerDrag): HandPointerDropPreview | null {
    if (resolved.mode !== 'reorder') {
      this.clearReorderPreviewTimer();
      return null;
    }

    this.pendingReorderPreview = resolved.preview;
    if (!resolved.preview) {
      return null;
    }

    if (drag.mode === 'reorder' && drag.preview) {
      return resolved.preview;
    }

    if (this.reorderPreviewTimer === null) {
      this.reorderPreviewTimer = window.setTimeout(() => {
        const activeDrag = this.pointerDrag();
        if (activeDrag?.mode === 'reorder') {
          this.pointerDrag.set({ ...activeDrag, preview: this.pendingReorderPreview });
        }
        this.reorderPreviewTimer = null;
      }, this.reorderPreviewDelayMs);
    }

    return null;
  }

  private clearReorderPreviewTimer(): void {
    this.pendingReorderPreview = null;
    if (this.reorderPreviewTimer === null) {
      return;
    }

    window.clearTimeout(this.reorderPreviewTimer);
    this.reorderPreviewTimer = null;
  }

  private scrollHandToEnd(): void {
    window.requestAnimationFrame(() => {
      const row = this.host.nativeElement.querySelector<HTMLElement>('[data-testid="hand-zone"]');
      if (row) {
        row.scrollLeft = row.scrollWidth;
      }
    });
  }

  private animateHandLayoutChange(shouldAnimate: boolean): void {
    const elements = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(
      '[data-testid="game-card"][data-zone="hand"]',
    ));
    const nextRects = new Map<string, DOMRect>();

    for (const element of elements) {
      const instanceId = element.dataset['cardInstanceId'];
      if (!instanceId) {
        continue;
      }

      const currentRect = element.getBoundingClientRect();
      nextRects.set(instanceId, currentRect);
      if (!shouldAnimate || this.isPointerDragActive()) {
        continue;
      }

      const previousRect = this.previousHandRects.get(instanceId);
      if (!previousRect) {
        continue;
      }

      const deltaX = previousRect.left - currentRect.left;
      const deltaY = previousRect.top - currentRect.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
        continue;
      }

      this.animateHandCardFromPreviousPosition(element, deltaX, deltaY);
    }

    this.previousHandRects = nextRects;
  }

  private animateHandCardFromPreviousPosition(element: HTMLElement, deltaX: number, deltaY: number): void {
    element.style.transition = 'none';
    element.classList.add('hand-settling');
    element.style.setProperty('--hand-shift-x', `${deltaX}px`);
    element.style.setProperty('--hand-shift-y', `${Math.max(-8, Math.min(8, deltaY))}px`);
    void element.offsetWidth;

    window.requestAnimationFrame(() => {
      element.style.transition = '';
      element.style.setProperty('--hand-shift-x', '0px');
      element.style.setProperty('--hand-shift-y', '0px');
      const timer = window.setTimeout(() => {
        element.classList.remove('hand-settling');
        element.style.removeProperty('--hand-shift-x');
        element.style.removeProperty('--hand-shift-y');
      }, 460);
      this.handAnimationTimers.push(timer);
    });
  }

  private clearHandAnimationTimers(): void {
    for (const timer of this.handAnimationTimers) {
      window.clearTimeout(timer);
    }
    this.handAnimationTimers = [];
  }

  private animateHandArrival(hand: readonly GameCardInstance[], previousIds: readonly string[]): void {
    const previousIdSet = new Set(previousIds);
    const anchorIndex = hand.findIndex((card) => !previousIdSet.has(card.instanceId));
    if (anchorIndex < 0) {
      return;
    }

    this.clearHandArrivalTimer();
    this.handArrivalPreviousIds = previousIdSet;
    this.handArrivalAnchorIndex = anchorIndex;
    this.handArrivalActive.set(true);
    this.handArrivalTimer = window.setTimeout(() => {
      this.handArrivalActive.set(false);
      this.handArrivalAnchorIndex = null;
      this.handArrivalPreviousIds = new Set<string>();
      this.handArrivalTimer = null;
    }, 680);
  }

  private clearHandArrivalTimer(): void {
    if (this.handArrivalTimer !== null) {
      window.clearTimeout(this.handArrivalTimer);
      this.handArrivalTimer = null;
    }

    this.handArrivalActive.set(false);
    this.handArrivalAnchorIndex = null;
    this.handArrivalPreviousIds = new Set<string>();
  }

  private dropPreviewAt(clientX: number, drag: HandPointerDrag): HandPointerDropPreview | null {
    return this.pointerDragService.handDropPreviewAt(
      this.host.nativeElement,
      drag.playerId,
      clientX,
      this.player().state.zones.hand,
      drag.card.instanceId,
    );
  }

  private resolvePointerDrag(
    event: PointerEvent,
    drag: HandPointerDrag,
    intendedMode: Exclude<HandPointerDragMode, 'pending'>,
  ): ResolvedHandPointerDrag {
    const insideOwnHand = this.isPointerDragInsideRevealedHand(event, drag);
    const target = this.pointerDragService.zoneTargetAt(event, {
      width: drag.cardWidth,
      height: drag.cardHeight,
      offsetX: drag.offsetX,
      offsetY: drag.offsetY,
    });
    if (target && !insideOwnHand) {
      return { mode: 'transfer', target: { ...target, draggedInstanceId: drag.card.instanceId }, preview: null, overOwnHand: false };
    }

    const overOwnHand = insideOwnHand || this.pointerDragService.isHandTargetAt(event, drag.playerId);
    if (insideOwnHand || drag.mode === 'pending' && intendedMode === 'reorder' && overOwnHand) {
      return {
        mode: 'reorder',
        target: null,
        preview: this.dropPreviewAt(event.clientX, drag),
        overOwnHand,
      };
    }

    return { mode: 'transfer', target: null, preview: null, overOwnHand: false };
  }

  private isPointerDragInsideRevealedHand(event: PointerEvent, drag: HandPointerDrag): boolean {
    const hand = this.host.nativeElement.querySelector<HTMLElement>(
      `[data-game-drop-zone][data-zone="hand"][data-player-id="${drag.playerId}"]`,
    );
    if (!hand) {
      return false;
    }

    const bounds = this.handVisualBounds(hand);
    if (bounds.width <= 0 || bounds.height <= 0) {
      return this.pointerDragService.isHandTargetAt(event, drag.playerId);
    }

    const previewLeft = event.clientX - drag.offsetX;
    const previewTop = event.clientY - drag.offsetY;
    if (!this.hasEnoughHandHorizontalOverlap(previewLeft, drag.cardWidth, bounds)) {
      return false;
    }

    return !this.hasExceededTopExitThreshold(previewTop, drag.cardHeight, bounds.top, this.ownHandTopExitRatio);
  }

  private handVisualBounds(hand: HTMLElement): DOMRect {
    const bounds = hand.getBoundingClientRect();

    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      left: bounds.left,
      toJSON: () => ({}),
    } as DOMRect;
  }

  private hasEnoughHandHorizontalOverlap(previewLeft: number, previewWidth: number, bounds: DOMRect): boolean {
    const overlapWidth = Math.max(0, Math.min(previewLeft + previewWidth, bounds.right) - Math.max(previewLeft, bounds.left));
    const horizontalOverlapRatio = previewWidth > 0 ? overlapWidth / previewWidth : 0;

    return horizontalOverlapRatio >= this.ownHandHorizontalRetentionOverlap;
  }

  private hasExceededTopExitThreshold(previewTop: number, previewHeight: number, zoneTop: number, exitRatio: number): boolean {
    if (previewHeight <= 0) {
      return false;
    }

    return zoneTop - previewTop > previewHeight * exitRatio;
  }

  private nextPointerDragMode(deltaX: number, deltaY: number): HandPointerDragMode {
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    if (deltaY <= -this.transferVerticalThreshold && absY >= absX * 0.6) {
      return 'transfer';
    }

    if (absX >= this.reorderHorizontalThreshold && absX > absY * 1.25) {
      return 'reorder';
    }

    return 'pending';
  }

}
