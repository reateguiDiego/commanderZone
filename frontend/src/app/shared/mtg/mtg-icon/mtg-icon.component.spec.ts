import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MTGIconComponent } from './mtg-icon.component';

@Component({
  imports: [MTGIconComponent],
  template: '<i class="custom-icon" [appMtgIcon]="icon" mtgIconKind="mechanic"></i>',
})
class MTGIconHostComponent {
  icon = 'ability-role-royal';
}

describe('MTGIconComponent', () => {
  it('adds Mana classes without removing existing visual classes', () => {
    const fixture = TestBed.createComponent(MTGIconHostComponent);
    fixture.detectChanges();

    const icon = iconElement(fixture);

    expect(icon.classList).toContain('custom-icon');
    expect(icon.classList).toContain('ms');
    expect(icon.classList).toContain('ms-mechanic');
    expect(icon.classList).toContain('ms-ability-role-royal');
  });

  it('accepts already-prefixed Mana icon classes', () => {
    const fixture = TestBed.createComponent(MTGIconHostComponent);
    fixture.componentInstance.icon = 'planeswalker';
    fixture.detectChanges();

    const icon = iconElement(fixture);

    expect(icon.classList).toContain('ms-planeswalker');
  });
});

function iconElement(fixture: ComponentFixture<MTGIconHostComponent>): HTMLElement {
  return fixture.nativeElement.querySelector('.custom-icon');
}
