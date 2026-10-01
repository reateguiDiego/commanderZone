import { Directive, ElementRef, HostListener, NgZone, OnDestroy, OnInit, inject, input, output } from '@angular/core';

const LAZY_GESTURE_LISTENERS_STORAGE_KEY = 'cz_perf_lazy_gesture_listeners';

interface ActiveLongPress {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly event: PointerEvent;
}

@Directive({
  selector: '[appGameTableLongPress]',
})
export class GameTableLongPressDirective implements OnInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly ngZone = inject(NgZone);
  private readonly activeClass = 'game-table-long-press-active';
  private readonly delayMs = 540;
  private readonly movementThresholdPx = 10;
  private readonly suppressionClearMs = 900;
  private readonly lazyGestureListenersEnabled =
    typeof window !== 'undefined'
    && window.localStorage.getItem(LAZY_GESTURE_LISTENERS_STORAGE_KEY) === '1';
  private activePress: ActiveLongPress | null = null;
  private timer: number | null = null;
  private suppressionTimer: number | null = null;
  private suppressNextClick = false;
  private suppressNextContextMenu = false;
  private windowPointerListenersAttached = false;

  readonly disabled = input(false, { alias: 'appGameTableLongPressDisabled' });
  readonly selfOnly = input(false, { alias: 'appGameTableLongPressSelfOnly' });
  readonly longPressed = output<PointerEvent>({ alias: 'appGameTableLongPressed' });

  private readonly captureClick = (event: MouseEvent): void => {
    if (!this.suppressNextClick) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    this.suppressNextClick = false;
  };

  private readonly captureContextMenu = (event: MouseEvent): void => {
    if (!this.suppressNextContextMenu) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    this.suppressNextContextMenu = false;
  };

  private readonly windowPointerMoveHandler = (event: PointerEvent): void => this.move(event);
  private readonly windowPointerUpHandler = (event: PointerEvent): void => this.end(event);
  private readonly windowPointerCancelHandler = (event: PointerEvent): void => this.cancel(event);

  ngOnInit(): void {
    const element = this.host.nativeElement;
    element.addEventListener('click', this.captureClick, true);
    element.addEventListener('contextmenu', this.captureContextMenu, true);
    if (!this.lazyGestureListenersEnabled) {
      this.attachWindowPointerListeners();
    }
  }

  ngOnDestroy(): void {
    const element = this.host.nativeElement;
    element.removeEventListener('click', this.captureClick, true);
    element.removeEventListener('contextmenu', this.captureContextMenu, true);
    this.cancelPress();
    this.detachWindowPointerListeners();
    this.clearSuppressionTimer();
  }

  @HostListener('pointerdown', ['$event'])
  start(event: PointerEvent): void {
    if (this.disabled() || this.shouldIgnoreNestedTarget(event) || !this.isTouchLikePointer(event) || event.button !== 0) {
      return;
    }

    this.cancelPress();
    this.host.nativeElement.classList.add(this.activeClass);
    this.activePress = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      event,
    };
    if (this.lazyGestureListenersEnabled) {
      this.attachWindowPointerListeners();
      this.ngZone.runOutsideAngular(() => {
        this.timer = window.setTimeout(() => this.ngZone.run(() => this.fire(event.pointerId)), this.delayMs);
      });
      return;
    }

    this.timer = window.setTimeout(() => this.fire(event.pointerId), this.delayMs);
  }

  private move(event: PointerEvent): void {
    const activePress = this.activePress;
    if (!activePress || event.pointerId !== activePress.pointerId) {
      return;
    }

    if (this.distanceFromStart(event, activePress) > this.movementThresholdPx) {
      this.cancelPress();
    }
  }

  private end(event: PointerEvent): void {
    if (this.activePress?.pointerId === event.pointerId) {
      this.cancelPress();
    }
  }

  private cancel(event: PointerEvent): void {
    if (this.activePress?.pointerId === event.pointerId) {
      this.cancelPress();
    }
  }

  private fire(pointerId: number): void {
    const activePress = this.activePress;
    if (!activePress || activePress.pointerId !== pointerId) {
      return;
    }

    this.timer = null;
    this.activePress = null;
    this.host.nativeElement.classList.remove(this.activeClass);
    if (this.lazyGestureListenersEnabled) {
      this.detachWindowPointerListeners();
    }
    this.suppressFollowUpMouseEvents();
    activePress.event.preventDefault();
    activePress.event.stopPropagation();
    this.longPressed.emit(activePress.event);
  }

  private suppressFollowUpMouseEvents(): void {
    this.suppressNextClick = true;
    this.suppressNextContextMenu = true;
    this.clearSuppressionTimer();
    this.suppressionTimer = window.setTimeout(() => {
      this.suppressNextClick = false;
      this.suppressNextContextMenu = false;
      this.suppressionTimer = null;
    }, this.suppressionClearMs);
  }

  private cancelPress(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.host.nativeElement.classList.remove(this.activeClass);
    this.activePress = null;
    if (this.lazyGestureListenersEnabled) {
      this.detachWindowPointerListeners();
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

  private clearSuppressionTimer(): void {
    if (this.suppressionTimer === null) {
      return;
    }

    window.clearTimeout(this.suppressionTimer);
    this.suppressionTimer = null;
  }

  private distanceFromStart(event: PointerEvent, activePress: ActiveLongPress): number {
    return Math.hypot(event.clientX - activePress.startX, event.clientY - activePress.startY);
  }

  private isTouchLikePointer(event: PointerEvent): boolean {
    return event.pointerType === 'touch' || event.pointerType === 'pen';
  }

  private shouldIgnoreNestedTarget(event: PointerEvent): boolean {
    return this.selfOnly() && event.target !== this.host.nativeElement;
  }
}
