import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoindexFooterDisclaimerComponent } from './noindex-footer-disclaimer.component';

describe('NoindexFooterDisclaimerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoindexFooterDisclaimerComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('renders the long legal disclaimer used by app noindex pages', () => {
    const fixture = TestBed.createComponent(NoindexFooterDisclaimerComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.app-noindex-disclaimer')).not.toBeNull();
    expect(compiled.querySelector('h2')?.textContent?.trim()).toBe('Disclaimer');
    expect(compiled.textContent).toContain('CommanderZone is unofficial Fan Content permitted under the Fan Content Policy.');
    expect(compiled.textContent).toContain('Magic: The Gathering®');
    expect(compiled.textContent).toContain('This site does not sell products, host tournaments, or offer any ranked or competitive services.');
    expect(compiled.textContent).toContain(`© 1993-${new Date().getFullYear()} Wizards of the Coast LLC`);
    expect(compiled.querySelector('a[href="https://company.wizards.com"]')).not.toBeNull();
    expect(compiled.querySelector('a[href="/contact"]')?.textContent?.trim()).toBe('Contact us');
    expect(compiled.querySelector('.app-noindex-disclaimer-link-button[data-cz-cookie-preferences]')).not.toBeNull();
  });
});
