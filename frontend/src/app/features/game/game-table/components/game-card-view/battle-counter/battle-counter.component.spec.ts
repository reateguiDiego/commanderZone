import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BattleCounterComponent } from './battle-counter.component';

describe('BattleCounterComponent', () => {
  it('emits battle changes from primary and secondary pointer clicks', async () => {
    const { fixture, valueChanged } = await renderBattleCounter();
    const counter = fixture.nativeElement.querySelector('.battle-counter') as HTMLElement;

    counter.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    counter.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 2 }));

    expect(valueChanged).toHaveBeenNthCalledWith(1, {
      event: expect.any(Event),
      delta: 1,
    });
    expect(valueChanged).toHaveBeenNthCalledWith(2, {
      event: expect.any(Event),
      delta: -1,
    });
  });

  it('does not emit pointer-click changes from click or contextmenu fallbacks', async () => {
    const { fixture, valueChanged } = await renderBattleCounter();
    const counter = fixture.nativeElement.querySelector('.battle-counter') as HTMLElement;

    counter.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    counter.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }));

    expect(valueChanged).not.toHaveBeenCalled();
  });

  it('renders the defense shield and value', async () => {
    const { fixture } = await renderBattleCounter();
    expect(fixture.nativeElement.querySelector('.battle-counter-icon')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.battle-counter-value')?.textContent?.trim()).toBe('3');
  });

  it('moves to the rotated battle corner when requested', async () => {
    const { fixture } = await renderBattleCounter();
    fixture.componentRef.setInput('rotatedPlacement', true);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).classList).toContain('battle-counter-rotated-placement');
  });

  it('shows a short press feedback pulse during the pointer interaction', async () => {
    const { fixture } = await renderBattleCounter();
    const counter = fixture.nativeElement.querySelector('.battle-counter') as HTMLElement;

    vi.useFakeTimers();
    try {
      counter.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      fixture.detectChanges();
      expect(counter.classList).toContain('stat-pulse-increase');

      counter.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
      fixture.detectChanges();
      expect(counter.classList).toContain('stat-pulse-increase');

      await vi.advanceTimersByTimeAsync(420);
      fixture.detectChanges();
      expect(counter.classList).not.toContain('stat-pulse-increase');
    } finally {
      vi.useRealTimers();
    }
  });

  it('swallows pointer and mouse events to avoid propagation', async () => {
    const { fixture } = await renderBattleCounter();
    const counter = fixture.nativeElement.querySelector('.battle-counter') as HTMLElement;

    const click = new MouseEvent('click', { bubbles: true, button: 0 });
    const clickPrevent = vi.spyOn(click, 'preventDefault');
    const clickStop = vi.spyOn(click, 'stopPropagation');
    counter.dispatchEvent(click);

    const contextmenu = new MouseEvent('contextmenu', { bubbles: true, button: 2 });
    const contextmenuPrevent = vi.spyOn(contextmenu, 'preventDefault');
    const contextmenuStop = vi.spyOn(contextmenu, 'stopPropagation');
    counter.dispatchEvent(contextmenu);

    const pointerDown = new PointerEvent('pointerdown', { bubbles: true, button: 2 });
    const pointerDownPrevent = vi.spyOn(pointerDown, 'preventDefault');
    const pointerDownStop = vi.spyOn(pointerDown, 'stopPropagation');
    counter.dispatchEvent(pointerDown);

    const pointerUp = new PointerEvent('pointerup', { bubbles: true, button: 0 });
    const pointerUpPrevent = vi.spyOn(pointerUp, 'preventDefault');
    const pointerUpStop = vi.spyOn(pointerUp, 'stopPropagation');
    counter.dispatchEvent(pointerUp);

    expect(clickPrevent).toHaveBeenCalled();
    expect(clickStop).toHaveBeenCalled();
    expect(contextmenuPrevent).toHaveBeenCalled();
    expect(contextmenuStop).toHaveBeenCalled();
    expect(pointerDownPrevent).toHaveBeenCalled();
    expect(pointerDownStop).toHaveBeenCalled();
    expect(pointerUpPrevent).toHaveBeenCalled();
    expect(pointerUpStop).toHaveBeenCalled();
  });
});

async function renderBattleCounter(): Promise<{
  fixture: ComponentFixture<BattleCounterComponent>;
  valueChanged: ReturnType<typeof vi.fn>;
}> {
  await TestBed.configureTestingModule({
    imports: [BattleCounterComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(BattleCounterComponent);
  fixture.componentRef.setInput('value', 3);
  const valueChanged = vi.fn();
  fixture.componentInstance.battleChanged.subscribe(valueChanged);
  fixture.detectChanges();

  return { fixture, valueChanged };
}
