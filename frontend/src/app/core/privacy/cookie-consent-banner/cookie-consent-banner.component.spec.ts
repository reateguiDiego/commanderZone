import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ANALYTICS_SERVICE, AnalyticsService } from '../analytics.service';
import { CookieConsentBannerComponent } from './cookie-consent-banner.component';

class AnalyticsSpy implements AnalyticsService {
  readonly consentUpdates: string[] = [];

  updateConsent(consent: Parameters<AnalyticsService['updateConsent']>[0]): void {
    this.consentUpdates.push(consent.analyticsStorage);
  }

  trackPageView(): void {
    return;
  }

  trackEvent(): void {
    return;
  }
}

describe('CookieConsentBannerComponent', () => {
  let fixture: ComponentFixture<CookieConsentBannerComponent>;
  let analytics: AnalyticsSpy;

  beforeEach(async () => {
    localStorage.clear();
    analytics = new AnalyticsSpy();

    await TestBed.configureTestingModule({
      imports: [CookieConsentBannerComponent],
      providers: [{ provide: ANALYTICS_SERVICE, useValue: analytics }],
    }).compileComponents();

    fixture = TestBed.createComponent(CookieConsentBannerComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders lightweight consent actions and policy links', () => {
    const element = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(element.querySelectorAll('button')).map((button) => button.textContent?.trim());
    const links = Array.from(element.querySelectorAll('a')).map((link) => link.getAttribute('href'));

    expect(element.querySelector('.cookie-banner')).not.toBeNull();
    expect(buttons).toEqual(['Configure', 'Reject', 'Accept']);
    expect(links).toEqual(['/privacy-policy/', '/cookie-policy/']);
    expect(element.querySelector('button.primary-button')?.textContent?.trim()).toBe('Accept');
    expect(element.querySelectorAll('button.secondary-button')).toHaveLength(2);
  });

  it('can reject cookies without enabling analytics', () => {
    const element = fixture.nativeElement as HTMLElement;
    const rejectButton = Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Reject');

    rejectButton?.click();
    fixture.detectChanges();

    expect(element.querySelector('.cookie-banner')).toBeNull();
    expect(analytics.consentUpdates).toEqual(['denied']);
  });

  it('can accept cookies and prepare analytics consent for a future provider', () => {
    const element = fixture.nativeElement as HTMLElement;
    const acceptButton = Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Accept');

    acceptButton?.click();
    fixture.detectChanges();

    expect(element.querySelector('.cookie-banner')).toBeNull();
    expect(analytics.consentUpdates).toEqual(['granted']);
  });

  it('shows configurable analytics preferences without saving until requested', () => {
    const element = fixture.nativeElement as HTMLElement;
    const configureButton = Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Configure');

    configureButton?.click();
    fixture.detectChanges();

    expect(element.querySelector('[aria-pressed="false"]')?.textContent?.trim()).toBe('Analytics cookies');
    expect(Array.from(element.querySelectorAll('.cookie-banner__actions button')).map((button) => button.textContent?.trim()))
      .toEqual(['Save', 'Reject', 'Accept']);
    expect(analytics.consentUpdates).toEqual([]);
  });
});
