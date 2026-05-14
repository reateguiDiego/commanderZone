import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { GameCardInstance } from '../../../../core/models/game.model';
import { CardPreviewSourceRect } from '../card-preview.model';

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

const PREVIEW_WIDTH = 288;
const PREVIEW_GAP = 14;
const PREVIEW_MARGIN = 12;
const PREVIEW_ASPECT_RATIO = 1.397;

@Component({
  selector: 'app-card-preview-overlay',
  templateUrl: './card-preview-overlay.component.html',
  styleUrl: './card-preview-overlay.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardPreviewOverlayComponent {
  readonly card = input.required<GameCardInstance>();
  readonly image = input.required<string | null>();
  readonly sourceRect = input<CardPreviewSourceRect | null>(null);
  readonly battlefieldRect = input.required<BattlefieldRect>();

  readonly previewStyle = computed(() => this.computePreviewStyle());

  private computePreviewStyle(): PreviewStyle {
    const field = this.battlefieldRect();
    const width = Math.min(PREVIEW_WIDTH, Math.max(160, field.width - PREVIEW_MARGIN * 2));
    const height = width * PREVIEW_ASPECT_RATIO;
    const defaultLeft = field.right - width - PREVIEW_MARGIN;
    const left = clamp(defaultLeft, field.left + PREVIEW_MARGIN, field.right - width - PREVIEW_MARGIN);
    const centeredTop = field.top + (field.height - height) / 2;
    const source = this.sourceRect();
    const defaultTop = clamp(centeredTop, field.top + PREVIEW_MARGIN, field.bottom - height - PREVIEW_MARGIN);
    const candidate = { left, top: defaultTop, right: left + width, bottom: defaultTop + height };

    if (!source || !rectsOverlap(candidate, source)) {
      return { left, top: defaultTop, width };
    }

    const belowTop = source.bottom + PREVIEW_GAP;
    if (belowTop + height <= field.bottom - PREVIEW_MARGIN) {
      return { left, top: belowTop, width };
    }

    const aboveTop = source.top - height - PREVIEW_GAP;
    if (aboveTop >= field.top + PREVIEW_MARGIN) {
      return { left, top: aboveTop, width };
    }

    return {
      left,
      top: clamp(aboveTop, field.top + PREVIEW_MARGIN, field.bottom - height - PREVIEW_MARGIN),
      width,
    };
  }
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
