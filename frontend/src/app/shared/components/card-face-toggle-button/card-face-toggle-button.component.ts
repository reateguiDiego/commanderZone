import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';

export type CardFaceToggleButtonTone = 'overlay' | 'inline';
export type CardFaceToggleButtonSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-card-face-toggle-button',
  imports: [LucideAngularModule, RuntimeTranslatePipe],
  templateUrl: './card-face-toggle-button.component.html',
  styleUrl: './card-face-toggle-button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.card-face-toggle-button--overlay]': 'tone() === "overlay"',
    '[class.card-face-toggle-button--inline]': 'tone() === "inline"',
    '[class.card-face-toggle-button--sm]': 'size() === "sm"',
    '[class.card-face-toggle-button--md]': 'size() === "md"',
    '[class.card-face-toggle-button--lg]': 'size() === "lg"',
  },
})
export class CardFaceToggleButtonComponent {
  private static readonly TOUCH_CLICK_DEDUPE_MS = 450;
  readonly tone = input<CardFaceToggleButtonTone>('overlay');
  readonly size = input<CardFaceToggleButtonSize>('md');
  readonly pressed = output<MouseEvent | PointerEvent>();
  private lastTouchActivationAt = 0;
  readonly iconSize = computed(() => {
    switch (this.size()) {
      case 'lg':
        return 19;
      case 'md':
        return 17;
      default:
        return 15;
    }
  });

  onPointerDown(event: PointerEvent): void {
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  onPointerUp(event: PointerEvent): void {
    if (event.pointerType === 'mouse') {
      return;
    }

    this.stopEvent(event);
    this.lastTouchActivationAt = Date.now();
    this.pressed.emit(event);
  }

  onClick(event: MouseEvent): void {
    this.stopEvent(event);
    if (Date.now() - this.lastTouchActivationAt < CardFaceToggleButtonComponent.TOUCH_CLICK_DEDUPE_MS) {
      return;
    }

    this.pressed.emit(event);
  }

  onContextMenu(event: MouseEvent): void {
    this.stopEvent(event);
  }

  private stopEvent(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }
}
