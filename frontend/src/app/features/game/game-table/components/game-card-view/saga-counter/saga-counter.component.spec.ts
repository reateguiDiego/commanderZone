import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SagaCounterComponent } from './saga-counter.component';

describe('SagaCounterComponent', () => {
  it('emits saga changes from primary and secondary pointer clicks', async () => {
    const { fixture, valueChanged } = await renderSagaCounter();

    const counter = fixture.nativeElement.querySelector('.saga-counter') as HTMLElement;

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
    const { fixture, valueChanged } = await renderSagaCounter();

    const counter = fixture.nativeElement.querySelector('.saga-counter') as HTMLElement;

    counter.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    counter.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }));

    expect(valueChanged).not.toHaveBeenCalled();
  });

  it('renders a black hexagon with roman numerals', async () => {
    const { fixture } = await renderSagaCounter();

    expect(fixture.nativeElement.querySelector('.saga-counter-hexagon')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.saga-counter-value')?.textContent?.trim()).toBe('III');
  });

  it('clamps the displayed chapter between I and IX', async () => {
    const { fixture } = await renderSagaCounter();

    fixture.componentRef.setInput('value', -4);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.saga-counter-value')?.textContent?.trim()).toBe('I');

    fixture.componentRef.setInput('value', 0);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.saga-counter-value')?.textContent?.trim()).toBe('I');

    fixture.componentRef.setInput('value', 12);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.saga-counter-value')?.textContent?.trim()).toBe('IX');

    fixture.componentRef.setInput('value', 99);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.saga-counter-value')?.textContent?.trim()).toBe('IX');
  });

  it('shows a short press feedback pulse during the pointer interaction', async () => {
    const { fixture } = await renderSagaCounter();
    const counter = fixture.nativeElement.querySelector('.saga-counter') as HTMLElement;

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
    const { fixture } = await renderSagaCounter();
    const counter = fixture.nativeElement.querySelector('.saga-counter') as HTMLElement;

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

async function renderSagaCounter(): Promise<{
  fixture: ComponentFixture<SagaCounterComponent>;
  valueChanged: ReturnType<typeof vi.fn>;
}> {
  await TestBed.configureTestingModule({
    imports: [SagaCounterComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(SagaCounterComponent);
  fixture.componentRef.setInput('value', 3);
  const valueChanged = vi.fn();
  fixture.componentInstance.sagaChanged.subscribe(valueChanged);
  fixture.detectChanges();

  return {
    fixture,
    valueChanged,
  };
}
