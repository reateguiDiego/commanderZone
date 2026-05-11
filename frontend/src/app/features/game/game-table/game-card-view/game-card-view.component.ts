import { ChangeDetectionStrategy, Component, OnChanges, OnDestroy, computed, input, output, signal } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';

type GameCardViewMode = 'battlefield' | 'hand' | 'mini';

type DropPlacement = 'before' | 'after';

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
  private hoverLiftTimer: number | null = null;
  private hoveredCard: GameCardInstance | null = null;
  private activePreviewInstanceId: string | null = null;
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
  readonly hoverInteractionsEnabled = input(true);
  readonly faceDown = input(false);
  readonly hidden = input(false);
  readonly visible = input(true);
  readonly position = input<{ x: number; y: number } | null>(null);
  readonly handDropPlacement = input<DropPlacement | null>(null);
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

  readonly handClass = (placement: DropPlacement): boolean => this.handDropPlacement() === placement;

  ngOnChanges(): void {
    this.syncHoverInteractions();
  }

  ngOnDestroy(): void {
    this.clearHoverLiftTimer();
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
}
