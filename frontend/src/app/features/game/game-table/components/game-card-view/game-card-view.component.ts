import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, ElementRef, OnChanges, OnDestroy, computed, inject, input, output, signal, type WritableSignal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { GameCardDungeonMarker, GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { CARD_PREVIEW_HOVER_DELAY_MS, CardPreviewEvent, previewRectFromElement } from '../../models/card-preview.model';
import {
  CardMarkerRailComponent,
  type CardMarkerCounterChange,
  type CardMarkerCounterDeleteRequest,
} from './card-marker-rail/card-marker-rail.component';
import { DungeonLocationPinComponent } from '../dungeon-location-pin/dungeon-location-pin.component';
import { LoyaltyCounterComponent } from './loyalty-counter/loyalty-counter.component';
import { GameTableDoubleTapDirective } from '../../directives/game-table-double-tap.directive';
import { GameTableLongPressDirective } from '../../directives/game-table-long-press.directive';
import { activeCardFaceIndex, hasAlternateFace, nextCardFaceIndex } from '../../utils/double-faced-card';
import { dungeonMarkerForCard } from '../../utils/dungeon-marker';
import { isGameplayCardTapLocked } from '../../utils/gameplay-card-kind';

type GameCardViewMode = 'battlefield' | 'hand' | 'mini';

type DropPlacement = 'before' | 'after';
type HandLayoutMode = 'fan' | 'row';
type BattlefieldFocusEntry = 'left' | 'right' | 'fade' | null;
type StatPulse = 'increase' | 'decrease' | null;
type LandStackRole = 'top' | 'under';
type AttachmentStackRole = 'target' | 'equipment';

const DUNGEON_MARKER_HORIZONTAL_VISIBLE_RATIO = 0.42;
const DUNGEON_MARKER_TOP_VISIBLE_RATIO = 0.86;

interface CardCounterView {
  key: string;
  value: number;
}

interface CardPointerEvent {
  event: PointerEvent;
  card: GameCardInstance;
}

interface CardMouseEvent {
  event: MouseEvent;
  card: GameCardInstance;
}

interface CardDragEvent {
  event: DragEvent;
  card: GameCardInstance;
}

interface CardStatChangeEvent {
  event: MouseEvent;
  card: GameCardInstance;
  delta: number;
}

interface CardCounterChangeEvent {
  event: MouseEvent;
  card: GameCardInstance;
  key: string;
  delta: number;
}

interface CardCounterDeleteRequestEvent {
  event: MouseEvent;
  card: GameCardInstance;
  key: string;
}

interface CardDungeonMarkerChangeEvent {
  event: PointerEvent;
  card: GameCardInstance;
  marker: GameCardDungeonMarker;
}

interface CardDungeonMarkerPreviewEvent {
  card: GameCardInstance;
  marker: GameCardDungeonMarker | null;
}

interface DungeonMarkerDragPoint {
  readonly clientX: number;
  readonly clientY: number;
}

@Component({
  selector: 'app-game-card-view',
  imports: [RuntimeTranslatePipe, 
    CardMarkerRailComponent,
    DungeonLocationPinComponent,
    LoyaltyCounterComponent,
    LucideAngularModule,
    GameTableDoubleTapDirective,
    GameTableLongPressDirective,
  ],
  templateUrl: './game-card-view.component.html',
  styleUrls: ['./game-card-view.component.scss', './game-card-view-effects.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameCardViewComponent implements OnChanges, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly defaultHoverLiftDelayMs = CARD_PREVIEW_HOVER_DELAY_MS;
  private readonly singleStatPulseMs = 420;
  private readonly repeatedStatPulseMs = 900;
  private hoverLiftTimer: number | null = null;
  private powerPulseTimer: number | null = null;
  private toughnessPulseTimer: number | null = null;
  private loyaltyPulseTimer: number | null = null;
  private hoveredCard: GameCardInstance | null = null;
  private activePreviewInstanceId: string | null = null;
  private activePreviewSourceRect: CardPreviewEvent['sourceRect'] = null;
  private previousPowerValue: number | null | undefined;
  private previousToughnessValue: number | null | undefined;
  private previousLoyaltyValue: number | null | undefined;
  private previousStatsVisible: boolean | undefined;
  private statOverlayArrivalTimer: number | null = null;
  private previousFaceInstanceId: string | null = null;
  private previousActiveFaceIndex: number | null = null;
  private previousFaceDown: boolean | null = null;
  private previewFaceIndexOverride: number | null = null;
  private faceFlipTimer: number | null = null;
  private pointerInside = false;
  private previewBoundsListening = false;
  private previewSuppressedUntilPointerExit = false;
  private dungeonMarkerPointerId: number | null = null;
  private dungeonMarkerHost: HTMLElement | null = null;
  private dungeonMarkerCaptureElement: HTMLElement | null = null;
  private dungeonMarkerPointerOffset: { x: number; y: number } | null = null;
  private pendingDungeonMarkerDragPoint: DungeonMarkerDragPoint | null = null;
  private dungeonMarkerDragFrame: number | null = null;
  private optimisticDungeonMarkerInstanceId: string | null = null;
  private readonly faceFlipAnimationMs = 620;
  private readonly previewPointerMoveHandler = (event: PointerEvent): void => this.syncPreviewPointerBounds(event);

  readonly mode = input.required<GameCardViewMode>();
  readonly card = input.required<GameCardInstance>();
  readonly playerId = input.required<string>();
  readonly zone = input.required<GameZoneName>();
  readonly image = input<string | null>(null);
  readonly selected = input(false);
  readonly dragging = input(false);
  readonly disabled = input(false);
  readonly draggable = input(false);
  readonly freePosition = input(false);
  readonly locked = input(false);
  readonly pendingTransfer = input(false);
  readonly alignmentReference = input(false);
  readonly arrowTargetCandidate = input(false);
  readonly dropSettling = input(false);
  readonly manaDropSettling = input(false);
  readonly statDropSettling = input(false);
  readonly commanderEntrySettling = input(false);
  readonly hoverInteractionsEnabled = input(true);
  readonly activeHoverInstanceId = input<string | null>(null);
  readonly motionActive = input(false);
  readonly faceDown = input(false);
  readonly hidden = input(false);
  readonly visible = input(true);
  readonly position = input<{ x: number; y: number } | null>(null);
  readonly handDropPlacement = input<DropPlacement | null>(null);
  readonly handLayout = input<HandLayoutMode>('fan');
  readonly battlefieldFocusEntry = input<BattlefieldFocusEntry>(null);
  readonly handIndex = input<number | null>(null);
  readonly handCount = input<number | null>(null);
  readonly miniLeftPx = input<number | null>(null);
  readonly miniTopPx = input<number | null>(null);
  readonly miniWidthPx = input<number | null>(null);
  readonly miniHeightPx = input<number | null>(null);
  readonly miniZIndex = input<number | null>(null);
  readonly landStackRole = input<LandStackRole | null>(null);
  readonly landStackLayer = input<number | null>(null);
  readonly landStackSize = input<number | null>(null);
  readonly attachmentStackRole = input<AttachmentStackRole | null>(null);
  readonly attachmentStackLayer = input<number | null>(null);
  readonly attachmentStackHighlighted = input(false);
  readonly landStackDropTarget = input(false);
  readonly landStackDropSize = input<number | null>(null);
  readonly landStackDropKind = input<'land' | 'attachment'>('land');
  readonly showPowerToughness = input(false);
  readonly powerValue = input<number | null>(null);
  readonly toughnessValue = input<number | null>(null);
  readonly loyaltyValue = input<number | null>(null);
  readonly counter = input<CardCounterView | null>(null);
  readonly handDepth = computed(() => `${Math.min(Math.max(0, this.handIndex() ?? 0), Math.max(0, (this.handCount() ?? 1) - 1))}`);
  readonly handFanRotationDeg = computed(() => {
    const distance = this.handFanDistance();
    const count = Math.max(1, this.handCount() ?? 1);
    const step = count <= 1 ? 0 : 1.35;

    return Math.max(-42, Math.min(42, Number((distance * step).toFixed(3))));
  });
  readonly handFanCounterRotationDeg = computed(() => Number((-this.handFanRotationDeg()).toFixed(3)));
  readonly handFanLiftPx = computed(() => 0);
  readonly handFanSplayPx = computed(() => {
    const distance = this.handFanDistance();
    const count = Math.max(1, this.handCount() ?? 1);
    const step = count <= 1 ? 0 : Math.max(15.5, Math.min(46, 500 / (count - 1)));

    return Number((distance * step).toFixed(3));
  });
  readonly handFanArcPx = computed(() => {
    const distance = this.handFanDistance();
    const count = Math.max(1, this.handCount() ?? 1);
    if (count <= 1) {
      return -18;
    }

    const centerBand = count % 2 === 0 ? 0.5 : 0;
    const sideDistance = Math.max(0, Math.abs(distance) - centerBand);
    const maxSideDistance = Math.max(1, (count - 1) / 2 - centerBand);
    const sideProgress = Math.min(1, sideDistance / maxSideDistance);
    const centerLift = Math.max(12, Math.min(20, count * 1.8));
    const edgeDrop = Math.max(5, Math.min(12, count * 0.95));
    const easedProgress = sideProgress ** 1.15;

    return Number((-centerLift + easedProgress * (centerLift + edgeDrop)).toFixed(3));
  });
  readonly handRowDistance = computed(() => Number(this.handFanDistance().toFixed(3)));
  readonly visibleCounters = computed<readonly CardCounterView[]>(() => {
    const counters = Object.entries(this.card().counters ?? {})
      .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) >= 0)
      .map(([key, value]) => ({ key, value: Number(value) }));

    return counters.length > 0 ? counters : this.counter() ? [this.counter()!] : [];
  });

  readonly cardPointerDown = output<CardPointerEvent>();
  readonly cardClicked = output<CardMouseEvent>();
  readonly cardDoubleClicked = output<CardMouseEvent>();
  readonly cardMenuOpened = output<CardMouseEvent>();
  readonly cardDragStarted = output<CardDragEvent>();
  readonly cardDragEnded = output<void>();
  readonly cardDragOver = output<CardDragEvent>();
  readonly cardDropped = output<CardDragEvent>();
  readonly cardPointerEntered = output<CardMouseEvent>();
  readonly cardMouseEntered = output<CardPreviewEvent>();
  readonly cardMouseLeft = output<void>();
  readonly cardFaceLookRequested = output<CardPreviewEvent>();
  readonly cardPreviewRequested = output<CardPreviewEvent>();
  readonly powerChanged = output<CardStatChangeEvent>();
  readonly toughnessChanged = output<CardStatChangeEvent>();
  readonly loyaltyChanged = output<CardStatChangeEvent>();
  readonly counterChanged = output<CardCounterChangeEvent>();
  readonly counterDeleteRequested = output<CardCounterDeleteRequestEvent>();
  readonly dungeonMarkerChanged = output<CardDungeonMarkerChangeEvent>();
  readonly dungeonMarkerPreviewChanged = output<CardDungeonMarkerPreviewEvent>();
  readonly hoverLifted = signal(false);
  readonly previewActive = signal(false);
  readonly draggingDungeonMarker = signal<GameCardDungeonMarker | null>(null);
  readonly optimisticDungeonMarker = signal<GameCardDungeonMarker | null>(null);
  readonly powerPulse = signal<StatPulse>(null);
  readonly toughnessPulse = signal<StatPulse>(null);
  readonly loyaltyPulse = signal<StatPulse>(null);
  readonly statOverlayArriving = signal(false);
  readonly faceFlipAnimating = signal(false);
  readonly canShowFaceToggle = computed(() => {
    const currentCard = this.card();

    return !this.faceDown()
      && currentCard.hidden !== true
      && hasAlternateFace(currentCard);
  });
  readonly statsVisible = computed(() => !this.faceDown() && this.showPowerToughness());
  readonly loyaltyVisible = computed(() => !this.faceDown() && this.loyaltyValue() !== null && !this.showPowerToughness());
  readonly showRulingsMarker = computed(() => this.rulingsMarkerEligible() && this.card().hasRulings === true);
  readonly dungeonMarkerPosition = computed(() => this.draggingDungeonMarker() ?? this.optimisticDungeonMarkerForCurrentCard() ?? dungeonMarkerForCard(this.card()));
  readonly showDungeonMarker = computed(() => (
    this.mode() === 'battlefield'
    && this.zone() === 'battlefield'
    && !this.faceDown()
    && this.dungeonMarkerPosition() !== null
  ));
  readonly landStackZIndex = computed(() => {
    const role = this.landStackRole();
    if (!role) {
      return null;
    }

    if (this.selected() && role === 'top') {
      return 90;
    }

    return role === 'top' ? 48 : Math.max(22, 42 - (this.landStackLayer() ?? 1));
  });
  readonly cardZIndex = computed(() => {
    if (
      this.mode() === 'battlefield'
      && this.zone() === 'battlefield'
      && this.previewActive()
      && this.hoverLifted()
    ) {
      return 96;
    }

    const landStackZIndex = this.landStackZIndex();
    if (landStackZIndex !== null) {
      return landStackZIndex;
    }

    const attachmentRole = this.attachmentStackRole();
    if (attachmentRole === 'target') {
      return this.selected() ? 90 : 48;
    }
    if (attachmentRole === 'equipment') {
      return Math.max(22, 42 - (this.attachmentStackLayer() ?? 1));
    }

    return null;
  });

  readonly handClass = (placement: DropPlacement): boolean => this.handDropPlacement() === placement;

  private readonly handFanDistance = computed(() => {
    const count = Math.max(1, this.handCount() ?? 1);
    const index = Math.min(Math.max(0, this.handIndex() ?? 0), count - 1);

    return index - (count - 1) / 2;
  });

  ngOnChanges(): void {
    this.syncActiveHoverInstance();
    this.syncHoverInteractions();
    this.syncFaceFlipAnimation();
    this.syncStatPulses();
    this.syncOptimisticDungeonMarker();
  }

  ngOnDestroy(): void {
    this.clearHoverLiftTimer();
    this.clearStatPulseTimers();
    this.clearStatOverlayArrivalTimer();
    this.clearFaceFlipTimer();
    this.clearDungeonMarkerDrag();
    this.stopPreviewBoundsWatcher();
  }

  fallbackLabel(): string {
    const currentCard = this.card();
    if (this.mode() === 'battlefield') {
      return currentCard.hidden ? 'Face-down card' : currentCard.name;
    }

    return currentCard.hidden ? 'Hidden card' : currentCard.name;
  }

  onDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.mode() === 'battlefield' && this.zone() === 'battlefield' && isGameplayCardTapLocked(this.card())) {
      return;
    }

    this.cardDoubleClicked.emit({ event, card: this.card() });
  }

  onClick(event: MouseEvent): void {
    const isBattlefieldClick = this.mode() === 'battlefield' && this.zone() === 'battlefield';
    this.previewSuppressedUntilPointerExit = isBattlefieldClick;
    if (isBattlefieldClick) {
      this.deactivateHover(true);
    }
    if (this.previewSuppressedUntilPointerExit) {
      this.startPreviewBoundsWatcher();
    }
    this.cardClicked.emit({ event, card: this.card() });
  }

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      event.preventDefault();
      return;
    }

    this.cardPointerDown.emit({ event, card: this.card() });
  }

  onMouseEnter(event: MouseEvent, card: GameCardInstance): void {
    if (this.hoveredCard?.instanceId !== card.instanceId) {
      this.previewFaceIndexOverride = null;
    }
    this.pointerInside = true;
    this.hoveredCard = card;
    this.cardPointerEntered.emit({ event, card });
    this.syncHoverInteractions(event.currentTarget instanceof Element ? event.currentTarget : null);
  }

  onMouseLeave(): void {
    if (this.dungeonMarkerPointerId !== null) {
      return;
    }

    this.pointerInside = false;
    this.previewSuppressedUntilPointerExit = false;
    this.hoveredCard = null;
    this.previewFaceIndexOverride = null;
    this.deactivateHover(true);
    this.cardMouseLeft.emit();
  }

  onDragStart(event: DragEvent, card: GameCardInstance): void {
    this.pointerInside = false;
    this.hoveredCard = null;
    this.previewFaceIndexOverride = null;
    this.deactivateHover(true);
    this.cardDragStarted.emit({ event, card });
  }

  changePower(event: MouseEvent, delta: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.powerChanged.emit({ event, card: this.card(), delta });
  }

  changeToughness(event: MouseEvent, delta: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.toughnessChanged.emit({ event, card: this.card(), delta });
  }

  changeLoyalty(event: MouseEvent, delta: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.loyaltyChanged.emit({ event, card: this.card(), delta });
  }

  changeCounter(change: CardMarkerCounterChange): void {
    this.counterChanged.emit({ event: change.event, card: this.card(), key: change.key, delta: change.delta });
  }

  requestCounterDelete(request: CardMarkerCounterDeleteRequest): void {
    this.counterDeleteRequested.emit({ event: request.event, card: this.card(), key: request.key });
  }

  openRulings(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.showRulingsMarker()) {
      return;
    }

    const scryfallId = this.card().scryfallId?.trim();
    if (!scryfallId) {
      return;
    }

    window.open(`https://scryfall.com/card/${encodeURIComponent(scryfallId)}#rulings`, '_blank', 'noopener');
  }

  stopStatPointer(event: PointerEvent): void {
    event.stopPropagation();
  }

  stopStatDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  stopFaceTogglePointer(event: PointerEvent): void {
    event.stopPropagation();
    if (event.button === 0) {
      event.preventDefault();
    }
  }

  stopFaceToggleEvent(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDungeonMarkerPointerDown(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0 || this.locked() || !this.showDungeonMarker()) {
      return;
    }

    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const host = target?.closest<HTMLElement>('.card-visual') ?? null;
    if (!target || !host) {
      return;
    }

    this.dungeonMarkerPointerId = event.pointerId;
    this.dungeonMarkerHost = host;
    this.dungeonMarkerCaptureElement = target;
    this.dungeonMarkerPointerOffset = this.dungeonMarkerDragOffset(event, host);
    target.setPointerCapture(event.pointerId);
    this.updateDungeonMarkerDrag(eventPoint(event));
    this.openDungeonMarkerDragPreview();
    this.emitDungeonMarkerPreview();
  }

  onDungeonMarkerPointerMove(event: PointerEvent): void {
    if (this.dungeonMarkerPointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.scheduleDungeonMarkerDrag(eventPoint(event));
  }

  onDungeonMarkerPointerUp(event: PointerEvent): void {
    if (this.dungeonMarkerPointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.cancelScheduledDungeonMarkerDrag();
    this.updateDungeonMarkerDrag(eventPoint(event));
    this.emitDungeonMarkerPreview();
    const marker = this.draggingDungeonMarker();
    const card = this.card();
    this.releaseDungeonMarkerCapture(event.pointerId);
    if (marker) {
      this.optimisticDungeonMarkerInstanceId = card.instanceId;
      this.optimisticDungeonMarker.set(marker);
    }
    this.clearDungeonMarkerDrag(false);
    if (marker) {
      this.dungeonMarkerChanged.emit({ event, card, marker });
    }
  }

  onDungeonMarkerPointerCancel(event: PointerEvent): void {
    if (this.dungeonMarkerPointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.releaseDungeonMarkerCapture(event.pointerId);
    this.emitDungeonMarkerPreview(null);
    this.clearDungeonMarkerDrag();
  }

  stopDungeonMarkerEvent(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
  }

  lookAtOtherFace(event: Event): void {
    this.stopFaceToggleEvent(event);
    const currentCard = this.card();
    const nextFaceIndex = this.nextPreviewFaceIndex(currentCard);
    if (nextFaceIndex === null) {
      return;
    }

    this.previewFaceIndexOverride = nextFaceIndex;
    this.activePreviewInstanceId = currentCard.instanceId;
    this.activePreviewSourceRect ??= previewRectFromElement(this.cardElement());
    this.activatePreviewForCurrentCard();
    this.emitCardPreview(currentCard);
    this.cardFaceLookRequested.emit(this.previewEvent(currentCard));
  }

  private syncHoverInteractions(sourceElement: Element | null = null): void {
    if (this.motionActive()) {
      this.clearHoverLiftTimer();
      return;
    }

    const hoveredCard = this.hoveredCard;
    if (!this.pointerInside || !hoveredCard || !this.hoverInteractionsEnabled()) {
      this.deactivateHover(true);
      return;
    }

    if (this.mode() !== 'battlefield' || this.zone() !== 'battlefield') {
      this.previewSuppressedUntilPointerExit = false;
    }

    if (this.previewSuppressedUntilPointerExit) {
      this.deactivateHover(false);
      return;
    }

    if (this.activePreviewInstanceId !== hoveredCard.instanceId) {
      this.deactivateHover(true);
      this.activePreviewInstanceId = hoveredCard.instanceId;
      this.activePreviewSourceRect = previewRectFromElement(sourceElement);
      this.activatePreviewForCurrentCard();
      this.emitCardPreview(hoveredCard);
    } else {
      this.activatePreviewForCurrentCard();
    }

    this.clearHoverLiftTimer();
    this.hoverLiftTimer = window.setTimeout(() => {
      if (this.pointerInside && this.hoverInteractionsEnabled() && this.hoveredCard?.instanceId === hoveredCard.instanceId) {
        this.hoverLifted.set(true);
        if (this.previewActive()) {
          this.emitCardPreview(hoveredCard);
        }
      }
      this.hoverLiftTimer = null;
    }, this.hoverLiftDelayMs());
  }

  private hoverLiftDelayMs(): number {
    return this.isBehindPermanentPile()
      ? this.defaultHoverLiftDelayMs * 2
      : this.defaultHoverLiftDelayMs;
  }

  private isBehindPermanentPile(): boolean {
    return this.landStackRole() === 'under' || this.attachmentStackRole() === 'equipment';
  }

  private syncActiveHoverInstance(): void {
    const activeInstanceId = this.activeHoverInstanceId();
    if (activeInstanceId === null || activeInstanceId === this.card().instanceId) {
      return;
    }

    this.pointerInside = false;
    this.hoveredCard = null;
    this.deactivateHover(false);
  }

  private deactivateHover(emitPreviewHidden: boolean): void {
    this.clearHoverLiftTimer();
    this.hoverLifted.set(false);
    this.previewActive.set(false);
    this.previewFaceIndexOverride = null;
    this.activePreviewSourceRect = null;
    this.stopPreviewBoundsWatcher();
    if (!emitPreviewHidden || this.activePreviewInstanceId === null) {
      this.activePreviewInstanceId = null;
      return;
    }

    this.activePreviewInstanceId = null;
    this.cardMouseLeft.emit();
  }

  private activatePreviewForCurrentCard(): void {
    const isBattlefieldPreview = this.mode() === 'battlefield' && this.zone() === 'battlefield';

    this.previewActive.set(isBattlefieldPreview);
    this.startPreviewBoundsWatcher();
  }

  private emitCardPreview(card: GameCardInstance): void {
    this.cardMouseEntered.emit(this.previewEvent(card));
  }

  private previewEvent(card: GameCardInstance): CardPreviewEvent {
    return {
      card: this.previewCard(card),
      playerId: this.playerId(),
      zone: this.zone(),
      sourceRect: this.activePreviewSourceRect,
    };
  }

  private previewCard(card: GameCardInstance): GameCardInstance {
    const previewCard = this.previewFaceIndexOverride === null ? card : { ...card, activeFaceIndex: this.previewFaceIndexOverride };
    const marker = card.instanceId === this.card().instanceId ? this.dungeonMarkerPosition() : null;

    return marker === null ? previewCard : { ...previewCard, dungeonMarker: marker };
  }

  private openDungeonMarkerDragPreview(): void {
    const card = this.card();

    this.pointerInside = true;
    this.hoveredCard = card;
    this.previewSuppressedUntilPointerExit = false;
    this.activePreviewInstanceId = card.instanceId;
    this.activePreviewSourceRect = previewRectFromElement(this.cardElement());
    this.activatePreviewForCurrentCard();
    this.cardPreviewRequested.emit(this.previewEvent(card));
  }

  private emitDungeonMarkerPreview(marker: GameCardDungeonMarker | null = this.dungeonMarkerPosition()): void {
    this.dungeonMarkerPreviewChanged.emit({
      card: this.card(),
      marker,
    });
  }

  private nextPreviewFaceIndex(card: GameCardInstance): number | null {
    return nextCardFaceIndex(card, this.previewFaceIndexOverride ?? activeCardFaceIndex(card));
  }

  private startPreviewBoundsWatcher(): void {
    if (this.previewBoundsListening) {
      return;
    }

    window.addEventListener('pointermove', this.previewPointerMoveHandler, { passive: true });
    this.previewBoundsListening = true;
  }

  private stopPreviewBoundsWatcher(): void {
    if (!this.previewBoundsListening) {
      return;
    }

    window.removeEventListener('pointermove', this.previewPointerMoveHandler);
    this.previewBoundsListening = false;
  }

  private syncPreviewPointerBounds(event: PointerEvent): void {
    if (this.dungeonMarkerPointerId !== null) {
      return;
    }

    const hasActivePreview = this.activePreviewInstanceId !== null;
    if (!hasActivePreview && !this.previewActive() && !this.previewSuppressedUntilPointerExit) {
      return;
    }

    const bounds = this.cardElement()?.getBoundingClientRect();
    if (!bounds || this.isPointInsideBounds(event.clientX, event.clientY, bounds)) {
      return;
    }

    this.pointerInside = false;
    this.previewSuppressedUntilPointerExit = false;
    this.hoveredCard = null;
    this.deactivateHover(hasActivePreview);
  }

  private cardElement(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>('.game-card, .mini-battlefield-card');
  }

  private scheduleDungeonMarkerDrag(point: DungeonMarkerDragPoint): void {
    this.pendingDungeonMarkerDragPoint = point;
    if (this.dungeonMarkerDragFrame !== null) {
      return;
    }

    this.dungeonMarkerDragFrame = window.requestAnimationFrame(() => {
      this.dungeonMarkerDragFrame = null;
      const nextPoint = this.pendingDungeonMarkerDragPoint;
      this.pendingDungeonMarkerDragPoint = null;
      if (nextPoint === null || this.dungeonMarkerPointerId === null) {
        return;
      }

      this.updateDungeonMarkerDrag(nextPoint);
      this.emitDungeonMarkerPreview();
    });
  }

  private updateDungeonMarkerDrag(point: DungeonMarkerDragPoint): void {
    const host = this.dungeonMarkerHost;
    if (!host) {
      return;
    }

    const rect = host.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const offset = this.dungeonMarkerPointerOffset ?? { x: 0, y: 0 };
    const markerClientX = point.clientX + offset.x;
    const markerClientY = point.clientY + offset.y;

    const bounds = this.dungeonMarkerDragBounds(rect);

    this.draggingDungeonMarker.set({
      x: clampNumber((markerClientX - rect.left) / rect.width, bounds.minX, bounds.maxX),
      y: clampNumber((markerClientY - rect.top) / rect.height, bounds.minY, bounds.maxY),
    });
  }

  private dungeonMarkerDragBounds(hostRect: DOMRect): { minX: number; maxX: number; minY: number; maxY: number } {
    const pinRect = this.dungeonMarkerCaptureElement?.getBoundingClientRect();
    if (!pinRect || pinRect.width <= 0 || pinRect.height <= 0) {
      return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    }

    const horizontalInset = clampNumber(
      (pinRect.width * DUNGEON_MARKER_HORIZONTAL_VISIBLE_RATIO) / hostRect.width,
      0,
      0.45,
    );
    const topInset = clampNumber(
      (pinRect.height * DUNGEON_MARKER_TOP_VISIBLE_RATIO) / hostRect.height,
      0,
      0.45,
    );

    return {
      minX: horizontalInset,
      maxX: 1 - horizontalInset,
      minY: topInset,
      maxY: 1,
    };
  }

  private dungeonMarkerDragOffset(event: PointerEvent, host: HTMLElement): { x: number; y: number } {
    const rect = host.getBoundingClientRect();
    const marker = this.dungeonMarkerPosition() ?? dungeonMarkerForCard(this.card());
    if (!marker || rect.width <= 0 || rect.height <= 0) {
      return { x: 0, y: 0 };
    }

    return {
      x: rect.left + marker.x * rect.width - event.clientX,
      y: rect.top + marker.y * rect.height - event.clientY,
    };
  }

  private optimisticDungeonMarkerForCurrentCard(): GameCardDungeonMarker | null {
    return this.optimisticDungeonMarkerInstanceId === this.card().instanceId
      ? this.optimisticDungeonMarker()
      : null;
  }

  private syncOptimisticDungeonMarker(): void {
    const optimistic = this.optimisticDungeonMarker();
    if (!optimistic) {
      return;
    }

    const currentCard = this.card();
    if (this.optimisticDungeonMarkerInstanceId !== currentCard.instanceId) {
      this.clearOptimisticDungeonMarker();
      return;
    }

    const confirmed = dungeonMarkerForCard(currentCard);
    if (confirmed === null || markersEqual(confirmed, optimistic)) {
      this.clearOptimisticDungeonMarker();
    }
  }

  private clearOptimisticDungeonMarker(): void {
    this.optimisticDungeonMarkerInstanceId = null;
    this.optimisticDungeonMarker.set(null);
  }

  private releaseDungeonMarkerCapture(pointerId: number): void {
    if (this.dungeonMarkerCaptureElement?.hasPointerCapture(pointerId)) {
      this.dungeonMarkerCaptureElement.releasePointerCapture(pointerId);
    }
  }

  private cancelScheduledDungeonMarkerDrag(): void {
    this.pendingDungeonMarkerDragPoint = null;
    if (this.dungeonMarkerDragFrame === null) {
      return;
    }

    window.cancelAnimationFrame(this.dungeonMarkerDragFrame);
    this.dungeonMarkerDragFrame = null;
  }

  private clearDungeonMarkerDrag(clearPreviewSuppression = true): void {
    this.cancelScheduledDungeonMarkerDrag();
    this.dungeonMarkerPointerId = null;
    this.dungeonMarkerHost = null;
    this.dungeonMarkerCaptureElement = null;
    this.dungeonMarkerPointerOffset = null;
    this.draggingDungeonMarker.set(null);
    if (clearPreviewSuppression) {
      this.previewSuppressedUntilPointerExit = false;
    }
  }

  private isPointInsideBounds(clientX: number, clientY: number, bounds: DOMRect): boolean {
    return clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom;
  }

  private clearHoverLiftTimer(): void {
    if (this.hoverLiftTimer === null) {
      return;
    }

    window.clearTimeout(this.hoverLiftTimer);
    this.hoverLiftTimer = null;
  }

  private syncStatPulses(): void {
    const statsVisible = this.statsVisible();
    if (this.previousStatsVisible === false && statsVisible) {
      this.startStatOverlayArrival();
    }
    this.previousStatsVisible = statsVisible;

    if (statsVisible) {
      this.previousPowerValue = this.updateStatPulse(this.previousPowerValue, this.powerValue(), this.powerPulse, 'power');
      this.previousToughnessValue = this.updateStatPulse(
        this.previousToughnessValue,
        this.toughnessValue(),
        this.toughnessPulse,
        'toughness',
      );
    } else {
      this.previousPowerValue = undefined;
      this.previousToughnessValue = undefined;
      this.clearStatPulseTimer('power');
      this.clearStatPulseTimer('toughness');
      this.powerPulse.set(null);
      this.toughnessPulse.set(null);
    }

    if (this.loyaltyVisible()) {
      this.previousLoyaltyValue = this.updateStatPulse(this.previousLoyaltyValue, this.loyaltyValue(), this.loyaltyPulse, 'loyalty');
      return;
    }

    this.previousLoyaltyValue = undefined;
    this.clearStatPulseTimer('loyalty');
    this.loyaltyPulse.set(null);
  }

  private updateStatPulse(
    previousValue: number | null | undefined,
    currentValue: number | null,
    pulse: WritableSignal<StatPulse>,
    stat: 'power' | 'toughness' | 'loyalty',
  ): number | null {
    if (previousValue === undefined) {
      return currentValue;
    }

    if (typeof previousValue === 'number' && typeof currentValue === 'number' && currentValue !== previousValue) {
      pulse.set(currentValue > previousValue ? 'increase' : 'decrease');
      this.scheduleStatPulseClear(stat);
    }

    return currentValue;
  }

  private scheduleStatPulseClear(stat: 'power' | 'toughness' | 'loyalty'): void {
    const timer = this.statPulseTimer(stat);
    const duration = timer === null ? this.singleStatPulseMs : this.repeatedStatPulseMs;
    if (timer !== null) {
      window.clearTimeout(timer);
    }

    const nextTimer = window.setTimeout(() => {
      this.statPulseSignal(stat).set(null);
      this.setStatPulseTimer(stat, null);
    }, duration);

    this.setStatPulseTimer(stat, nextTimer);
  }

  private clearStatPulseTimers(): void {
    this.clearStatPulseTimer('power');
    this.clearStatPulseTimer('toughness');
    this.clearStatPulseTimer('loyalty');
  }

  private startStatOverlayArrival(): void {
    this.clearStatOverlayArrivalTimer();
    this.statOverlayArriving.set(true);
    this.statOverlayArrivalTimer = window.setTimeout(() => {
      this.statOverlayArriving.set(false);
      this.statOverlayArrivalTimer = null;
    }, 1240);
  }

  private clearStatOverlayArrivalTimer(): void {
    if (this.statOverlayArrivalTimer !== null) {
      window.clearTimeout(this.statOverlayArrivalTimer);
      this.statOverlayArrivalTimer = null;
    }
  }

  private syncFaceFlipAnimation(): void {
    const currentCard = this.card();
    const activeFaceIndex = currentCard.activeFaceIndex ?? 0;
    const faceDown = Boolean(this.faceDown() || this.hidden() || currentCard.faceDown || currentCard.hidden);
    const isSameCard = this.previousFaceInstanceId === currentCard.instanceId;
    const faceChanged = isSameCard
      && this.previousActiveFaceIndex !== null
      && this.previousActiveFaceIndex !== activeFaceIndex;
    const faceDownChanged = isSameCard
      && this.previousFaceDown !== null
      && this.previousFaceDown !== faceDown;

    if ((faceChanged || faceDownChanged) && this.canPlayFaceFlipAnimation()) {
      this.startFaceFlipAnimation();
    }

    this.previousFaceInstanceId = currentCard.instanceId;
    this.previousActiveFaceIndex = activeFaceIndex;
    this.previousFaceDown = faceDown;
  }

  private canPlayFaceFlipAnimation(): boolean {
    return this.mode() !== 'battlefield' || this.battlefieldFocusEntry() === null;
  }

  private startFaceFlipAnimation(): void {
    this.clearFaceFlipTimer();
    this.faceFlipAnimating.set(true);
    this.faceFlipTimer = window.setTimeout(() => {
      this.faceFlipAnimating.set(false);
      this.faceFlipTimer = null;
    }, this.faceFlipAnimationMs);
  }

  private clearFaceFlipTimer(): void {
    if (this.faceFlipTimer !== null) {
      window.clearTimeout(this.faceFlipTimer);
      this.faceFlipTimer = null;
    }
    this.faceFlipAnimating.set(false);
  }

  private clearStatPulseTimer(stat: 'power' | 'toughness' | 'loyalty'): void {
    const timer = this.statPulseTimer(stat);
    if (timer !== null) {
      window.clearTimeout(timer);
      this.setStatPulseTimer(stat, null);
    }
  }

  private statPulseTimer(stat: 'power' | 'toughness' | 'loyalty'): number | null {
    switch (stat) {
      case 'power':
        return this.powerPulseTimer;
      case 'toughness':
        return this.toughnessPulseTimer;
      case 'loyalty':
        return this.loyaltyPulseTimer;
    }
  }

  private setStatPulseTimer(stat: 'power' | 'toughness' | 'loyalty', timer: number | null): void {
    switch (stat) {
      case 'power':
        this.powerPulseTimer = timer;
        return;
      case 'toughness':
        this.toughnessPulseTimer = timer;
        return;
      case 'loyalty':
        this.loyaltyPulseTimer = timer;
        return;
    }
  }

  private statPulseSignal(stat: 'power' | 'toughness' | 'loyalty'): WritableSignal<StatPulse> {
    switch (stat) {
      case 'power':
        return this.powerPulse;
      case 'toughness':
        return this.toughnessPulse;
      case 'loyalty':
        return this.loyaltyPulse;
    }
  }

  private rulingsMarkerEligible(): boolean {
    const currentCard = this.card();
    const scryfallId = currentCard.scryfallId?.trim() ?? '';

    return this.mode() === 'battlefield'
      && this.zone() === 'battlefield'
      && this.faceDown() !== true
      && this.hidden() !== true
      && currentCard.faceDown !== true
      && currentCard.hidden !== true
      && currentCard.isToken !== true
      && currentCard.isTokenCopy !== true
      && scryfallId !== '';
  }
}

function markersEqual(left: GameCardDungeonMarker, right: GameCardDungeonMarker): boolean {
  return Math.abs(left.x - right.x) < 0.0001 && Math.abs(left.y - right.y) < 0.0001;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function eventPoint(event: PointerEvent): DungeonMarkerDragPoint {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
  };
}
