import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { LegalLinksService } from '../../legal/legal-links.service';
import { getPublicChromeCopy } from '../../localization/public-chrome-copy';
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
      providers: [
        { provide: ANALYTICS_SERVICE, useValue: analytics },
        {
          provide: LegalLinksService,
          useValue: {
            chromeCopy: signal(getPublicChromeCopy('es')),
            links: signal([
              { pageKey: 'privacy', label: 'Privacidad', href: '/es/politica-privacidad/' },
              { pageKey: 'cookies', label: 'Cookies', href: '/es/politica-cookies/' },
              { pageKey: 'terms', label: 'Términos', href: '/es/terminos/' },
            ]),
          },
        },
      ],
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
    expect(element.querySelector('.cookie-banner')?.getAttribute('role')).toBe('region');
    expect(element.querySelector('.cookie-banner__title')?.textContent?.trim()).toBe('Preferencias de cookies');
    expect(buttons).toEqual(['Configurar', 'Rechazar', 'Aceptar']);
    expect(links).toEqual(['/es/politica-privacidad/', '/es/politica-cookies/']);
    expect(Array.from(element.querySelectorAll('a')).map((link) => link.textContent?.trim())).toEqual(['política de privacidad', 'política de cookies']);
    expect(element.textContent).not.toContain('Cookie preferences');
    expect(element.textContent).not.toContain('privacy policy');
    expect(element.querySelector('button.primary-button')?.textContent?.trim()).toBe('Aceptar');
    expect(element.querySelectorAll('button.secondary-button')).toHaveLength(2);
  });

  it('can reject cookies without enabling analytics', () => {
    const element = fixture.nativeElement as HTMLElement;
    const rejectButton = Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Rechazar');

    rejectButton?.click();
    fixture.detectChanges();

    expect(element.querySelector('.cookie-banner')).toBeNull();
    expect(analytics.consentUpdates).toEqual(['denied']);
  });

  it('can accept cookies and prepare analytics consent for a future provider', () => {
    const element = fixture.nativeElement as HTMLElement;
    const acceptButton = Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Aceptar');

    acceptButton?.click();
    fixture.detectChanges();

    expect(element.querySelector('.cookie-banner')).toBeNull();
    expect(analytics.consentUpdates).toEqual(['granted']);
  });

  it('shows configurable analytics preferences without saving until requested', () => {
    const element = fixture.nativeElement as HTMLElement;
    const configureButton = Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Configurar');

    configureButton?.click();
    fixture.detectChanges();

    expect(element.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
    expect(element.querySelector('[role="switch"]')?.textContent?.trim()).toBe('Cookies de analítica');
    expect(Array.from(element.querySelectorAll('.cookie-banner__actions button')).map((button) => button.textContent?.trim()))
      .toEqual(['Guardar', 'Rechazar', 'Aceptar']);
    expect(analytics.consentUpdates).toEqual([]);
  });
});
