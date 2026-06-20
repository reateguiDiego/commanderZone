import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoyaltyCounterComponent } from './loyalty-counter.component';

describe('LoyaltyCounterComponent', () => {
  it('emits loyalty changes from primary and secondary pointer clicks', async () => {
    const { fixture, valueChanged } = await renderLoyaltyCounter();
    const counter = fixture.nativeElement.querySelector('.loyalty-counter') as HTMLElement;

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
    const { fixture, valueChanged } = await renderLoyaltyCounter();
    const counter = fixture.nativeElement.querySelector('.loyalty-counter') as HTMLElement;

    counter.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    counter.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }));

    expect(valueChanged).not.toHaveBeenCalled();
  });

  it('swallows pointer and mouse events to avoid propagation', async () => {
    const { fixture } = await renderLoyaltyCounter();
    const counter = fixture.nativeElement.querySelector('.loyalty-counter') as HTMLElement;

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

async function renderLoyaltyCounter(): Promise<{
  fixture: ComponentFixture<LoyaltyCounterComponent>;
  valueChanged: ReturnType<typeof vi.fn>;
}> {
  await TestBed.configureTestingModule({
    imports: [LoyaltyCounterComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(LoyaltyCounterComponent);
  fixture.componentRef.setInput('value', 3);
  const valueChanged = vi.fn();
  fixture.componentInstance.loyaltyChanged.subscribe(valueChanged);
  fixture.detectChanges();

  return { fixture, valueChanged };
}
