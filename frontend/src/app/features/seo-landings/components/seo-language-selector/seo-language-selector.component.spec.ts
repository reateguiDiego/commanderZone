import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SUPPORTED_LOCALES } from '../../../../core/localization/locale-config';
import { SeoLanguageSelectorComponent } from './seo-language-selector.component';

describe('SeoLanguageSelectorComponent', () => {
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

  it('renders a flag asset for every supported locale', () => {
    fixture.componentRef.setInput('links', SUPPORTED_LOCALES.map((locale) => ({
      locale: locale.code,
      label: locale.label,
      href: `/${locale.code}/play-commander-online/`,
      ariaLabel: locale.label,
    })));
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const menuFlags = Array.from(element.querySelectorAll('.seo-language-selector__menu img') as NodeListOf<HTMLImageElement>);

    expect(menuFlags).toHaveLength(SUPPORTED_LOCALES.length);
    expect(menuFlags.every((flag) => flag.getAttribute('src')?.startsWith('/assets/icons/flags/'))).toBe(true);
    expect(element.querySelector('a[hreflang="ko"] img')?.getAttribute('src')).toBe('/assets/icons/flags/south-korea.svg');
    expect(element.querySelector('a[hreflang="zh-hant"] img')?.getAttribute('src')).toBe('/assets/icons/flags/taiwan.svg');
    expect(element.querySelector('a[hreflang="ru"] img')?.getAttribute('src')).toBe('/assets/icons/flags/russia.svg');
  });

  it('does not generate mixed locale and slug URLs', () => {
    const hrefs = Array.from(fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>)
      .map((link) => link.getAttribute('href'));

    expect(hrefs).not.toContain('/en/jugar-commander-online/');
    expect(hrefs).not.toContain('/es/play-commander-online/');
  });
});
