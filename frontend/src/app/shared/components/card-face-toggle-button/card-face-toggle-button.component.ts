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
  private static readonly TOUCH_EVENT_DEDUPE_MS = 32;
  readonly tone = input<CardFaceToggleButtonTone>('overlay');
  readonly size = input<CardFaceToggleButtonSize>('md');
  readonly pressed = output<MouseEvent | PointerEvent | TouchEvent>();
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
    this.stopPropagationOnly(event);
  }

  onMouseDown(event: MouseEvent): void {
    this.stopPropagationOnly(event);
  }

  onPointerUp(event: PointerEvent): void {
    this.stopPropagationOnly(event);

    if (event.pointerType === 'mouse') {
      return;
    }

    this.stopEvent(event);
    this.lastTouchActivationAt = Date.now();
    this.pressed.emit(event);
  }

  onMouseUp(event: MouseEvent): void {
    this.stopPropagationOnly(event);
  }

  onTouchStart(event: TouchEvent): void {
    this.stopPropagationOnly(event);
  }

  onTouchEnd(event: TouchEvent): void {
    this.stopEvent(event);
    if (Date.now() - this.lastTouchActivationAt < CardFaceToggleButtonComponent.TOUCH_EVENT_DEDUPE_MS) {
      return;
    }

    this.lastTouchActivationAt = Date.now();
    this.pressed.emit(event);
  }

  onPointerCancel(event: PointerEvent): void {
    this.stopEvent(event);
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

  private stopPropagationOnly(event: Event): void {
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }
}
