import { Directive, ElementRef, HostListener, NgZone, OnDestroy, OnInit, inject, input, output } from '@angular/core';

const LAZY_GESTURE_LISTENERS_STORAGE_KEY = 'cz_perf_lazy_gesture_listeners';

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
  private readonly ngZone = inject(NgZone);
  private readonly maxIntervalMs = 320;
  private readonly maxTapDurationMs = 280;
  private readonly movementThresholdPx = 12;
  private readonly suppressionClearMs = 600;
  private readonly lazyGestureListenersEnabled =
    typeof window !== 'undefined'
    && window.localStorage.getItem(LAZY_GESTURE_LISTENERS_STORAGE_KEY) === '1';
  private activeTap: ActiveTap | null = null;
  private lastTap: LastTap | null = null;
  private suppressionTimer: number | null = null;
  private suppressNextNativeDoubleClick = false;
  private windowPointerListenersAttached = false;

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

  private readonly windowPointerMoveHandler = (event: PointerEvent): void => this.move(event);
  private readonly windowPointerUpHandler = (event: PointerEvent): void => this.end(event);
  private readonly windowPointerCancelHandler = (event: PointerEvent): void => this.cancel(event);

  ngOnInit(): void {
    this.host.nativeElement.addEventListener('dblclick', this.captureNativeDoubleClick, true);
    if (!this.lazyGestureListenersEnabled) {
      this.attachWindowPointerListeners();
    }
  }

  ngOnDestroy(): void {
    this.host.nativeElement.removeEventListener('dblclick', this.captureNativeDoubleClick, true);
    this.detachWindowPointerListeners();
    this.clearSuppressionTimer();
  }

  @HostListener('pointerdown', ['$event'])
  start(event: PointerEvent): void {
    if (this.disabled() || this.shouldIgnoreNestedTarget(event) || !this.isTouchLikePointer(event) || event.button !== 0) {
      this.activeTap = null;
      if (this.lazyGestureListenersEnabled) {
        this.detachWindowPointerListeners();
      }
      return;
    }

    this.activeTap = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      startTime: Date.now(),
    };
    if (this.lazyGestureListenersEnabled) {
      this.attachWindowPointerListeners();
    }
  }

  private move(event: PointerEvent): void {
    const activeTap = this.activeTap;
    if (!activeTap || event.pointerId !== activeTap.pointerId) {
      return;
    }

    if (this.distance(event.clientX, event.clientY, activeTap.startX, activeTap.startY) > this.movementThresholdPx) {
      this.activeTap = null;
      if (this.lazyGestureListenersEnabled) {
        this.detachWindowPointerListeners();
      }
    }
  }

  private end(event: PointerEvent): void {
    const activeTap = this.activeTap;
    if (!activeTap || event.pointerId !== activeTap.pointerId) {
      return;
    }

    this.activeTap = null;
    if (this.lazyGestureListenersEnabled) {
      this.detachWindowPointerListeners();
    }
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
      if (this.lazyGestureListenersEnabled) {
        this.ngZone.run(() => this.doubleTapped.emit(event));
      } else {
        this.doubleTapped.emit(event);
      }
      return;
    }

    this.lastTap = {
      pointerType: activeTap.pointerType,
      x: event.clientX,
      y: event.clientY,
      time: now,
    };
  }

  private cancel(event: PointerEvent): void {
    if (this.activeTap?.pointerId === event.pointerId) {
      this.activeTap = null;
      if (this.lazyGestureListenersEnabled) {
        this.detachWindowPointerListeners();
      }
    }
  }

  private attachWindowPointerListeners(): void {
    if (this.windowPointerListenersAttached || typeof window === 'undefined') {
      return;
    }

    const attach = (): void => {
      window.addEventListener('pointermove', this.windowPointerMoveHandler);
      window.addEventListener('pointerup', this.windowPointerUpHandler);
      window.addEventListener('pointercancel', this.windowPointerCancelHandler);
      this.windowPointerListenersAttached = true;
    };

    if (this.lazyGestureListenersEnabled) {
      this.ngZone.runOutsideAngular(attach);
      return;
    }

    attach();
  }

  private detachWindowPointerListeners(): void {
    if (!this.windowPointerListenersAttached || typeof window === 'undefined') {
      return;
    }

    window.removeEventListener('pointermove', this.windowPointerMoveHandler);
    window.removeEventListener('pointerup', this.windowPointerUpHandler);
    window.removeEventListener('pointercancel', this.windowPointerCancelHandler);
    this.windowPointerListenersAttached = false;
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
