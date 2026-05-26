import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output } from '@angular/core';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { GameTableLongPressDirective } from '../../directives/game-table-long-press.directive';

type CardSpoilerSlot = {
  index: number;
  card: GameCardInstance | null;
};

@Component({
  selector: 'app-card-spoiler-grid',
  imports: [PrettyScrollDirective, GameTableLongPressDirective],
  templateUrl: './card-spoiler-grid.component.html',
  styleUrl: './card-spoiler-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardSpoilerGridComponent {
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

  private draggedCardId: string | null = null;
  private dropTargetCardId: string | null = null;
  private dragPreviewElement: HTMLElement | null = null;

  selectCard(card: GameCardInstance): void {
    if (!this.allowSelection()) {
      return;
    }

    this.cardSelected.emit(card);
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

  private clearDropTarget(): void {
    this.dropTargetCardId = null;
  }

  private clearDragState(): void {
    this.draggedCardId = null;
    this.removeDragPreview();
    this.clearDropTarget();
  }

  private hasSameOrder(left: readonly GameCardInstance[], right: readonly GameCardInstance[]): boolean {
    return left.length === right.length && left.every((card, index) => card.instanceId === right[index]?.instanceId);
  }
}
