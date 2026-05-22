import { Directive, ElementRef, HostListener, OnDestroy, OnInit, inject, input, output } from '@angular/core';

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
  private readonly activeClass = 'game-table-long-press-active';
  private readonly delayMs = 540;
  private readonly movementThresholdPx = 10;
  private readonly suppressionClearMs = 900;
  private activePress: ActiveLongPress | null = null;
  private timer: number | null = null;
  private suppressionTimer: number | null = null;
  private suppressNextClick = false;
  private suppressNextContextMenu = false;

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

  ngOnInit(): void {
    const element = this.host.nativeElement;
    element.addEventListener('click', this.captureClick, true);
    element.addEventListener('contextmenu', this.captureContextMenu, true);
  }

  ngOnDestroy(): void {
    const element = this.host.nativeElement;
    element.removeEventListener('click', this.captureClick, true);
    element.removeEventListener('contextmenu', this.captureContextMenu, true);
    this.cancelPress();
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
    this.timer = window.setTimeout(() => this.fire(event.pointerId), this.delayMs);
  }

  @HostListener('window:pointermove', ['$event'])
  move(event: PointerEvent): void {
    const activePress = this.activePress;
    if (!activePress || event.pointerId !== activePress.pointerId) {
      return;
    }

    if (this.distanceFromStart(event, activePress) > this.movementThresholdPx) {
      this.cancelPress();
    }
  }

  @HostListener('window:pointerup', ['$event'])
  end(event: PointerEvent): void {
    if (this.activePress?.pointerId === event.pointerId) {
      this.cancelPress();
    }
  }

  @HostListener('window:pointercancel', ['$event'])
  cancel(event: PointerEvent): void {
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
