import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SEO_LOCALES } from '../../../../core/localization/locale-config';
import { SeoLanguageSelectorComponent } from './seo-language-selector.component';

describe('SeoLanguageSelectorComponent', () => {
  const nonSeoLocaleCodes = ['ja', 'ko', 'zh-hans', 'zh-hant', 'nl', 'ca', 'ru'] as const;
  let fixture: ComponentFixture<SeoLanguageSelectorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SeoLanguageSelectorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SeoLanguageSelectorComponent);
    fixture.componentRef.setInput('currentLocale', 'en');
    fixture.componentRef.setInput('links', [
      { locale: 'en', label: 'English', href: '/en/play-commander-online/', ariaLabel: 'English' },
      { locale: 'es', label: 'Español', href: '/es/jugar-commander-online/', ariaLabel: 'Spanish' },
      { locale: 'de', label: 'Deutsch', href: '/de/commander-online-spielen/', ariaLabel: 'German' },
    ]);
    fixture.detectChanges();
  });

  it('renders localized SEO URLs with native labels and hreflang values', () => {
    const links = Array.from(fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>);

    expect(links.map((link) => link.textContent?.trim())).toEqual(['English', 'Español', 'Deutsch']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/en/play-commander-online/',
      '/es/jugar-commander-online/',
      '/de/commander-online-spielen/',
    ]);
    expect(links.map((link) => link.getAttribute('hreflang'))).toEqual(['en', 'es', 'de']);
  });

  it('marks the current locale without changing the destination URL', () => {
    const currentLink = fixture.nativeElement.querySelector('a[aria-current="page"]') as HTMLAnchorElement;

    expect(currentLink.textContent?.trim()).toBe('English');
    expect(currentLink.getAttribute('href')).toBe('/en/play-commander-online/');
  });

  it('renders a dropdown trigger while keeping every localized URL crawlable', () => {
    const element = fixture.nativeElement as HTMLElement;
    const trigger = element.querySelector('.seo-language-selector__trigger');
    const links = Array.from(element.querySelectorAll('.seo-language-selector__menu a') as NodeListOf<HTMLAnchorElement>);
    const flags = Array.from(element.querySelectorAll('.seo-language-selector__flag') as NodeListOf<HTMLImageElement>);

    expect(trigger?.textContent).toContain('English');
    expect(element.querySelector('details.seo-language-selector')).not.toBeNull();
    expect(element.querySelector('.seo-language-selector__menu')?.classList.contains('app-pretty-scroll')).toBe(true);
    expect(links).toHaveLength(3);
    expect(links.every((link) => Boolean(link.getAttribute('href')))).toBe(true);
    expect(flags).toHaveLength(4);
    expect(flags.map((flag) => flag.getAttribute('src'))).toEqual([
      '/assets/icons/flags/uk.png',
      '/assets/icons/flags/uk.png',
      '/assets/icons/flags/spain.png',
      '/assets/icons/flags/germany.png',
    ]);
  });

  it('localizes the trigger label and aria label from the current SEO locale', () => {
    fixture.componentRef.setInput('currentLocale', 'de');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.seo-language-selector__label')?.textContent?.trim()).toBe('Sprache');
    expect(element.querySelector('summary')?.getAttribute('aria-label')).toBe('Sprache auswählen');
    expect(element.querySelector('nav')?.getAttribute('aria-label')).toBe('Sprache auswählen');
  });

  it('renders a flag asset for every SEO locale', () => {
    fixture.componentRef.setInput('links', SEO_LOCALES.map((locale) => ({
      locale: locale.code,
      label: locale.label,
      href: `/${locale.code}/play-commander-online/`,
      ariaLabel: locale.label,
    })));
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const menuFlags = Array.from(element.querySelectorAll('.seo-language-selector__menu img') as NodeListOf<HTMLImageElement>);

    expect(menuFlags).toHaveLength(SEO_LOCALES.length);
    expect(menuFlags.every((flag) => flag.getAttribute('src')?.startsWith('/assets/icons/flags/'))).toBe(true);
    expect(element.querySelector('a[hreflang="it"] img')?.getAttribute('src')).toBe('/assets/icons/flags/italy.png');
    expect(element.querySelector('a[hreflang="pt"] img')?.getAttribute('src')).toBe('/assets/icons/flags/portugal.png');
    for (const locale of nonSeoLocaleCodes) {
      expect(element.querySelector(`a[hreflang="${locale}"] img`)).toBeNull();
    }
  });

  it('keeps the root English home URL crawlable in the language menu', () => {
    fixture.componentRef.setInput('links', [
      { locale: 'en', label: 'English', href: '/', ariaLabel: 'English' },
      { locale: 'es', label: 'Español', href: '/es/', ariaLabel: 'Spanish' },
      { locale: 'it', label: 'Italiano', href: '/it/', ariaLabel: 'Italian' },
    ]);
    fixture.detectChanges();

    const links = Array.from(fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>);

    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/', '/es/', '/it/']);
    expect(links.map((link) => link.getAttribute('hreflang'))).toEqual(['en', 'es', 'it']);
    expect(fixture.nativeElement.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('/');
  });

  it('does not generate mixed locale and slug URLs', () => {
    const hrefs = Array.from(fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>)
      .map((link) => link.getAttribute('href'));

    expect(hrefs).not.toContain('/en/jugar-commander-online/');
    expect(hrefs).not.toContain('/es/play-commander-online/');
  });
});
