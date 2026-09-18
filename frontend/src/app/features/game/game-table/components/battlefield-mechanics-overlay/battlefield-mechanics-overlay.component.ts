import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { CardPreviewEvent, previewRectFromElement } from '../../models/card-preview.model';
import { GameCardViewComponent } from '../game-card-view/game-card-view.component';
import { CardMarkerCounterChange, CardMarkerRailComponent } from '../game-card-view/card-marker-rail/card-marker-rail.component';
import { PreloadCardAlternateFaceDirective } from '../../../../../shared/directives/preload-card-alternate-face.directive';
import { GameScheduledImageDirective } from '../../directives/game-scheduled-image.directive';

interface BattlefieldMechanicCardMenuEvent {
  readonly event: MouseEvent;
  readonly card: GameCardInstance;
  readonly forceOpenLeft?: boolean;
}

interface BattlefieldMechanicCardCounterChangeEvent {
  readonly event: MouseEvent;
  readonly card: GameCardInstance;
  readonly key: string;
  readonly delta: number;
}

interface BattlefieldMechanicCardPointerEvent {
  readonly event: PointerEvent;
  readonly card: GameCardInstance;
}

interface BattlefieldMechanicCardMouseEvent {
  readonly event: MouseEvent;
  readonly card: GameCardInstance;
}

@Component({
  selector: 'app-battlefield-mechanics-overlay',
  imports: [
    GameCardViewComponent,
    CardMarkerRailComponent,
    PreloadCardAlternateFaceDirective,
    GameScheduledImageDirective,
  ],
  templateUrl: './battlefield-mechanics-overlay.component.html',
  styleUrl: './battlefield-mechanics-overlay.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BattlefieldMechanicsOverlayComponent {
  readonly cards = input<readonly GameCardInstance[]>([]);
  readonly playerId = input.required<string>();
  readonly image = input.required<(card: GameCardInstance) => string | null>();
  readonly variant = input<'battlefield' | 'mini'>('battlefield');
  readonly miniViewportSize = input<{ width: number; height: number } | null>(null);
  readonly miniCardBaseWidthPx = input<number | null>(null);
  readonly countersEditable = input(false);
  readonly canInteract = input<(card: GameCardInstance) => boolean>(() => false);

  private readonly miniCardGapPx = 1;
  private readonly miniCardAspectRatio = 1.4;
  readonly miniCardWidthPx = computed(() => {
    const viewport = this.miniViewportSize();
    const cardCount = this.cards().length;
    if (!viewport || cardCount === 0) {
      return null;
    }

    const desiredWidth = clamp(this.miniCardBaseWidthPx() ?? viewport.width * 0.09, 18, 58);
    const availableWidth = Math.max(
      1,
      viewport.width - this.miniCardGapPx * Math.max(0, cardCount - 1),
    );

    return roundMiniPixel(Math.max(14, Math.min(desiredWidth, availableWidth / cardCount)));
  });
  readonly miniCardHeightPx = computed(() => {
    const width = this.miniCardWidthPx();

    return width === null ? null : roundMiniPixel(width * this.miniCardAspectRatio);
  });

  readonly cardMenuOpened = output<BattlefieldMechanicCardMenuEvent>();
  readonly cardPreviewShown = output<CardPreviewEvent>();
  readonly cardPreviewRequested = output<CardPreviewEvent>();
  readonly cardPreviewHidden = output<void>();
  readonly counterChanged = output<BattlefieldMechanicCardCounterChangeEvent>();
  readonly cardPointerDown = output<BattlefieldMechanicCardPointerEvent>();
  readonly cardClicked = output<BattlefieldMechanicCardMouseEvent>();
  readonly cardDoubleClicked = output<BattlefieldMechanicCardMouseEvent>();

  miniCardLeftPx(index: number): number | null {
    const viewport = this.miniViewportSize();
    const cardWidth = this.miniCardWidthPx();
    if (!viewport || cardWidth === null) {
      return null;
    }

    const cardCount = this.cards().length;
    const rowWidth = cardCount * cardWidth + Math.max(0, cardCount - 1) * this.miniCardGapPx;
    const start = Math.max(0, viewport.width - rowWidth);

    return roundMiniPixel(start + index * (cardWidth + this.miniCardGapPx));
  }

  showMiniCardPreview(event: MouseEvent, card: GameCardInstance): void {
    this.cardPreviewShown.emit({
      card,
      playerId: this.playerId(),
      zone: 'battlefield',
      sourceRect: previewRectFromElement(event.currentTarget as Element | null),
    });
  }

  openMiniCardMenu(event: MouseEvent, card: GameCardInstance): void {
    event.preventDefault();
    event.stopPropagation();
    this.cardMenuOpened.emit({ event, card, forceOpenLeft: true });
  }

  openBattlefieldCardMenu(event: MouseEvent, card: GameCardInstance): void {
    this.cardMenuOpened.emit({
      event,
      card,
      forceOpenLeft: true,
    });
  }

  visibleCounters(card: GameCardInstance): readonly { key: string; value: number }[] {
    return Object.entries(card.counters ?? {})
      .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) >= 0)
      .map(([key, value]) => ({ key, value: Number(value) }));
  }

  changeCounter(event: CardMarkerCounterChange, card: GameCardInstance): void {
    this.counterChanged.emit({ event: event.event, card, key: event.key, delta: event.delta });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundMiniPixel(value: number): number {
  return Math.round(value * 100) / 100;
}
