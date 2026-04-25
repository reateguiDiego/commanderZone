import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ManaSymbolsComponent } from './mana-symbols.component';
import { ManaTextComponent } from './mana-text.component';

@Component({
  imports: [ManaSymbolsComponent],
  template: '<app-mana-symbols value="{2}{W}" />',
})
class SymbolsHostComponent {}

@Component({
  imports: [ManaTextComponent],
  template: '<app-mana-text text="Add {G}. Draw a card." />',
})
class TextHostComponent {}

describe('mana components', () => {
  it('renders mana cost classes', () => {
    const fixture: ComponentFixture<SymbolsHostComponent> = TestBed.createComponent(SymbolsHostComponent);
    fixture.detectChanges();

    const symbols = fixture.nativeElement.querySelectorAll('.ms');

    expect(symbols.length).toBe(2);
    expect(symbols[0].classList).toContain('ms-2');
    expect(symbols[1].classList).toContain('ms-w');
  });

  it('preserves text while rendering inline symbols', () => {
    const fixture: ComponentFixture<TextHostComponent> = TestBed.createComponent(TextHostComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Add');
    expect(fixture.nativeElement.textContent).toContain('Draw a card.');
    expect(fixture.nativeElement.querySelector('.ms-g')).not.toBeNull();
  });
});
