import { ChangeDetectionStrategy, Component, ElementRef, HostListener, input, signal, viewChild } from '@angular/core';

interface TooltipPosition {
  readonly left: number;
  readonly top: number;
}

type TooltipTriggerMode = 'hover' | 'click';
type TooltipPlacement = 'top' | 'bottom';
type TooltipAlign = 'center' | 'end';

@Component({
  selector: 'app-tooltip',
  templateUrl: './tooltip.component.html',
  styleUrl: './tooltip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TooltipComponent {
  private readonly trigger = viewChild.required<ElementRef<HTMLElement>>('trigger');

  readonly text = input<string | null>(null);
  readonly stretch = input(false);
  readonly triggerMode = input<TooltipTriggerMode>('hover');
  readonly placement = input<TooltipPlacement>('top');
  readonly align = input<TooltipAlign>('center');
  readonly open = signal(false);
  readonly position = signal<TooltipPosition | null>(null);

  show(): void {
    if (!this.text()) {
      return;
    }

    this.updatePosition();
    this.open.set(true);
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
    this.position.set({
      left: rect.left + rect.width / 2,
      top: rect.top,
    });
  }
}
