import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { GameCardInstance } from '../../../../../core/models/game.model';

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
  templateUrl: './commanders-stack.component.html',
  styleUrl: './commanders-stack.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandersStackComponent {
  readonly playerId = input.required<string>();
  readonly cards = input.required<readonly CommandersStackCard[]>();
  readonly canDrag = input(true);

  readonly pointerDragStarted = output<CommandersStackCardPointerEvent>();
  readonly nativeDragStarted = output<CommandersStackCardDragEvent>();
  readonly nativeDragEnded = output<DragEvent>();
  readonly cardPreviewShown = output<CommandersStackCardMouseEvent>();
  readonly cardPreviewHidden = output<void>();

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
