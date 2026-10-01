import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameTableLongPressDirective } from './game-table-long-press.directive';

const LAZY_GESTURE_LISTENERS_STORAGE_KEY = 'cz_perf_lazy_gesture_listeners';
const WINDOW_POINTER_LISTENER_TYPES = ['pointermove', 'pointerup', 'pointercancel'];

@Component({
  imports: [GameTableLongPressDirective],
  template: `
    <button
      type="button"
      appGameTableLongPress
      (appGameTableLongPressed)="longPressed($event)"
      (click)="clicked()"
      (contextmenu)="contextMenuOpened()"
    >
      <span>Card</span>
    </button>
  `,
})
class HostComponent {
  readonly longPressed = vi.fn();
  readonly clicked = vi.fn();
  readonly contextMenuOpened = vi.fn();
}

@Component({
  imports: [GameTableLongPressDirective],
  template: `
    <button
      type="button"
      appGameTableLongPress
      [appGameTableLongPressDisabled]="true"
      (appGameTableLongPressed)="longPressed($event)"
    >
      Card
    </button>
  `,
})
class DisabledHostComponent {
  readonly longPressed = vi.fn();
}

@Component({
  imports: [GameTableLongPressDirective],
  template: `
    <button
      type="button"
      appGameTableLongPress
      [appGameTableLongPressSelfOnly]="true"
      (appGameTableLongPressed)="longPressed($event)"
    >
      <span>Card</span>
    </button>
  `,
})
class SelfOnlyHostComponent {
  readonly longPressed = vi.fn();
}

