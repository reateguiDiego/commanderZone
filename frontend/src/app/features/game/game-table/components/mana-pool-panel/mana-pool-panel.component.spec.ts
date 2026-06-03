import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, Minus, Plus, RotateCcw, X } from 'lucide-angular';
import { ManaPoolPanelComponent, contrastManaColorForBackground } from './mana-pool-panel.component';
import { ManaPool } from '../../state/mana/game-table-mana-pool.state';
import { ManaPoolColor } from '../../utils/mana-source-detector';

describe('ManaPoolPanelComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ManaPoolPanelComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Minus, Plus, RotateCcw, X })),
      ],
    }).compileComponents();
  });

  it('renders mana amounts and emits manual changes', () => {
    const fixture = createFixture({ W: 1, U: 0, B: 0, R: 0, G: 2, C: 3 });
    const added: ManaPoolColor[] = [];
    const removed: ManaPoolColor[] = [];
    fixture.componentInstance.colorAdded.subscribe((color) => added.push(color));
    fixture.componentInstance.colorRemoved.subscribe((color) => removed.push(color));

    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('1');
    expect(text).toContain('2');
    expect(text).toContain('3');
    expect(text).not.toContain('Mana');

    buttons.find((button) => button.title === 'Add White mana')?.click();
    buttons.find((button) => button.title === 'Remove White mana' && !button.disabled)?.click();

    expect(added).toEqual(['W']);
    expect(removed).toEqual(['W']);
  });

  it('uses English mana type names as color tooltips', () => {
    const fixture = createFixture({ W: 1, U: 1, B: 1, R: 1, G: 1, C: 1 });
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));

    expect(buttons.some((button) => button.title === 'White mana')).toBe(true);
    expect(buttons.some((button) => button.title === 'Blue mana')).toBe(true);
    expect(buttons.some((button) => button.title === 'Black mana')).toBe(true);
    expect(buttons.some((button) => button.title === 'Red mana')).toBe(true);
    expect(buttons.some((button) => button.title === 'Green mana')).toBe(true);
    expect(buttons.some((button) => button.title === 'Colorless mana')).toBe(true);
  });

  it('renders mana symbols without colored cost backgrounds', () => {
    const fixture = createFixture({ W: 1, U: 1, B: 1, R: 1, G: 1, C: 1 });
    const poolGrid = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.mana-pool-grid');
    const symbols = Array.from(poolGrid?.querySelectorAll('.ms') ?? []);

    expect(symbols.length).toBe(6);
    expect(symbols.every((symbol) => !symbol.classList.contains('ms-cost'))).toBe(true);
  });

  it('always shows colorless and uses deck color identity as the base colored mana set', () => {
    const fixture = createFixture(
      { W: 0, U: 2, B: 3, R: 0, G: 0, C: 6 },
      null,
      ['U', 'B'],
    );
    const element = fixture.nativeElement as HTMLElement;
    const poolGrid = element.querySelector<HTMLElement>('.mana-pool-grid');
    const buttons = Array.from(poolGrid?.querySelectorAll('button') ?? []);
    const symbols = Array.from(poolGrid?.querySelectorAll('.ms') ?? []);
    const buttonTitles = buttons.map((button) => button.title);

    expect(element.querySelector('.any-color-symbol')).toBeNull();
    expect(symbols.length).toBe(3);
    expect(symbols.some((symbol) => symbol.classList.contains('ms-u'))).toBe(true);
    expect(symbols.some((symbol) => symbol.classList.contains('ms-b'))).toBe(true);
    expect(symbols.some((symbol) => symbol.classList.contains('ms-c'))).toBe(true);
    expect(buttonTitles).toContain('Blue mana');
    expect(buttonTitles).toContain('Black mana');
    expect(buttonTitles).toContain('Colorless mana');
    expect(buttonTitles).not.toContain('White mana');
    expect(buttonTitles).not.toContain('Red mana');
    expect(buttonTitles).not.toContain('Green mana');
  });

  it('does not render any-color pool controls', () => {
    const fixture = createFixture({ W: 1, U: 1, B: 1, R: 1, G: 1, C: 1 });
    const element = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(element.querySelectorAll('button'));

    expect(element.querySelector('[data-mana-pool-color="ANY"]')).toBeNull();
    expect(buttons.some((button) => button.title.includes('Any color'))).toBe(false);
  });

  it('shows off-identity colored mana while its pool amount is positive and hides it again at zero', () => {
    const fixture = createFixture(
      { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 },
      null,
      ['U'],
    );

    expect(colorButtonTitles(fixture)).toContain('White mana');
    expect(colorButtonTitles(fixture)).toContain('Blue mana');

    fixture.componentRef.setInput('pool', { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
    fixture.detectChanges();

    expect(colorButtonTitles(fixture)).not.toContain('White mana');
    expect(colorButtonTitles(fixture)).toContain('Blue mana');
    expect(colorButtonTitles(fixture)).toContain('Colorless mana');
  });

  it('shows off-identity colored mana while it has a pending comet target', () => {
    const fixture = createFixture(
      { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      null,
      ['G'],
      ['U'],
    );

    expect(colorButtonTitles(fixture)).toContain('Blue mana');
    expect(colorButtonTitles(fixture)).toContain('Green mana');

    fixture.componentRef.setInput('pendingColors', []);
    fixture.detectChanges();

    expect(colorButtonTitles(fixture)).not.toContain('Blue mana');
    expect(colorButtonTitles(fixture)).toContain('Green mana');
  });

  it('paints every mana symbol with the contrast color selected from the player background', () => {
    const fixture = createFixture({ W: 1, U: 1, B: 1, R: 1, G: 1, C: 1 }, 'R_1');
    const panel = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.mana-pool-panel');

    expect(contrastManaColorForBackground('R_1')).toBe('U');
    expect(panel?.style.getPropertyValue('--mana-pool-symbol-color')).toBe('#00d9ff');
  });

  it('falls back to white mana for generic game backgrounds', () => {
    expect(contrastManaColorForBackground('back_5')).toBe('W');
    expect(contrastManaColorForBackground(null)).toBe('W');
  });

  it('emits a context menu request from the panel context menu', () => {
    const fixture = createFixture({ W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 });
    const opened = vi.fn();
    fixture.componentInstance.menuOpened.subscribe(opened);

    const panel = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.mana-pool-panel');
    panel?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(opened).toHaveBeenCalledOnce();
    expect((fixture.nativeElement as HTMLElement).querySelector('.mana-reset-menu')).toBeNull();
  });

  it('does not render remove controls for zero amounts and disables add controls at 99', () => {
    const fixture = createFixture({ W: 99, U: 0, B: 0, R: 0, G: 0, C: 0 });
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));

    expect(buttons.some((button) => button.title === 'Remove Blue mana')).toBe(false);
    expect(buttons.find((button) => button.title === 'Add White mana')?.disabled).toBe(true);
  });

  it('does not pin controls for mouse pointer activation', () => {
    const fixture = createFixture({ W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 });
    const whiteButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.title === 'White mana');

    dispatchPointerDown(whiteButton, 'mouse');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.mana-pool-color.controls-active')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.mana-pool-panel.controls-active')).toBeNull();
  });

  it('activates touch controls from a symbol pointer interaction and emits hide', () => {
    const fixture = createFixture({ W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 });
    let hidden = 0;
    fixture.componentInstance.hidden.subscribe(() => ++hidden);

    const whiteButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.title === 'White mana');
    dispatchPointerDown(whiteButton, 'touch');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.mana-pool-color.controls-active')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.mana-pool-panel.controls-active')).not.toBeNull();

    const hideButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.title === 'Hide mana pool');
    hideButton?.click();

    expect(hidden).toBe(1);
  });
});

