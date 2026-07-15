import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, Minus, Plus, RotateCcw, X } from 'lucide-angular';
import { ManaPoolPanelComponent } from './mana-pool-panel.component';
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

  it('does not expose legacy off-identity mana even while its local amount is positive', () => {
    const fixture = createFixture(
      { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 },
      null,
      ['U'],
    );

    expect(colorButtonTitles(fixture)).not.toContain('White mana');
    expect(colorButtonTitles(fixture)).toContain('Blue mana');

    fixture.componentRef.setInput('pool', { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
    fixture.detectChanges();

    expect(colorButtonTitles(fixture)).not.toContain('White mana');
    expect(colorButtonTitles(fixture)).toContain('Blue mana');
    expect(colorButtonTitles(fixture)).toContain('Colorless mana');
  });

  it('does not add off-identity colors for pending effects', () => {
    const fixture = createFixture(
      { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      null,
      ['G'],
      ['U'],
    );

    expect(colorButtonTitles(fixture)).not.toContain('Blue mana');
    expect(colorButtonTitles(fixture)).toContain('Green mana');

    fixture.componentRef.setInput('pendingColors', []);
    fixture.detectChanges();

    expect(colorButtonTitles(fixture)).not.toContain('Blue mana');
    expect(colorButtonTitles(fixture)).toContain('Green mana');
  });

  it.each([
    { identity: ['W'], titles: ['White mana', 'Colorless mana'] },
    { identity: ['U', 'R'], titles: ['Blue mana', 'Red mana', 'Colorless mana'] },
    { identity: ['W', 'U', 'B', 'R', 'G'], titles: ['White mana', 'Blue mana', 'Black mana', 'Red mana', 'Green mana', 'Colorless mana'] },
    { identity: [], titles: ['Colorless mana'] },
    { identity: ['invalid'], titles: ['Colorless mana'] },
  ])('renders only canonical effective identity rows for $identity', ({ identity, titles }) => {
    const fixture = createFixture({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, null, identity);

    expect(colorButtonTitles(fixture)).toEqual(titles);
  });

  it.each(['normal', 'compact', 'aggressive', 'minimal'] as const)('stays vertical and present in %s', (responsiveState) => {
    const fixture = createFixture({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 100 }, null, ['W']);
    fixture.componentRef.setInput('responsiveState', responsiveState);
    fixture.detectChanges();

    const panel = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="mana-helper"]');
    expect(panel?.dataset['responsiveState']).toBe(responsiveState);
    expect(panel?.dataset['manaHelperOrientation']).toBe('vertical');
    expect(panel?.textContent).toContain('100');
  });

  it('announces current values and supports vertical arrow-key navigation', () => {
    const fixture = createFixture({ W: 9, U: 10, B: 0, R: 0, G: 0, C: 99 }, null, ['W', 'U']);
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('[data-mana-pool-color]'));

    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'White mana: 9',
      'Blue mana: 10',
      'Colorless mana: 99',
    ]);
    buttons[0]?.focus();
    buttons[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
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
  fixture.componentRef.setInput('colorIdentity', colorIdentity ?? ['W', 'U', 'B', 'R', 'G']);
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

  return Array.from(poolGrid?.querySelectorAll<HTMLButtonElement>('[data-mana-pool-color]') ?? []).map((button) => button.title);
}
