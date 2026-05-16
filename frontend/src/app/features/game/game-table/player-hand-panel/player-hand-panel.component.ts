import { AfterViewChecked, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnChanges, OnDestroy, computed, inject, input, output, signal } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { PrettyScrollDirective } from '../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { PlayerView } from '../game-table.store';
import { GameCardViewComponent } from '../game-card-view/game-card-view.component';
import { GameTablePointerDragService, HandPointerDropPreview, PointerDropTarget } from '../services/game-table-pointer-drag.service';
import { CardPreviewEvent } from '../card-preview.model';
import { HAND_ROW_CARD_STEP_PX } from '../hand-layout.model';

interface HandZoneDropEvent {
  event: DragEvent;
  playerId: string;
}

interface HandCardMouseEvent {
  event: MouseEvent;
  playerId: string;
  card: GameCardInstance;
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
  private readonly handHoverOpenDelayMs = 180;
  private readonly handHoverCloseDelayMs = 260;
  private readonly handDropRevealOpenDelayMs = 1000;
  private readonly handDropRevealCloseDelayMs = 1000;
  private readonly reorderPreviewDelayMs = 120;
  private readonly handArrivalAnimationMs = 2000;
  private readonly reorderHorizontalThreshold = 22;
  private readonly transferVerticalThreshold = 12;
  private readonly ownHandHorizontalRetentionOverlap = 0.4;
  private readonly ownHandTopExitRatio = 0.35;
  private revealTimer: number | null = null;
  private handHoverTimer: number | null = null;
  private handHoverClearTimer: number | null = null;
  private handDropRevealTimer: number | null = null;
  private handDropHideTimer: number | null = null;
  private reorderPreviewTimer: number | null = null;
  private pendingReorderPreview: HandPointerDropPreview | null = null;
  private previousHandCount: number | null = null;
  private previousHandSignature = '';
  private previousHandRects = new Map<string, DOMRect>();
  private handAnimationTimers: number[] = [];
  private handArrivalTimer: number | null = null;
  private handArrivalAnchorIndex: number | null = null;
  private handArrivalPreviousIds = new Set<string>();
  private handArrivalNewIds = new Set<string>();
  private previousHandLayoutMode: 'fan' | 'row' | null = null;
  private pendingRowScrollAnchor: { scrollProgress: number } | null = null;
  private focusInside = false;
  private pointerInside = false;
  private suppressedClickInstanceId: string | null = null;

