import { ChangeDetectionStrategy, Component, HostListener, inject, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { PlayerView } from '../../game-table.store';
import { ZoneCardStackComponent } from '../zone-card-stack/zone-card-stack.component';
import { CardPreviewEvent, previewRectFromElement } from '../../models/card-preview.model';
import { GameTableZonePointerDragService } from '../../services/game-table-zone-pointer-drag.service';
import { GameTablePointerDragService, PointerDropTarget } from '../../services/game-table-pointer-drag.service';
import { ZonePointerDropRequest } from '../../models/game-table-zone-pointer-drag.model';
import { GameTableLongPressDirective } from '../../directives/game-table-long-press.directive';
import { knownCommanderInstanceIdsFromPlayerState } from '../../utils/command-zone-drop';
import { CommandersStackCard, CommandersStackComponent } from '../commanders-stack/commanders-stack.component';
import { GameTableSpecialEntitiesState } from '../../state/helpers/game-table-special-entities.state';

interface ZoneDragStartEvent {
  event: DragEvent;
  player: PlayerView;
  zone: GameZoneName;
  card: GameCardInstance | null;
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
  commanderInstanceId: string;
  delta: number;
}

interface CommanderCastPill {
  commander: GameCardInstance;
  castCount: number;
  accent: string;
}

const COMMANDER_COLOR_ACCENTS: Record<string, string> = {
  W: '#f0e6c8',
  U: '#8fc8ff',
  B: '#bdb7c8',
  R: '#ff8b62',
  G: '#8fd47f',
  C: '#d7b46a',
};

@Component({
  selector: 'app-zone-piles-panel',
  imports: [RuntimeTranslatePipe, LucideAngularModule, ZoneCardStackComponent, CommandersStackComponent, GameTableLongPressDirective],
  templateUrl: './zone-piles-panel.component.html',
  styleUrl: './zone-piles-panel.component.scss',
  providers: [GameTablePointerDragService, GameTableZonePointerDragService],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZonePilesPanelComponent {
  readonly zonePointerDrag = inject(GameTableZonePointerDragService);
  readonly specialEntities = inject(GameTableSpecialEntitiesState);
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
  readonly commandZoneCards = input.required<(player: PlayerView) => readonly GameCardInstance[]>();
  readonly commanderCards = input.required<(player: PlayerView) => readonly GameCardInstance[]>();
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();
  readonly commanderCastCount = input.required<(player: PlayerView, commander: GameCardInstance) => number>();
  readonly canControlPlayer = input.required<(playerId: string) => boolean>();
  readonly isZoneDropSettling = input<(playerId: string, zone: GameZoneName) => boolean>(() => false);
  readonly isZoneTransferPending = input<(playerId: string, zone: GameZoneName) => boolean>(() => false);
  readonly isCardTransferPending = input<(playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean>(() => false);
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

  isMonarchOwner(playerId: string): boolean {
    return this.specialEntities.globalEntity('monarch')?.ownerPlayerId === playerId;
  }

  startZoneDrag(event: DragEvent, player: PlayerView, zone: GameZoneName, topZoneCard: GameCardInstance | null): void {
    if (!this.canControlPlayer()(player.id)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    this.zoneDragStart.emit({ event, player, zone, card: topZoneCard });

    if (event.defaultPrevented) {
      this.clearZoneDrag(event, zone);
      return;
    }

    if (topZoneCard) {
      this.draggingVisualZone.set(zone);
      const sourceElement = this.nativeDragSourceElement(event, zone);
      if (sourceElement) {
        sourceElement.classList.add('dragging-zone-card');
        if (zone === 'command') {
          sourceElement.classList.add('dragging-command-zone-card');
        }
      }
    }
  }

  clearZoneDrag(event?: DragEvent, zone?: GameZoneName): void {
    this.draggingVisualZone.set(null);
    const sourceElement = event ? this.nativeDragSourceElement(event, zone) : null;
    if (sourceElement) {
      sourceElement.classList.remove('dragging-zone-card');
      sourceElement.classList.remove('dragging-command-zone-card');
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

  changeCommanderCastCount(event: MouseEvent, commander: GameCardInstance, delta: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.commanderCastChanged.emit({ playerId: this.player().id, commanderInstanceId: commander.instanceId, delta });
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

  previewCommandZoneCard(event: MouseEvent, card: GameCardInstance): void {
    if (!card.hidden) {
      this.cardPreviewShown.emit({
        card,
        playerId: this.player().id,
        zone: 'command',
        sourceRect: previewRectFromElement(event.currentTarget instanceof Element ? event.currentTarget : null),
      });
    }
  }

  hideZoneCardPreview(zone: GameZoneName): void {
    if (this.canPreviewZoneCard(zone)) {
      this.cardPreviewHidden.emit();
    }
  }

  startZonePointerDrag(event: PointerEvent, zone: GameZoneName, topZoneCard: GameCardInstance | null, allowMouse = false): void {
    if (!this.canControlCurrentPlayer()) {
      return;
    }

    const started = this.zonePointerDrag.start(event, this.player().id, zone, topZoneCard, {
      allowMouse,
      knownCommanderInstanceIds: this.knownCommanderIds(),
    });
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

    if (!drag) {
      return null;
    }

    return drag.source.fromZone === 'command'
      ? this.cardImage()(drag.source.card)
      : this.zonePreviewImage()(this.player(), drag.source.fromZone);
  }

  isDraggingCommandZoneCard(card: GameCardInstance): boolean {
    const pointerDrag = this.zonePointerDrag.dragMove();

    return pointerDrag?.source.card.instanceId === card.instanceId && pointerDrag.dragging
      || card.instanceId === this.currentDraggingCardInstanceId();
  }

  canUseMousePointerDrag(zone: GameZoneName, card: GameCardInstance | null): boolean {
    return this.canControlCurrentPlayer() && (zone === 'graveyard' || zone === 'exile') && card !== null;
  }

  canUseNativeZoneDrag(zone: GameZoneName, card: GameCardInstance | null): boolean {
    return this.canControlCurrentPlayer() && zone !== 'command' && card !== null && !this.canUseMousePointerDrag(zone, card);
  }

  canDragCommandZoneCards(): boolean {
    return this.canControlCurrentPlayer();
  }

  blockZoneNativeDrag(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  commanderStackCards(player: PlayerView, commanders: readonly GameCardInstance[]): readonly CommandersStackCard[] {
    return commanders.map((commander) => ({
      card: commander,
      image: this.cardImage()(commander),
      accent: this.commanderAccent(commander),
      dragging: this.isDraggingCommandZoneCard(commander),
      pendingTransfer: this.isCardTransferPending()(player.id, 'command', commander),
    }));
  }

  commanderCastPills(player: PlayerView): readonly CommanderCastPill[] {
    return this.commanderCards()(player).map((commander) => ({
      commander,
      castCount: this.commanderCastCount()(player, commander),
      accent: this.commanderAccent(commander),
    }));
  }

  isDualCommandZone(player: PlayerView, zone: GameZoneName): boolean {
    return zone === 'command' && this.commandZoneCards()(player).length === 2;
  }

  private commanderAccent(commander: GameCardInstance): string {
    const colorIdentity = Array.isArray(commander.colorIdentity) ? commander.colorIdentity : [];
    const firstColor = colorIdentity.find((color): color is keyof typeof COMMANDER_COLOR_ACCENTS => color in COMMANDER_COLOR_ACCENTS);

    return firstColor ? COMMANDER_COLOR_ACCENTS[firstColor] : COMMANDER_COLOR_ACCENTS['C'];
  }

  private canPreviewZoneCard(zone: GameZoneName): boolean {
    return zone === 'command' || zone === 'library' || zone === 'graveyard' || zone === 'exile';
  }

  private canControlCurrentPlayer(): boolean {
    return this.canControlPlayer()(this.player().id);
  }

  private knownCommanderIds(): ReadonlySet<string> {
    const player = this.player();

    return player.knownCommanderInstanceIds ?? knownCommanderInstanceIdsFromPlayerState(player.state);
  }

  private clearZonePointerDragVisuals(): void {
    this.pointerDragStartedInstanceId = null;
    this.draggingVisualZone.set(null);
    this.zonePointerDrag.clearDropPreview();
  }

  private nativeDragSourceElement(event: DragEvent, zone?: GameZoneName): HTMLElement | null {
    const currentTarget = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (zone === 'command') {
      const eventTarget = event.target instanceof Element ? event.target : null;

      return eventTarget?.closest<HTMLElement>('.command-zone-card') ?? currentTarget;
    }

    return currentTarget;
  }

  private consumeSuppressedPointerClick(zone: GameZoneName): boolean {
    if (this.suppressedClickZone !== zone) {
      return false;
    }

    this.suppressedClickZone = null;
    return true;
  }
}
