import { ChangeDetectionStrategy, Component, HostListener, inject, input, output, signal } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { PlayerView } from '../../game-table.store';
import { ZoneCardStackComponent } from '../zone-card-stack/zone-card-stack.component';
import { CardPreviewEvent, previewRectFromElement } from '../../models/card-preview.model';
import { GameTableZonePointerDragService } from '../../services/game-table-zone-pointer-drag.service';
import { GameTablePointerDragService, PointerDropTarget } from '../../services/game-table-pointer-drag.service';
import { ZonePointerDropRequest } from '../../models/game-table-zone-pointer-drag.model';
import { GameTableLongPressDirective } from '../../directives/game-table-long-press.directive';

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

interface ZonePointerDragStartEvent {
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
}

interface ZonePointerDropEvent {
  request: ZonePointerDropRequest | null;
  moved: boolean;
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
  imports: [ZoneCardStackComponent, GameTableLongPressDirective],
  templateUrl: './zone-piles-panel.component.html',
  styleUrl: './zone-piles-panel.component.scss',
  providers: [GameTablePointerDragService, GameTableZonePointerDragService],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZonePilesPanelComponent {
  readonly zonePointerDrag = inject(GameTableZonePointerDragService);
  private pointerDragStartedInstanceId: string | null = null;
  private suppressedClickZone: GameZoneName | null = null;

  readonly player = input.required<PlayerView>();
  readonly zones = input.required<ReadonlyArray<GameZoneName>>();
  readonly colorAccent = input.required<(player: PlayerView | null) => string>();
  readonly topDraggableCard = input.required<(player: PlayerView, zone: GameZoneName) => GameCardInstance | null>();
  readonly zonePreviewCard = input.required<(player: PlayerView, zone: GameZoneName) => GameCardInstance | null>();
  readonly zoneCount = input.required<(player: PlayerView, zone: GameZoneName) => number>();
  readonly isDropZoneHighlighted = input.required<(playerId: string, zone: GameZoneName) => boolean>();
  readonly zoneTitle = input.required<(zone: GameZoneName) => string>();
  readonly zonePreviewImage = input.required<(player: PlayerView, zone: GameZoneName) => string | null>();
  readonly zoneStackLayerImage = input.required<(player: PlayerView, zone: GameZoneName) => string | null>();
  readonly commanderCastCount = input.required<(player: PlayerView) => number>();
  readonly isZoneDropSettling = input<(playerId: string, zone: GameZoneName) => boolean>(() => false);
  readonly isZoneTransferPending = input<(playerId: string, zone: GameZoneName) => boolean>(() => false);
  readonly currentDraggingCardInstanceId = input<string | null>(null);
  readonly draggingVisualZone = signal<GameZoneName | null>(null);

  readonly zoneDragStart = output<ZoneDragStartEvent>();
  readonly zoneDragEnd = output<void>();
  readonly zoneDragOver = output<DragEvent>();
  readonly zoneDropped = output<ZoneDropEvent>();
  readonly zonePointerDragStarted = output<ZonePointerDragStartEvent>();
  readonly zonePointerDropTargetChanged = output<PointerDropTarget | null>();
  readonly zonePointerDropped = output<ZonePointerDropEvent>();
  readonly zonePointerDragEnded = output<void>();
  readonly zoneOpened = output<ZoneActionEvent>();
  readonly zoneDoubleClicked = output<ZoneActionEvent>();
  readonly zoneMenuOpened = output<ZoneMenuEvent>();
  readonly commanderCastChanged = output<CommanderCastChangeEvent>();
  readonly cardPreviewShown = output<CardPreviewEvent>();
  readonly cardPreviewHidden = output<void>();

  startZoneDrag(event: DragEvent, player: PlayerView, zone: GameZoneName, topZoneCard: GameCardInstance | null): void {
    if (topZoneCard) {
      this.draggingVisualZone.set(zone);
      if (event.currentTarget instanceof HTMLElement) {
        event.currentTarget.classList.add('dragging-zone-card');
      }
    }

    this.zoneDragStart.emit({ event, player, zone });

    if (event.defaultPrevented) {
      this.clearZoneDrag(event);
    }
  }

  clearZoneDrag(event?: DragEvent): void {
    this.draggingVisualZone.set(null);
    if (event?.currentTarget instanceof HTMLElement) {
      event.currentTarget.classList.remove('dragging-zone-card');
    }
  }

  isDraggingZone(zone: GameZoneName, topZoneCard: GameCardInstance | null): boolean {
    const pointerDrag = this.zonePointerDrag.dragMove();

    return this.draggingVisualZone() === zone
      || pointerDrag?.source.fromZone === zone && pointerDrag.dragging
      || topZoneCard?.instanceId === this.currentDraggingCardInstanceId();
  }

  openZone(zone: GameZoneName): void {
    if (this.consumeSuppressedPointerClick(zone)) {
      return;
    }

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

  startZonePointerDrag(event: PointerEvent, zone: GameZoneName, topZoneCard: GameCardInstance | null): void {
    const started = this.zonePointerDrag.start(event, this.player().id, zone, topZoneCard);
    if (started) {
      this.cardPreviewHidden.emit();
    }
  }

  @HostListener('window:pointermove', ['$event'])
  moveZonePointerDrag(event: PointerEvent): void {
    const move = this.zonePointerDrag.move(event);
    if (!move) {
      return;
    }

    if (this.pointerDragStartedInstanceId !== move.source.card.instanceId) {
      this.pointerDragStartedInstanceId = move.source.card.instanceId;
      this.draggingVisualZone.set(move.source.fromZone);
      this.zonePointerDragStarted.emit({
        playerId: move.source.playerId,
        zone: move.source.fromZone,
        card: move.source.card,
      });
    }

    this.zonePointerDropTargetChanged.emit(move.target);
  }

  @HostListener('window:pointerup', ['$event'])
  endZonePointerDrag(event: PointerEvent): void {
    const result = this.zonePointerDrag.end(event);
    if (!result) {
      return;
    }

    if (result.moved) {
      this.suppressedClickZone = result.source.fromZone;
      this.zonePointerDropped.emit({ request: result.request, moved: true });
    }

    this.clearZonePointerDragVisuals();
  }

  @HostListener('window:pointercancel', ['$event'])
  cancelZonePointerDrag(event: PointerEvent): void {
    const result = this.zonePointerDrag.cancel(event);
    if (!result) {
      return;
    }

    this.zonePointerDropTargetChanged.emit(null);
    this.zonePointerDragEnded.emit();
    this.clearZonePointerDragVisuals();
  }

  floatingCardImage(): string | null {
    const drag = this.zonePointerDrag.dragMove();

    return drag ? this.zonePreviewImage()(this.player(), drag.source.fromZone) : null;
  }

  private canPreviewZoneCard(zone: GameZoneName): boolean {
    return zone === 'command' || zone === 'library' || zone === 'graveyard' || zone === 'exile';
  }

  private clearZonePointerDragVisuals(): void {
    this.pointerDragStartedInstanceId = null;
    this.draggingVisualZone.set(null);
  }

  private consumeSuppressedPointerClick(zone: GameZoneName): boolean {
    if (this.suppressedClickZone !== zone) {
      return false;
    }

    this.suppressedClickZone = null;
    return true;
  }
}
