import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, inject, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { GameTableLongPressDirective } from '../../directives/game-table-long-press.directive';
import { PreloadCardAlternateFaceDirective } from '../../../../../shared/directives/preload-card-alternate-face.directive';
import { GameScheduledImageDirective } from '../../directives/game-scheduled-image.directive';
import { activeCardFaceIndex, canShowAlternateFaceToggle, nextCardFaceIndex } from '../../utils/double-faced-card';

type CardSpoilerSlot = {
  index: number;
  card: GameCardInstance | null;
};

interface CardSpoilerGridMetrics {
  readonly columns: number;
  readonly cardHeight: number;
  readonly rowGap: number;
  readonly viewportHeight: number;
}

const VIRTUALIZATION_MIN_CARD_COUNT = 30;
const VIRTUALIZATION_OVERSCAN_ROWS = 3;
const DEFAULT_GRID_METRICS: CardSpoilerGridMetrics = {
  columns: 1,
  cardHeight: 346,
  rowGap: 17,
  viewportHeight: 800,
};

@Component({
  selector: 'app-card-spoiler-grid',
  imports: [
    RuntimeTranslatePipe,
    PrettyScrollDirective,
    GameTableLongPressDirective,
    LucideAngularModule,
    GameScheduledImageDirective,
    PreloadCardAlternateFaceDirective,
  ],
  templateUrl: './card-spoiler-grid.component.html',
  styleUrl: './card-spoiler-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardSpoilerGridComponent implements AfterViewInit, OnDestroy {
  private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly cards = input.required<readonly GameCardInstance[]>();
  readonly selectedCardId = input<string | null>(null);
  readonly loading = input(false);
  readonly allowContextMenu = input(true);
  readonly allowReorder = input(false);
  readonly allowSelection = input(true);
  readonly orderLabels = input<readonly string[]>([]);
  readonly emptyLabel = input('No cards found');
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();

  readonly cardSelected = output<GameCardInstance>();
  readonly cardDoubleClicked = output<GameCardInstance>();
  readonly cardMenuOpened = output<{ event: MouseEvent; card: GameCardInstance }>();
  readonly cardsReordered = output<readonly GameCardInstance[]>();

  readonly slots = computed<readonly CardSpoilerSlot[]>(() => {
    const cards = this.cards();
    const slotCount = this.allowReorder()
      ? Math.max(cards.length, this.orderLabels().length)
      : cards.length;

    return Array.from({ length: slotCount }, (_unused, index) => ({
      index,
      card: cards[index] ?? null,
    }));
  });
  private readonly scrollTop = signal(0);
  private readonly gridMetrics = signal<CardSpoilerGridMetrics>(DEFAULT_GRID_METRICS);
  readonly virtualizationEnabled = computed(() =>
    !this.allowReorder() && this.slots().length > VIRTUALIZATION_MIN_CARD_COUNT,
  );
  private readonly virtualWindow = computed(() => {
    const slots = this.slots();
    if (!this.virtualizationEnabled()) {
      return { start: 0, end: slots.length, beforeHeight: 0, afterHeight: 0 };
    }

    const metrics = this.gridMetrics();
    const rowHeight = metrics.cardHeight + metrics.rowGap;
    const startRow = Math.max(0, Math.floor(this.scrollTop() / rowHeight) - VIRTUALIZATION_OVERSCAN_ROWS);
    const visibleRows = Math.ceil(metrics.viewportHeight / rowHeight) + (VIRTUALIZATION_OVERSCAN_ROWS * 2);
    const rowCount = Math.ceil(slots.length / metrics.columns);
    const endRow = Math.min(rowCount, startRow + visibleRows);

    return {
      start: startRow * metrics.columns,
      end: Math.min(slots.length, endRow * metrics.columns),
      beforeHeight: startRow === 0 ? 0 : Math.max(0, (startRow * rowHeight) - metrics.rowGap),
      afterHeight: endRow >= rowCount ? 0 : Math.max(0, ((rowCount - endRow) * rowHeight) - metrics.rowGap),
    };
  });
  readonly renderedSlots = computed(() => {
    const window = this.virtualWindow();
    return this.slots().slice(window.start, window.end);
  });
  readonly virtualSpacerBeforeHeight = computed(() => this.virtualWindow().beforeHeight);
  readonly virtualSpacerAfterHeight = computed(() => this.virtualWindow().afterHeight);

  private draggedCardId: string | null = null;
  private dropTargetCardId: string | null = null;
  private dragPreviewElement: HTMLElement | null = null;
  private readonly facePreviewIndexes = signal<Record<string, number>>({});
  private readonly faceFlipCardIds = signal<Record<string, true>>({});
  private readonly faceFlipTimers = new Map<string, number>();
  private readonly faceFlipAnimationMs = 620;
  private resizeObserver: ResizeObserver | null = null;

  ngAfterViewInit(): void {
    const grid = this.gridElement();
    if (!grid) {
      return;
    }

    const syncMetrics = (): void => this.syncGridMetrics(grid);
    syncMetrics();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    this.resizeObserver = new ResizeObserver(syncMetrics);
    this.resizeObserver.observe(grid);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.clearFaceFlipTimers();
  }

  selectCard(card: GameCardInstance): void {
    if (!this.allowSelection()) {
      return;
    }

    this.cardSelected.emit(card);
  }

  gridScrolled(event: Event): void {
    const grid = event.currentTarget;
    if (!(grid instanceof HTMLElement) || !this.virtualizationEnabled()) {
      return;
    }

    this.scrollTop.set(grid.scrollTop);
  }

  doubleClickCard(event: MouseEvent, card: GameCardInstance): void {
    event.preventDefault();
    this.cardDoubleClicked.emit(card);
  }

  openCardMenu(event: MouseEvent, card: GameCardInstance): void {
    if (!this.allowContextMenu()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    this.cardMenuOpened.emit({ event, card });
  }

  orderLabel(index: number): string {
    return this.orderLabels()[index] ?? '';
  }

  slotTrackBy(_index: number, slot: CardSpoilerSlot): string {
    return slot.card?.instanceId ?? `empty-${slot.index}`;
  }

  isDraggedCard(card: GameCardInstance): boolean {
    return this.draggedCardId === card.instanceId;
  }

  isDropTargetCard(card: GameCardInstance): boolean {
    return this.dropTargetCardId === card.instanceId && this.draggedCardId !== card.instanceId;
  }

  isFaceFlipping(card: GameCardInstance): boolean {
    return this.faceFlipCardIds()[card.instanceId] === true;
  }

  canShowFaceToggle(card: GameCardInstance): boolean {
    return card.hidden !== true
      && card.faceDown !== true
      && canShowAlternateFaceToggle(card);
  }

  stopFaceToggleEvent(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
  }

  stopFaceTogglePointer(event: PointerEvent): void {
    event.stopPropagation();
    if (event.button === 0) {
      event.preventDefault();
    }
  }

  lookAtOtherFace(event: Event, card: GameCardInstance): void {
    this.stopFaceToggleEvent(event);
    const nextFaceIndex = nextCardFaceIndex(card, this.facePreviewIndex(card) ?? activeCardFaceIndex(card));
    if (nextFaceIndex === null) {
      return;
    }

    this.facePreviewIndexes.update((indexes) => ({ ...indexes, [card.instanceId]: nextFaceIndex }));
    this.startFaceFlipAnimation(card);
  }

  resetFacePreview(card: GameCardInstance): void {
    if (this.facePreviewIndex(card) === null) {
      return;
    }

    this.facePreviewIndexes.update((indexes) => {
      const { [card.instanceId]: _removed, ...rest } = indexes;

      return rest;
    });
    this.startFaceFlipAnimation(card);
  }

  previewCard(card: GameCardInstance): GameCardInstance {
    const faceIndex = this.facePreviewIndex(card);

    return faceIndex === null ? card : { ...card, activeFaceIndex: faceIndex };
  }

  dragStart(event: DragEvent, card: GameCardInstance): void {
    if (!this.allowReorder()) {
      event.preventDefault();
      return;
    }

    this.draggedCardId = card.instanceId;
    event.dataTransfer?.setData('text/plain', card.instanceId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }

    this.prepareDragPreview(event);
  }

  dragOver(event: DragEvent, targetCard: GameCardInstance): void {
    if (!this.allowReorder() || this.draggedCardId === null) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    this.dropTargetCardId = targetCard.instanceId;
  }

  dragLeave(event: DragEvent, targetCard: GameCardInstance): void {
    if (this.dropTargetCardId !== targetCard.instanceId) {
      return;
    }

    const currentTarget = event.currentTarget as HTMLElement | null;
    const nextTarget = event.relatedTarget as Node | null;
    if (currentTarget?.contains(nextTarget)) {
      return;
    }

    this.clearDropTarget();
  }

  dropCard(event: DragEvent, targetCard: GameCardInstance): void {
    if (!this.allowReorder() || this.draggedCardId === null) {
      return;
    }

    event.preventDefault();
    const draggedCardId = this.draggedCardId;
    const cards = [...this.cards()];
    const fromIndex = cards.findIndex((card) => card.instanceId === draggedCardId);
    const toIndex = cards.findIndex((card) => card.instanceId === targetCard.instanceId);
    const previousRects = this.cardRects();
    this.clearDragState();
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
      return;
    }

    [cards[fromIndex], cards[toIndex]] = [cards[toIndex] as GameCardInstance, cards[fromIndex] as GameCardInstance];
    if (this.hasSameOrder(cards, this.cards())) {
      return;
    }

    this.cardsReordered.emit(cards);
    this.animateFrom(previousRects);
  }

  dragEnd(): void {
    this.clearDragState();
  }

  private prepareDragPreview(event: DragEvent): void {
    const source = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (!source || !event.dataTransfer?.setDragImage) {
      return;
    }

    this.removeDragPreview();
    const preview = source.cloneNode(true) as HTMLElement;
    preview.classList.remove('dragging', 'drop-target');
    preview.querySelector('.draw-order-label')?.remove();
    preview.style.position = 'fixed';
    preview.style.top = '-1000px';
    preview.style.left = '-1000px';
    preview.style.width = `${source.offsetWidth}px`;
    preview.style.height = `${source.offsetHeight}px`;
    preview.style.pointerEvents = 'none';
    preview.style.opacity = '1';
    preview.style.transform = 'none';
    source.ownerDocument.body.appendChild(preview);
    event.dataTransfer.setDragImage(preview, Math.round(source.offsetWidth / 2), Math.round(source.offsetHeight / 2));
    this.dragPreviewElement = preview;
  }

  private removeDragPreview(): void {
    this.dragPreviewElement?.remove();
    this.dragPreviewElement = null;
  }

  private cardRects(): ReadonlyMap<string, DOMRect> {
    const rects = new Map<string, DOMRect>();
    for (const element of this.cardElements()) {
      const instanceId = element.dataset['cardInstanceId'];
      if (instanceId) {
        rects.set(instanceId, element.getBoundingClientRect());
      }
    }

    return rects;
  }

  private animateFrom(previousRects: ReadonlyMap<string, DOMRect>): void {
    const window = this.hostElement.ownerDocument.defaultView;
    window?.requestAnimationFrame(() => {
      for (const element of this.cardElements()) {
        const instanceId = element.dataset['cardInstanceId'];
        const previousRect = instanceId ? previousRects.get(instanceId) : null;
        if (!previousRect || typeof element.animate !== 'function') {
          continue;
        }

        const nextRect = element.getBoundingClientRect();
        const deltaX = previousRect.left - nextRect.left;
        const deltaY = previousRect.top - nextRect.top;
        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
          continue;
        }

        element.animate([
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: 'translate(0, 0)' },
        ], {
          duration: 280,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        });
      }
    });
  }

  private cardElements(): HTMLElement[] {
    return Array.from(this.hostElement.querySelectorAll<HTMLElement>('[data-card-instance-id]'));
  }

  private gridElement(): HTMLElement | null {
    return this.hostElement.querySelector<HTMLElement>('[data-testid="card-spoiler-grid"]');
  }

  private syncGridMetrics(grid: HTMLElement): void {
    const styles = grid.ownerDocument.defaultView?.getComputedStyle(grid);
    if (!styles) {
      return;
    }
    const cardWidth = this.cssPixelValue(styles.getPropertyValue('--card-spoiler-width'), 250);
    const cardHeight = this.cssPixelValue(styles.getPropertyValue('--card-spoiler-height'), 346);
    const rowGap = this.cssPixelValue(styles.rowGap, 17);
    const paddingWidth = this.cssPixelValue(styles.paddingLeft, 0) + this.cssPixelValue(styles.paddingRight, 0);
    const availableWidth = Math.max(0, grid.clientWidth - paddingWidth);
    const columns = Math.max(1, Math.floor((availableWidth + rowGap) / (cardWidth + rowGap)));
    const nextMetrics: CardSpoilerGridMetrics = {
      columns,
      cardHeight,
      rowGap,
      viewportHeight: Math.max(1, grid.clientHeight),
    };

    const currentMetrics = this.gridMetrics();
    if (
      currentMetrics.columns !== nextMetrics.columns ||
      currentMetrics.cardHeight !== nextMetrics.cardHeight ||
      currentMetrics.rowGap !== nextMetrics.rowGap ||
      currentMetrics.viewportHeight !== nextMetrics.viewportHeight
    ) {
      this.gridMetrics.set(nextMetrics);
    }
  }

  private cssPixelValue(value: string, fallback: number): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private clearDropTarget(): void {
    this.dropTargetCardId = null;
  }

  private clearDragState(): void {
    this.draggedCardId = null;
    this.removeDragPreview();
    this.clearDropTarget();
  }

  private startFaceFlipAnimation(card: GameCardInstance): void {
    this.clearFaceFlipTimer(card.instanceId);
    this.faceFlipCardIds.update((cardIds) => ({ ...cardIds, [card.instanceId]: true }));
    this.faceFlipTimers.set(card.instanceId, window.setTimeout(() => {
      this.faceFlipTimers.delete(card.instanceId);
      this.faceFlipCardIds.update((cardIds) => {
        const nextCardIds = { ...cardIds };
        delete nextCardIds[card.instanceId];

        return nextCardIds;
      });
    }, this.faceFlipAnimationMs));
  }

  private clearFaceFlipTimer(cardId: string): void {
    const timer = this.faceFlipTimers.get(cardId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.faceFlipTimers.delete(cardId);
    }
  }

  private clearFaceFlipTimers(): void {
    for (const timer of this.faceFlipTimers.values()) {
      window.clearTimeout(timer);
    }
    this.faceFlipTimers.clear();
    this.faceFlipCardIds.set({});
  }

  private facePreviewIndex(card: GameCardInstance): number | null {
    return this.facePreviewIndexes()[card.instanceId] ?? null;
  }

  private hasSameOrder(left: readonly GameCardInstance[], right: readonly GameCardInstance[]): boolean {
    return left.length === right.length && left.every((card, index) => card.instanceId === right[index]?.instanceId);
  }
}
