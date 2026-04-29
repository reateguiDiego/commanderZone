import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ManaTextComponent } from './mana-text.component';

@Component({
  imports: [ManaTextComponent],
  template: '<app-mana-text text="Add {G}. Draw a card." />',
})
class TextHostComponent {}

describe('ManaTextComponent', () => {
  it('preserves text while rendering inline symbols', () => {
    const fixture: ComponentFixture<TextHostComponent> = TestBed.createComponent(TextHostComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Add');
    expect(fixture.nativeElement.textContent).toContain('Draw a card.');
    expect(fixture.nativeElement.querySelector('.ms-g')).not.toBeNull();
  });
});
