import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';

@Component({
  selector: 'app-card-spoiler-grid',
  imports: [PrettyScrollDirective],
  templateUrl: './card-spoiler-grid.component.html',
  styleUrl: './card-spoiler-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardSpoilerGridComponent {
  readonly cards = input.required<readonly GameCardInstance[]>();
  readonly selectedCardId = input<string | null>(null);
  readonly loading = input(false);
  readonly allowContextMenu = input(true);
  readonly allowReorder = input(false);
  readonly orderLabels = input<readonly string[]>([]);
  readonly emptyLabel = input('No cards found');
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();

  readonly cardSelected = output<GameCardInstance>();
  readonly cardDoubleClicked = output<GameCardInstance>();
  readonly cardMenuOpened = output<{ event: MouseEvent; card: GameCardInstance }>();
  readonly cardsReordered = output<readonly GameCardInstance[]>();

  private draggedCardId: string | null = null;

  selectCard(card: GameCardInstance): void {
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

  dragStart(event: DragEvent, card: GameCardInstance): void {
    if (!this.allowReorder()) {
      event.preventDefault();
      return;
    }

    this.draggedCardId = card.instanceId;
    event.dataTransfer?.setData('text/plain', card.instanceId);
    event.dataTransfer?.setDragImage?.(event.currentTarget as Element, 24, 32);
  }

  dragOver(event: DragEvent): void {
    if (!this.allowReorder() || this.draggedCardId === null) {
      return;
    }

    event.preventDefault();
  }

  dropCard(event: DragEvent, targetCard: GameCardInstance): void {
    if (!this.allowReorder() || this.draggedCardId === null) {
      return;
    }

    event.preventDefault();
    const cards = [...this.cards()];
    const fromIndex = cards.findIndex((card) => card.instanceId === this.draggedCardId);
    const toIndex = cards.findIndex((card) => card.instanceId === targetCard.instanceId);
    this.draggedCardId = null;
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
      return;
    }

    const [movedCard] = cards.splice(fromIndex, 1);
    if (!movedCard) {
      return;
    }
    cards.splice(toIndex, 0, movedCard);
    this.cardsReordered.emit(cards);
  }

  dragEnd(): void {
    this.draggedCardId = null;
  }
}
