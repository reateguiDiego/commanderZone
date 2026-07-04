import { AfterViewInit, Directive, ElementRef, OnDestroy, inject } from '@angular/core';

@Directive({
  selector: 'input[appFriendSearchAutofocus]',
})
export class FriendSearchAutofocusDirective implements AfterViewInit, OnDestroy {
  private readonly elementRef = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private focusHandle?: ReturnType<typeof setTimeout>;

  ngAfterViewInit(): void {
    this.focusHandle = setTimeout(() => {
      this.focusHandle = undefined;
      this.elementRef.nativeElement.focus({ preventScroll: true });
    }, 0);
  }

  ngOnDestroy(): void {
    if (this.focusHandle === undefined) {
      return;
    }

    clearTimeout(this.focusHandle);
    this.focusHandle = undefined;
  }
}
