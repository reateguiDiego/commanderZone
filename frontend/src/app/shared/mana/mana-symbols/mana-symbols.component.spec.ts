import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ManaSymbolsComponent } from './mana-symbols.component';

@Component({
  imports: [ManaSymbolsComponent],
  template: '<app-mana-symbols value="{2}{W}" size="small" />',
})
class SymbolsHostComponent {}

@Component({
  imports: [ManaSymbolsComponent],
  template: '<app-mana-symbols value="{W}" [costBackground]="false" />',
})
class PlainSymbolsHostComponent {}

describe('ManaSymbolsComponent', () => {
  it('renders mana cost classes', () => {
    const fixture: ComponentFixture<SymbolsHostComponent> = TestBed.createComponent(SymbolsHostComponent);
    fixture.detectChanges();

    const symbols = fixture.nativeElement.querySelectorAll('.ms');

    expect(symbols.length).toBe(2);
    expect(symbols[0].classList).toContain('ms-2');
    expect(symbols[1].classList).toContain('ms-w');
    expect(symbols[1].classList).toContain('ms-cost');
    expect(symbols[0].title).toBe('Two generic mana');
    expect(symbols[1].title).toBe('White mana');
    expect(fixture.nativeElement.querySelector('.mana-symbols')?.getAttribute('aria-label')).toBe(
      'Two generic mana White mana',
    );
    expect(fixture.nativeElement.querySelector('.mana-symbols')?.classList).toContain('size-small');
  });

  it('can render symbols without mana cost backgrounds', () => {
    const fixture: ComponentFixture<PlainSymbolsHostComponent> = TestBed.createComponent(PlainSymbolsHostComponent);
    fixture.detectChanges();

    const symbol = fixture.nativeElement.querySelector('.ms');

    expect(symbol.classList).toContain('ms-w');
    expect(symbol.classList).not.toContain('ms-cost');
  });
});
