import {
  AfterViewInit,
  DestroyRef,
  Directive,
  ElementRef,
  NgZone,
  PLATFORM_ID,
  booleanAttribute,
  inject,
  input,
  numberAttribute,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

const DEFAULT_MIN_SCALE = 0.68;
const DEFAULT_MAX_SCALE = 1;
const DEFAULT_STEP = 0.04;
const OVERFLOW_TOLERANCE_PX = 1;

@Directive({
  selector: '[czTextFit]',
  standalone: true,
  host: {
    '[class.cz-text-fit]': 'true',
    '[class.cz-text-fit--shrunk]': 'shrunk()',
    '[class.cz-text-fit--overflowing]': 'overflowing()',
  },
})
export class TextFitDirective implements AfterViewInit {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private animationFrame: number | null = null;

  readonly minScale = input(DEFAULT_MIN_SCALE, { alias: 'czTextFitMinScale', transform: numberAttribute });
  readonly maxScale = input(DEFAULT_MAX_SCALE, { alias: 'czTextFitMaxScale', transform: numberAttribute });
  readonly step = input(DEFAULT_STEP, { alias: 'czTextFitStep', transform: numberAttribute });
  readonly disabled = input(false, { alias: 'czTextFitDisabled', transform: booleanAttribute });
  readonly shrunk = signal(false);
  readonly overflowing = signal(false);

  ngAfterViewInit(): void {
    if (!this.isBrowser) {
      return;
    }

    this.zone.runOutsideAngular(() => {
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.scheduleFit());
        this.resizeObserver.observe(this.elementRef.nativeElement);
      }

      if (typeof MutationObserver !== 'undefined') {
        this.mutationObserver = new MutationObserver(() => this.scheduleFit());
        this.mutationObserver.observe(this.elementRef.nativeElement, {
          characterData: true,
          childList: true,
          subtree: true,
        });
      }

      this.scheduleFit();
    });

    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.mutationObserver?.disconnect();
      if (this.animationFrame !== null) {
        cancelAnimationFrame(this.animationFrame);
      }
    });
  }

  private scheduleFit(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
    }

    this.animationFrame = requestAnimationFrame(() => {
      this.animationFrame = null;
      this.fit();
    });
  }

  private fit(): void {
    const element = this.elementRef.nativeElement;
    const maxScale = this.clampScale(this.maxScale(), DEFAULT_MAX_SCALE);

    if (this.disabled() || this.shouldSkipAutoFit(element)) {
      this.applyScale(element, maxScale, false);
      return;
    }

    const minScale = Math.min(this.clampScale(this.minScale(), DEFAULT_MIN_SCALE), maxScale);
    const step = Math.max(0.01, Math.min(0.25, Math.abs(this.step() || DEFAULT_STEP)));
    let scale = maxScale;

    this.applyScale(element, scale, false);

    while (scale > minScale && this.hasOverflow(element)) {
      scale = Math.max(minScale, Number((scale - step).toFixed(3)));
      this.applyScale(element, scale, false);
    }

    this.applyScale(element, scale, this.hasOverflow(element));
  }

  private hasOverflow(element: HTMLElement): boolean {
    if (element.scrollWidth > element.clientWidth + OVERFLOW_TOLERANCE_PX) {
      return true;
    }

    const whiteSpace = getComputedStyle(element).whiteSpace;
    const canWrap = whiteSpace !== 'nowrap' && whiteSpace !== 'pre';

    return canWrap && element.scrollHeight > element.clientHeight + OVERFLOW_TOLERANCE_PX;
  }

  private shouldSkipAutoFit(element: HTMLElement): boolean {
    return element.classList.contains('cz-button--icon');
  }

  private applyScale(element: HTMLElement, scale: number, overflowing: boolean): void {
    element.style.setProperty('--cz-text-fit-scale', String(scale));
    const shrunk = scale < this.clampScale(this.maxScale(), DEFAULT_MAX_SCALE);
    element.classList.toggle('cz-text-fit--shrunk', shrunk);
    element.classList.toggle('cz-text-fit--overflowing', overflowing);
    this.shrunk.set(shrunk);
    this.overflowing.set(overflowing);
  }

  private clampScale(value: number, fallback: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      return fallback;
    }

    return Math.max(0.5, Math.min(1.25, value));
  }
}
