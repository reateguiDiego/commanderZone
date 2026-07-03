import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { LegalLinksService } from '../../legal/legal-links.service';
import { getPublicChromeCopy } from '../../localization/public-chrome-copy';
import { CookieConsentService } from '../cookie-consent.service';
import { CookieConsentBannerComponent } from './cookie-consent-banner.component';

describe('CookieConsentBannerComponent', () => {
  let fixture: ComponentFixture<CookieConsentBannerComponent>;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [CookieConsentBannerComponent],
      providers: [
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
    const buttons = visibleActionButtons(element).map((button) => button.textContent?.trim());
    const links = Array.from(element.querySelectorAll('a')).map((link) => link.getAttribute('href'));

    expect(element.querySelector('.cookie-banner')).not.toBeNull();
    expect(element.querySelector('.cookie-banner')?.getAttribute('role')).toBe('region');
    expect(element.querySelector('.cookie-banner__title')?.textContent?.trim()).toBe('Preferencias de cookies');
    expect(buttons).toEqual(['Solo esenciales', 'Personalizar', 'Aceptar todas']);
    expect(links).toEqual(['/es/politica-privacidad/', '/es/politica-cookies/']);
    expect(Array.from(element.querySelectorAll('a')).map((link) => link.textContent?.trim())).toEqual(['política de privacidad', 'política de cookies']);
    expect(element.textContent).not.toContain('Cookie preferences');
    expect(element.textContent).not.toContain('privacy policy');
    expect(element.textContent).toContain('cookies esenciales y preferencias funcionales');
    expect(element.textContent).not.toContain('Cookies de analítica');
    expect(element.textContent).not.toContain('Anuncios personalizados');
    expect(visibleActionButtons(element).filter((button) => button.classList.contains('primary-button')).at(-1)?.textContent?.trim()).toBe('Aceptar todas');
    expect(visibleActionButtons(element).filter((button) => button.classList.contains('secondary-button'))).toHaveLength(2);
  });

  it('can keep only essential cookies without granting optional consent', () => {
    const consent = TestBed.inject(CookieConsentService);
    const element = fixture.nativeElement as HTMLElement;
    const rejectButton = Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Solo esenciales');

    rejectButton?.click();
    fixture.detectChanges();

    expect(element.querySelector('.cookie-banner')).toBeNull();
    expect(consent.state().decision).toBe('rejected');
    expect(consent.canUsePreferences()).toBe(false);
    expect(consent.canUseAds()).toBe(true);
    expect(consent.canUsePersonalizedAds()).toBe(false);
    expect(consent.googleConsentModeState()).toEqual({
      adPersonalization: 'denied',
      adStorage: 'denied',
      adUserData: 'denied',
      analyticsStorage: 'denied',
    });
  });

  it('can accept internal cookie preferences without granting ad or analytics consent', () => {
    const consent = TestBed.inject(CookieConsentService);
    const element = fixture.nativeElement as HTMLElement;
    const acceptButton = Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Aceptar todas');

    acceptButton?.click();
    fixture.detectChanges();

    expect(element.querySelector('.cookie-banner')).toBeNull();
    expect(consent.state().decision).toBe('accepted');
    expect(consent.canUsePreferences()).toBe(true);
    expect(consent.canUseAds()).toBe(true);
    expect(consent.canUsePersonalizedAds()).toBe(false);
    expect(consent.googleConsentModeState().adStorage).toBe('denied');
    expect(consent.googleConsentModeState().analyticsStorage).toBe('denied');
  });

  it('shows essential, functional and informational advertising cookie categories', () => {
    const consent = TestBed.inject(CookieConsentService);
    const element = fixture.nativeElement as HTMLElement;

    consent.openPreferences();
    fixture.detectChanges();

    const switches = Array.from(element.querySelectorAll('[role="switch"]'));

    expect(switches.map((switchElement) => switchElement.getAttribute('aria-checked'))).toEqual(['true', 'true', 'false']);
    expect(switches[0].textContent).toContain('Cookies esenciales');
    expect(switches[1].textContent).toContain('Preferencias funcionales');
    expect(switches[2].textContent).toContain('Cookies de publicidad');
    expect(switches[2].hasAttribute('disabled')).toBe(true);
    expect(element.textContent).toContain('CMP certificada');
    expect(element.textContent).not.toContain('Anuncios personalizados');
    expect(element.textContent).not.toContain('Cookies de anal');
    expect(visibleActionButtons(element).map((button) => button.textContent?.trim()))
      .toEqual(['Solo esenciales', 'Guardar', 'Aceptar todas']);
  });

  it('opens the preferences controls from the customize action', () => {
    const element = fixture.nativeElement as HTMLElement;
    const settings = element.querySelector<HTMLElement>('[data-cz-cookie-settings]');
    const customizeButton = Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Personalizar');

    expect(settings?.hidden).toBe(true);

    customizeButton?.click();
    fixture.detectChanges();

    expect(settings?.hidden).toBe(false);
    expect(element.querySelectorAll('[role="switch"]')[1]?.getAttribute('aria-checked')).toBe('true');
    expect(visibleActionButtons(element).map((button) => button.textContent?.trim()))
      .toEqual(['Solo esenciales', 'Guardar', 'Aceptar todas']);
  });

  it('can save internal cookie preferences without personalized ads consent', () => {
    const consent = TestBed.inject(CookieConsentService);
    const element = fixture.nativeElement as HTMLElement;

    fixture.componentInstance.customize();
    fixture.detectChanges();

    const saveButton = Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Guardar');
    saveButton?.click();
    fixture.detectChanges();

    expect(consent.state().decision).toBe('custom');
    expect(consent.canUsePreferences()).toBe(true);
    expect(consent.canUseAds()).toBe(true);
    expect(consent.canUsePersonalizedAds()).toBe(false);
    expect(element.querySelector('.cookie-banner')).toBeNull();
  });

  it('can reopen preferences after a previous decision', () => {
    const consent = TestBed.inject(CookieConsentService);
    const element = fixture.nativeElement as HTMLElement;

    consent.rejectAll();
    fixture.detectChanges();
    expect(element.querySelector('.cookie-banner')).toBeNull();

    consent.openPreferences();
    fixture.detectChanges();

    expect(element.querySelector('.cookie-banner')).not.toBeNull();
    expect(visibleActionButtons(element).map((button) => button.textContent?.trim()))
      .toEqual(['Solo esenciales', 'Guardar', 'Aceptar todas']);
  });
});

function visibleActionButtons(element: HTMLElement): HTMLButtonElement[] {
  return Array.from(element.querySelectorAll<HTMLButtonElement>('.cookie-banner__actions button'))
    .filter((button) => !button.hidden);
}
