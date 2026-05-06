import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { PlayerView } from '../game-table.store';
import { GameCardViewComponent } from '../game-card-view/game-card-view.component';

interface HandCardDragEvent {
  event: DragEvent;
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
}

interface HandCardDropEvent {
  event: DragEvent;
  playerId: string;
  card: GameCardInstance;
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

@Component({
  selector: 'app-player-hand-panel',
  imports: [GameCardViewComponent],
  templateUrl: './player-hand-panel.component.html',
  styleUrl: './player-hand-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayerHandPanelComponent {
  readonly player = input.required<PlayerView>();
  readonly isCurrentPlayer = input.required<(playerId: string) => boolean>();
  readonly zoneCount = input.required<(player: PlayerView, zone: GameZoneName) => number>();
  readonly countItems = input.required<(count: number) => number[]>();
  readonly colorAccent = input.required<(player: PlayerView | null) => string>();
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();
  readonly isSelected = input.required<(instanceId: string) => boolean>();
  readonly isDraggingCard = input.required<(card: GameCardInstance) => boolean>();
  readonly isHandDropTarget = input.required<(playerId: string, card: GameCardInstance, placement: 'before' | 'after') => boolean>();
  readonly isDropZoneHighlighted = input.required<(playerId: string, zone: GameZoneName) => boolean>();

  readonly handDragOver = output<DragEvent>();
  readonly handDropped = output<{ event: DragEvent; playerId: string }>();
  readonly cardDragStarted = output<HandCardDragEvent>();
  readonly cardDragEnded = output<void>();
  readonly handCardDragOver = output<HandCardDropEvent>();
  readonly handCardDropped = output<HandCardDropEvent>();
  readonly handCardClicked = output<HandCardMouseEvent>();
  readonly cardMenuOpened = output<HandCardMouseEvent>();
  readonly cardPreviewShown = output<HandCardPreviewEvent>();
  readonly cardPreviewHidden = output<void>();

  handDropPlacement(playerId: string, card: GameCardInstance): 'before' | 'after' | null {
    if (this.isHandDropTarget()(playerId, card, 'before')) {
      return 'before';
    }

    return this.isHandDropTarget()(playerId, card, 'after') ? 'after' : null;
  }

  stopDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }
}
