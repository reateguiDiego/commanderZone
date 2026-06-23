import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PremiumBadgeComponent } from './premium-badge.component';

@Component({
  imports: [PremiumBadgeComponent],
  template: '<app-premium-badge label="Elite" />',
})
class PremiumBadgeHostComponent {}

describe('PremiumBadgeComponent', () => {
  it('renders the provided badge label', () => {
    const fixture = TestBed.createComponent(PremiumBadgeHostComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Elite');
  });
});
