import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameTableDoubleTapDirective } from './game-table-double-tap.directive';

const LAZY_GESTURE_LISTENERS_STORAGE_KEY = 'cz_perf_lazy_gesture_listeners';
const WINDOW_POINTER_LISTENER_TYPES = ['pointermove', 'pointerup', 'pointercancel'];

@Component({
  imports: [GameTableDoubleTapDirective],
  template: `
    <button
      type="button"
      appGameTableDoubleTap
      (appGameTableDoubleTapped)="doubleTapped($event)"
      (dblclick)="nativeDoubleClicked()"
    >
      <span>Card</span>
    </button>
  `,
})
class HostComponent {
  readonly doubleTapped = vi.fn();
  readonly nativeDoubleClicked = vi.fn();
}

@Component({
  imports: [GameTableDoubleTapDirective],
  template: `
    <button
      type="button"
      appGameTableDoubleTap
      [appGameTableDoubleTapDisabled]="true"
      (appGameTableDoubleTapped)="doubleTapped($event)"
    >
      Card
    </button>
  `,
})
class DisabledHostComponent {
  readonly doubleTapped = vi.fn();
}

@Component({
  imports: [GameTableDoubleTapDirective],
  template: `
    <button
      type="button"
      appGameTableDoubleTap
      [appGameTableDoubleTapSelfOnly]="true"
      (appGameTableDoubleTapped)="doubleTapped($event)"
    >
      <span>Card</span>
    </button>
  `,
})
class SelfOnlyHostComponent {
  readonly doubleTapped = vi.fn();
}