describe('GameTableLongPressDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let button: HTMLButtonElement;

  beforeEach(async () => {
    window.localStorage.removeItem(LAZY_GESTURE_LISTENERS_STORAGE_KEY);
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    button = fixture.nativeElement.querySelector('button');
    vi.useFakeTimers();
  });

  afterEach(() => {
    window.localStorage.removeItem(LAZY_GESTURE_LISTENERS_STORAGE_KEY);
    vi.useRealTimers();
  });

  it('emits long press for touch pointers after the threshold delay', () => {
    const event = pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 });

    button.dispatchEvent(event);
    vi.advanceTimersByTime(540);

    expect(fixture.componentInstance.longPressed).toHaveBeenCalledWith(event);
  });

  it('emits long press for pen pointers', () => {
    const event = pointerEvent('pointerdown', { pointerType: 'pen', pointerId: 1, clientX: 10, clientY: 20 });

    button.dispatchEvent(event);
    vi.advanceTimersByTime(540);

    expect(fixture.componentInstance.longPressed).toHaveBeenCalledWith(event);
  });

  it('ignores mouse pointers', () => {
    button.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse', pointerId: 1, clientX: 10, clientY: 20 }));
    vi.advanceTimersByTime(540);

    expect(fixture.componentInstance.longPressed).not.toHaveBeenCalled();
  });

  it('registers global listeners only for an active touch gesture when lazy listeners are enabled', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    let lazyFixture: ComponentFixture<HostComponent> | null = null;

    try {
      window.localStorage.setItem(LAZY_GESTURE_LISTENERS_STORAGE_KEY, '1');
      lazyFixture = TestBed.createComponent(HostComponent);
      lazyFixture.detectChanges();
      const lazyButton = lazyFixture.nativeElement.querySelector('button') as HTMLButtonElement;

      expect(pointerListenerTypes(addEventListener.mock.calls)).toEqual([]);

      lazyButton.dispatchEvent(pointerEvent('pointerdown', {
        pointerType: 'mouse',
        pointerId: 1,
        clientX: 10,
        clientY: 20,
      }));
      expect(pointerListenerTypes(addEventListener.mock.calls)).toEqual([]);

      lazyButton.dispatchEvent(pointerEvent('pointerdown', {
        pointerType: 'touch',
        pointerId: 2,
        clientX: 10,
        clientY: 20,
      }));
      expect(pointerListenerTypes(addEventListener.mock.calls)).toEqual(WINDOW_POINTER_LISTENER_TYPES);

      window.dispatchEvent(pointerEvent('pointercancel', {
        pointerType: 'touch',
        pointerId: 2,
        clientX: 10,
        clientY: 20,
      }));
      expect(pointerListenerTypes(removeEventListener.mock.calls)).toEqual(WINDOW_POINTER_LISTENER_TYPES);

      lazyButton.dispatchEvent(pointerEvent('pointerdown', {
        pointerType: 'pen',
        pointerId: 3,
        clientX: 10,
        clientY: 20,
      }));
      window.dispatchEvent(pointerEvent('pointerup', {
        pointerType: 'pen',
        pointerId: 3,
        clientX: 10,
        clientY: 20,
      }));
      expect(pointerListenerTypes(removeEventListener.mock.calls)).toHaveLength(6);

      lazyButton.dispatchEvent(pointerEvent('pointerdown', {
        pointerType: 'pen',
        pointerId: 4,
        clientX: 10,
        clientY: 20,
      }));
      lazyFixture.destroy();
      lazyFixture = null;

      expect(pointerListenerTypes(removeEventListener.mock.calls)).toHaveLength(9);
    } finally {
      lazyFixture?.destroy();
      addEventListener.mockRestore();
      removeEventListener.mockRestore();
    }
  });

  it('preserves long press output when lazy listeners are enabled', () => {
    window.localStorage.setItem(LAZY_GESTURE_LISTENERS_STORAGE_KEY, '1');
    const lazyFixture = TestBed.createComponent(HostComponent);
    lazyFixture.detectChanges();
    const lazyButton = lazyFixture.nativeElement.querySelector('button') as HTMLButtonElement;
    const event = pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 });

    lazyButton.dispatchEvent(event);
    vi.advanceTimersByTime(540);

    expect(lazyFixture.componentInstance.longPressed).toHaveBeenCalledWith(event);
    lazyFixture.destroy();
  });

  it('cancels when the pointer moves beyond the drag threshold', () => {
    button.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 }));
    window.dispatchEvent(pointerEvent('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 24, clientY: 20 }));
    vi.advanceTimersByTime(540);

    expect(fixture.componentInstance.longPressed).not.toHaveBeenCalled();
  });

  it('does not cancel when the pointer stays within the tap jitter threshold', () => {
    const event = pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 });
    button.dispatchEvent(event);
    window.dispatchEvent(pointerEvent('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 17, clientY: 22 }));
    vi.advanceTimersByTime(540);

    expect(fixture.componentInstance.longPressed).toHaveBeenCalledWith(event);
  });

  it('marks the host while a long press is pending', () => {
    button.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 }));

    expect(button.classList).toContain('game-table-long-press-active');
  });

  it('cancels on pointer up before the delay', () => {
    button.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 }));
    window.dispatchEvent(pointerEvent('pointerup', { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 }));
    vi.advanceTimersByTime(540);

    expect(fixture.componentInstance.longPressed).not.toHaveBeenCalled();
    expect(button.classList).not.toContain('game-table-long-press-active');
  });

  it('clears the pending class after firing long press', () => {
    button.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 }));
    vi.advanceTimersByTime(540);

    expect(button.classList).not.toContain('game-table-long-press-active');
  });

  it('suppresses the follow-up click and native contextmenu after a long press', () => {
    button.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 }));
    vi.advanceTimersByTime(540);

    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(fixture.componentInstance.clicked).not.toHaveBeenCalled();
    expect(fixture.componentInstance.contextMenuOpened).not.toHaveBeenCalled();
  });

  it('does not emit while disabled', () => {
    const disabledFixture = TestBed.createComponent(DisabledHostComponent);
    disabledFixture.detectChanges();
    const disabledButton = disabledFixture.nativeElement.querySelector('button');

    disabledButton.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 }));
    vi.advanceTimersByTime(540);

    expect(disabledFixture.componentInstance.longPressed).not.toHaveBeenCalled();
  });

  it('can ignore nested targets when self-only mode is enabled', () => {
    const selfOnlyFixture = TestBed.createComponent(SelfOnlyHostComponent);
    selfOnlyFixture.detectChanges();
    const selfOnlyButton = selfOnlyFixture.nativeElement.querySelector('button');

    selfOnlyButton.querySelector('span')?.dispatchEvent(pointerEvent('pointerdown', {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 10,
      clientY: 20,
    }));
    vi.advanceTimersByTime(540);

    expect(selfOnlyFixture.componentInstance.longPressed).not.toHaveBeenCalled();
  });
});

function pointerEvent(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
}

function pointerListenerTypes(calls: ReadonlyArray<ReadonlyArray<unknown>>): string[] {
  return calls
    .map(([type]) => type)
    .filter((type): type is string => type === 'pointermove' || type === 'pointerup' || type === 'pointercancel');
}
