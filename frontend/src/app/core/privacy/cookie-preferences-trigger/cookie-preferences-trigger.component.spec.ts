import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CookieConsentService } from '../cookie-consent.service';
import { CookiePreferencesTriggerComponent } from './cookie-preferences-trigger.component';

describe('CookiePreferencesTriggerComponent', () => {
  let fixture: ComponentFixture<CookiePreferencesTriggerComponent>;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [CookiePreferencesTriggerComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CookiePreferencesTriggerComponent);
    fixture.componentRef.setInput('label', 'Cookie preferences');
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('opens the shared cookie consent banner from the button trigger', () => {
    const consent = TestBed.inject(CookieConsentService);
    const button = fixture.nativeElement.querySelector('button[data-cz-cookie-preferences]') as HTMLButtonElement | null;

    button?.click();
    fixture.detectChanges();

    expect(consent.preferencesPanelOpen()).toBe(true);
  });

  it('can render a link trigger for static public footers', () => {
    fixture.componentRef.setInput('element', 'link');
    fixture.componentRef.setInput('variant', 'seo-footer');
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('a[data-cz-cookie-preferences]') as HTMLAnchorElement | null;

    expect(link?.getAttribute('href')).toBe('#cookie-preferences');
    expect(link?.textContent?.trim()).toBe('Cookie preferences');
    expect(link?.classList.contains('cookie-preferences-trigger--seo-footer')).toBe(true);
  });
});
