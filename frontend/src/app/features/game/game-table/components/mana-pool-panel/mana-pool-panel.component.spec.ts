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
    const fixture = createFixture({ ANY: 0, W: 1, U: 0, B: 0, R: 0, G: 2, C: 3 });
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
    const fixture = createFixture({ ANY: 0, W: 1, U: 1, B: 1, R: 1, G: 1, C: 1 });
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));

    expect(buttons.some((button) => button.title === 'White mana')).toBe(true);
    expect(buttons.some((button) => button.title === 'Blue mana')).toBe(true);
    expect(buttons.some((button) => button.title === 'Black mana')).toBe(true);
    expect(buttons.some((button) => button.title === 'Red mana')).toBe(true);
    expect(buttons.some((button) => button.title === 'Green mana')).toBe(true);
    expect(buttons.some((button) => button.title === 'Colorless mana')).toBe(true);
  });

  it('renders mana symbols without colored cost backgrounds', () => {
    const fixture = createFixture({ ANY: 0, W: 1, U: 1, B: 1, R: 1, G: 1, C: 1 });
    const poolGrid = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.mana-pool-grid');
    const symbols = Array.from(poolGrid?.querySelectorAll('.ms') ?? []);

    expect(symbols.length).toBe(6);
    expect(symbols.every((symbol) => !symbol.classList.contains('ms-cost'))).toBe(true);
  });

  it('always shows any color and colorless, and filters colored mana by deck color identity', () => {
    const fixture = createFixture(
      { ANY: 1, W: 1, U: 2, B: 3, R: 4, G: 5, C: 6 },
      null,
      ['U', 'B'],
    );
    const element = fixture.nativeElement as HTMLElement;
    const poolGrid = element.querySelector<HTMLElement>('.mana-pool-grid');
    const buttons = Array.from(poolGrid?.querySelectorAll('button') ?? []);
    const symbols = Array.from(poolGrid?.querySelectorAll('.ms') ?? []);
    const buttonTitles = buttons.map((button) => button.title);

    expect(element.querySelector('.any-color-symbol')).not.toBeNull();
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

  it('renders an any color symbol group with all five colored mana symbols', () => {
    const fixture = createFixture({ ANY: 4, W: 1, U: 1, B: 1, R: 1, G: 1, C: 1 });
    const anyColorSymbol = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.any-color-symbol');
    const symbols = Array.from(anyColorSymbol?.querySelectorAll('.ms') ?? []);

    expect(anyColorSymbol?.title).toBe('Any color');
    expect(anyColorSymbol?.textContent).toContain('4');
    expect(symbols.length).toBe(5);
    expect(symbols.some((symbol) => symbol.classList.contains('ms-w'))).toBe(true);
    expect(symbols.some((symbol) => symbol.classList.contains('ms-u'))).toBe(true);
    expect(symbols.some((symbol) => symbol.classList.contains('ms-b'))).toBe(true);
    expect(symbols.some((symbol) => symbol.classList.contains('ms-r'))).toBe(true);
    expect(symbols.some((symbol) => symbol.classList.contains('ms-g'))).toBe(true);
    expect(symbols.every((symbol) => !symbol.classList.contains('ms-cost'))).toBe(true);
  });

  it('paints every mana symbol with the contrast color selected from the player background', () => {
    const fixture = createFixture({ ANY: 0, W: 1, U: 1, B: 1, R: 1, G: 1, C: 1 }, 'R_1');
    const panel = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.mana-pool-panel');

    expect(contrastManaColorForBackground('R_1')).toBe('U');
    expect(panel?.style.getPropertyValue('--mana-pool-symbol-color')).toBe('#00d9ff');
  });

  it('falls back to white mana for generic game backgrounds', () => {
    expect(contrastManaColorForBackground('back_5')).toBe('W');
    expect(contrastManaColorForBackground(null)).toBe('W');
  });

  it('opens reset from the panel context menu', () => {
    const fixture = createFixture({ ANY: 0, W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 });
    let resetAll = 0;
    fixture.componentInstance.poolReset.subscribe(() => ++resetAll);

    const panel = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.mana-pool-panel');
    panel?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    const resetButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Reset mana pool'));
    resetButton?.click();

    expect(resetAll).toBe(1);
  });

  it('emits any color manual changes', () => {
    const fixture = createFixture({ ANY: 1, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
    let added = 0;
    let removed = 0;
    fixture.componentInstance.anyAdded.subscribe(() => ++added);
    fixture.componentInstance.anyRemoved.subscribe(() => ++removed);

    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));

    buttons.find((button) => button.title === 'Add Any color')?.click();
    buttons.find((button) => button.title === 'Remove Any color' && !button.disabled)?.click();

    expect(added).toBe(1);
    expect(removed).toBe(1);
  });

  it('does not render remove controls for zero amounts and disables add controls at 99', () => {
    const fixture = createFixture({ ANY: 0, W: 99, U: 0, B: 0, R: 0, G: 0, C: 0 });
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));

    expect(buttons.some((button) => button.title === 'Remove Any color')).toBe(false);
    expect(buttons.some((button) => button.title === 'Remove Blue mana')).toBe(false);
    expect(buttons.find((button) => button.title === 'Add White mana')?.disabled).toBe(true);
  });

  it('activates touch controls from a symbol click and emits hide', () => {
    const fixture = createFixture({ ANY: 0, W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 });
    let hidden = 0;
    fixture.componentInstance.hidden.subscribe(() => ++hidden);

    const whiteButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.title === 'White mana');
    whiteButton?.click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.mana-pool-color.controls-active')).not.toBeNull();

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
): ComponentFixture<ManaPoolPanelComponent> {
  const fixture = TestBed.createComponent(ManaPoolPanelComponent);
  fixture.componentRef.setInput('pool', pool);
  fixture.componentRef.setInput('backgroundName', backgroundName);
  if (colorIdentity) {
    fixture.componentRef.setInput('colorIdentity', colorIdentity);
  }
  fixture.detectChanges();

  return fixture;
}
