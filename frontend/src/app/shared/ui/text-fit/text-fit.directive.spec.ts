import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TextFitDirective } from './text-fit.directive';

type ResizeObserverCallbackRef = ResizeObserverCallback | null;

@Component({
  standalone: true,
  imports: [TextFitDirective],
  template: `
    <button type="button" czTextFit [czTextFitMinScale]="0.8">
      Very long translated action label
    </button>
    <button type="button" class="cz-button--icon" czTextFit [czTextFitMinScale]="0.8">
      <span>0</span>
    </button>
    <h1 class="single-line-title" czTextFit [czTextFitMinScale]="0.72">
      Rooms
    </h1>
  `,
})
class TextFitHostComponent {}

describe('TextFitDirective', () => {
  let resizeCallback: ResizeObserverCallbackRef = null;
  let animationFrameHandle = 0;
  let animationFrameCallbacks = new Map<number, FrameRequestCallback>();
  let fixture: ComponentFixture<TextFitHostComponent>;

  beforeEach(async () => {
    resizeCallback = null;
    animationFrameHandle = 0;
    animationFrameCallbacks = new Map<number, FrameRequestCallback>();

    vi.useRealTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      animationFrameHandle += 1;
      animationFrameCallbacks.set(animationFrameHandle, callback);
      return animationFrameHandle;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
      animationFrameCallbacks.delete(handle);
    });

    class ResizeObserverMock implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }

      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);

    await TestBed.configureTestingModule({
      imports: [TextFitHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TextFitHostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shrinks text and marks overflow when the rendered content does not fit', () => {
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    setElementBox(button, {
      clientWidth: 100,
      scrollWidth: 180,
      clientHeight: 20,
      scrollHeight: 40,
    });

    resizeCallback?.([], {} as ResizeObserver);
    flushAnimationFrames(animationFrameCallbacks);

    expect(button.style.getPropertyValue('--cz-text-fit-scale')).toBe('0.8');
    expect(button.classList).toContain('cz-text-fit--shrunk');
    expect(button.classList).toContain('cz-text-fit--overflowing');
  });

  it('keeps the default scale when the rendered content fits', () => {
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    setElementBox(button, {
      clientWidth: 180,
      scrollWidth: 120,
      clientHeight: 40,
      scrollHeight: 20,
    });

    resizeCallback?.([], {} as ResizeObserver);
    flushAnimationFrames(animationFrameCallbacks);

    expect(button.style.getPropertyValue('--cz-text-fit-scale')).toBe('1');
    expect(button.classList).not.toContain('cz-text-fit--shrunk');
    expect(button.classList).not.toContain('cz-text-fit--overflowing');
  });

  it('does not shrink icon buttons', () => {
    const iconButton = fixture.nativeElement.querySelector('.cz-button--icon') as HTMLButtonElement;
    setElementBox(iconButton, {
      clientWidth: 40,
      scrollWidth: 80,
      clientHeight: 40,
      scrollHeight: 80,
    });

    resizeCallback?.([], {} as ResizeObserver);
    flushAnimationFrames(animationFrameCallbacks);

    expect(iconButton.style.getPropertyValue('--cz-text-fit-scale')).toBe('1');
    expect(iconButton.classList).not.toContain('cz-text-fit--shrunk');
    expect(iconButton.classList).not.toContain('cz-text-fit--overflowing');
  });

  it('does not shrink single-line text for vertical font metric overflow only', () => {
    const title = fixture.nativeElement.querySelector('.single-line-title') as HTMLHeadingElement;
    title.style.whiteSpace = 'nowrap';
    setElementBox(title, {
      clientWidth: 120,
      scrollWidth: 80,
      clientHeight: 44,
      scrollHeight: 48,
    });

    resizeCallback?.([], {} as ResizeObserver);
    flushAnimationFrames(animationFrameCallbacks);

    expect(title.style.getPropertyValue('--cz-text-fit-scale')).toBe('1');
    expect(title.classList).not.toContain('cz-text-fit--shrunk');
    expect(title.classList).not.toContain('cz-text-fit--overflowing');
  });
});

function setElementBox(element: HTMLElement, box: {
  readonly clientWidth: number;
  readonly scrollWidth: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
}): void {
  for (const [property, value] of Object.entries(box)) {
    Object.defineProperty(element, property, {
      configurable: true,
      value,
    });
  }
}

function flushAnimationFrames(callbacks: Map<number, FrameRequestCallback>): void {
  const pendingCallbacks = Array.from(callbacks.values());
  callbacks.clear();

  for (const callback of pendingCallbacks) {
    callback(performance.now());
  }
}
