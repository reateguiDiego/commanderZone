import { ChangeDetectionStrategy, Component, ElementRef, HostListener, input, signal, viewChild } from '@angular/core';

interface TooltipPosition {
  readonly left: number;
  readonly top: number;
}

type TooltipTriggerMode = 'hover' | 'click';
type TooltipPlacement = 'top' | 'bottom';
type TooltipAlign = 'start' | 'center' | 'end';

interface TooltipBounds {
  readonly left: number;
  readonly right: number;
}

@Component({
  selector: 'app-tooltip',
  templateUrl: './tooltip.component.html',
  styleUrl: './tooltip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TooltipComponent {
  private readonly trigger = viewChild.required<ElementRef<HTMLElement>>('trigger');
  private readonly bubble = viewChild<ElementRef<HTMLElement>>('bubble');

  readonly text = input<string | null>(null);
  readonly stretch = input(false);
  readonly triggerMode = input<TooltipTriggerMode>('hover');
  readonly placement = input<TooltipPlacement>('top');
  readonly align = input<TooltipAlign>('center');
  readonly open = signal(false);
  readonly position = signal<TooltipPosition | null>(null);
  readonly effectivePlacement = signal<TooltipPlacement>('top');
  readonly effectiveAlign = signal<TooltipAlign>('center');

  show(): void {
    if (!this.text()) {
      return;
    }

    this.updatePosition();
    this.open.set(true);
    setTimeout(() => {
      if (this.open()) {
        this.updatePosition();
      }
    });
  }

  hide(): void {
    this.open.set(false);
  }

  handleMouseEnter(): void {
    if (this.triggerMode() !== 'hover') {
      return;
    }

    this.show();
  }

  handleMouseLeave(): void {
    if (this.triggerMode() !== 'hover') {
      return;
    }

    this.hide();
  }

  handleFocusIn(): void {
    if (this.triggerMode() !== 'hover') {
      return;
    }

    this.show();
  }

  handleClick(event: MouseEvent): void {
    if (this.triggerMode() !== 'click') {
      return;
    }

    const triggerElement = this.trigger().nativeElement;
    if (!triggerElement.contains(event.target as Node | null)) {
      return;
    }

    this.show();
  }

  handleFocusOut(event: FocusEvent): void {
    if (this.triggerMode() !== 'hover') {
      return;
    }

    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && this.trigger().nativeElement.contains(nextTarget)) {
      return;
    }

    this.hide();
  }

  @HostListener('window:scroll')
  @HostListener('window:resize')
  syncPosition(): void {
    if (!this.open()) {
      return;
    }

    this.updatePosition();
  }

  @HostListener('document:pointerdown', ['$event'])
  handleDocumentPointerDown(event: PointerEvent): void {
    if (!this.open() || this.triggerMode() !== 'click') {
      return;
    }

    const triggerElement = this.trigger().nativeElement;
    if (triggerElement.contains(event.target as Node | null)) {
      return;
    }

    this.hide();
  }

  private updatePosition(): void {
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    const placement = this.resolvePlacement(rect);
    const align = this.resolveAlign(rect);

    this.effectivePlacement.set(placement);
    this.effectiveAlign.set(align);
    this.position.set({
      left: rect.left + rect.width / 2,
      top: placement === 'bottom' ? rect.bottom : rect.top,
    });
  }

  private resolvePlacement(triggerRect: DOMRect): TooltipPlacement {
    const preferredPlacement = this.placement();
    const bubbleHeight = this.bubble()?.nativeElement.getBoundingClientRect().height ?? 0;
    if (bubbleHeight <= 0) {
      return preferredPlacement;
    }

    const viewportHeight = this.viewportHeight();
    const margin = 8;
    const gap = 9;
    const hasSpaceAbove = triggerRect.top - bubbleHeight - gap >= margin;
    const hasSpaceBelow = triggerRect.bottom + bubbleHeight + gap <= viewportHeight - margin;

    if (preferredPlacement === 'top' && !hasSpaceAbove && hasSpaceBelow) {
      return 'bottom';
    }

    if (preferredPlacement === 'bottom' && !hasSpaceBelow && hasSpaceAbove) {
      return 'top';
    }

    if (!hasSpaceAbove && !hasSpaceBelow) {
      return triggerRect.top >= viewportHeight - triggerRect.bottom ? 'top' : 'bottom';
    }

    return preferredPlacement;
  }

  private resolveAlign(triggerRect: DOMRect): TooltipAlign {
    const preferredAlign = this.align();
    const bubbleWidth = this.bubble()?.nativeElement.getBoundingClientRect().width ?? 0;
    if (bubbleWidth <= 0) {
      return preferredAlign;
    }

    const viewportWidth = this.viewportWidth();
    const margin = 8;
    const center = triggerRect.left + triggerRect.width / 2;
    const candidateOrder = this.alignCandidateOrder(preferredAlign);

    return candidateOrder.reduce<{ align: TooltipAlign; overflow: number } | null>((best, align) => {
      const bounds = this.alignBounds(center, bubbleWidth, align);
      const overflow = Math.max(0, margin - bounds.left) + Math.max(0, bounds.right - (viewportWidth - margin));
      if (overflow === 0) {
        return best?.overflow === 0 ? best : { align, overflow };
      }

      if (!best || overflow < best.overflow) {
        return { align, overflow };
      }

      return best;
    }, null)?.align ?? preferredAlign;
  }

  private alignCandidateOrder(preferredAlign: TooltipAlign): TooltipAlign[] {
    if (preferredAlign === 'start') {
      return ['start', 'center', 'end'];
    }

    if (preferredAlign === 'end') {
      return ['end', 'center', 'start'];
    }

    return ['center', 'end', 'start'];
  }

  private alignBounds(center: number, width: number, align: TooltipAlign): TooltipBounds {
    const arrowOffset = 17.6;
    if (align === 'start') {
      return {
        left: center - arrowOffset,
        right: center - arrowOffset + width,
      };
    }

    if (align === 'end') {
      return {
        left: center - width + arrowOffset,
        right: center + arrowOffset,
      };
    }

    return {
      left: center - width / 2,
      right: center + width / 2,
    };
  }

  private viewportWidth(): number {
    return document.documentElement.clientWidth || window.innerWidth;
  }

  private viewportHeight(): number {
    return document.documentElement.clientHeight || window.innerHeight;
  }
}