describe('GameTableDoubleTapDirective', () => {
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

  it('emits a double tap for touch pointers within the interval', () => {
    tap(button, { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 });
    vi.advanceTimersByTime(160);
    const secondUp = tap(button, { pointerType: 'touch', pointerId: 2, clientX: 12, clientY: 21 });

    expect(fixture.componentInstance.doubleTapped).toHaveBeenCalledWith(secondUp);
  });

  it('emits a double tap for pen pointers', () => {
    tap(button, { pointerType: 'pen', pointerId: 1, clientX: 10, clientY: 20 });
    vi.advanceTimersByTime(120);
    tap(button, { pointerType: 'pen', pointerId: 2, clientX: 10, clientY: 20 });

    expect(fixture.componentInstance.doubleTapped).toHaveBeenCalledOnce();
  });

  it('ignores mouse pointers', () => {
    tap(button, { pointerType: 'mouse', pointerId: 1, clientX: 10, clientY: 20 });
    vi.advanceTimersByTime(100);
    tap(button, { pointerType: 'mouse', pointerId: 2, clientX: 10, clientY: 20 });

    expect(fixture.componentInstance.doubleTapped).not.toHaveBeenCalled();
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

      lazyButton.dispatchEvent(pointerEvent('pointerdown', {
        pointerType: 'mouse',
        pointerId: 3,
        clientX: 10,
        clientY: 20,
      }));
      expect(pointerListenerTypes(removeEventListener.mock.calls)).toEqual(WINDOW_POINTER_LISTENER_TYPES);

      lazyButton.dispatchEvent(pointerEvent('pointerdown', {
        pointerType: 'touch',
        pointerId: 4,
        clientX: 10,
        clientY: 20,
      }));
      window.dispatchEvent(pointerEvent('pointercancel', {
        pointerType: 'touch',
        pointerId: 4,
        clientX: 10,
        clientY: 20,
      }));
      expect(pointerListenerTypes(removeEventListener.mock.calls)).toHaveLength(6);

      lazyButton.dispatchEvent(pointerEvent('pointerdown', {
        pointerType: 'pen',
        pointerId: 5,
        clientX: 10,
        clientY: 20,
      }));
      window.dispatchEvent(pointerEvent('pointerup', {
        pointerType: 'pen',
        pointerId: 5,
        clientX: 10,
        clientY: 20,
      }));
      expect(pointerListenerTypes(removeEventListener.mock.calls)).toHaveLength(9);

      lazyButton.dispatchEvent(pointerEvent('pointerdown', {
        pointerType: 'pen',
        pointerId: 6,
        clientX: 10,
        clientY: 20,
      }));
      lazyFixture.destroy();
      lazyFixture = null;

      expect(pointerListenerTypes(removeEventListener.mock.calls)).toHaveLength(12);
    } finally {
      lazyFixture?.destroy();
      addEventListener.mockRestore();
      removeEventListener.mockRestore();
    }
  });

  it('preserves double tap output when lazy listeners are enabled', () => {
    window.localStorage.setItem(LAZY_GESTURE_LISTENERS_STORAGE_KEY, '1');
    const lazyFixture = TestBed.createComponent(HostComponent);
    lazyFixture.detectChanges();
    const lazyButton = lazyFixture.nativeElement.querySelector('button') as HTMLButtonElement;

    tap(lazyButton, { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 });
    vi.advanceTimersByTime(160);
    const secondUp = tap(lazyButton, { pointerType: 'touch', pointerId: 2, clientX: 12, clientY: 21 });

    expect(lazyFixture.componentInstance.doubleTapped).toHaveBeenCalledWith(secondUp);
    lazyFixture.destroy();
  });

  it('does not emit after the double tap interval expires', () => {
    tap(button, { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 });
    vi.advanceTimersByTime(321);
    tap(button, { pointerType: 'touch', pointerId: 2, clientX: 10, clientY: 20 });

    expect(fixture.componentInstance.doubleTapped).not.toHaveBeenCalled();
  });

  it('does not emit when movement becomes a drag gesture', () => {
    button.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 }));
    window.dispatchEvent(pointerEvent('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 28, clientY: 20 }));
    window.dispatchEvent(pointerEvent('pointerup', { pointerType: 'touch', pointerId: 1, clientX: 28, clientY: 20 }));
    vi.advanceTimersByTime(100);
    tap(button, { pointerType: 'touch', pointerId: 2, clientX: 10, clientY: 20 });

    expect(fixture.componentInstance.doubleTapped).not.toHaveBeenCalled();
  });

  it('does not count a long press release as a tap', () => {
    button.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 }));
    vi.advanceTimersByTime(281);
    window.dispatchEvent(pointerEvent('pointerup', { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 }));
    vi.advanceTimersByTime(100);
    tap(button, { pointerType: 'touch', pointerId: 2, clientX: 10, clientY: 20 });

    expect(fixture.componentInstance.doubleTapped).not.toHaveBeenCalled();
  });

  it('suppresses a native dblclick after emitting a synthetic double tap', () => {
    tap(button, { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 });
    vi.advanceTimersByTime(100);
    tap(button, { pointerType: 'touch', pointerId: 2, clientX: 10, clientY: 20 });

    button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));

    expect(fixture.componentInstance.nativeDoubleClicked).not.toHaveBeenCalled();
  });

  it('does not emit while disabled', () => {
    const disabledFixture = TestBed.createComponent(DisabledHostComponent);
    disabledFixture.detectChanges();
    const disabledButton = disabledFixture.nativeElement.querySelector('button');

    tap(disabledButton, { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 });
    vi.advanceTimersByTime(100);
    tap(disabledButton, { pointerType: 'touch', pointerId: 2, clientX: 10, clientY: 20 });

    expect(disabledFixture.componentInstance.doubleTapped).not.toHaveBeenCalled();
  });

  it('can ignore nested targets when self-only mode is enabled', () => {
    const selfOnlyFixture = TestBed.createComponent(SelfOnlyHostComponent);
    selfOnlyFixture.detectChanges();
    const nested = selfOnlyFixture.nativeElement.querySelector('span');

    tap(nested, { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 });
    vi.advanceTimersByTime(100);
    tap(nested, { pointerType: 'touch', pointerId: 2, clientX: 10, clientY: 20 });

    expect(selfOnlyFixture.componentInstance.doubleTapped).not.toHaveBeenCalled();
  });
});

function tap(target: EventTarget, init: PointerEventInit): PointerEvent {
  target.dispatchEvent(pointerEvent('pointerdown', init));
  const up = pointerEvent('pointerup', init);
  window.dispatchEvent(up);
  return up;
}

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
