import { ChangeDetectionStrategy, Component, ElementRef, HostListener, input, signal, viewChild } from '@angular/core';

interface TooltipPosition {
  readonly left: number;
  readonly top: number;
}

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

  handleFocusOut(event: FocusEvent): void {
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

  private updatePosition(): void {
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    this.position.set({
      left: rect.left + rect.width / 2,
      top: rect.top,
    });
  }
}
