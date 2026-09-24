import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { COUNTER_HOVER_INTENT_DELAY_MS, CounterHoverIntentDirective } from './counter-hover-intent.directive';

@Component({
  imports: [CounterHoverIntentDirective],
  template: `
    <section class="game-screen">
      <section class="table-surface">
        <section class="player-cell">
          <section class="battlefield">
            <button class="game-card">
              <span class="card-visual"><span appCounterHoverIntent>Counter</span></span>
            </button>
          </section>
        </section>
      </section>
    </section>
  `,
})
class HostComponent {}

describe('CounterHoverIntentDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let counter: HTMLElement;
  let card: HTMLElement;
  let visual: HTMLElement;
  let battlefield: HTMLElement;
  let playerCell: HTMLElement;
  let tableSurface: HTMLElement;
  let gameScreen: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    counter = fixture.nativeElement.querySelector('[appCounterHoverIntent]');
    card = fixture.nativeElement.querySelector('.game-card');
    visual = fixture.nativeElement.querySelector('.card-visual');
    battlefield = fixture.nativeElement.querySelector('.battlefield');
    playerCell = fixture.nativeElement.querySelector('.player-cell');
    tableSurface = fixture.nativeElement.querySelector('.table-surface');
    gameScreen = fixture.nativeElement.querySelector('.game-screen');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits before enlarging the counter and clears an aborted hover', () => {
    counter.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    vi.advanceTimersByTime(COUNTER_HOVER_INTENT_DELAY_MS - 1);

    expect(counter.classList).not.toContain('counter-hover-active');

    counter.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    vi.advanceTimersByTime(COUNTER_HOVER_INTENT_DELAY_MS);

    expect(counter.classList).not.toContain('counter-hover-active');
  });

  it('keeps the counter enlarged when the pointer returns during the leave grace period', () => {
    counter.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    vi.advanceTimersByTime(COUNTER_HOVER_INTENT_DELAY_MS);

    expect(counter.classList).toContain('counter-hover-active');
    expect(card.classList).toContain('counter-hover-parent-active');
    expect(visual.classList).toContain('counter-hover-visual-active');
    expect(battlefield.classList).toContain('counter-hover-bounds-active');
    expect(playerCell.classList).toContain('counter-hover-bounds-active');
    expect(tableSurface.classList).not.toContain('counter-hover-bounds-active');
    expect(gameScreen.classList).not.toContain('counter-hover-bounds-active');

    counter.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    vi.advanceTimersByTime(COUNTER_HOVER_INTENT_DELAY_MS - 1);
    counter.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    vi.advanceTimersByTime(COUNTER_HOVER_INTENT_DELAY_MS);

    expect(counter.classList).toContain('counter-hover-active');
  });
});
