import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DoCheck,
  ElementRef,
  OnDestroy,
  ViewChild,
  input,
  output,
  signal,
} from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { PlayerView } from '../game-table.store';
import { GameCardViewComponent } from '../game-card-view/game-card-view.component';
import { CardPreviewEvent } from '../card-preview.model';

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

interface BattlefieldSizeEvent {
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type BattlefieldFocusEntry = 'left' | 'right' | 'fade' | null;

@Component({
  selector: 'app-focused-battlefield',
  imports: [GameCardViewComponent],
  templateUrl: './focused-battlefield.component.html',
  styleUrl: './focused-battlefield.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FocusedBattlefieldComponent implements AfterViewInit, DoCheck, OnDestroy {
  private resizeObserver: ResizeObserver | null = null;
  private lastBattlefieldSize: BattlefieldSizeEvent | null = null;
  private lastPlayerId: string | null = null;
  private boardTransitionTimer: number | null = null;

  @ViewChild('battlefieldRoot', { static: true }) private readonly battlefieldRoot?: ElementRef<HTMLElement>;

  readonly player = input.required<PlayerView>();
  readonly isCurrentPlayer = input.required<(playerId: string) => boolean>();
  readonly allowArrowTargetSelection = input(false);
  readonly focusEffectsEnabled = input(true);
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
  readonly isCardDropSettling = input<(playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean>(() => false);
  readonly isManaDropSettling = input<(playerId: string, card: GameCardInstance) => boolean>(() => false);
  readonly isBattlefieldEntrySettling = input<(playerId: string, card: GameCardInstance) => boolean>(() => false);
  readonly isCommanderEntrySettling = input<(playerId: string, card: GameCardInstance) => boolean>(() => false);
  readonly isCardTransferPending = input<(playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean>(() => false);

  readonly battlefieldDragOver = output<DragEvent>();
  readonly battlefieldDropped = output<BattlefieldDropEvent>();
  readonly battlefieldMenuOpened = output<BattlefieldZoneMenuEvent>();
  readonly cardPointerDown = output<BattlefieldCardPointerEvent>();
  readonly cardClicked = output<BattlefieldCardMouseEvent>();
  readonly cardDoubleClicked = output<BattlefieldCardMouseEvent>();
  readonly cardMenuOpened = output<BattlefieldCardMouseEvent>();
  readonly cardPreviewShown = output<CardPreviewEvent>();
  readonly cardPreviewHidden = output<void>();
  readonly cardPowerChanged = output<BattlefieldCardStatChangeEvent>();
  readonly cardToughnessChanged = output<BattlefieldCardStatChangeEvent>();
  readonly cardLoyaltyChanged = output<BattlefieldCardStatChangeEvent>();
  readonly cardCounterChanged = output<BattlefieldCardCounterChangeEvent>();
  readonly cardCounterDeleteRequested = output<BattlefieldCardCounterDeleteRequestEvent>();
  readonly manaLaneDragOver = output<DragEvent>();
  readonly manaLaneDropped = output<{ event: DragEvent; playerId: string }>();
  readonly battlefieldSizeChanged = output<BattlefieldSizeEvent>();
  readonly boardTransitioning = signal(false);

  ngAfterViewInit(): void {
    const element = this.battlefieldRoot?.nativeElement;
    if (!element) {
      return;
    }

    this.emitBattlefieldSize(element);
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    this.resizeObserver = new ResizeObserver(([entry]) => {
      if (entry) {
        this.emitBattlefieldSize(element);
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
  }

  ngDoCheck(): void {
    const playerId = this.player().id;
    if (this.lastPlayerId === playerId) {
      return;
    }

    this.lastPlayerId = playerId;
    this.triggerBoardTransition();
  }

  canInteractWithCard(playerId: string, card: GameCardInstance): boolean {
    return this.isCurrentPlayer()(playerId) && this.canDragBattlefieldCard()(playerId, card);
  }

  onCardDoubleClick(event: MouseEvent, playerId: string, card: GameCardInstance): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isCurrentPlayer()(playerId)) {
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
}
