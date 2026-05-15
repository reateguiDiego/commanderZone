import { ChangeDetectionStrategy, Component, OnChanges, OnDestroy, computed, input, output, signal, type WritableSignal } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { CardPreviewEvent, previewRectFromElement } from '../card-preview.model';
import {
  CardMarkerRailComponent,
  type CardMarkerCounterChange,
  type CardMarkerCounterDeleteRequest,
} from './card-marker-rail/card-marker-rail.component';
import { LoyaltyCounterComponent } from './loyalty-counter/loyalty-counter.component';

type GameCardViewMode = 'battlefield' | 'hand' | 'mini';

type DropPlacement = 'before' | 'after';
type StatPulse = 'increase' | 'decrease' | null;

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

@Component({
  selector: 'app-game-card-view',
  imports: [CardMarkerRailComponent, LoyaltyCounterComponent],
  templateUrl: './game-card-view.component.html',
  styleUrls: ['./game-card-view.component.scss', './game-card-view-effects.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameCardViewComponent implements OnChanges, OnDestroy {
  private readonly hoverLiftDelayMs = 100;
  private readonly singleStatPulseMs = 420;
  private readonly repeatedStatPulseMs = 900;
  private hoverLiftTimer: number | null = null;
  private powerPulseTimer: number | null = null;
  private toughnessPulseTimer: number | null = null;
  private loyaltyPulseTimer: number | null = null;
  private hoveredCard: GameCardInstance | null = null;
  private activePreviewInstanceId: string | null = null;
  private previousPowerValue: number | null | undefined;
  private previousToughnessValue: number | null | undefined;
  private previousLoyaltyValue: number | null | undefined;
  private previousStatsVisible: boolean | undefined;
  private statOverlayArrivalTimer: number | null = null;
  private pointerInside = false;

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
  readonly faceDown = input(false);
  readonly hidden = input(false);
  readonly visible = input(true);
  readonly position = input<{ x: number; y: number } | null>(null);
  readonly handDropPlacement = input<DropPlacement | null>(null);
  readonly handArrivalSide = input<'before' | 'after' | null>(null);
  readonly handIndex = input<number | null>(null);
  readonly handCount = input<number | null>(null);
  readonly miniLeftPx = input<number | null>(null);
  readonly miniTopPx = input<number | null>(null);
  readonly miniWidthPx = input<number | null>(null);
  readonly miniHeightPx = input<number | null>(null);
  readonly miniZIndex = input<number | null>(null);
  readonly showPowerToughness = input(false);
  readonly powerValue = input<number | null>(null);
  readonly toughnessValue = input<number | null>(null);
  readonly loyaltyValue = input<number | null>(null);
  readonly counter = input<CardCounterView | null>(null);
  readonly handDepth = computed(() => `${Math.max(0, this.handCount() ?? 0) - (this.handIndex() ?? 0)}`);
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
  readonly cardPointerEntered = output<void>();
  readonly cardMouseEntered = output<CardPreviewEvent>();
  readonly cardMouseLeft = output<void>();
  readonly powerChanged = output<CardStatChangeEvent>();
  readonly toughnessChanged = output<CardStatChangeEvent>();
  readonly loyaltyChanged = output<CardStatChangeEvent>();
  readonly counterChanged = output<CardCounterChangeEvent>();
  readonly counterDeleteRequested = output<CardCounterDeleteRequestEvent>();
  readonly hoverLifted = signal(false);
  readonly powerPulse = signal<StatPulse>(null);
  readonly toughnessPulse = signal<StatPulse>(null);
  readonly loyaltyPulse = signal<StatPulse>(null);
  readonly statOverlayArriving = signal(false);
  readonly statsVisible = computed(() => !this.faceDown() && this.showPowerToughness());
  readonly loyaltyVisible = computed(() => !this.faceDown() && this.loyaltyValue() !== null && !this.showPowerToughness());

  readonly handClass = (placement: DropPlacement): boolean => this.handDropPlacement() === placement;

  ngOnChanges(): void {
    this.syncHoverInteractions();
    this.syncStatPulses();
  }

  ngOnDestroy(): void {
    this.clearHoverLiftTimer();
    this.clearStatPulseTimers();
    this.clearStatOverlayArrivalTimer();
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
    this.cardDoubleClicked.emit({ event, card: this.card() });
  }

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      event.preventDefault();
      return;
    }

    this.cardPointerDown.emit({ event, card: this.card() });
  }

  onMouseEnter(event: MouseEvent, card: GameCardInstance): void {
    this.pointerInside = true;
    this.hoveredCard = card;
    this.cardPointerEntered.emit();
    this.syncHoverInteractions(event.currentTarget instanceof Element ? event.currentTarget : null);
  }

  onMouseLeave(): void {
    this.pointerInside = false;
    this.hoveredCard = null;
    this.deactivateHover(true);
  }

  onDragStart(event: DragEvent, card: GameCardInstance): void {
    this.pointerInside = false;
    this.hoveredCard = null;
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

  stopStatPointer(event: PointerEvent): void {
    event.stopPropagation();
  }

  stopStatDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  private syncHoverInteractions(sourceElement: Element | null = null): void {
    const hoveredCard = this.hoveredCard;
    if (!this.pointerInside || !hoveredCard || !this.hoverInteractionsEnabled()) {
      this.deactivateHover(true);
      return;
    }

    if (this.activePreviewInstanceId !== hoveredCard.instanceId) {
      this.deactivateHover(true);
      this.activePreviewInstanceId = hoveredCard.instanceId;
      this.cardMouseEntered.emit({
        card: hoveredCard,
        playerId: this.playerId(),
        zone: this.zone(),
        sourceRect: previewRectFromElement(sourceElement),
      });
    }

    this.clearHoverLiftTimer();
    this.hoverLiftTimer = window.setTimeout(() => {
      if (this.pointerInside && this.hoverInteractionsEnabled() && this.hoveredCard?.instanceId === hoveredCard.instanceId) {
        this.hoverLifted.set(true);
      }
      this.hoverLiftTimer = null;
    }, this.hoverLiftDelayMs);
  }

  private deactivateHover(emitPreviewHidden: boolean): void {
    this.clearHoverLiftTimer();
    this.hoverLifted.set(false);
    if (!emitPreviewHidden || this.activePreviewInstanceId === null) {
      this.activePreviewInstanceId = null;
      return;
    }

    this.activePreviewInstanceId = null;
    this.cardMouseLeft.emit();
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
}
