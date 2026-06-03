import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, OnChanges, OnDestroy, computed, input, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { CardPreviewAttachmentInfo, CardPreviewCardStateInfo, CardPreviewSourceRect } from '../../models/card-preview.model';
import { CardMarkerRailComponent } from '../game-card-view/card-marker-rail/card-marker-rail.component';
import { LoyaltyCounterComponent } from '../game-card-view/loyalty-counter/loyalty-counter.component';

interface BattlefieldRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

interface PreviewStyle {
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

interface CollisionRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const PREVIEW_WIDTH = 288;
const PREVIEW_WITH_ATTACHMENTS_WIDTH = 270;
const PREVIEW_GAP = 14;
const PREVIEW_MARGIN = 12;
const PREVIEW_ASPECT_RATIO = 1.397;
const DETAIL_INFO_ESTIMATED_HEIGHT = 104;

@Component({
  selector: 'app-card-preview-overlay',
  imports: [RuntimeTranslatePipe, LucideAngularModule, CardMarkerRailComponent, LoyaltyCounterComponent],
  templateUrl: './card-preview-overlay.component.html',
  styleUrl: './card-preview-overlay.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardPreviewOverlayComponent implements OnChanges, OnDestroy {
  readonly card = input.required<GameCardInstance>();
  readonly image = input.required<string | null>();
  readonly sourceRect = input<CardPreviewSourceRect | null>(null);
  readonly avoidRect = input<CollisionRect | null>(null);
  readonly battlefieldRect = input.required<BattlefieldRect>();
  readonly attachmentInfo = input<CardPreviewAttachmentInfo | null>(null);
  readonly cardStateInfo = input<CardPreviewCardStateInfo | null>(null);
  readonly hasAttachmentDetails = computed(() => {
    const info = this.attachmentInfo();

    return info !== null && (info.attachedTo !== null || info.attachedCards.length > 0);
  });
  readonly hasDetailInfo = computed(() => this.attachmentInfo() !== null || this.cardStateInfo() !== null);
  readonly faceFlipAnimating = signal(false);

  readonly previewStyle = computed(() => this.computePreviewStyle());

  private previousFaceInstanceId: string | null = null;
  private previousActiveFaceIndex: number | null = null;
  private faceFlipTimer: number | null = null;
  private readonly faceFlipAnimationMs = 620;

  ngOnChanges(): void {
    this.syncFaceFlipAnimation();
  }

  ngOnDestroy(): void {
    this.clearFaceFlipTimer();
  }

  private computePreviewStyle(): PreviewStyle {
    const field = this.battlefieldRect();
    const hasDetailInfo = this.hasDetailInfo();
    const maxWidth = hasDetailInfo ? PREVIEW_WITH_ATTACHMENTS_WIDTH : PREVIEW_WIDTH;
    const width = Math.min(maxWidth, Math.max(160, field.width - PREVIEW_MARGIN * 2));
    const height = width * PREVIEW_ASPECT_RATIO + (hasDetailInfo ? DETAIL_INFO_ESTIMATED_HEIGHT : 0);
    const defaultLeft = field.right - width - PREVIEW_MARGIN;
    const left = clamp(defaultLeft, field.left + PREVIEW_MARGIN, field.right - width - PREVIEW_MARGIN);
    const centeredTop = field.top + (field.height - height) / 2;
    const defaultTop = clamp(centeredTop, field.top + PREVIEW_MARGIN, field.bottom - height - PREVIEW_MARGIN);
    const candidate = { left, top: defaultTop, right: left + width, bottom: defaultTop + height };
    const obstacles = [this.sourceRect(), this.avoidRect()].filter((rect): rect is CollisionRect => rect !== null);
    const obstacle = this.firstOverlappingObstacle(candidate, obstacles);

    if (!obstacle) {
      return { left, top: defaultTop, width };
    }

    for (const rect of obstacles) {
      const belowTop = rect.bottom + PREVIEW_GAP;
      if (belowTop + height <= field.bottom - PREVIEW_MARGIN && !this.overlapsAny(styleRect(left, belowTop, width, height), obstacles)) {
        return { left, top: belowTop, width };
      }
    }

    for (const rect of obstacles) {
      const aboveTop = rect.top - height - PREVIEW_GAP;
      if (aboveTop >= field.top + PREVIEW_MARGIN && !this.overlapsAny(styleRect(left, aboveTop, width, height), obstacles)) {
        return { left, top: aboveTop, width };
      }
    }

    const aboveTop = obstacle.top - height - PREVIEW_GAP;
    return {
      left,
      top: clamp(aboveTop, field.top + PREVIEW_MARGIN, field.bottom - height - PREVIEW_MARGIN),
      width,
    };
  }

  private firstOverlappingObstacle(
    candidate: CollisionRect,
    obstacles: readonly CollisionRect[],
  ): CollisionRect | null {
    return obstacles.find((obstacle) => rectsOverlap(candidate, obstacle)) ?? null;
  }

  private overlapsAny(candidate: CollisionRect, obstacles: readonly CollisionRect[]): boolean {
    return obstacles.some((obstacle) => rectsOverlap(candidate, obstacle));
  }

  private syncFaceFlipAnimation(): void {
    const currentCard = this.card();
    const activeFaceIndex = currentCard.activeFaceIndex ?? 0;
    const isSameCard = this.previousFaceInstanceId === currentCard.instanceId;
    const faceChanged = isSameCard
      && this.previousActiveFaceIndex !== null
      && this.previousActiveFaceIndex !== activeFaceIndex;

    if (faceChanged) {
      this.startFaceFlipAnimation();
    }

    this.previousFaceInstanceId = currentCard.instanceId;
    this.previousActiveFaceIndex = activeFaceIndex;
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
}

function styleRect(left: number, top: number, width: number, height: number): CollisionRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
  };
}

function rectsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
