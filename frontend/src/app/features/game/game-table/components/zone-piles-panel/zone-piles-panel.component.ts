import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { PlayerView } from '../../game-table.store';
import { ZoneCardStackComponent } from '../zone-card-stack/zone-card-stack.component';
import { CardPreviewEvent, previewRectFromElement } from '../../models/card-preview.model';

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
  imports: [ZoneCardStackComponent],
  templateUrl: './zone-piles-panel.component.html',
  styleUrl: './zone-piles-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZonePilesPanelComponent {
  readonly player = input.required<PlayerView>();
  readonly zones = input.required<ReadonlyArray<GameZoneName>>();
  readonly colorAccent = input.required<(player: PlayerView | null) => string>();
  readonly topDraggableCard = input.required<(player: PlayerView, zone: GameZoneName) => GameCardInstance | null>();
  readonly zonePreviewCard = input.required<(player: PlayerView, zone: GameZoneName) => GameCardInstance | null>();
  readonly zoneCount = input.required<(player: PlayerView, zone: GameZoneName) => number>();
  readonly isDropZoneHighlighted = input.required<(playerId: string, zone: GameZoneName) => boolean>();
  readonly zoneTitle = input.required<(zone: GameZoneName) => string>();
  readonly zonePreviewImage = input.required<(player: PlayerView, zone: GameZoneName) => string | null>();
  readonly commanderCastCount = input.required<(player: PlayerView) => number>();
  readonly isZoneDropSettling = input<(playerId: string, zone: GameZoneName) => boolean>(() => false);
  readonly isZoneTransferPending = input<(playerId: string, zone: GameZoneName) => boolean>(() => false);
  readonly currentDraggingCardInstanceId = input<string | null>(null);

  readonly zoneDragStart = output<ZoneDragStartEvent>();
  readonly zoneDragEnd = output<void>();
  readonly zoneDragOver = output<DragEvent>();
  readonly zoneDropped = output<ZoneDropEvent>();
  readonly zoneOpened = output<ZoneActionEvent>();
  readonly zoneDoubleClicked = output<ZoneActionEvent>();
  readonly zoneMenuOpened = output<ZoneMenuEvent>();
  readonly commanderCastChanged = output<CommanderCastChangeEvent>();
  readonly cardPreviewShown = output<CardPreviewEvent>();
  readonly cardPreviewHidden = output<void>();

  openZone(zone: GameZoneName): void {
    if (zone === 'library' || zone === 'command') {
      return;
    }

    this.zoneOpened.emit({ playerId: this.player().id, zone });
  }

  changeCommanderCastCount(event: MouseEvent, delta: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.commanderCastChanged.emit({ playerId: this.player().id, delta });
  }

  doubleClickZone(event: MouseEvent, zone: GameZoneName): void {
    event.preventDefault();
    event.stopPropagation();
    this.zoneDoubleClicked.emit({ playerId: this.player().id, zone });
  }

  previewZoneCard(event: MouseEvent, zone: GameZoneName): void {
    if (!this.canPreviewZoneCard(zone)) {
      return;
    }

    const player = this.player();
    const card = this.zonePreviewCard()(player, zone);
    if (card && !card.hidden) {
      this.cardPreviewShown.emit({
        card,
        playerId: player.id,
        zone,
        sourceRect: previewRectFromElement(event.currentTarget instanceof Element ? event.currentTarget : null),
      });
    }
  }

  hideZoneCardPreview(zone: GameZoneName): void {
    if (this.canPreviewZoneCard(zone)) {
      this.cardPreviewHidden.emit();
    }
  }

  private canPreviewZoneCard(zone: GameZoneName): boolean {
    return zone === 'command' || zone === 'library' || zone === 'graveyard' || zone === 'exile';
  }
}
