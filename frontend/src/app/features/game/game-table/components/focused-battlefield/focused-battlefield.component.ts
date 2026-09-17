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
import { GameAttachment, GameBattlefieldStack, GameCardDungeonMarker, GameCardInstance, GameCardStatValue, GamePowerToughnessValue, GameZoneName } from '../../../../../core/models/game.model';
import { PlayerView } from '../../game-table.store';
import { GameCardViewComponent } from '../game-card-view/game-card-view.component';
import { ManaPoolPanelComponent } from '../mana-pool-panel/mana-pool-panel.component';
import { BattlefieldMechanicsOverlayComponent } from '../battlefield-mechanics-overlay/battlefield-mechanics-overlay.component';
import { CardPreviewEvent } from '../../models/card-preview.model';
import { LandStackDropPreview } from '../../state/drag-drop/game-table-battlefield-drag.state';
import { buildLandStackGroups, landStackOffsetX, landStackOffsetY } from '../../utils/land-stack';
import { AttachmentStackView, attachmentStackViewFor, buildAttachmentStackGroups } from '../../utils/attachment-stack';
import { GameTableLongPressDirective } from '../../directives/game-table-long-press.directive';
import { ManaPool } from '../../state/mana/game-table-mana-pool.state';
import { ManaPoolColor } from '../../utils/mana-source-detector';
import {
  DEFAULT_BATTLEFIELD_ZOOM_PERCENT,
  MAX_BATTLEFIELD_ZOOM_PERCENT,
} from '../../state/battlefield/game-table-battlefield-zoom.state';
import { isBattlefieldMechanicOverlayCard } from '../../utils/gameplay-card-kind';

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
  forceOpenLeft?: boolean;
}

/**
 * The visual pile is shared by attachments and manual land/token stacks.
 * Relation type is intentionally not part of this shape: it only governs how
 * a persisted group is rendered after its own rules have already validated it.
 */
