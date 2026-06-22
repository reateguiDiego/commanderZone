import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ManaIconComponent } from './mana-icon.component';

@Component({
  imports: [ManaIconComponent],
  template: '<i class="custom-icon" [appManaIcon]="icon" manaIconKind="mechanic"></i>',
})
class ManaIconHostComponent {
  icon = 'ability-role-royal';
}

describe('ManaIconComponent', () => {
  it('adds Mana classes without removing existing visual classes', () => {
    const fixture = TestBed.createComponent(ManaIconHostComponent);
    fixture.detectChanges();

    const icon = iconElement(fixture);

    expect(icon.classList).toContain('custom-icon');
    expect(icon.classList).toContain('ms');
    expect(icon.classList).toContain('ms-mechanic');
    expect(icon.classList).toContain('ms-ability-role-royal');
  });

  it('accepts already-prefixed Mana icon classes', () => {
    const fixture = TestBed.createComponent(ManaIconHostComponent);
    fixture.componentInstance.icon = 'planeswalker';
    fixture.detectChanges();

    const icon = iconElement(fixture);

    expect(icon.classList).toContain('ms-planeswalker');
  });
});

function iconElement(fixture: ComponentFixture<ManaIconHostComponent>): HTMLElement {
  return fixture.nativeElement.querySelector('.custom-icon');
}
