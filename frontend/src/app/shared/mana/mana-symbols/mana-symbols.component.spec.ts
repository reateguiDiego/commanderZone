import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ManaSymbolsComponent } from './mana-symbols.component';

@Component({
  imports: [ManaSymbolsComponent],
  template: '<app-mana-symbols value="{2}{W}" />',
})
class SymbolsHostComponent {}

describe('ManaSymbolsComponent', () => {
  it('renders mana cost classes', () => {
    const fixture: ComponentFixture<SymbolsHostComponent> = TestBed.createComponent(SymbolsHostComponent);
    fixture.detectChanges();

    const symbols = fixture.nativeElement.querySelectorAll('.ms');

    expect(symbols.length).toBe(2);
    expect(symbols[0].classList).toContain('ms-2');
    expect(symbols[1].classList).toContain('ms-w');
  });
});