interface PermanentStackLayoutGroup {
  readonly members: readonly {
    readonly card: GameCardInstance;
    readonly position: { x: number; y: number };
    readonly layer: number;
  }[];
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

const MIN_STACK_VISUAL_OFFSET_Y = 12;
const MAX_STACK_VISUAL_OFFSET_Y = 25;
const MIN_RENDERED_BATTLEFIELD_ZOOM_PERCENT = 60;
const EMPTY_MANA_POOL: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

@Component({
  selector: 'app-focused-battlefield',
  imports: [RuntimeTranslatePipe, BattlefieldMechanicsOverlayComponent, GameCardViewComponent, GameTableLongPressDirective, ManaPoolPanelComponent],
  templateUrl: './focused-battlefield.component.html',
  styleUrl: './focused-battlefield.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FocusedBattlefieldComponent implements AfterViewInit, DoCheck, OnDestroy {
  private resizeObserver: ResizeObserver | null = null;
  private lastBattlefieldSize: BattlefieldSizeEvent | null = null;
  private lastLayoutKey: unknown = null;
  private layoutRefreshFrame: number | null = null;

  @ViewChild('battlefieldRoot', { static: true }) private readonly battlefieldRoot?: ElementRef<HTMLElement>;

  readonly player = input.required<PlayerView>();
  /** Local display transform used by upper Grid seats. */
  readonly verticallyInverted = input(false);
  readonly isCurrentPlayer = input.required<(playerId: string) => boolean>();
  readonly allowArrowTargetSelection = input(false);
  readonly mechanicCards = input<readonly GameCardInstance[]>([]);
  readonly battlefieldCards = computed(() =>
    this.player().state.zones.battlefield.filter((card) => !isBattlefieldMechanicOverlayCard(card)),
  );
  readonly isDropZoneHighlighted = input.required<(playerId: string, zone: GameZoneName) => boolean>();
  readonly cardPosition = input.required<(card: GameCardInstance) => { x: number; y: number } | null>();
  readonly isSelected = input.required<(instanceId: string) => boolean>();
  readonly isDraggingCard = input.required<(card: GameCardInstance) => boolean>();
  readonly canDragBattlefieldCard = input.required<(playerId: string, card: GameCardInstance) => boolean>();
  readonly isPendingBattlefieldTransfer = input.required<(card: GameCardInstance) => boolean>();
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();
  readonly shouldShowPowerToughness = input.required<(card: GameCardInstance) => boolean>();
  readonly cardPowerValue = input.required<(card: GameCardInstance) => GamePowerToughnessValue>();
  readonly cardToughnessValue = input.required<(card: GameCardInstance) => GamePowerToughnessValue>();
  readonly cardBattleValue = input.required<(card: GameCardInstance) => GameCardStatValue>();
  readonly cardLoyaltyValue = input.required<(card: GameCardInstance) => GameCardStatValue>();
  readonly firstCounter = input.required<(card: GameCardInstance) => CardCounterView | null>();
  readonly alignmentGuideFor = input.required<(playerId: string) => AlignmentGuideView | null>();
  readonly showManaRow = input(true);
  readonly isManaLaneHighlighted = input.required<(playerId: string) => boolean>();
  readonly manaPool = input<(playerId: string) => ManaPool>(() => EMPTY_MANA_POOL);
  readonly canEditManaPool = input<(playerId: string) => boolean>(() => false);
  readonly isManaPoolHidden = input<(playerId: string) => boolean>(() => false);
  readonly pendingManaColors = input<readonly ManaPoolColor[]>([]);
  readonly layoutKey = input<unknown>(null);
  readonly zoomPercent = input(DEFAULT_BATTLEFIELD_ZOOM_PERCENT);
  readonly landStackDropPreview = input<LandStackDropPreview | null>(null);
  readonly attachments = input<readonly GameAttachment[]>([]);
  readonly battlefieldStacks = input<readonly GameBattlefieldStack[]>([]);
  readonly isCardDropSettling = input<(playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean>(() => false);
  readonly isManaDropSettling = input<(playerId: string, card: GameCardInstance) => boolean>(() => false);
  readonly isBattlefieldEntrySettling = input<(playerId: string, card: GameCardInstance) => boolean>(() => false);
  readonly isCommanderEntrySettling = input<(playerId: string, card: GameCardInstance) => boolean>(() => false);
  readonly isCardTransferPending = input<(playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean>(() => false);

  readonly landStackGroups = computed(() => buildLandStackGroups(
    this.battlefieldCards().filter((card) => !this.isDraggingCard()(card)),
    this.battlefieldStacks(),
    (candidate) => this.cardPosition()(candidate),
  ));
  readonly battlefieldDragOver = output<DragEvent>();
  readonly battlefieldDropped = output<BattlefieldDropEvent>();
  readonly battlefieldMenuOpened = output<BattlefieldZoneMenuEvent>();
  readonly manaPoolMenuOpened = output<BattlefieldManaPoolMenuEvent>();
  readonly cardPointerDown = output<BattlefieldCardPointerEvent>();
  readonly cardClicked = output<BattlefieldCardMouseEvent>();
  readonly cardDoubleClicked = output<BattlefieldCardMouseEvent>();
  readonly cardMenuOpened = output<BattlefieldCardMouseEvent>();
  readonly cardPreviewShown = output<CardPreviewEvent>();
  readonly cardPreviewRequested = output<CardPreviewEvent>();
  readonly cardPreviewHidden = output<void>();
  readonly cardPowerChanged = output<BattlefieldCardStatChangeEvent>();
  readonly cardToughnessChanged = output<BattlefieldCardStatChangeEvent>();
  readonly cardBattleChanged = output<BattlefieldCardStatChangeEvent>();
  readonly cardSagaChanged = output<BattlefieldCardStatChangeEvent>();
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
  readonly hoveredPermanentStackId = signal<string | null>(null);
  private readonly measuredLayoutVersion = signal(0);
  readonly attachmentStackGroups = computed(() => buildAttachmentStackGroups(
    this.player().state.zones.battlefield,
    this.attachments(),
    (candidate) => this.cardPosition()(candidate),
  ));
  readonly stackPresentationViews = computed<ReadonlyMap<string, AttachmentStackView>>(() => {
    const views = new Map<string, AttachmentStackView>();

    // Lands and tokens deliberately reuse the attachment presentation. Their
    // domain validation remains in land-stack.ts; only the visual contract is
    // shared here.
    for (const group of this.landStackGroups()) {
      for (const member of group.members) {
        views.set(member.card.instanceId, {
          stackId: group.id,
          layer: member.layer,
          role: member.role === 'top' ? 'target' : 'equipment',
        });
      }
    }
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
  readonly permanentStackDisplayPositions = computed<ReadonlyMap<string, { x: number; y: number }>>(() => {
    this.layoutKey();
    this.measuredLayoutVersion();
    return this.calculateStackDisplayPositions([
      ...this.landStackGroups(),
      ...this.attachmentStackGroups(),
    ]);
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
    if (this.layoutRefreshFrame !== null) {
      window.cancelAnimationFrame(this.layoutRefreshFrame);
      this.layoutRefreshFrame = null;
    }
  }

  handleManaLaneDragOver(event: DragEvent): void {
    if (this.showManaRow()) {
      this.manaLaneDragOver.emit(event);
    }
  }

  handleManaLaneDrop(event: DragEvent, playerId: string): void {
    if (this.showManaRow()) {
      this.manaLaneDropped.emit({ event, playerId });
    }
  }

  ngDoCheck(): void {
    const layoutKey = this.layoutKey();
    const layoutChanged = this.lastLayoutKey !== layoutKey;

    this.lastLayoutKey = layoutKey;

    if (layoutChanged) {
      this.queueMeasuredLayoutRefresh();
    }
  }

  canInteractWithCard(playerId: string, card: GameCardInstance): boolean {
    return this.isCurrentPlayer()(playerId) && this.canDragBattlefieldCard()(playerId, card);
  }

  onCardDoubleClick(event: MouseEvent, playerId: string, card: GameCardInstance): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isCurrentPlayer()(playerId) || this.isAttachedEquipment(card)) {
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

  onCardMenu(event: MouseEvent, playerId: string, card: GameCardInstance, forceOpenLeft = false): void {
    if (!this.isCurrentPlayer()(playerId)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    this.cardMenuOpened.emit({ event, playerId, card, forceOpenLeft });
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

  changePower(event: Event, playerId: string, card: GameCardInstance, delta: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.cardPowerChanged.emit({ playerId, zone: 'battlefield', card, delta });
  }

  changeToughness(event: Event, playerId: string, card: GameCardInstance, delta: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.cardToughnessChanged.emit({ playerId, zone: 'battlefield', card, delta });
  }

  changeLoyalty(event: Event, playerId: string, card: GameCardInstance, delta: number): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isCurrentPlayer()(playerId)) {
      return;
    }
    this.cardLoyaltyChanged.emit({ playerId, zone: 'battlefield', card, delta });
  }

  changeSaga(event: Event, playerId: string, card: GameCardInstance, delta: number): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isCurrentPlayer()(playerId)) {
      return;
    }
    this.cardSagaChanged.emit({ playerId, zone: 'battlefield', card, delta });
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

  stackPresentationView(card: GameCardInstance): AttachmentStackView | null {
    return this.stackPresentationViews().get(card.instanceId) ?? null;
  }

  isStackPresentationHighlighted(card: GameCardInstance): boolean {
    const hoveredStackId = this.hoveredPermanentStackId();
    const stackView = this.stackPresentationView(card);

    return hoveredStackId !== null && stackView?.stackId === hoveredStackId;
  }

  onCardPointerEntered(card: GameCardInstance): void {
    this.hoveredPermanentStackId.set(this.stackPresentationView(card)?.stackId ?? null);
  }

  onCardPointerLeft(): void {
    this.hoveredPermanentStackId.set(null);
    this.cardPreviewHidden.emit();
  }

  private isAttachedEquipment(card: GameCardInstance): boolean {
    return attachmentStackViewFor(this.attachmentStackGroups(), card.instanceId)?.role === 'equipment';
  }

  displayedCardPosition(card: GameCardInstance): { x: number; y: number } | null {
    this.layoutKey();
    this.measuredLayoutVersion();
    const position = this.permanentStackDisplayPositions().get(card.instanceId)
      ?? this.fitPositionInsideBattlefield(card.instanceId, this.cardPosition()(card));

    return this.verticallyInverted()
      ? this.invertedDisplayPosition(card.instanceId, position)
      : position;
  }

  displayedAlignmentGuideY(y: number, referenceInstanceIds: readonly string[]): number {
    if (!this.verticallyInverted()) {
      return y;
    }

    const battlefieldHeight = this.battlefieldHeight();
    const referenceCardHeight = this.measuredCardSize(referenceInstanceIds[0] ?? '').height;

    return battlefieldHeight > 0 ? Math.max(0, Math.round(battlefieldHeight - referenceCardHeight - y)) : y;
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

  commanderEntryDirection(card: GameCardInstance): 'left' | 'right' {
    const position = this.cardPosition()(card);
    const battlefieldWidth = this.lastBattlefieldSize?.width ?? 0;

    if (!position || battlefieldWidth <= 0) {
      return 'left';
    }

    return position.x <= battlefieldWidth / 2 ? 'left' : 'right';
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

  private invertedDisplayPosition(
    instanceId: string,
    position: { x: number; y: number } | null,
  ): { x: number; y: number } | null {
    if (!position) {
      return null;
    }

    const battlefieldHeight = this.battlefieldHeight();
    if (battlefieldHeight <= 0) {
      return position;
    }

    return {
      x: position.x,
      y: Math.max(0, Math.round(battlefieldHeight - this.measuredCardSize(instanceId).height - position.y)),
    };
  }

  private stackVisualOffsetY(): number {
    const zoomPercent = Math.max(
      MIN_RENDERED_BATTLEFIELD_ZOOM_PERCENT,
      Math.min(MAX_BATTLEFIELD_ZOOM_PERCENT, Math.round(this.zoomPercent())),
    );
    const offset = zoomPercent <= DEFAULT_BATTLEFIELD_ZOOM_PERCENT
      ? this.interpolateStackVisualOffset(
        zoomPercent,
        MIN_RENDERED_BATTLEFIELD_ZOOM_PERCENT,
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

  private calculateStackDisplayPositions(groups: readonly PermanentStackLayoutGroup[]): ReadonlyMap<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();
    const stackOffsetY = this.stackVisualOffsetY();

    for (const group of groups) {
      const anchor = group.members.find((member) => member.layer === 0);
      if (!anchor) {
        continue;
      }

      const rawPositions = group.members.map((member) => ({
        member,
        position: {
          x: anchor.position.x + landStackOffsetX() * member.layer,
          y: anchor.position.y - stackOffsetY * member.layer,
        },
      }));
      const shiftY = this.verticalOverflowShift(rawPositions.map((item) => ({
        instanceId: item.member.card.instanceId,
        position: item.position,
      })));

      for (const item of rawPositions) {
        positions.set(item.member.card.instanceId, {
          x: item.position.x,
          y: item.position.y - shiftY,
        });
      }
    }

    return positions;
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

    const battlefieldHeight = this.battlefieldHeight();
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

  private battlefieldHeight(): number {
    const battlefield = this.battlefieldRoot?.nativeElement;
    return battlefield
      ? Math.round(battlefield.clientHeight || battlefield.getBoundingClientRect().height)
      : 0;
  }

  private measuredCardSize(instanceId: string): { width: number; height: number } {
    const battlefield = this.battlefieldRoot?.nativeElement;
    const element = Array.from(battlefield?.querySelectorAll<HTMLElement>(
      '[data-testid="game-card"][data-card-instance-id]',
    ) ?? []).find((candidate) => candidate.dataset['cardInstanceId'] === instanceId);
    const bounds = element?.getBoundingClientRect();
    if (element && bounds && bounds.width > 0 && bounds.height > 0) {
      return {
        width: Math.max(1, Math.round(element.offsetWidth || bounds.width)),
        height: Math.max(1, Math.round(element.offsetHeight || bounds.height)),
      };
    }

    const configuredWidth = battlefield
      ? this.cssLengthInPixels(getComputedStyle(battlefield).getPropertyValue('--battlefield-card-width'))
      : null;
    const width = configuredWidth ?? 116;

    return {
      width,
      height: Math.max(1, Math.round(width / 0.716)),
    };
  }

  private cssLengthInPixels(value: string): number | null {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }

    if (value.trim().endsWith('px')) {
      return Math.round(parsed);
    }

    if (value.trim().endsWith('rem')) {
      const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);

      return Number.isFinite(rootFontSize) && rootFontSize > 0
        ? Math.round(parsed * rootFontSize)
        : null;
    }

    return null;
  }
}
