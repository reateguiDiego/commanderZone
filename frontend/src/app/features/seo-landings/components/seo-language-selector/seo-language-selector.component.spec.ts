import { ComponentFixture, TestBed } from '@angular/core/testing';
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

  it('does not generate mixed locale and slug URLs', () => {
    const hrefs = Array.from(fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>)
      .map((link) => link.getAttribute('href'));

    expect(hrefs).not.toContain('/en/jugar-commander-online/');
    expect(hrefs).not.toContain('/es/play-commander-online/');
  });
});
