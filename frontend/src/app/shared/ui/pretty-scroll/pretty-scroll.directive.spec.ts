import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PrettyScrollDirective } from './pretty-scroll.directive';

@Component({
  imports: [PrettyScrollDirective],
  template: '<div appPrettyScroll></div>',
})
class PrettyScrollHostComponent {}

describe('PrettyScrollDirective', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the scrollbar while scrolling and hides it after scrolling stops', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(PrettyScrollHostComponent);
    fixture.detectChanges();
    const scrollContainer = fixture.nativeElement.querySelector('div') as HTMLDivElement;

    scrollContainer.dispatchEvent(new Event('scroll'));
    expect(scrollContainer.classList).toContain('is-scrolling');

    vi.advanceTimersByTime(700);
    expect(scrollContainer.classList).not.toContain('is-scrolling');
  });
});
