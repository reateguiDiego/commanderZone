import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { GameCardInstance } from '../../../../../core/models/game.model';

export interface CommandersStackCard {
  card: GameCardInstance;
  image: string | null;
  castCount: number;
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

interface CommandersStackCastChangeEvent {
  event: MouseEvent;
  card: GameCardInstance;
  delta: number;
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

  readonly pointerDragStarted = output<CommandersStackCardPointerEvent>();
  readonly nativeDragStarted = output<CommandersStackCardDragEvent>();
  readonly nativeDragEnded = output<DragEvent>();
  readonly cardPreviewShown = output<CommandersStackCardMouseEvent>();
  readonly cardPreviewHidden = output<void>();
  readonly castCountChanged = output<CommandersStackCastChangeEvent>();

  finishNativeDrag(event: DragEvent): void {
    event.stopPropagation();
    this.nativeDragEnded.emit(event);
  }
}
