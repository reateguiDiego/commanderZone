import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { CardPreviewEvent, previewRectFromElement } from '../../models/card-preview.model';
import { GameCardViewComponent } from '../game-card-view/game-card-view.component';

interface BattlefieldMechanicCardMenuEvent {
  readonly event: MouseEvent;
  readonly card: GameCardInstance;
}

@Component({
  selector: 'app-battlefield-mechanics-overlay',
  imports: [GameCardViewComponent],
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

  private readonly miniCardGapPx = 1;
  private readonly miniCardAspectRatio = 1.4;
  readonly miniCardWidthPx = computed(() => {
    const viewport = this.miniViewportSize();
    const cardCount = this.cards().length;
    if (!viewport || cardCount === 0) {
      return null;
    }

    const desiredWidth = clamp(this.miniCardBaseWidthPx() ?? viewport.width * 0.09, 18, 58);
    const availableWidth = Math.max(1, viewport.width - this.miniCardGapPx * Math.max(0, cardCount - 1));

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
    this.cardMenuOpened.emit({ event, card });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundMiniPixel(value: number): number {
  return Math.round(value * 100) / 100;
}
