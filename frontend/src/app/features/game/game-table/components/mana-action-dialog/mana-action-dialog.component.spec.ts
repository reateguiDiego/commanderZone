import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChevronDown, ChevronUp, LucideAngularModule, TriangleAlert } from 'lucide-angular';
import { ManaActionDialogComponent } from './mana-action-dialog.component';
import { ManaPoolColor, ManaSourceSuggestion } from '../../utils/mana-source-detector';

describe('ManaActionDialogComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ManaActionDialogComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronUp, TriangleAlert })),
      ],
    }).compileComponents();
  });

  it('confirms fixed mana additions', () => {
    const fixture = createFixture({
      kind: 'fixed',
      cardName: 'Sol Ring',
      summary: 'Add {C}{C}.',
      additions: [{ color: 'C', amount: 2 }],
      colors: ['C'],
      amount: 0,
      restriction: null,
      manualOnly: false,
    });
    let confirmed = 0;
    fixture.componentInstance.confirmed.subscribe(() => ++confirmed);

    primaryButton(fixture).click();

    expect(confirmed).toBe(1);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Sol Ring');
  });

  it('uses the card name as the modal title without assistant labels', () => {
    const fixture = createFixture({
      kind: 'variable',
      cardName: 'Priest of Titania',
      summary: 'Variable mana amount.',
      additions: [],
      colors: ['G'],
      amount: 1,
      restriction: null,
      manualOnly: false,
    }, 'G', 1);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h2')?.textContent?.trim()).toBe('Priest of Titania');
    expect(element.textContent).not.toContain('Mana Assistant');
    expect(element.textContent).not.toContain('Mana source');
  });

  it('renders mana codes in the summary as mana symbols', () => {
    const fixture = createFixture({
      kind: 'fixed',
      cardName: 'Forest',
      summary: 'Add {G}.',
      additions: [{ color: 'G', amount: 1 }],
      colors: ['G'],
      amount: 0,
      restriction: null,
      manualOnly: false,
    });
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.mana-summary app-mana-symbols')).not.toBeNull();
    expect(element.querySelector('.mana-summary')?.textContent).not.toContain('{G}');
    expect(element.querySelector('.mana-summary')?.textContent?.trim()).toBe('Add');
  });

  it('hides the mana selection panel for a single fixed mana', () => {
    const fixture = createFixture({
      kind: 'fixed',
      cardName: 'Forest',
      summary: 'Add {G}.',
      additions: [{ color: 'G', amount: 1 }],
      colors: ['G'],
      amount: 0,
      restriction: null,
      manualOnly: false,
    });

    expect(fixture.nativeElement.querySelector('.mana-selection-panel')).toBeNull();
  });

  it('uses the selection panel when mana needs quantity or fixed preview', () => {
    const fixedFixture = createFixture({
      kind: 'fixed',
      cardName: 'Sol Ring',
      summary: 'Add {C}{C}.',
      additions: [{ color: 'C', amount: 2 }],
      colors: ['C'],
      amount: 0,
      restriction: null,
      manualOnly: false,
    });
    const variableFixture = createFixture({
      kind: 'variable',
      cardName: 'Priest of Titania',
      summary: 'Variable mana amount.',
      additions: [],
      colors: ['G'],
      amount: 1,
      restriction: null,
      manualOnly: false,
    }, 'G', 1);

    expect(fixedFixture.nativeElement.querySelector('.mana-selection-panel')).not.toBeNull();
    expect(variableFixture.nativeElement.querySelector('.mana-selection-panel')).not.toBeNull();
    expect(fixedFixture.nativeElement.querySelector('app-game-x-quantity-stepper')).toBeNull();
    expect(variableFixture.nativeElement.querySelector('app-game-x-quantity-stepper')).not.toBeNull();
  });

  it('hides the color selector when only one mana color is possible', () => {
    const fixture = createFixture({
      kind: 'variable',
      cardName: 'Elvish Archdruid',
      summary: 'Variable mana amount. Choose the color and quantity after checking the board state.',
      additions: [],
      colors: ['G'],
      amount: 1,
      restriction: null,
      manualOnly: false,
    }, 'G', 1);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.mana-summary')?.textContent?.trim()).toBe('Add');
    expect(element.querySelector('.mana-summary app-mana-symbols')).not.toBeNull();
    expect(element.querySelector('.mana-choice-grid')).toBeNull();
    expect(element.querySelector('app-game-x-quantity-stepper')).not.toBeNull();
    expect(primaryButton(fixture).disabled).toBe(false);
  });

  it('renders a color selector when a suggestion carries multiple colors', () => {
    const fixture = createFixture({
      kind: 'variable',
      cardName: 'Manual Source',
      summary: 'Variable mana amount.',
      additions: [],
      colors: ['U', 'G'],
      amount: 1,
      restriction: null,
      manualOnly: false,
    }, 'U', 1);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.mana-choice-grid')).not.toBeNull();
    expect(element.querySelectorAll('.mana-choice app-mana-symbols').length).toBe(2);
    expect(element.querySelector('.mana-choice.selected app-mana-symbols .ms-u')).not.toBeNull();
    expect(element.querySelector('app-game-x-quantity-stepper')).not.toBeNull();
  });

  it('keeps variable mana confirmation anchored to the provided selected color', () => {
    const fixture = createFixture({
      kind: 'variable',
      cardName: 'Manual Source',
      summary: 'Variable mana amount.',
      additions: [],
      colors: ['U', 'G'],
      amount: 1,
      restriction: null,
      manualOnly: false,
    }, 'U', 3);
    let additions: readonly { color: string; amount: number }[] = [];
    fixture.componentInstance.confirmed.subscribe((value) => {
      additions = value;
    });

    primaryButton(fixture).click();

    expect(additions).toEqual([{ color: 'U', amount: 3 }]);
  });

  it('lets the user choose between multiple tap mana abilities before confirming', () => {
    const fixture = createFixture({
      kind: 'variable',
      cardName: 'Delighted Halfling',
      summary: 'Choose a mana ability.',
      additions: [],
      colors: [],
      amount: 1,
      restriction: null,
      manualOnly: false,
      abilityOptions: [
        {
          id: 'tap-0',
          label: 'Add {C}',
          summary: 'Add {C}.',
          additions: [{ color: 'C', amount: 1 }],
          colors: ['C'],
          amount: 1,
          restriction: null,
        },
        {
          id: 'tap-1',
          label: 'Add one mana from {W}, {U}, {B}, {R}, {G}',
          summary: 'Choose one mana from {W}, {U}, {B}, {R}, {G}.',
          additions: [],
          colors: ['W', 'U', 'B', 'R', 'G'],
          amount: 1,
          restriction: 'Spend this mana only to cast a legendary spell.',
        },
      ],
    });
    let additions: readonly { color: string; amount: number }[] = [];
    const changes: Array<{ color?: string; amount?: number }> = [];
    fixture.componentInstance.confirmed.subscribe((value) => {
      additions = value;
    });
    fixture.componentInstance.valueChanged.subscribe((change) => changes.push(change));

    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('.mana-ability-choice').length).toBe(2);
    expect(element.querySelectorAll('.mana-ability-choice app-mana-symbols').length).toBe(6);
    expect(abilityChoiceText(element)).not.toMatch(/\{[WUBRGC]\}/);

    const secondAbility = element.querySelectorAll<HTMLButtonElement>('.mana-ability-choice')[1];
    secondAbility?.click();
    fixture.componentRef.setInput('selectedColor', 'G');
    fixture.detectChanges();

    primaryButton(fixture).click();

    expect(changes).toContainEqual({ color: 'W', amount: 1 });
    expect(additions).toEqual([{ color: 'G', amount: 1 }]);
  });

  it('emits selected color and amount for variable mana', () => {
    const fixture = createFixture({
      kind: 'variable',
      cardName: 'Command Tower',
      summary: 'Variable mana amount.',
      additions: [],
      colors: ['U', 'G'],
      amount: 1,
      restriction: null,
      manualOnly: false,
    }, 'U', 1);
    const changes: Array<{ color?: string; amount?: number }> = [];
    fixture.componentInstance.valueChanged.subscribe((change) => changes.push(change));

    const greenChoice = (fixture.nativeElement as HTMLElement).querySelector('.mana-choice app-mana-symbols .ms-g')?.closest('button') as HTMLButtonElement;
    greenChoice.click();

    const amountInput = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="mana-action-quantity-input"]') as HTMLInputElement;
    amountInput.value = '4';
    amountInput.dispatchEvent(new Event('input'));

    expect(changes).toContainEqual({ color: 'G' });
    expect(changes).toContainEqual({ amount: 4 });
  });

  it('renders production parts and confirms the merged mana package', () => {
    const fixture = createFixture({
      kind: 'variable',
      cardName: 'Command Tower',
      summary: 'Build mana from:',
      additions: [],
      colors: ['G'],
      amount: 1,
      restriction: null,
      manualOnly: false,
      productionParts: [
        {
          id: 'attachment-overgrowth',
          kind: 'fixed',
          label: 'Overgrowth',
          additions: [{ color: 'G', amount: 2 }],
        },
      ],
    });
    let additions: readonly { color: string; amount: number }[] = [];
    fixture.componentInstance.confirmed.subscribe((value) => {
      additions = value;
    });
    const element = fixture.nativeElement as HTMLElement;

    primaryButton(fixture).click();

    expect(element.querySelectorAll('.mana-production-part').length).toBe(1);
    expect(element.textContent).not.toContain('Build mana from');
    expect(additions).toEqual([
      { color: 'G', amount: 2 },
    ]);
  });

  it('caps variable mana amount to the supported pool range', () => {
    const fixture = createFixture({
      kind: 'variable',
      cardName: 'Priest of Titania',
      summary: 'Variable mana amount.',
      additions: [],
      colors: ['G'],
      amount: 1,
      restriction: null,
      manualOnly: false,
    }, 'G', 1);
    const changes: Array<{ color?: string; amount?: number }> = [];
    fixture.componentInstance.valueChanged.subscribe((change) => changes.push(change));

    const amountInput = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="mana-action-quantity-input"]') as HTMLInputElement;
    amountInput.value = '120';
    amountInput.dispatchEvent(new Event('input'));

    expect(changes).toContainEqual({ amount: 99 });
  });

  it('shows restrictions before confirming restricted mana', () => {
    const fixture = createFixture({
      kind: 'restricted',
      cardName: 'Delighted Halfling',
      summary: 'Add restricted mana.',
      additions: [],
      colors: ['G'],
      amount: 1,
      restriction: 'Spend this mana only to cast a legendary spell.',
      manualOnly: false,
    }, 'G');

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Spend this mana only');
    expect(primaryButton(fixture).disabled).toBe(false);
  });

  it('keeps the popover inside the left viewport edge', () => {
    setViewportSize(320, 240);
    const fixture = createFixture({
      kind: 'fixed',
      cardName: 'Exotic Orchard',
      summary: 'Add {U}.',
      additions: [{ color: 'U', amount: 1 }],
      colors: ['U'],
      amount: 0,
      restriction: null,
      manualOnly: false,
    }, null, 1, { x: 4, y: 24 });

    const popover = popoverElement(fixture);

    expect(popover.classList).toContain('mana-action-popover--below');
    expect(popover.style.left).toBe('12px');
    expect(popover.style.width).toBe('296px');
    expect(popover.style.top).toBe('32px');
    expect(popover.style.getPropertyValue('--mana-action-arrow-left')).toBe('14px');
  });

  it('places the popover above cards near the bottom viewport edge', () => {
    setViewportSize(360, 240);
    const fixture = createFixture({
      kind: 'variable',
      cardName: 'Priest of Titania',
      summary: 'Variable mana amount.',
      additions: [],
      colors: ['G'],
      amount: 1,
      restriction: null,
      manualOnly: false,
    }, 'G', 1, { x: 180, y: 228 });

    const popover = popoverElement(fixture);

    expect(popover.classList).toContain('mana-action-popover--above');
    expect(popover.style.bottom).toBe('20px');
    expect(popover.style.maxHeight).toBe('208px');
  });

  it('uses the lower side instead of forcing a tight upper scroll area', () => {
    setViewportSize(640, 700);
    const fixture = createFixture({
      kind: 'variable',
      cardName: 'Priest of Titania',
      summary: 'Variable mana amount.',
      additions: [],
      colors: ['G'],
      amount: 1,
      restriction: null,
      manualOnly: false,
    }, 'G', 1, { x: 320, y: 250 });

    const popover = popoverElement(fixture);

    expect(popover.classList).toContain('mana-action-popover--below');
    expect(popover.style.top).toBe('258px');
    expect(popover.style.maxHeight).toBe('430px');
  });
});

function createFixture(
  suggestion: ManaSourceSuggestion,
  selectedColor: ManaPoolColor | null = null,
  amount = 1,
  position: { x: number; y: number } | null = null,
): ComponentFixture<ManaActionDialogComponent> {
  const fixture = TestBed.createComponent(ManaActionDialogComponent);
  fixture.componentRef.setInput('suggestion', suggestion);
  fixture.componentRef.setInput('selectedColor', selectedColor);
  fixture.componentRef.setInput('amount', amount);
  fixture.componentRef.setInput('position', position);
  fixture.detectChanges();

  return fixture;
}

function primaryButton(fixture: ComponentFixture<ManaActionDialogComponent>): HTMLButtonElement {
  return (fixture.nativeElement as HTMLElement).querySelector('.primary-button') as HTMLButtonElement;
}

function popoverElement(fixture: ComponentFixture<ManaActionDialogComponent>): HTMLElement {
  return (fixture.nativeElement as HTMLElement).querySelector('.mana-action-popover') as HTMLElement;
}

function setViewportSize(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

function abilityChoiceText(element: HTMLElement): string {
  return Array
    .from(element.querySelectorAll('.mana-ability-choice'))
    .map((choice) => choice.textContent ?? '')
    .join(' ');
}
