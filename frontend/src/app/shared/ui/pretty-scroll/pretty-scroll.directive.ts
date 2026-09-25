import { Directive, ElementRef, HostListener, OnDestroy, inject } from '@angular/core';

const SCROLLING_CLASS = 'is-scrolling';
const SCROLL_END_DELAY_MS = 700;

@Directive({
  selector: '[appPrettyScroll]',
  host: {
    class: 'app-pretty-scroll',
  },
})
export class PrettyScrollDirective implements OnDestroy {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private scrollEndTimer: ReturnType<typeof setTimeout> | null = null;

  @HostListener('scroll')
  handleScroll(): void {
    const element = this.elementRef.nativeElement;

    element.classList.add(SCROLLING_CLASS);
    if (this.scrollEndTimer !== null) {
      clearTimeout(this.scrollEndTimer);
    }

    this.scrollEndTimer = setTimeout(() => {
      element.classList.remove(SCROLLING_CLASS);
      this.scrollEndTimer = null;
    }, SCROLL_END_DELAY_MS);
  }

  ngOnDestroy(): void {
    if (this.scrollEndTimer !== null) {
      clearTimeout(this.scrollEndTimer);
    }
  }
}
