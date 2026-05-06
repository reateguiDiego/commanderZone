import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { PlayerView } from '../game-table.store';

interface ZoneDragStartEvent {
  event: DragEvent;
  player: PlayerView;
  zone: GameZoneName;
}

interface ZoneDropEvent {
  event: DragEvent;
  playerId: string;
  zone: GameZoneName;
}

interface ZoneActionEvent {
  playerId: string;
  zone: GameZoneName;
}

interface ZoneMenuEvent extends ZoneActionEvent {
  event: MouseEvent;
}

interface CommanderCastChangeEvent {
  playerId: string;
  delta: number;
}

@Component({
  selector: 'app-zone-piles-panel',
  templateUrl: './zone-piles-panel.component.html',
  styleUrl: './zone-piles-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZonePilesPanelComponent {
  readonly player = input.required<PlayerView>();
  readonly zones = input.required<ReadonlyArray<GameZoneName>>();
  readonly colorAccent = input.required<(player: PlayerView | null) => string>();
  readonly topDraggableCard = input.required<(player: PlayerView, zone: GameZoneName) => GameCardInstance | null>();
  readonly zoneCount = input.required<(player: PlayerView, zone: GameZoneName) => number>();
  readonly isDropZoneHighlighted = input.required<(playerId: string, zone: GameZoneName) => boolean>();
  readonly zoneTitle = input.required<(zone: GameZoneName) => string>();
  readonly zonePreviewImage = input.required<(player: PlayerView, zone: GameZoneName) => string | null>();
  readonly commanderCastCount = input.required<(player: PlayerView) => number>();

  readonly zoneDragStart = output<ZoneDragStartEvent>();
  readonly zoneDragEnd = output<void>();
  readonly zoneDragOver = output<DragEvent>();
  readonly zoneDropped = output<ZoneDropEvent>();
  readonly zoneOpened = output<ZoneActionEvent>();
  readonly zoneMenuOpened = output<ZoneMenuEvent>();
  readonly commanderCastChanged = output<CommanderCastChangeEvent>();

  openZone(zone: GameZoneName): void {
    if (zone === 'library') {
      return;
    }

    this.zoneOpened.emit({ playerId: this.player().id, zone });
  }

  changeCommanderCastCount(event: MouseEvent, delta: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.commanderCastChanged.emit({ playerId: this.player().id, delta });
  }
}
