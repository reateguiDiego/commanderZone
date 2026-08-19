import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { activeCardFaceIndex, canShowAlternateFaceToggle, nextCardFaceIndex } from '../../utils/double-faced-card';

export interface CommandersStackCard {
  card: GameCardInstance;
  image: string | null;
  accent: string;
  dragging: boolean;
  pendingTransfer: boolean;
}

interface CommandersStackCardPointerEvent {
  event: PointerEvent;
  card: GameCardInstance;
}

interface CommandersStackCardDragEvent {
  event: DragEvent;
  card: GameCardInstance;
}

interface CommandersStackCardMouseEvent {
  event: MouseEvent;
  card: GameCardInstance;
}

@Component({
  selector: 'app-commanders-stack',
  imports: [LucideAngularModule],
  templateUrl: './commanders-stack.component.html',
  styleUrl: './commanders-stack.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandersStackComponent {
  readonly playerId = input.required<string>();
  readonly cards = input.required<readonly CommandersStackCard[]>();
  readonly canDrag = input(true);
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();

  readonly pointerDragStarted = output<CommandersStackCardPointerEvent>();
  readonly nativeDragStarted = output<CommandersStackCardDragEvent>();
  readonly nativeDragEnded = output<DragEvent>();
  readonly cardPreviewShown = output<CommandersStackCardMouseEvent>();
  readonly cardPreviewHidden = output<void>();
  private readonly facePreviewIndexes = signal<Record<string, number>>({});

  previewCard(card: GameCardInstance): GameCardInstance {
    const faceIndex = this.facePreviewIndexes()[card.instanceId];

    return faceIndex === undefined ? card : { ...card, activeFaceIndex: faceIndex };
  }

  canShowFaceToggle(card: GameCardInstance): boolean {
    return card.hidden !== true && card.faceDown !== true && canShowAlternateFaceToggle(card);
  }

  lookAtOtherFace(event: MouseEvent, card: GameCardInstance): void {
    event.preventDefault();
    event.stopPropagation();
    const currentFaceIndex = this.facePreviewIndexes()[card.instanceId] ?? activeCardFaceIndex(card);
    const nextFaceIndex = nextCardFaceIndex(card, currentFaceIndex);
    if (nextFaceIndex === null) {
      return;
    }

    this.facePreviewIndexes.update((indexes) => ({ ...indexes, [card.instanceId]: nextFaceIndex }));
    this.cardPreviewShown.emit({ event, card: { ...card, activeFaceIndex: nextFaceIndex } });
  }

  resetFacePreview(card: GameCardInstance): void {
    if (this.facePreviewIndexes()[card.instanceId] === undefined) {
      return;
    }

    this.facePreviewIndexes.update((indexes) => {
      const { [card.instanceId]: _removed, ...rest } = indexes;
      return rest;
    });
  }

  startPointerDrag(event: PointerEvent, card: GameCardInstance): void {
    if (!this.canDrag()) {
      return;
    }

    this.pointerDragStarted.emit({ event, card });
  }

  startNativeDrag(event: DragEvent, card: GameCardInstance): void {
    if (!this.canDrag()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    this.nativeDragStarted.emit({ event, card });
  }

  finishNativeDrag(event: DragEvent): void {
    event.stopPropagation();
    this.nativeDragEnded.emit(event);
  }
}
