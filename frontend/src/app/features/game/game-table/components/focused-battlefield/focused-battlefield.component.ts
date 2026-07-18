import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DoCheck,
  ElementRef,
  HostListener,
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
import { isBattlefieldMechanicOverlayCard } from '../../utils/gameplay-card-kind';
import { DEFAULT_BATTLEFIELD_CARD_SIZE } from '../../utils/battlefield-position';
import { type GameTableResponsiveState } from '../../utils/game-table-responsive-state';
import { type GroupSelectionRef, type SelectionModifierMode } from '../../services/game-table-selection.service';
import {
  type MarqueeCandidateBounds,
  type MarqueePoint,
  type MarqueeRect,
  applySelectionModifier,
  exceedsMarqueeThreshold,
  marqueeModifierMode,
  normalizeMarqueeRect,
  resolveMarqueeCandidates,
} from '../../utils/marquee-selection';
import { captureSelectionVisualTargets } from '../../utils/selection-visual-target';

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

interface MarqueeSelectionCommitEvent {
  readonly playerId: string;
  readonly cards: readonly GameCardInstance[];
  readonly mode: SelectionModifierMode;
}

interface MarqueePerformanceMetrics {
  readonly pointerMoves: number;
  readonly animationFrames: number;
  readonly boundsCaptures: number;
  readonly layoutReads: number;
  readonly candidateCount: number;
  readonly durationMs: number;
  readonly outcome: 'commit' | 'cancel';
}

interface PointerPendingInteraction {
  readonly kind: 'pointerPending';
  readonly pointerId: number;
  readonly pointerType: string;
  readonly startClientPoint: MarqueePoint;
  readonly currentClientPoint: MarqueePoint;
  readonly modifierMode: SelectionModifierMode;
  readonly baseSelection: readonly string[];
  readonly startedAt: number;
  readonly pointerMoves: number;
}

interface MarqueeInteraction extends Omit<PointerPendingInteraction, 'kind'> {
  readonly kind: 'marquee';
  readonly rootRect: DOMRect;
  readonly rect: MarqueeRect;
  readonly localRect: MarqueeRect;
  readonly cachedBounds: readonly MarqueeCandidateBounds[];
  readonly candidateIds: readonly string[];
  readonly previewSelectedIds: readonly string[];
  readonly animationFrames: number;
  readonly boundsCaptures: number;
  readonly layoutReads: number;
}

type BattlefieldSelectionInteraction = { readonly kind: 'idle' } | PointerPendingInteraction | MarqueeInteraction;

type BattlefieldFocusEntry = 'left' | 'right' | 'fade' | null;

