import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, Minus, Plus, TriangleAlert } from 'lucide-angular';
import { ManaActionDialogComponent } from './mana-action-dialog.component';
import { ManaPoolColor, ManaSourceSuggestion } from '../../utils/mana-source-detector';

describe('ManaActionDialogComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ManaActionDialogComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Minus, Plus, TriangleAlert })),
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

  it('emits selected color and amount for variable mana', () => {
    const fixture = createFixture({
      kind: 'variable',
      cardName: "Gaea's Cradle",
      summary: 'Variable mana amount.',
      additions: [],
      colors: ['G'],
      amount: 1,
      restriction: null,
      manualOnly: false,
    }, 'G', 1);
    const changes: Array<{ color?: string; amount?: number }> = [];
    fixture.componentInstance.valueChanged.subscribe((change) => changes.push(change));

    const amountInput = (fixture.nativeElement as HTMLElement).querySelector('input') as HTMLInputElement;
    amountInput.value = '4';
    amountInput.dispatchEvent(new Event('input'));

    expect(changes).toContainEqual({ amount: 4 });
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
});

function createFixture(
  suggestion: ManaSourceSuggestion,
  selectedColor: ManaPoolColor | null = null,
  amount = 1,
): ComponentFixture<ManaActionDialogComponent> {
  const fixture = TestBed.createComponent(ManaActionDialogComponent);
  fixture.componentRef.setInput('suggestion', suggestion);
  fixture.componentRef.setInput('selectedColor', selectedColor);
  fixture.componentRef.setInput('amount', amount);
  fixture.detectChanges();

  return fixture;
}

function primaryButton(fixture: ComponentFixture<ManaActionDialogComponent>): HTMLButtonElement {
  return (fixture.nativeElement as HTMLElement).querySelector('.primary-button') as HTMLButtonElement;
}
