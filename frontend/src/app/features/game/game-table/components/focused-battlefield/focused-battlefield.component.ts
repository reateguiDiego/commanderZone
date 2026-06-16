import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DoCheck,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { GameAttachment, GameCardDungeonMarker, GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { PlayerView } from '../../game-table.store';
import { GameCardViewComponent } from '../game-card-view/game-card-view.component';
import { ManaPoolPanelComponent } from '../mana-pool-panel/mana-pool-panel.component';
import { CardPreviewEvent } from '../../models/card-preview.model';
import { LandStackDropPreview } from '../../state/drag-drop/game-table-battlefield-drag.state';
import { buildLandStackGroups, LandStackView, landStackOffsetX, landStackOffsetY } from '../../utils/land-stack';
import { AttachmentStackView, attachmentStackViewFor, buildAttachmentStackGroups } from '../../utils/attachment-stack';
import { GameTableLongPressDirective } from '../../directives/game-table-long-press.directive';
import { ManaPool } from '../../state/mana/game-table-mana-pool.state';
import { ManaPoolColor } from '../../utils/mana-source-detector';
import {
  DEFAULT_BATTLEFIELD_ZOOM_PERCENT,
  MAX_BATTLEFIELD_ZOOM_PERCENT,
  MIN_BATTLEFIELD_ZOOM_PERCENT,
} from '../../state/battlefield/game-table-battlefield-zoom.state';

interface CardCounterView {
  key: string;
  value: number;
}

interface AlignmentGuideView {
  y: number;
  referenceInstanceIds: readonly string[];
}

interface BattlefieldDropEvent {
  event: DragEvent;
  playerId: string;
  zone: GameZoneName;
}

interface BattlefieldZoneMenuEvent {
  event: MouseEvent;
  playerId: string;
  zone: GameZoneName;
}

interface BattlefieldManaPoolMenuEvent {
  event: MouseEvent;
  playerId: string;
}

interface BattlefieldCardPointerEvent {
  event: PointerEvent;
  playerId: string;
  card: GameCardInstance;
}

interface BattlefieldCardMouseEvent {
  event: MouseEvent;
  playerId: string;
  card: GameCardInstance;
}

interface BattlefieldCardStatChangeEvent {
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
  delta: number;
}

interface BattlefieldCardCounterChangeEvent extends BattlefieldCardStatChangeEvent {
  key: string;
}

interface BattlefieldCardCounterDeleteRequestEvent {
  event: MouseEvent;
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
  key: string;
}

interface BattlefieldDungeonMarkerChangeEvent {
  event: PointerEvent;
  playerId: string;
  card: GameCardInstance;
  marker: GameCardDungeonMarker;
}

interface BattlefieldDungeonMarkerPreviewEvent {
  playerId: string;
  card: GameCardInstance;
  marker: GameCardDungeonMarker | null;
}

interface BattlefieldSizeEvent {
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type BattlefieldFocusEntry = 'left' | 'right' | 'fade' | null;

const MIN_STACK_VISUAL_OFFSET_Y = 12;
const MAX_STACK_VISUAL_OFFSET_Y = 25;
const EMPTY_MANA_POOL: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

@Component({
  selector: 'app-focused-battlefield',
  imports: [RuntimeTranslatePipe, GameCardViewComponent, GameTableLongPressDirective, ManaPoolPanelComponent],
  templateUrl: './focused-battlefield.component.html',
  styleUrl: './focused-battlefield.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FocusedBattlefieldComponent implements AfterViewInit, DoCheck, OnDestroy {
  private resizeObserver: ResizeObserver | null = null;
  private lastBattlefieldSize: BattlefieldSizeEvent | null = null;
  private lastPlayerId: string | null = null;
  private lastLayoutKey: unknown = null;
  private boardTransitionTimer: number | null = null;
  private layoutRefreshFrame: number | null = null;

  @ViewChild('battlefieldRoot', { static: true }) private readonly battlefieldRoot?: ElementRef<HTMLElement>;

  readonly player = input.required<PlayerView>();
  readonly isCurrentPlayer = input.required<(playerId: string) => boolean>();
  readonly allowArrowTargetSelection = input(false);
  readonly focusEffectsEnabled = input(true);
  readonly monarchCard = input<GameCardInstance | null>(null);
  readonly dayNightCard = input<GameCardInstance | null>(null);
  readonly isDropZoneHighlighted = input.required<(playerId: string, zone: GameZoneName) => boolean>();
  readonly cardPosition = input.required<(card: GameCardInstance) => { x: number; y: number } | null>();
  readonly isSelected = input.required<(instanceId: string) => boolean>();
  readonly isDraggingCard = input.required<(card: GameCardInstance) => boolean>();
  readonly canDragBattlefieldCard = input.required<(playerId: string, card: GameCardInstance) => boolean>();
  readonly isPendingBattlefieldTransfer = input.required<(card: GameCardInstance) => boolean>();
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();
  readonly shouldShowPowerToughness = input.required<(card: GameCardInstance) => boolean>();
  readonly cardPowerValue = input.required<(card: GameCardInstance) => number | null>();
  readonly cardToughnessValue = input.required<(card: GameCardInstance) => number | null>();
  readonly firstCounter = input.required<(card: GameCardInstance) => CardCounterView | null>();
  readonly alignmentGuideFor = input.required<(playerId: string) => AlignmentGuideView | null>();
  readonly isManaLaneHighlighted = input.required<(playerId: string) => boolean>();
  readonly manaPool = input<(playerId: string) => ManaPool>(() => EMPTY_MANA_POOL);
  readonly canEditManaPool = input<(playerId: string) => boolean>(() => false);
  readonly isManaPoolHidden = input<(playerId: string) => boolean>(() => false);
  readonly pendingManaColors = input<readonly ManaPoolColor[]>([]);
  readonly layoutKey = input<unknown>(null);
  readonly zoomPercent = input(DEFAULT_BATTLEFIELD_ZOOM_PERCENT);
  readonly landStackDropPreview = input<LandStackDropPreview | null>(null);
  readonly attachments = input<readonly GameAttachment[]>([]);
  readonly isCardDropSettling = input<(playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean>(() => false);
  readonly isManaDropSettling = input<(playerId: string, card: GameCardInstance) => boolean>(() => false);
  readonly isBattlefieldEntrySettling = input<(playerId: string, card: GameCardInstance) => boolean>(() => false);
  readonly isCommanderEntrySettling = input<(playerId: string, card: GameCardInstance) => boolean>(() => false);
  readonly isCardTransferPending = input<(playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean>(() => false);

  readonly landStackGroups = computed(() => buildLandStackGroups(
    this.player().state.zones.battlefield.filter((card) => !this.isDraggingCard()(card)),
    (candidate) => this.cardPosition()(candidate),
  ));
  readonly battlefieldDragOver = output<DragEvent>();
  readonly battlefieldDropped = output<BattlefieldDropEvent>();
  readonly battlefieldMenuOpened = output<BattlefieldZoneMenuEvent>();
  readonly manaPoolMenuOpened = output<BattlefieldManaPoolMenuEvent>();
  readonly dayNightPointerDown = output<BattlefieldCardPointerEvent>();
  readonly cardPointerDown = output<BattlefieldCardPointerEvent>();
  readonly cardClicked = output<BattlefieldCardMouseEvent>();
  readonly cardDoubleClicked = output<BattlefieldCardMouseEvent>();
  readonly cardMenuOpened = output<BattlefieldCardMouseEvent>();
  readonly cardPreviewShown = output<CardPreviewEvent>();
  readonly cardPreviewRequested = output<CardPreviewEvent>();
  readonly cardPreviewHidden = output<void>();
  readonly cardPowerChanged = output<BattlefieldCardStatChangeEvent>();
  readonly cardToughnessChanged = output<BattlefieldCardStatChangeEvent>();
  readonly cardLoyaltyChanged = output<BattlefieldCardStatChangeEvent>();
  readonly cardCounterChanged = output<BattlefieldCardCounterChangeEvent>();
  readonly cardCounterDeleteRequested = output<BattlefieldCardCounterDeleteRequestEvent>();
  readonly dungeonMarkerChanged = output<BattlefieldDungeonMarkerChangeEvent>();
  readonly dungeonMarkerPreviewChanged = output<BattlefieldDungeonMarkerPreviewEvent>();
  readonly manaLaneDragOver = output<DragEvent>();
  readonly manaLaneDropped = output<{ event: DragEvent; playerId: string }>();
  readonly manaPoolColorAdded = output<{ playerId: string; color: ManaPoolColor }>();
  readonly manaPoolColorRemoved = output<{ playerId: string; color: ManaPoolColor }>();
  readonly manaPoolHidden = output<{ playerId: string }>();
  readonly battlefieldSizeChanged = output<BattlefieldSizeEvent>();
  readonly boardTransitioning = signal(false);
  readonly hoveredAttachmentStackId = signal<string | null>(null);
  private readonly measuredLayoutVersion = signal(0);
  readonly landStackViews = computed<ReadonlyMap<string, LandStackView>>(() => {
    const views = new Map<string, LandStackView>();

    for (const group of this.landStackGroups()) {
      for (const member of group.members) {
        views.set(member.card.instanceId, {
          stackId: group.id,
          size: group.members.length,
          layer: member.layer,
          role: member.role,
        });
      }
    }

    return views;
  });
  readonly landStackDisplayPositions = computed<ReadonlyMap<string, { x: number; y: number }>>(() => {
    this.layoutKey();
    this.measuredLayoutVersion();
    const positions = new Map<string, { x: number; y: number }>();
    const stackOffsetY = this.stackVisualOffsetY();

    for (const group of this.landStackGroups()) {
      const top = group.members.find((member) => member.layer === 0);
      if (!top) {
        continue;
      }

      const rawPositions = group.members.map((member) => ({
        member,
        position: {
          x: top.position.x + landStackOffsetX() * member.layer,
          y: top.position.y - stackOffsetY * member.layer,
        },
      }));
      const shiftY = this.verticalOverflowShift(rawPositions.map((item) => ({
        instanceId: item.member.card.instanceId,
        position: item.position,
      })));

      for (const member of group.members) {
        positions.set(member.card.instanceId, {
          x: top.position.x + landStackOffsetX() * member.layer,
          y: top.position.y - stackOffsetY * member.layer - shiftY,
        });
      }
    }

    return positions;
  });
  readonly attachmentStackGroups = computed(() => buildAttachmentStackGroups(
    this.player().state.zones.battlefield,
    this.attachments(),
    (candidate) => this.cardPosition()(candidate),
  ));
  readonly attachmentStackViews = computed<ReadonlyMap<string, AttachmentStackView>>(() => {
    const views = new Map<string, AttachmentStackView>();

    for (const group of this.attachmentStackGroups()) {
      for (const member of group.members) {
        const view = attachmentStackViewFor([group], member.card.instanceId);
        if (view) {
          views.set(member.card.instanceId, view);
        }
      }
    }

    return views;
  });
  readonly attachmentStackDisplayPositions = computed<ReadonlyMap<string, { x: number; y: number }>>(() => {
    this.layoutKey();
    this.measuredLayoutVersion();
    const positions = new Map<string, { x: number; y: number }>();
    const stackOffsetY = this.stackVisualOffsetY();

    for (const group of this.attachmentStackGroups()) {
      const target = group.members.find((member) => member.layer === 0);
      if (!target) {
        continue;
      }

      const rawPositions = group.members.map((member) => ({
        member,
        position: {
          x: target.position.x + landStackOffsetX() * member.layer,
          y: target.position.y - stackOffsetY * member.layer,
        },
      }));
      const shiftY = this.verticalOverflowShift(rawPositions.map((item) => ({
        instanceId: item.member.card.instanceId,
        position: item.position,
      })));

      for (const member of group.members) {
        positions.set(member.card.instanceId, {
          x: target.position.x + landStackOffsetX() * member.layer,
          y: target.position.y - stackOffsetY * member.layer - shiftY,
        });
      }
    }

    return positions;
  });

  ngAfterViewInit(): void {
    const element = this.battlefieldRoot?.nativeElement;
    if (!element) {
      return;
    }

    this.emitBattlefieldSize(element);
    this.queueMeasuredLayoutRefresh();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    this.resizeObserver = new ResizeObserver(([entry]) => {
      if (entry) {
        this.emitBattlefieldSize(element);
        this.queueMeasuredLayoutRefresh();
      }
    });
    this.resizeObserver.observe(element);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.boardTransitionTimer !== null) {
      window.clearTimeout(this.boardTransitionTimer);
      this.boardTransitionTimer = null;
    }
    if (this.layoutRefreshFrame !== null) {
      window.cancelAnimationFrame(this.layoutRefreshFrame);
      this.layoutRefreshFrame = null;
    }
  }

  ngDoCheck(): void {
    const playerId = this.player().id;
    const layoutKey = this.layoutKey();
    const playerChanged = this.lastPlayerId !== playerId;
    const layoutChanged = this.lastLayoutKey !== layoutKey;

    this.lastLayoutKey = layoutKey;

    if (playerChanged) {
      this.lastPlayerId = playerId;
      this.triggerBoardTransition();
    }

    if (playerChanged || layoutChanged) {
      this.queueMeasuredLayoutRefresh();
    }
  }

  canInteractWithCard(playerId: string, card: GameCardInstance): boolean {
    return this.isCurrentPlayer()(playerId) && this.canDragBattlefieldCard()(playerId, card);
  }

  onCardDoubleClick(event: MouseEvent, playerId: string, card: GameCardInstance): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isCurrentPlayer()(playerId) || this.attachmentStackView(card)?.role === 'equipment') {
      return;
    }

    this.cardDoubleClicked.emit({ event, playerId, card });
  }

  onCardClick(event: MouseEvent, playerId: string, card: GameCardInstance): void {
    if (!this.isCurrentPlayer()(playerId) && !this.allowArrowTargetSelection()) {
      event.stopPropagation();
      return;
    }

    this.cardClicked.emit({ event, playerId, card });
  }

  onCardMenu(event: MouseEvent, playerId: string, card: GameCardInstance): void {
    if (!this.isCurrentPlayer()(playerId)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    this.cardMenuOpened.emit({ event, playerId, card });
  }

  preventUnexpectedNativeDragStart(event: DragEvent): void {
    const source = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-testid="game-card"][draggable="true"]') : null;
    if (source) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  }

  suppressExcessivePrimaryClick(event: PointerEvent): void {
    if (event.button !== 0 || event.detail <= 2) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  }

  changePower(event: MouseEvent, playerId: string, card: GameCardInstance, delta: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.cardPowerChanged.emit({ playerId, zone: 'battlefield', card, delta });
  }

  changeToughness(event: MouseEvent, playerId: string, card: GameCardInstance, delta: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.cardToughnessChanged.emit({ playerId, zone: 'battlefield', card, delta });
  }

  changeLoyalty(event: MouseEvent, playerId: string, card: GameCardInstance, delta: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.cardLoyaltyChanged.emit({ playerId, zone: 'battlefield', card, delta });
  }

  changeCounter(event: MouseEvent, playerId: string, card: GameCardInstance, key: string, delta: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.cardCounterChanged.emit({ playerId, zone: 'battlefield', card, key, delta });
  }

  requestCounterDelete(event: MouseEvent, playerId: string, card: GameCardInstance, key: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.cardCounterDeleteRequested.emit({ event, playerId, zone: 'battlefield', card, key });
  }

  stopStatPointer(event: PointerEvent): void {
    event.stopPropagation();
  }

  stopStatDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  cardVisibility(playerId: string, card: GameCardInstance): boolean {
    return !this.isDraggingCard()(card)
      && !this.isPendingBattlefieldTransfer()(card)
      && !this.isCardTransferPending()(playerId, 'battlefield', card);
  }

  isAlignmentReference(card: GameCardInstance, guide: AlignmentGuideView | null): boolean {
    return Boolean(guide?.referenceInstanceIds.includes(card.instanceId));
  }

  landStackView(card: GameCardInstance): LandStackView | null {
    return this.landStackViews().get(card.instanceId) ?? null;
  }

  attachmentStackView(card: GameCardInstance): AttachmentStackView | null {
    return this.attachmentStackViews().get(card.instanceId) ?? null;
  }

  isAttachmentStackHighlighted(card: GameCardInstance): boolean {
    const hoveredStackId = this.hoveredAttachmentStackId();
    const attachmentView = this.attachmentStackView(card);

    return hoveredStackId !== null && attachmentView?.stackId === hoveredStackId;
  }

  onCardPointerEntered(card: GameCardInstance): void {
    this.hoveredAttachmentStackId.set(this.attachmentStackView(card)?.stackId ?? null);
  }

  onCardPointerLeft(): void {
    this.hoveredAttachmentStackId.set(null);
    this.cardPreviewHidden.emit();
  }

  displayedCardPosition(card: GameCardInstance): { x: number; y: number } | null {
    this.layoutKey();
    this.measuredLayoutVersion();
    return this.landStackDisplayPositions().get(card.instanceId)
      ?? this.attachmentStackDisplayPositions().get(card.instanceId)
      ?? this.fitPositionInsideBattlefield(card.instanceId, this.cardPosition()(card));
  }

  isLandStackDropTarget(playerId: string, card: GameCardInstance): boolean {
    const preview = this.landStackDropPreview();

    return preview?.playerId === playerId && preview.targetInstanceId === card.instanceId;
  }

  landStackDropSize(playerId: string, card: GameCardInstance): number | null {
    const preview = this.landStackDropPreview();

    return preview?.playerId === playerId && preview.targetInstanceId === card.instanceId && preview.kind === 'land'
      ? preview.nextSize ?? null
      : null;
  }

  stackDropKind(playerId: string, card: GameCardInstance): 'land' | 'attachment' {
    const preview = this.landStackDropPreview();

    return preview?.playerId === playerId && preview.targetInstanceId === card.instanceId
      ? preview.kind
      : 'land';
  }

  battlefieldFocusEntry(card: GameCardInstance): BattlefieldFocusEntry {
    if (!this.focusEffectsEnabled() || !this.boardTransitioning()) {
      return null;
    }

    if (!this.usesLandingFocusEntry(card)) {
      return 'fade';
    }

    const position = this.cardPosition()(card);
    if (!position) {
      return 'left';
    }

    const battlefieldWidth = this.lastBattlefieldSize?.width ?? 0;
    if (battlefieldWidth <= 0) {
      return position.x <= 0 ? 'left' : 'right';
    }

    return position.x + 58 <= battlefieldWidth / 2 ? 'left' : 'right';
  }

  private usesLandingFocusEntry(card: GameCardInstance): boolean {
    const typeLine = card.typeLine?.toLowerCase() ?? '';

    return typeLine.includes('creature') || typeLine.includes('planeswalker');
  }

  private emitBattlefieldSize(element: HTMLElement): void {
    const bounds = element.getBoundingClientRect();
    const width = Math.round(element.clientWidth || bounds.width);
    const height = Math.round(element.clientHeight || bounds.height);
    const left = Math.round(bounds.left);
    const top = Math.round(bounds.top);
    const next = {
      width,
      height,
      left,
      top,
      right: left + width,
      bottom: top + height,
    };
    if (next.width <= 0 || next.height <= 0) {
      return;
    }

    const previous = this.lastBattlefieldSize;
    if (
      previous?.width === next.width
      && previous.height === next.height
      && previous.left === next.left
      && previous.top === next.top
      && previous.right === next.right
      && previous.bottom === next.bottom
    ) {
      return;
    }

    this.lastBattlefieldSize = next;
    this.battlefieldSizeChanged.emit(next);
  }

  private triggerBoardTransition(): void {
    if (!this.focusEffectsEnabled()) {
      this.clearBoardTransition();
      return;
    }

    this.boardTransitioning.set(false);
    window.requestAnimationFrame(() => this.boardTransitioning.set(true));
    if (this.boardTransitionTimer !== null) {
      window.clearTimeout(this.boardTransitionTimer);
    }
    this.boardTransitionTimer = window.setTimeout(() => {
      this.boardTransitioning.set(false);
      this.boardTransitionTimer = null;
    }, 980);
  }

  private clearBoardTransition(): void {
    this.boardTransitioning.set(false);
    if (this.boardTransitionTimer !== null) {
      window.clearTimeout(this.boardTransitionTimer);
      this.boardTransitionTimer = null;
    }
  }

  private queueMeasuredLayoutRefresh(): void {
    if (this.layoutRefreshFrame !== null) {
      return;
    }

    this.layoutRefreshFrame = window.requestAnimationFrame(() => {
      this.layoutRefreshFrame = null;
      this.measuredLayoutVersion.update((value) => value + 1);
    });
  }

  private fitPositionInsideBattlefield(instanceId: string, position: { x: number; y: number } | null): { x: number; y: number } | null {
    if (!position) {
      return null;
    }

    const shiftY = this.verticalOverflowShift([{ instanceId, position }]);

    return shiftY > 0 ? { ...position, y: position.y - shiftY } : position;
  }

  private stackVisualOffsetY(): number {
    const zoomPercent = Math.max(
      MIN_BATTLEFIELD_ZOOM_PERCENT,
      Math.min(MAX_BATTLEFIELD_ZOOM_PERCENT, Math.round(this.zoomPercent())),
    );
    const offset = zoomPercent <= DEFAULT_BATTLEFIELD_ZOOM_PERCENT
      ? this.interpolateStackVisualOffset(
        zoomPercent,
        MIN_BATTLEFIELD_ZOOM_PERCENT,
        DEFAULT_BATTLEFIELD_ZOOM_PERCENT,
        MIN_STACK_VISUAL_OFFSET_Y,
        landStackOffsetY(),
      )
      : this.interpolateStackVisualOffset(
        zoomPercent,
        DEFAULT_BATTLEFIELD_ZOOM_PERCENT,
        MAX_BATTLEFIELD_ZOOM_PERCENT,
        landStackOffsetY(),
        MAX_STACK_VISUAL_OFFSET_Y,
      );

    return Number(offset.toFixed(2));
  }

  private interpolateStackVisualOffset(
    value: number,
    minValue: number,
    maxValue: number,
    minOffset: number,
    maxOffset: number,
  ): number {
    const range = maxValue - minValue;
    if (range <= 0) {
      return minOffset;
    }

    const ratio = (value - minValue) / range;

    return minOffset + (maxOffset - minOffset) * ratio;
  }

  private verticalOverflowShift(items: readonly { instanceId: string; position: { x: number; y: number } }[]): number {
    const battlefield = this.battlefieldRoot?.nativeElement;
    if (!battlefield || items.length === 0) {
      return 0;
    }

    const battlefieldHeight = Math.round(battlefield.clientHeight || battlefield.getBoundingClientRect().height);
    if (battlefieldHeight <= 0) {
      return 0;
    }

    let maxBottom = Number.NEGATIVE_INFINITY;
    let minTop = Number.POSITIVE_INFINITY;
    for (const item of items) {
      const size = this.measuredCardSize(item.instanceId);
      maxBottom = Math.max(maxBottom, item.position.y + size.height);
      minTop = Math.min(minTop, item.position.y);
    }

    if (!Number.isFinite(maxBottom) || maxBottom <= battlefieldHeight) {
      return 0;
    }

    return Math.min(Math.round(maxBottom - battlefieldHeight), Math.max(0, Math.round(minTop)));
  }

  private measuredCardSize(instanceId: string): { width: number; height: number } {
    const element = Array.from(this.battlefieldRoot?.nativeElement.querySelectorAll<HTMLElement>(
      '[data-testid="game-card"][data-card-instance-id]',
    ) ?? []).find((candidate) => candidate.dataset['cardInstanceId'] === instanceId);
    const bounds = element?.getBoundingClientRect();

    return {
      width: Math.max(1, Math.round(element?.offsetWidth || bounds?.width || 116)),
      height: Math.max(1, Math.round(element?.offsetHeight || bounds?.height || 162)),
    };
  }
}
