import { Directive, ElementRef, HostListener, OnDestroy, inject } from '@angular/core';

export const COUNTER_HOVER_INTENT_DELAY_MS = 100;
const COUNTER_HOVER_LEAVE_GRACE_MS = 140;

@Directive({
  selector: '[appCounterHoverIntent]',
})
export class CounterHoverIntentDirective implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private enterTimer: number | null = null;
  private leaveTimer: number | null = null;

  @HostListener('pointerenter')
  onPointerEnter(): void {
    this.clearLeaveTimer();
    if (this.isActive()) {
      return;
    }

    this.clearEnterTimer();
    this.enterTimer = window.setTimeout(() => {
      this.enterTimer = null;
      this.setActive(true);
    }, COUNTER_HOVER_INTENT_DELAY_MS);
  }

  @HostListener('pointerleave')
  onPointerLeave(): void {
    this.clearEnterTimer();
    if (!this.isActive()) {
      return;
    }

    this.clearLeaveTimer();
    this.leaveTimer = window.setTimeout(() => {
      this.leaveTimer = null;
      this.setActive(false);
    }, COUNTER_HOVER_LEAVE_GRACE_MS);
  }

  ngOnDestroy(): void {
    this.clearEnterTimer();
    this.clearLeaveTimer();
    this.setActive(false);
  }

  private isActive(): boolean {
    return this.host.nativeElement.classList.contains('counter-hover-active');
  }

  private setActive(active: boolean): void {
    const element = this.host.nativeElement;
    element.classList.toggle('counter-hover-active', active);
    this.syncCardOverflowState();
  }

  private syncCardOverflowState(): void {
    const element = this.host.nativeElement;
    const card = element.closest<HTMLElement>('.game-card');
    if (!card) {
      return;
    }

    const hasActiveCounter = card.querySelector('.counter-hover-active') !== null;
    card.classList.toggle('counter-hover-parent-active', hasActiveCounter);
    element.closest<HTMLElement>('.card-visual')?.classList.toggle('counter-hover-visual-active', hasActiveCounter);

    this.syncOverflowContainer(element.closest<HTMLElement>('.battlefield'));
    this.syncOverflowContainer(element.closest<HTMLElement>('.player-cell'));
  }

  private syncOverflowContainer(container: HTMLElement | null): void {
    if (!container) {
      return;
    }

    container.classList.toggle('counter-hover-bounds-active', container.querySelector('.counter-hover-active') !== null);
  }

  private clearEnterTimer(): void {
    if (this.enterTimer === null) {
      return;
    }

    window.clearTimeout(this.enterTimer);
    this.enterTimer = null;
  }

  private clearLeaveTimer(): void {
    if (this.leaveTimer === null) {
      return;
    }

    window.clearTimeout(this.leaveTimer);
    this.leaveTimer = null;
  }
}
