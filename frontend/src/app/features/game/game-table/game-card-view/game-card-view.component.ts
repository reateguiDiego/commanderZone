import { ChangeDetectionStrategy, Component, OnChanges, OnDestroy, computed, input, output, signal, type WritableSignal } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';

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

@Component({
  selector: 'app-game-card-view',
  templateUrl: './game-card-view.component.html',
  styleUrl: './game-card-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameCardViewComponent implements OnChanges, OnDestroy {
  private readonly hoverLiftDelayMs = 100;
  private readonly dragReadyDelayMs = 50;
  private hoverLiftTimer: number | null = null;
  private dragReadyTimer: number | null = null;
  private powerPulseTimer: number | null = null;
  private toughnessPulseTimer: number | null = null;
  private hoveredCard: GameCardInstance | null = null;
  private activePreviewInstanceId: string | null = null;
  private previousPowerValue: number | null | undefined;
  private previousToughnessValue: number | null | undefined;
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
  readonly dropSettling = input(false);
  readonly manaDropSettling = input(false);
  readonly statDropSettling = input(false);
  readonly hoverInteractionsEnabled = input(true);
  readonly faceDown = input(false);
  readonly hidden = input(false);
  readonly visible = input(true);
  readonly position = input<{ x: number; y: number } | null>(null);
  readonly handDropPlacement = input<DropPlacement | null>(null);
  readonly handArrivalSide = input<'before' | 'after' | null>(null);
  readonly handIndex = input<number | null>(null);
  readonly handCount = input<number | null>(null);
  readonly miniLeft = input<number | null>(null);
  readonly miniTop = input<number | null>(null);
  readonly showPowerToughness = input(false);
  readonly powerValue = input<number | null>(null);
  readonly toughnessValue = input<number | null>(null);
  readonly loyaltyValue = input<number | null>(null);
  readonly counter = input<CardCounterView | null>(null);
  readonly handDepth = computed(() => `${Math.max(0, this.handCount() ?? 0) - (this.handIndex() ?? 0)}`);

  readonly cardPointerDown = output<CardPointerEvent>();
  readonly cardClicked = output<CardMouseEvent>();
  readonly cardDoubleClicked = output<CardMouseEvent>();
  readonly cardMenuOpened = output<CardMouseEvent>();
  readonly cardDragStarted = output<CardDragEvent>();
  readonly cardDragEnded = output<void>();
  readonly cardDragOver = output<CardDragEvent>();
  readonly cardDropped = output<CardDragEvent>();
  readonly cardPointerEntered = output<void>();
  readonly cardMouseEntered = output<GameCardInstance>();
  readonly cardMouseLeft = output<void>();
  readonly powerChanged = output<CardStatChangeEvent>();
  readonly toughnessChanged = output<CardStatChangeEvent>();
  readonly hoverLifted = signal(false);
  readonly dragReady = signal(false);
  readonly powerPulse = signal<StatPulse>(null);
  readonly toughnessPulse = signal<StatPulse>(null);

  readonly handClass = (placement: DropPlacement): boolean => this.handDropPlacement() === placement;

  ngOnChanges(): void {
    this.syncHoverInteractions();
    this.syncStatPulses();
  }

  ngOnDestroy(): void {
    this.clearHoverLiftTimer();
    this.clearDragReadyTimer();
    this.clearStatPulseTimers();
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

    if (!this.dragReady()) {
      return;
    }

    this.cardPointerDown.emit({ event, card: this.card() });
  }

  onMouseEnter(card: GameCardInstance): void {
    this.pointerInside = true;
    this.hoveredCard = card;
    this.cardPointerEntered.emit();
    this.syncHoverInteractions();
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

  stopStatPointer(event: PointerEvent): void {
    event.stopPropagation();
  }

  stopStatDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  private syncHoverInteractions(): void {
    const hoveredCard = this.hoveredCard;
    if (!this.pointerInside || !hoveredCard || !this.hoverInteractionsEnabled()) {
      this.deactivateHover(true);
      return;
    }

    if (this.activePreviewInstanceId !== hoveredCard.instanceId) {
      this.deactivateHover(true);
      this.activePreviewInstanceId = hoveredCard.instanceId;
      this.cardMouseEntered.emit(hoveredCard);
    }

    this.clearHoverLiftTimer();
    this.hoverLiftTimer = window.setTimeout(() => {
      if (this.pointerInside && this.hoverInteractionsEnabled() && this.hoveredCard?.instanceId === hoveredCard.instanceId) {
        this.hoverLifted.set(true);
        this.scheduleDragReady(hoveredCard.instanceId);
      }
      this.hoverLiftTimer = null;
    }, this.hoverLiftDelayMs);
  }

  private deactivateHover(emitPreviewHidden: boolean): void {
    this.clearHoverLiftTimer();
    this.clearDragReadyTimer();
    this.hoverLifted.set(false);
    this.dragReady.set(false);
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

  private scheduleDragReady(instanceId: string): void {
    this.clearDragReadyTimer();
    this.dragReadyTimer = window.setTimeout(() => {
      if (this.pointerInside && this.hoverLifted() && this.hoveredCard?.instanceId === instanceId) {
        this.dragReady.set(true);
      }
      this.dragReadyTimer = null;
    }, this.dragReadyDelayMs);
  }

  private clearDragReadyTimer(): void {
    if (this.dragReadyTimer === null) {
      return;
    }

    window.clearTimeout(this.dragReadyTimer);
    this.dragReadyTimer = null;
  }

  private syncStatPulses(): void {
    if (!this.showPowerToughness()) {
      this.previousPowerValue = undefined;
      this.previousToughnessValue = undefined;
      this.clearStatPulseTimers();
      this.powerPulse.set(null);
      this.toughnessPulse.set(null);
      return;
    }

    this.previousPowerValue = this.updateStatPulse(this.previousPowerValue, this.powerValue(), this.powerPulse, 'power');
    this.previousToughnessValue = this.updateStatPulse(
      this.previousToughnessValue,
      this.toughnessValue(),
      this.toughnessPulse,
      'toughness',
    );
  }

  private updateStatPulse(
    previousValue: number | null | undefined,
    currentValue: number | null,
    pulse: WritableSignal<StatPulse>,
    stat: 'power' | 'toughness',
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

  private scheduleStatPulseClear(stat: 'power' | 'toughness'): void {
    const timer = stat === 'power' ? this.powerPulseTimer : this.toughnessPulseTimer;
    if (timer !== null) {
      window.clearTimeout(timer);
    }

    const nextTimer = window.setTimeout(() => {
      if (stat === 'power') {
        this.powerPulse.set(null);
        this.powerPulseTimer = null;
        return;
      }

      this.toughnessPulse.set(null);
      this.toughnessPulseTimer = null;
    }, 900);

    if (stat === 'power') {
      this.powerPulseTimer = nextTimer;
      return;
    }

    this.toughnessPulseTimer = nextTimer;
  }

  private clearStatPulseTimers(): void {
    if (this.powerPulseTimer !== null) {
      window.clearTimeout(this.powerPulseTimer);
      this.powerPulseTimer = null;
    }

    if (this.toughnessPulseTimer !== null) {
      window.clearTimeout(this.toughnessPulseTimer);
      this.toughnessPulseTimer = null;
    }
  }
}