const EMPTY_MANA_POOL: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
const MARQUEE_THRESHOLD_PX = 5;

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
  private lastPlayerId: string | null = null;
  private lastLayoutKey: unknown = null;
  private lastMarqueeLayoutKey: unknown = null;
  private lastMarqueeBlocked = false;
  private boardTransitionTimer: number | null = null;
  private layoutRefreshFrame: number | null = null;
  private marqueeFrame: number | null = null;
  private cancelledPointerId: number | null = null;
  private suppressNextBackgroundClick = false;
  private suppressBackgroundClickTimer: number | null = null;

  @ViewChild('battlefieldRoot', { static: true }) private readonly battlefieldRoot?: ElementRef<HTMLElement>;

  readonly player = input.required<PlayerView>();
  readonly responsiveState = input<GameTableResponsiveState>('normal');
  readonly isCurrentPlayer = input.required<(playerId: string) => boolean>();
  readonly selectedInstanceIds = input<readonly string[]>([]);
  readonly selectedGroupRefs = input<readonly GroupSelectionRef[]>([]);
  readonly marqueeEnabled = input(false);
  readonly touchMarqueeMode = input(false);
  readonly marqueeBlocked = input(false);
  readonly marqueeLayoutKey = input<unknown>(null);
  readonly allowArrowTargetSelection = input(false);
  readonly focusEffectsEnabled = input(true);
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

  readonly relationCardSize = computed(() => {
    const zoomPercent = Math.max(
      MIN_BATTLEFIELD_ZOOM_PERCENT,
      Math.min(MAX_BATTLEFIELD_ZOOM_PERCENT, this.zoomPercent()),
    );
    const scale = zoomPercent / DEFAULT_BATTLEFIELD_ZOOM_PERCENT;

    return {
      width: DEFAULT_BATTLEFIELD_CARD_SIZE.width * scale,
      height: DEFAULT_BATTLEFIELD_CARD_SIZE.height * scale,
    };
  });

  readonly landStackGroups = computed(() => buildLandStackGroups(
    this.battlefieldCards().filter((card) => !this.isDraggingCard()(card)),
    this.battlefieldStacks(),
    (candidate) => this.cardPosition()(candidate),
    this.relationCardSize(),
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
  readonly battlefieldEmptyClicked = output<void>();
  readonly marqueeSelectionCommitted = output<MarqueeSelectionCommitEvent>();
  readonly touchMarqueeModeChanged = output<boolean>();
  readonly boardTransitioning = signal(false);
  readonly selectionInteraction = signal<BattlefieldSelectionInteraction>({ kind: 'idle' });
  readonly lastMarqueeMetrics = signal<MarqueePerformanceMetrics | null>(null);
  readonly marqueeVisualRect = computed(() => {
    const interaction = this.selectionInteraction();
    return interaction.kind === 'marquee' ? interaction.localRect : null;
  });
  readonly marqueePreviewIds = computed<ReadonlySet<string>>(() => {
    const interaction = this.selectionInteraction();
    return new Set(interaction.kind === 'marquee' ? interaction.previewSelectedIds : []);
  });
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
    const cardSize = this.relationCardSize();
    const stackOffsetX = landStackOffsetX(cardSize.width);
    const stackOffsetY = landStackOffsetY(cardSize.height);

    for (const group of this.landStackGroups()) {
      const top = group.members.find((member) => member.layer === 0);
      if (!top) {
        continue;
      }
      const verticalDirection = this.relationVerticalDirection(
        top.card,
        top.position.y,
        group.members.length - 1,
        stackOffsetY,
      );

      const rawPositions = group.members.map((member) => ({
        member,
        position: {
          x: top.position.x + stackOffsetX * member.layer,
          y: top.position.y + stackOffsetY * member.layer * verticalDirection,
        },
      }));
      const shiftY = this.verticalOverflowShift(rawPositions.map((item) => ({
        instanceId: item.member.card.instanceId,
        position: item.position,
      })));

      for (const member of group.members) {
        positions.set(member.card.instanceId, {
          x: top.position.x + stackOffsetX * member.layer,
          y: top.position.y + stackOffsetY * member.layer * verticalDirection - shiftY,
        });
      }
    }

    return positions;
  });
  readonly attachmentStackGroups = computed(() => buildAttachmentStackGroups(
    this.player().state.zones.battlefield,
    this.attachments(),
    (candidate) => this.cardPosition()(candidate),
    this.relationCardSize(),
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
    const cardSize = this.relationCardSize();
    const stackOffsetX = landStackOffsetX(cardSize.width);
    const stackOffsetY = landStackOffsetY(cardSize.height);

    for (const group of this.attachmentStackGroups()) {
      const target = group.members.find((member) => member.layer === 0);
      if (!target) {
        continue;
      }
      const verticalDirection = this.relationVerticalDirection(
        target.card,
        target.position.y,
        group.members.length - 1,
        stackOffsetY,
      );

      const rawPositions = group.members.map((member) => ({
        member,
        position: {
          x: target.position.x + stackOffsetX * member.layer,
          y: target.position.y + stackOffsetY * member.layer * verticalDirection,
        },
      }));
      const shiftY = this.verticalOverflowShift(rawPositions.map((item) => ({
        instanceId: item.member.card.instanceId,
        position: item.position,
      })));

      for (const member of group.members) {
        positions.set(member.card.instanceId, {
          x: target.position.x + stackOffsetX * member.layer,
          y: target.position.y + stackOffsetY * member.layer * verticalDirection - shiftY,
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
        this.cancelSelectionInteraction('layout');
        this.emitBattlefieldSize(element);
        this.queueMeasuredLayoutRefresh();
      }
    });
    this.resizeObserver.observe(element);
  }

  ngOnDestroy(): void {
    this.cancelSelectionInteraction('destroy');
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
    if (this.suppressBackgroundClickTimer !== null) {
      window.clearTimeout(this.suppressBackgroundClickTimer);
      this.suppressBackgroundClickTimer = null;
    }
  }

  ngDoCheck(): void {
    const playerId = this.player().id;
    const layoutKey = this.layoutKey();
    const marqueeLayoutKey = this.marqueeLayoutKey();
    const marqueeBlocked = this.marqueeBlocked() || !this.marqueeEnabled();
    const playerChanged = this.lastPlayerId !== playerId;
    const layoutChanged = this.lastLayoutKey !== layoutKey;
    const marqueeLayoutChanged = this.lastMarqueeLayoutKey !== marqueeLayoutKey;
    const marqueeBecameBlocked = !this.lastMarqueeBlocked && marqueeBlocked;

    this.lastLayoutKey = layoutKey;
    this.lastMarqueeLayoutKey = marqueeLayoutKey;
    this.lastMarqueeBlocked = marqueeBlocked;

    if (playerChanged) {
      this.lastPlayerId = playerId;
      this.triggerBoardTransition();
    }

    if (playerChanged || layoutChanged) {
      this.queueMeasuredLayoutRefresh();
    }

    if (playerChanged || marqueeLayoutChanged || marqueeBecameBlocked) {
      this.cancelSelectionInteraction('layout');
      if (marqueeBecameBlocked && this.touchMarqueeMode()) {
        this.touchMarqueeModeChanged.emit(false);
      }
    }
  }

  @HostListener('window:blur')
  handleWindowBlur(): void {
    this.cancelSelectionInteraction('blur');
  }

  @HostListener('window:scroll')
  handleStructuralScroll(): void {
    this.cancelSelectionInteraction('scroll');
  }

  canInteractWithCard(playerId: string, card: GameCardInstance): boolean {
    return this.isCurrentPlayer()(playerId) && this.canDragBattlefieldCard()(playerId, card);
  }

  isVisuallySelected(card: GameCardInstance): boolean {
    const interaction = this.selectionInteraction();
    if (interaction.kind === 'marquee') {
      return this.marqueePreviewIds().has(card.instanceId);
    }

    return this.isCurrentPlayer()(this.player().id) && this.isSelected()(card.instanceId);
  }

  isMarqueeCandidate(card: GameCardInstance): boolean {
    return this.canInteractWithCard(this.player().id, card)
      && this.cardVisibility(this.player().id, card)
      && this.landStackView(card)?.role !== 'under';
  }

  isStackGroupSelected(card: GameCardInstance): boolean {
    const view = this.landStackView(card);
    return view?.role === 'top' && this.selectedGroupRefs().some((ref) => ref.stackId === view.stackId);
  }

  selectionTargetKind(card: GameCardInstance): 'card' | 'attachment' | 'stack-group' | 'stack-member' {
    const stack = this.landStackView(card);
    if (stack?.role === 'top') {
      return 'stack-group';
    }
    if (stack?.role === 'under') {
      return 'stack-member';
    }
    return this.attachmentStackView(card)?.role === 'equipment' ? 'attachment' : 'card';
  }

  beginMarqueePointer(event: PointerEvent): void {
    const root = this.battlefieldRoot?.nativeElement;
    if (!root) {
      return;
    }
    const activeInteraction = this.selectionInteraction();
    if (event.pointerType === 'touch' && activeInteraction.kind !== 'idle' && activeInteraction.pointerId !== event.pointerId) {
      event.preventDefault();
      this.cancelSelectionInteraction('multitouch');
      return;
    }
    if (event.pointerType === 'touch' && !this.touchMarqueeMode()) {
      return;
    }
    this.cancelledPointerId = null;
    if (event.defaultPrevented || event.target !== root) {
      return;
    }
    if (
      event.button !== 0
      || event.isPrimary === false && event.pointerType !== ''
      || !this.marqueeEnabled()
      || this.marqueeBlocked()
      || !this.isCurrentPlayer()(this.player().id)
      || this.player().state.status !== 'active'
      || this.selectionInteraction().kind !== 'idle'
    ) {
      return;
    }

    event.preventDefault();
    const startClientPoint = { x: event.clientX, y: event.clientY };
    this.selectionInteraction.set({
      kind: 'pointerPending',
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startClientPoint,
      currentClientPoint: startClientPoint,
      modifierMode: marqueeModifierMode(event),
      baseSelection: [...this.selectedInstanceIds()],
      startedAt: performance.now(),
      pointerMoves: 0,
    });
    root.focus({ preventScroll: true });
    try {
      root.setPointerCapture?.(event.pointerId);
    } catch {
      this.cancelSelectionInteraction('capture');
    }
  }

  moveMarqueePointer(event: PointerEvent): void {
    const interaction = this.selectionInteraction();
    if (interaction.kind === 'idle' || interaction.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const currentClientPoint = { x: event.clientX, y: event.clientY };
    const pointerMoves = interaction.pointerMoves + 1;
    if (interaction.kind === 'pointerPending') {
      if (!exceedsMarqueeThreshold(interaction.startClientPoint, currentClientPoint, MARQUEE_THRESHOLD_PX)) {
        this.selectionInteraction.set({ ...interaction, currentClientPoint, pointerMoves });
        return;
      }

      const capture = this.captureMarqueeBounds();
      if (!capture) {
        this.cancelSelectionInteraction('layout');
        return;
      }
      const rect = normalizeMarqueeRect(interaction.startClientPoint, currentClientPoint);
      this.selectionInteraction.set({
        ...interaction,
        kind: 'marquee',
        currentClientPoint,
        pointerMoves,
        rootRect: capture.rootRect,
        rect,
        localRect: this.localMarqueeRect(rect, capture.rootRect),
        cachedBounds: capture.bounds,
        candidateIds: [],
        previewSelectedIds: interaction.baseSelection,
        animationFrames: 0,
        boundsCaptures: 1,
        layoutReads: capture.layoutReads,
      });
      this.scheduleMarqueeFrame();
      return;
    }

    this.selectionInteraction.set({ ...interaction, currentClientPoint, pointerMoves });
    this.scheduleMarqueeFrame();
  }

  endMarqueePointer(event: PointerEvent): void {
    const interaction = this.selectionInteraction();
    if (interaction.kind === 'idle') {
      if (this.cancelledPointerId === event.pointerId) {
        this.cancelledPointerId = null;
        this.suppressNextBattlefieldBackgroundClick();
      }
      return;
    }
    if (interaction.pointerId !== event.pointerId) {
      return;
    }

    if (interaction.kind === 'pointerPending') {
      this.suppressNextBattlefieldBackgroundClick();
      this.finishSelectionInteraction('cancel');
      this.battlefieldEmptyClicked.emit();
      return;
    }

    this.flushMarqueeFrame();
    const committed = this.selectionInteraction();
    if (committed.kind !== 'marquee') {
      return;
    }
    const cardsById = new Map(this.battlefieldCards().map((card) => [card.instanceId, card]));
    const cards = committed.previewSelectedIds
      .map((instanceId) => cardsById.get(instanceId))
      .filter((card): card is GameCardInstance => Boolean(card));
    this.marqueeSelectionCommitted.emit({
      playerId: this.player().id,
      cards,
      mode: 'replace',
    });
    this.suppressNextBattlefieldBackgroundClick();
    if (committed.pointerType === 'touch') {
      this.touchMarqueeModeChanged.emit(false);
    }
    this.finishSelectionInteraction('commit');
  }

  onBattlefieldBackgroundClick(event: MouseEvent): void {
    event.stopPropagation();
    if (this.cancelledPointerId !== null) {
      this.cancelledPointerId = null;
      return;
    }
    if (this.suppressNextBackgroundClick) {
      this.suppressNextBackgroundClick = false;
      return;
    }
    if (event.target === this.battlefieldRoot?.nativeElement) {
      this.battlefieldEmptyClicked.emit();
    }
  }

  onBattlefieldContextMenu(event: MouseEvent): void {
    this.cancelSelectionInteraction('contextMenu');
    this.battlefieldMenuOpened.emit({ event, playerId: this.player().id, zone: 'battlefield' });
  }

  cancelActiveSelectionInteraction(): boolean {
    if (this.selectionInteraction().kind === 'idle') {
      return false;
    }
    this.cancelSelectionInteraction('escape');
    return true;
  }

  cancelMarqueeForLayoutChange(): boolean {
    const active = this.selectionInteraction().kind !== 'idle';
    this.cancelSelectionInteraction('layout');
    return active;
  }

  private suppressNextBattlefieldBackgroundClick(timeoutMs = 0): void {
    this.suppressNextBackgroundClick = true;
    if (this.suppressBackgroundClickTimer !== null) {
      window.clearTimeout(this.suppressBackgroundClickTimer);
    }
    this.suppressBackgroundClickTimer = window.setTimeout(() => {
      this.suppressNextBackgroundClick = false;
      this.suppressBackgroundClickTimer = null;
    }, timeoutMs);
  }

  private captureMarqueeBounds(): { rootRect: DOMRect; bounds: MarqueeCandidateBounds[]; layoutReads: number } | null {
    const root = this.battlefieldRoot?.nativeElement;
    if (!root) {
      return null;
    }
    const rootRect = root.getBoundingClientRect();
    const actionableIds = new Set(this.battlefieldCards().filter((card) => this.isMarqueeCandidate(card)).map((card) => card.instanceId));
    const targets = captureSelectionVisualTargets(root, actionableIds);
    const bounds: MarqueeCandidateBounds[] = targets.map((target) => ({
      instanceId: target.instanceId,
      left: target.bounds.left,
      top: target.bounds.top,
      right: target.bounds.right,
      bottom: target.bounds.bottom,
    }));
    const layoutReads = 1 + targets.length;

    return { rootRect, bounds, layoutReads };
  }

  private scheduleMarqueeFrame(): void {
    if (this.marqueeFrame !== null) {
      return;
    }
    this.marqueeFrame = window.requestAnimationFrame(() => {
      this.marqueeFrame = null;
      this.updateMarqueeFrame();
    });
  }

  private flushMarqueeFrame(): void {
    if (this.marqueeFrame === null) {
      return;
    }
    window.cancelAnimationFrame(this.marqueeFrame);
    this.marqueeFrame = null;
    this.updateMarqueeFrame();
  }

  private updateMarqueeFrame(): void {
    const interaction = this.selectionInteraction();
    if (interaction.kind !== 'marquee') {
      return;
    }
    const rect = normalizeMarqueeRect(interaction.startClientPoint, interaction.currentClientPoint);
    const candidateIds = resolveMarqueeCandidates(rect, interaction.cachedBounds);
    const previewSelectedIds = applySelectionModifier(interaction.baseSelection, candidateIds, interaction.modifierMode);
    this.selectionInteraction.set({
      ...interaction,
      rect,
      localRect: this.localMarqueeRect(rect, interaction.rootRect),
      candidateIds,
      previewSelectedIds,
      animationFrames: interaction.animationFrames + 1,
    });
  }

  private localMarqueeRect(rect: MarqueeRect, rootRect: DOMRect): MarqueeRect {
    const left = Math.max(0, Math.min(rootRect.width, rect.left - rootRect.left));
    const top = Math.max(0, Math.min(rootRect.height, rect.top - rootRect.top));
    const right = Math.max(0, Math.min(rootRect.width, rect.right - rootRect.left));
    const bottom = Math.max(0, Math.min(rootRect.height, rect.bottom - rootRect.top));
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  }

  private cancelSelectionInteraction(_reason: string): void {
    const interaction = this.selectionInteraction();
    if (interaction.kind === 'idle') {
      return;
    }
    this.cancelledPointerId = interaction.pointerId;
    if (interaction.pointerType === 'touch') {
      this.touchMarqueeModeChanged.emit(false);
    }
    this.finishSelectionInteraction('cancel');
  }

  private finishSelectionInteraction(outcome: 'commit' | 'cancel'): void {
    const interaction = this.selectionInteraction();
    if (interaction.kind === 'idle') {
      return;
    }
    if (this.marqueeFrame !== null) {
      window.cancelAnimationFrame(this.marqueeFrame);
      this.marqueeFrame = null;
    }
    if (interaction.kind === 'marquee') {
      this.lastMarqueeMetrics.set({
        pointerMoves: interaction.pointerMoves,
        animationFrames: interaction.animationFrames,
        boundsCaptures: interaction.boundsCaptures,
        layoutReads: interaction.layoutReads,
        candidateCount: interaction.cachedBounds.length,
        durationMs: Math.max(0, performance.now() - interaction.startedAt),
        outcome,
      });
    }
    const root = this.battlefieldRoot?.nativeElement;
    try {
      if (root?.hasPointerCapture?.(interaction.pointerId)) {
        root.releasePointerCapture(interaction.pointerId);
      }
    } catch {
      // Capture may already have been released by the browser.
    }
    this.selectionInteraction.set({ kind: 'idle' });
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

    return shiftY !== 0 ? { ...position, y: position.y - shiftY } : position;
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
    let maxRight = Number.NEGATIVE_INFINITY;
    let minLeft = Number.POSITIVE_INFINITY;
    for (const item of items) {
      const size = this.measuredCardSize(item.instanceId);
      maxBottom = Math.max(maxBottom, item.position.y + size.height);
      minTop = Math.min(minTop, item.position.y);
      maxRight = Math.max(maxRight, item.position.x + size.width);
      minLeft = Math.min(minLeft, item.position.x);
    }

    if (![maxBottom, minTop, maxRight, minLeft].every(Number.isFinite)) {
      return 0;
    }

    let minimumVisibleTop = 0;
    const battlefieldRect = battlefield.getBoundingClientRect();
    const ownerSummaryHost = battlefield.closest<HTMLElement>('.focused-board') ?? battlefield.parentElement;
    const ownerSummary = ownerSummaryHost?.querySelector<HTMLElement>('[data-testid="battlefield-owner-summary"]');
    const ownerSummaryRect = ownerSummary?.getBoundingClientRect();
    if (ownerSummaryRect && ownerSummaryRect.width > 0 && ownerSummaryRect.height > 0) {
      const overlayLeft = ownerSummaryRect.left - battlefieldRect.left;
      const overlayRight = ownerSummaryRect.right - battlefieldRect.left;
      const overlayTop = ownerSummaryRect.top - battlefieldRect.top;
      const overlayBottom = ownerSummaryRect.bottom - battlefieldRect.top;
      const overlapsHorizontally = minLeft < overlayRight && maxRight > overlayLeft;
      const overlapsVertically = minTop < overlayBottom && maxBottom > overlayTop;
      if (overlapsHorizontally && overlapsVertically) {
        minimumVisibleTop = Math.max(0, Math.round(overlayBottom + 4));
      }
    }

    if (minTop < minimumVisibleTop) {
      const downwardShift = Math.round(minimumVisibleTop - minTop);
      if (maxBottom + downwardShift <= battlefieldHeight) {
        return -downwardShift;
      }
    }

    if (maxBottom <= battlefieldHeight) {
      return 0;
    }

    return Math.min(Math.round(maxBottom - battlefieldHeight), Math.max(0, Math.round(minTop)));
  }

  private relationVerticalDirection(root: GameCardInstance, rootY: number, maxLayer: number, offsetY: number): -1 | 1 {
    const battlefield = this.battlefieldRoot?.nativeElement;
    const battlefieldHeight = Math.round(battlefield?.clientHeight || battlefield?.getBoundingClientRect().height || 0);
    if (battlefieldHeight <= 0 || maxLayer <= 0) {
      return -1;
    }

    // Relation direction is part of the logical projection. Base it on the
    // shared ratio when available so viewers with different local viewports,
    // battlefield zooms, or browser zooms cannot fan the same graph in
    // opposite directions. Legacy pixel positions retain a local fallback.
    if (root.position?.unit === 'ratio') {
      return root.position.y < 0.5 ? 1 : -1;
    }

    const requiredSpace = Math.max(0, maxLayer * offsetY);
    const rootHeight = this.measuredCardSize(root.instanceId).height;
    const spaceAbove = Math.max(0, rootY);
    const spaceBelow = Math.max(0, battlefieldHeight - rootY - rootHeight);
    if (spaceAbove >= requiredSpace) {
      return -1;
    }

    return spaceBelow >= requiredSpace || spaceBelow > spaceAbove ? 1 : -1;
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
