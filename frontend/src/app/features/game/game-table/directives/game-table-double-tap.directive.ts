import { Directive, ElementRef, HostListener, OnDestroy, OnInit, inject, input, output } from '@angular/core';

interface ActiveTap {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly startX: number;
  readonly startY: number;
  readonly startTime: number;
}

interface LastTap {
  readonly pointerType: string;
  readonly x: number;
  readonly y: number;
  readonly time: number;
}

@Directive({
  selector: '[appGameTableDoubleTap]',
})
export class GameTableDoubleTapDirective implements OnInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly maxIntervalMs = 320;
  private readonly maxTapDurationMs = 280;
  private readonly movementThresholdPx = 12;
  private readonly suppressionClearMs = 600;
  private activeTap: ActiveTap | null = null;
  private lastTap: LastTap | null = null;
  private suppressionTimer: number | null = null;
  private suppressNextNativeDoubleClick = false;

  readonly disabled = input(false, { alias: 'appGameTableDoubleTapDisabled' });
  readonly selfOnly = input(false, { alias: 'appGameTableDoubleTapSelfOnly' });
  readonly doubleTapped = output<PointerEvent>({ alias: 'appGameTableDoubleTapped' });

  private readonly captureNativeDoubleClick = (event: MouseEvent): void => {
    if (!this.suppressNextNativeDoubleClick) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    this.suppressNextNativeDoubleClick = false;
  };

  ngOnInit(): void {
    this.host.nativeElement.addEventListener('dblclick', this.captureNativeDoubleClick, true);
  }

  ngOnDestroy(): void {
    this.host.nativeElement.removeEventListener('dblclick', this.captureNativeDoubleClick, true);
    this.clearSuppressionTimer();
  }

  @HostListener('pointerdown', ['$event'])
  start(event: PointerEvent): void {
    if (this.disabled() || this.shouldIgnoreNestedTarget(event) || !this.isTouchLikePointer(event) || event.button !== 0) {
      this.activeTap = null;
      return;
    }

    this.activeTap = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      startTime: Date.now(),
    };
  }

  @HostListener('window:pointermove', ['$event'])
  move(event: PointerEvent): void {
    const activeTap = this.activeTap;
    if (!activeTap || event.pointerId !== activeTap.pointerId) {
      return;
    }

    if (this.distance(event.clientX, event.clientY, activeTap.startX, activeTap.startY) > this.movementThresholdPx) {
      this.activeTap = null;
    }
  }

  @HostListener('window:pointerup', ['$event'])
  end(event: PointerEvent): void {
    const activeTap = this.activeTap;
    if (!activeTap || event.pointerId !== activeTap.pointerId) {
      return;
    }

    this.activeTap = null;
    if (!this.isValidTap(event, activeTap)) {
      this.lastTap = null;
      return;
    }

    const now = Date.now();
    const lastTap = this.lastTap;
    if (lastTap && this.isDoubleTap(event, lastTap, now)) {
      this.lastTap = null;
      this.suppressNativeDoubleClick();
      event.preventDefault();
      event.stopPropagation();
      this.doubleTapped.emit(event);
      return;
    }

    this.lastTap = {
      pointerType: activeTap.pointerType,
      x: event.clientX,
      y: event.clientY,
      time: now,
    };
  }

  @HostListener('window:pointercancel', ['$event'])
  cancel(event: PointerEvent): void {
    if (this.activeTap?.pointerId === event.pointerId) {
      this.activeTap = null;
    }
  }

  private isValidTap(event: PointerEvent, activeTap: ActiveTap): boolean {
    if (Date.now() - activeTap.startTime > this.maxTapDurationMs) {
      return false;
    }

    return this.distance(event.clientX, event.clientY, activeTap.startX, activeTap.startY) <= this.movementThresholdPx;
  }

  private isDoubleTap(event: PointerEvent, lastTap: LastTap, now: number): boolean {
    return event.pointerType === lastTap.pointerType
      && now - lastTap.time <= this.maxIntervalMs
      && this.distance(event.clientX, event.clientY, lastTap.x, lastTap.y) <= this.movementThresholdPx;
  }

  private suppressNativeDoubleClick(): void {
    this.suppressNextNativeDoubleClick = true;
    this.clearSuppressionTimer();
    this.suppressionTimer = window.setTimeout(() => {
      this.suppressNextNativeDoubleClick = false;
      this.suppressionTimer = null;
    }, this.suppressionClearMs);
  }

  private clearSuppressionTimer(): void {
    if (this.suppressionTimer === null) {
      return;
    }

    window.clearTimeout(this.suppressionTimer);
    this.suppressionTimer = null;
  }

  private distance(fromX: number, fromY: number, toX: number, toY: number): number {
    return Math.hypot(fromX - toX, fromY - toY);
  }

  private isTouchLikePointer(event: PointerEvent): boolean {
    return event.pointerType === 'touch' || event.pointerType === 'pen';
  }

  private shouldIgnoreNestedTarget(event: PointerEvent): boolean {
    return this.selfOnly() && event.target !== this.host.nativeElement;
  }
}