function createFixture(
  pool: ManaPool,
  backgroundName: string | null = null,
  colorIdentity?: readonly string[],
  pendingColors: readonly ManaPoolColor[] = [],
): ComponentFixture<ManaPoolPanelComponent> {
  const fixture = TestBed.createComponent(ManaPoolPanelComponent);
  fixture.componentRef.setInput('pool', pool);
  fixture.componentRef.setInput('backgroundName', backgroundName);
  fixture.componentRef.setInput('pendingColors', pendingColors);
  if (colorIdentity) {
    fixture.componentRef.setInput('colorIdentity', colorIdentity);
  }
  fixture.detectChanges();

  return fixture;
}

function dispatchPointerDown(target: Element | undefined, pointerType: 'mouse' | 'touch' | 'pen'): void {
  if (!target) {
    return;
  }

  const supportsPointerEvent = typeof PointerEvent === 'function';
  const event = supportsPointerEvent
    ? new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType })
    : new MouseEvent('pointerdown', { bubbles: true, cancelable: true });

  if (!supportsPointerEvent && !('pointerType' in event)) {
    Object.defineProperty(event, 'pointerType', { value: pointerType });
  }

  target.dispatchEvent(event);
}

function colorButtonTitles(fixture: ComponentFixture<ManaPoolPanelComponent>): readonly string[] {
  const poolGrid = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.mana-pool-grid');

  return Array.from(poolGrid?.querySelectorAll('button') ?? []).map((button) => button.title);
}