  readonly player = input.required<PlayerView>();
  readonly zoneCount = input.required<(player: PlayerView, zone: GameZoneName) => number>();
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();
  readonly isSelected = input.required<(instanceId: string) => boolean>();
  readonly isDraggingCard = input.required<(card: GameCardInstance) => boolean>();
  readonly isHandDropTarget = input.required<(playerId: string, card: GameCardInstance, placement: 'before' | 'after') => boolean>();
  readonly isDropZoneHighlighted = input<(playerId: string, zone: GameZoneName) => boolean>(() => false);
  readonly isCardDropSettling = input<(playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean>(() => false);
  readonly isCardTransferPending = input<(playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean>(() => false);
  readonly interactionFrozen = input(false);
  readonly readOnly = input(false);
  readonly showCardsFaceDown = input(false);
  readonly hasOpenHandContextMenu = input(false);
  readonly hasActiveCardDrag = input(false);
  readonly externalRevealAllowed = input(true);

  readonly handDragOver = output<HandZoneDropEvent>();
  readonly handDropped = output<HandZoneDropEvent>();
  readonly handCardClicked = output<HandCardMouseEvent>();
  readonly cardMenuOpened = output<HandCardMouseEvent>();
  readonly cardPreviewShown = output<CardPreviewEvent>();
  readonly cardPreviewHidden = output<void>();
  readonly handCardPointerReordered = output<HandPointerReorderEvent>();
  readonly handCardPointerMoved = output<HandPointerZoneMoveEvent>();
  readonly handPointerDropTargetChanged = output<PointerDropTarget | null>();

  readonly handRevealed = signal(false);
  readonly handHovered = signal(false);
  readonly handDropReceiverRevealed = signal(false);
  readonly pointerDrag = signal<HandPointerDrag | null>(null);
  readonly handArrivalActive = signal(false);
  readonly displayHandCards = computed<readonly GameCardInstance[]>(() => {
    const handPlayer = this.player();
    const visibleCards = handPlayer.state.zones.hand;
    const expectedCount = this.zoneCount()(handPlayer, 'hand');
    if (!this.showCardsFaceDown() || visibleCards.length >= expectedCount) {
      return visibleCards;
    }

    return Array.from({ length: expectedCount }, (_, index): GameCardInstance => visibleCards[index] ?? {
      instanceId: `${handPlayer.id}-hidden-hand-${index}`,
      ownerId: handPlayer.id,
      controllerId: handPlayer.id,
      name: 'Hidden card',
      tapped: false,
      hidden: true,
      zone: 'hand',
    });
  });
  readonly handLayoutMode = computed<'fan' | 'row'>(() => {
    if (this.readOnly() || this.showCardsFaceDown()) {
      return 'fan';
    }

    const drag = this.pointerDrag();
    if (drag?.mode === 'reorder') {
      return 'row';
    }

    if (this.isHandDropReceiverVisuallyHighlighted()) {
      return 'row';
    }

    return (this.handHovered() || this.hasOpenHandContextMenu()) && this.isHandVisuallyRevealed() ? 'row' : 'fan';
  });

  ngAfterViewChecked(): void {
    this.syncHandDropReceiverReveal(this.isExternalHandDropReceiverHighlighted());

    const hand = this.displayHandCards();
    const handCount = hand.length;
    const handSignature = hand.map((card) => card.instanceId).join('|');
    const currentLayoutMode = this.handLayoutMode();
    const previousIds = this.previousHandSignature ? this.previousHandSignature.split('|') : [];
    const isExternalArrival = this.previousHandCount !== null
      && handCount > this.previousHandCount
      && handSignature !== this.previousHandSignature;
    this.animateHandLayoutChange(handSignature !== this.previousHandSignature && this.previousHandSignature !== '' && !isExternalArrival);
    if (isExternalArrival) {
      this.animateHandArrival(hand, previousIds);
    }
    if (this.previousHandCount !== null && handCount > this.previousHandCount && currentLayoutMode === 'row') {
      this.scrollHandToEnd();
    }
    if (currentLayoutMode === 'row' && this.previousHandLayoutMode !== 'row') {
      this.scrollHandRowToPointerAnchor();
    }
    if (currentLayoutMode === 'fan' && (isExternalArrival || this.previousHandLayoutMode !== 'fan')) {
      this.centerHandFan();
    }

    this.previousHandCount = handCount;
    this.previousHandSignature = handSignature;
    this.previousHandLayoutMode = currentLayoutMode;
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
    this.clearHandHoverTimers();
    this.clearHandDropRevealTimers();
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

    const reorderPreview = resolved?.mode === 'reorder'
      ? resolved.preview ?? drag.preview
      : drag.mode === 'reorder' && drag.preview && !resolved?.target
        ? drag.preview
        : null;
    if (reorderPreview) {
      this.handCardPointerReordered.emit({
        playerId: drag.playerId,
        movedInstanceId: drag.card.instanceId,
        targetInstanceId: reorderPreview.targetInstanceId,
        placement: reorderPreview.placement,
      });
      this.keepHandOpenAfterReorder(event, drag.playerId);
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

  enterHand(event?: MouseEvent): void {
    this.pointerInside = true;
    this.rememberRowScrollAnchor(event);
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

  leaveHand(event?: MouseEvent): void {
    if (this.isRelatedTargetInsideHand(event)) {
      this.pointerInside = true;
      return;
    }

    this.pointerInside = false;
    const wasHandHovered = this.handHovered();
    this.scheduleHandHoverClose();
    if (this.hasOwnPointerDrag()) {
      return;
    }

    if (!wasHandHovered && !this.focusInside && !this.interactionFrozen()) {
      this.hideHand();
    }
  }

  enterHandHoverZone(event?: MouseEvent): void {
    this.enterHand(event);
    this.scheduleHandRowOpen();
  }

  enterHandScrollArea(event?: MouseEvent): void {
    this.pointerInside = true;
    this.rememberRowScrollAnchor(event);
    if (!this.isHandVisuallyRevealed()) {
      return;
    }

    this.scheduleHandRowOpen();
  }

  leaveHandScrollArea(event?: MouseEvent): void {
    if (this.isRelatedTargetInsideHand(event)) {
      this.pointerInside = true;
      return;
    }

    this.pointerInside = false;
    this.scheduleHandHoverClose();
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
    if (this.readOnly()) {
      event.preventDefault();
      return;
    }

    if (event.button !== 0) {
      return;
    }

    const visualBounds = this.cardVisualStartBounds(event);
    if (!visualBounds) {
      return;
    }

    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    target?.setPointerCapture?.(event.pointerId);
    const bounds = visualBounds;
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

    if (!this.handDropReceiverRevealed()) {
      return null;
    }

    if (this.isHandDropTarget()(this.player().id, card, 'before')) {
      return 'before';
    }

    return this.isHandDropTarget()(this.player().id, card, 'after') ? 'after' : null;
  }

  enterHandCard(event: MouseEvent, card: GameCardInstance): void {
    if (this.readOnly()) {
      return;
    }

    this.enterHand(event);

    this.scheduleHandRowOpen();
  }

  leaveHandCard(): void {
    this.cardPreviewHidden.emit();
  }

  handDropSlotOffsetPx(index: number, placement: 'before' | 'after'): number {
    const count = Math.max(1, this.displayHandCards().length);
    const slotIndex = placement === 'before' ? index - 0.5 : index + 0.5;
    const centerIndex = (count - 1) / 2;

    return Number(((slotIndex - centerIndex) * this.handRowStepPx(count)).toFixed(3));
  }

  handRowWidthPx(count: number): number {
    const normalizedCount = Math.max(1, count);
    const rowSpan = (normalizedCount - 1) * HAND_ROW_CARD_STEP_PX;
    const estimatedCardWidth = HAND_ROW_CARD_STEP_PX;

    return rowSpan + estimatedCardWidth * 2;
  }

  handArrivalSide(card: GameCardInstance, _index: number): 'before' | 'after' | 'new' | null {
    if (!this.handArrivalActive() || this.handArrivalAnchorIndex === null) {
      return null;
    }

    if (!this.handArrivalPreviousIds.has(card.instanceId)) {
      return this.handArrivalNewIds.has(card.instanceId) ? 'new' : null;
    }

    return null;
  }

  isHandVisuallyRevealed(): boolean {
    if (this.showCardsFaceDown()) {
      return true;
    }

    if (this.hasOpenHandContextMenu()) {
      return true;
    }

    const drag = this.pointerDrag();
    const highlighted = this.isHandDropReceiverVisuallyHighlighted();

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
    const hand = this.displayHandCards();
    if (hand.length === 0) {
      return true;
    }

    const drag = this.pointerDrag();

    return hand.length === 1
      && Boolean(drag && drag.mode !== 'pending' && drag.card.instanceId === hand[0]?.instanceId);
  }

  hasCompactHandDropTarget(): boolean {
    const handCount = this.displayHandCards().length;

    return handCount >= 1 && handCount <= 4;
  }

  isEmptyHandDropTargetActive(): boolean {
    const drag = this.pointerDrag();

    return this.isHandDropReceiverVisuallyHighlighted() || Boolean(drag && drag.mode !== 'pending' && drag.overOwnHand);
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
    const drag = this.pointerDrag();

    return this.isExternalHandDropReceiverHighlighted()
      || Boolean(drag && (drag.mode === 'reorder' || drag.mode !== 'pending' && drag.overOwnHand));
  }

  isHandDropReceiverVisuallyHighlighted(): boolean {
    const drag = this.pointerDrag();

    return this.handDropReceiverRevealed()
      || Boolean(drag && (drag.mode === 'reorder' || drag.mode !== 'pending' && drag.overOwnHand));
  }

  handleHandCardClick(event: MouseEvent, playerId: string, card: GameCardInstance): void {
    if (this.readOnly()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (this.suppressedClickInstanceId === card.instanceId) {
      this.suppressedClickInstanceId = null;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    this.handCardClicked.emit({ event, playerId, card });
  }

  openHandCardMenu(event: MouseEvent, playerId: string, card: GameCardInstance): void {
    if (this.readOnly()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    this.clearHandHoverTimers();
    this.handHovered.set(true);
    this.cardMenuOpened.emit({ event, playerId, card });
  }

  stopDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  handleHandWheel(event: WheelEvent): void {
    if (this.readOnly() || this.handLayoutMode() !== 'row') {
      return;
    }

    const row = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (!row || row.scrollWidth <= row.clientWidth) {
      return;
    }

    const rawDelta = event.deltaX + event.deltaY;
    const fallbackDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    const delta = rawDelta === 0 ? fallbackDelta : rawDelta;
    const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? row.clientWidth
        : 1;

    row.scrollLeft += delta * multiplier;
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
    return !this.showCardsFaceDown() && (!this.isExternalCardDrag() || this.externalRevealAllowed());
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

  private clearHandHoverTimers(): void {
    this.clearHandHoverTimer();
    this.clearHandHoverClearTimer();
  }

  private clearHandHoverTimer(): void {
    if (this.handHoverTimer === null) {
      return;
    }

    window.clearTimeout(this.handHoverTimer);
    this.handHoverTimer = null;
  }

  private clearHandHoverClearTimer(): void {
    if (this.handHoverClearTimer === null) {
      return;
    }

    window.clearTimeout(this.handHoverClearTimer);
    this.handHoverClearTimer = null;
  }

  private clearHandDropRevealTimers(): void {
    this.clearHandDropRevealTimer();
    this.clearHandDropHideTimer();
  }

  private clearHandDropRevealTimer(): void {
    if (this.handDropRevealTimer === null) {
      return;
    }

    window.clearTimeout(this.handDropRevealTimer);
    this.handDropRevealTimer = null;
  }

  private clearHandDropHideTimer(): void {
    if (this.handDropHideTimer === null) {
      return;
    }

    window.clearTimeout(this.handDropHideTimer);
    this.handDropHideTimer = null;
  }

  private syncHandDropReceiverReveal(highlighted: boolean): void {
    if (highlighted) {
      this.clearHandDropHideTimer();
      if (this.handDropReceiverRevealed() || this.handDropRevealTimer !== null) {
        return;
      }

      this.handDropRevealTimer = window.setTimeout(() => {
        this.handDropReceiverRevealed.set(true);
        this.handDropRevealTimer = null;
      }, this.handDropRevealOpenDelayMs);
      return;
    }

    this.clearHandDropRevealTimer();
    if (!this.handDropReceiverRevealed() || this.handDropHideTimer !== null) {
      return;
    }

    this.handDropHideTimer = window.setTimeout(() => {
      this.handDropReceiverRevealed.set(false);
      this.handDropHideTimer = null;
    }, this.handDropRevealCloseDelayMs);
  }

  private scheduleHandHoverClose(): void {
    this.clearHandHoverTimer();
    this.clearHandHoverClearTimer();
    if (!this.handHovered()) {
      return;
    }

    this.handHoverClearTimer = window.setTimeout(() => {
      if (this.pointerInside || this.focusInside || this.hasOpenHandContextMenu()) {
        this.handHoverClearTimer = null;
        return;
      }

      this.handHovered.set(false);
      if (!this.interactionFrozen()) {
        this.hideHand();
      }
      this.handHoverClearTimer = null;
    }, this.handHoverCloseDelayMs);
  }

  private scheduleHandRowOpen(): void {
    if (this.readOnly() || this.interactionFrozen() || !this.canRevealFromPointer()) {
      return;
    }

    this.clearHandHoverClearTimer();
    if (this.handHovered() || this.handHoverTimer !== null) {
      return;
    }

    this.handHoverTimer = window.setTimeout(() => {
      this.handHovered.set(true);
      this.handHoverTimer = null;
    }, this.handHoverOpenDelayMs);
  }

  private keepHandOpenAfterReorder(event: PointerEvent, playerId: string): void {
    if (!this.isPointInsideHandZone(event.clientX, event.clientY, playerId)) {
      return;
    }

    this.pointerInside = true;
    this.clearHandHoverTimers();
    this.clearRevealTimer();
    this.handRevealed.set(true);
    this.handHovered.set(true);
  }

  private handRowStepPx(count: number): number {
    return count <= 1 ? 0 : HAND_ROW_CARD_STEP_PX;
  }

  private isExternalHandDropReceiverHighlighted(): boolean {
    return this.isDropZoneHighlighted()(this.player().id, 'hand');
  }

  private cardVisualStartBounds(event: PointerEvent): DOMRect | null {
    const current = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const visual = current?.querySelector<HTMLElement>('.card-visual') ?? null;
    const visualBounds = visual?.getBoundingClientRect();
    if (visualBounds && visualBounds.width > 0 && visualBounds.height > 0) {
      return this.isInsideBounds(event.clientX, event.clientY, visualBounds) ? visualBounds : null;
    }

    const source = event.target instanceof Element ? event.target : null;
    if (source === null || source.closest('.card-visual') !== null) {
      return current?.getBoundingClientRect() ?? null;
    }

    return null;
  }

  private isInsideBounds(clientX: number, clientY: number, bounds: DOMRect): boolean {
    return clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom;
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

  private scrollHandRowToPointerAnchor(): void {
    const anchor = this.pendingRowScrollAnchor;
    if (!anchor) {
      return;
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const row = this.host.nativeElement.querySelector<HTMLElement>('[data-testid="hand-zone"]');
        if (!row || row.scrollWidth <= row.clientWidth) {
          return;
        }

        const maxScrollLeft = row.scrollWidth - row.clientWidth;

        row.scrollLeft = Math.max(0, Math.min(maxScrollLeft, maxScrollLeft * anchor.scrollProgress));
        this.pendingRowScrollAnchor = null;
      });
    });
  }

  private rememberRowScrollAnchor(event?: MouseEvent): void {
    if (this.readOnly() || !event) {
      return;
    }

    const handBounds = this.handAreaElement()?.getBoundingClientRect()
      ?? (event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null);
    if (!handBounds) {
      return;
    }

    const pointerRatio = this.pointerRatioWithinBounds(event.clientX, handBounds);

    this.pendingRowScrollAnchor = { scrollProgress: this.scrollBandProgress(pointerRatio) };
  }

  private handAreaElement(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>('[data-testid="hand-area"]');
  }

  private isRelatedTargetInsideHand(event?: MouseEvent): boolean {
    const handArea = this.handAreaElement();
    const relatedTarget = event?.relatedTarget instanceof Node ? event.relatedTarget : null;

    return Boolean(handArea && relatedTarget && handArea.contains(relatedTarget));
  }

  private pointerRatioWithinBounds(clientX: number, bounds: DOMRect): number {
    if (bounds.width <= 0) {
      return 0.5;
    }

    return Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
  }

  private scrollBandProgress(pointerRatio: number): number {
    if (pointerRatio < 0.2) {
      return 0;
    }
    if (pointerRatio < 0.4) {
      return 0.25;
    }
    if (pointerRatio < 0.6) {
      return 0.5;
    }
    if (pointerRatio < 0.8) {
      return 0.75;
    }

    return 1;
  }

  private centerHandFan(): void {
    window.requestAnimationFrame(() => {
      if (this.handLayoutMode() !== 'fan') {
        return;
      }

      const row = this.host.nativeElement.querySelector<HTMLElement>('[data-testid="hand-zone"]');
      if (!row) {
        return;
      }

      row.scrollLeft = 0;
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
    const playerId = this.player().id;
    const animatedNewIds = new Set(hand
      .filter((card) => !previousIdSet.has(card.instanceId) && !this.isCardDropSettling()(playerId, 'hand', card))
      .map((card) => card.instanceId));
    const anchorIndex = hand.findIndex((card) => animatedNewIds.has(card.instanceId));
    if (anchorIndex < 0) {
      return;
    }

    this.clearHandArrivalTimer();
    this.handArrivalPreviousIds = previousIdSet;
    this.handArrivalNewIds = animatedNewIds;
    this.handArrivalAnchorIndex = anchorIndex;
    this.handArrivalActive.set(true);
    this.handArrivalTimer = window.setTimeout(() => {
      this.handArrivalActive.set(false);
      this.handArrivalAnchorIndex = null;
      this.handArrivalPreviousIds = new Set<string>();
      this.handArrivalNewIds = new Set<string>();
      this.handArrivalTimer = null;
    }, this.handArrivalAnimationMs);
  }

  private clearHandArrivalTimer(): void {
    if (this.handArrivalTimer !== null) {
      window.clearTimeout(this.handArrivalTimer);
      this.handArrivalTimer = null;
    }

    this.handArrivalActive.set(false);
    this.handArrivalAnchorIndex = null;
    this.handArrivalPreviousIds = new Set<string>();
    this.handArrivalNewIds = new Set<string>();
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

  private isPointInsideHandZone(clientX: number, clientY: number, playerId: string): boolean {
    const hand = this.host.nativeElement.querySelector<HTMLElement>(
      `[data-testid="hand-zone"][data-player-id="${playerId}"]`,
    );
    if (!hand) {
      return false;
    }

    const bounds = hand.getBoundingClientRect();

    return this.isInsideBounds(clientX, clientY, bounds);
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
