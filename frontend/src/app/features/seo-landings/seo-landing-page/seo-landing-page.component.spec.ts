import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SEO_LOCALE_CODES } from '../../../core/localization/locale-config';
import { SEO_ROUTE_KEYS, SeoRouteKey } from '../../../core/localization/seo-routes';
import { getSeoLandingContent } from '../content/seo-landing-content';
import { SeoLandingContent } from '../models/seo-landing-content.model';
import { SeoLandingPageComponent } from './seo-landing-page.component';

describe('SeoLandingPageComponent', () => {
  let fixture: ComponentFixture<SeoLandingPageComponent>;

  const content: SeoLandingContent = {
    routeKey: 'playCommanderOnline',
    locale: 'en',
    seo: {
      title: 'Play Commander online | CommanderZone',
      description: 'Run a manual Commander table with friends from any browser.',
      ogTitle: 'Play Commander online | CommanderZone',
      ogDescription: 'Run a manual Commander table with friends from any browser.',
      ogImage: '/assets/og/play-commander-og.png',
    },
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Play Commander online',
    },
    siteName: 'CommanderZone',
    homeLink: { label: 'CommanderZone home', href: '/en/' },
    publicNavigationLinks: [
      { label: 'Play online', href: '/en/play-commander-online/' },
      { label: 'FAQ', href: '/en/faq/' },
    ],
    localeLinks: [
      { locale: 'en', label: 'English', href: '/en/play-commander-online/' },
      { locale: 'de', label: 'Deutsch mit extra langem lokalisierten Text', href: '/de/commander-online-spielen/' },
      { locale: 'pt', label: 'Portuguese', href: '/pt/jogar-commander-online/' },
      { locale: 'it', label: 'Italiano', href: '/it/giocare-commander-online/' },
    ],
    breadcrumb: {
      items: [
        { label: 'Home', href: '/en/' },
        { label: 'Play Commander online', href: '/en/play-commander-online/' },
      ],
    },
    hero: {
      eyebrow: 'CommanderZone',
      title: 'Play Commander online',
      subtitle: 'Run a manual Commander table with friends from any browser.',
      image: {
        src: '/assets/og/play-commander-og.png',
        alt: 'Play Commander online - CommanderZone',
        width: 960,
        height: 504,
        loading: 'eager',
        fetchPriority: 'high',
      },
      primaryLink: { label: 'Sign in and prepare deck', href: '/auth/login?redirect=/decks' },
      secondaryLink: { label: 'Open CommanderZone', href: '/auth/login?redirect=/decks' },
      highlights: ['No rules engine', 'Shared table', 'Browser based'],
    },
    trustBar: {
      label: 'CommanderZone trust signals',
      items: [
        { value: 'Manual', label: 'No hidden rules automation' },
        { value: 'Browser', label: 'Works on desktop, tablet and phone' },
      ],
    },
    sections: [
      {
        id: 'overview',
        title: 'A manual online table',
        body: ['CommanderZone keeps the table state clear while players make their own game decisions.'],
        links: [{ label: 'See Commander rooms', href: '/en/create-commander-room/' }],
      },
    ],
    featureGrid: {
      title: 'Built for Commander pods',
      features: [
        { title: 'Private rooms', description: 'Invite only the players you want at the table.' },
        { title: 'Deck import', description: 'Bring a Commander deck into the room quickly.' },
        { title: 'Manual play', description: 'Keep play flexible without hidden rules automation.' },
      ],
    },
    steps: {
      title: 'Start in three steps',
      steps: [
        { title: 'Create room', description: 'Open a new table for the pod.' },
        { title: 'Invite friends', description: 'Share the room link.' },
        { title: 'Play', description: 'Track the game manually.' },
      ],
    },
    useCases: {
      title: 'Use cases for every pod',
      useCases: [
        {
          title: 'Remote games',
          description: 'Run a Commander night when the pod cannot meet in person.',
          link: { label: 'Prepare a remote room', href: '/en/create-commander-room/' },
        },
      ],
    },
    comparison: {
      title: 'Manual table vs full rules engine',
      firstColumnLabel: 'CommanderZone',
      secondColumnLabel: 'Rules engine',
      rows: [
        { label: 'Player control', firstValue: 'Manual choices', secondValue: 'Automated validation' },
      ],
    },
    fullFaq: {
      title: 'Commander online FAQ',
      items: [
        {
          question: 'Does it enforce Magic rules?',
          answer: ['No. It is a manual Commander table.'],
        },
      ],
    },
    faq: {
      title: 'Commander online FAQ',
      items: [
        {
          question: 'Does it enforce Magic rules?',
          answer: ['No. It is a manual Commander table.'],
        },
      ],
    },
    cta: {
      title: 'Start a Commander table',
      description: 'Sign in, prepare a deck and open the room when your pod is ready.',
      primaryLink: { label: 'Sign in and prepare deck', href: '/auth/login?redirect=/decks' },
    },
    internalLinks: {
      title: 'Related CommanderZone pages',
      links: [
        { label: 'Import Commander deck', href: '/en/import-commander-deck/' },
        { label: 'Commander deck builder', href: '/en/commander-deck-builder/' },
      ],
    },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SeoLandingPageComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SeoLandingPageComponent);
    fixture.componentRef.setInput('content', content);
    fixture.detectChanges();
  });

  afterEach(() => {
    if (!fixture.componentRef.hostView.destroyed) {
      fixture.destroy();
    }
    document.documentElement.classList.remove('app-pretty-scroll', 'seo-scroll-context');
    document.body.classList.remove('app-pretty-scroll', 'seo-scroll-context');
  });

  it('renders a complete SEO landing from typed static content', () => {
    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelector('.seo-landing-layout')?.getAttribute('data-route-key')).toBe('playCommanderOnline');
    expect(element.querySelector('.seo-landing-layout')?.getAttribute('lang')).toBe('en');
    expect(element.textContent).toContain('Play Commander online');
    expect(element.textContent).toContain('Built for Commander pods');
    expect(element.textContent).toContain('Commander online FAQ');
    expect(element.textContent).toContain('Related CommanderZone pages');
  });

  it('enables the app custom scrollbar while the SEO layout is mounted', () => {
    expect(document.documentElement.classList.contains('app-pretty-scroll')).toBe(true);
    expect(document.documentElement.classList.contains('seo-scroll-context')).toBe(true);
    expect(document.body.classList.contains('app-pretty-scroll')).toBe(true);
    expect(document.body.classList.contains('seo-scroll-context')).toBe(true);

    fixture.destroy();

    expect(document.documentElement.classList.contains('app-pretty-scroll')).toBe(false);
    expect(document.documentElement.classList.contains('seo-scroll-context')).toBe(false);
    expect(document.body.classList.contains('app-pretty-scroll')).toBe(false);
    expect(document.body.classList.contains('seo-scroll-context')).toBe(false);
  });

  it('marks SEO scrollable content areas with the app pretty scrollbar class', () => {
    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelector('.seo-language-selector__menu')?.classList.contains('app-pretty-scroll')).toBe(true);
    expect(element.querySelector('.landing-faq__items')?.classList.contains('app-pretty-scroll')).toBe(true);
    expect(element.querySelector('.landing-internal-links ul')?.classList.contains('app-pretty-scroll')).toBe(true);
  });

  it('keeps semantic heading structure with a single H1', () => {
    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelectorAll('h1')).toHaveLength(1);
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Play Commander online');
    expect(element.querySelectorAll('h2').length).toBeGreaterThan(0);
    expect(element.querySelectorAll('h3').length).toBeGreaterThan(0);
  });

  it('renders real links with href attributes and visible FAQ answers', () => {
    const element: HTMLElement = fixture.nativeElement;
    const anchors = Array.from(element.querySelectorAll('a'));
    const links = anchors.map((link) => link.getAttribute('href'));

    expect(links).toContain('/auth/login?redirect=/decks');
    expect(links).toContain('/en/faq/');
    expect(links).toContain('/de/commander-online-spielen/');
    expect(links).toContain('/en/import-commander-deck/');
    expect(anchors.every((link) => Boolean(link.getAttribute('href')))).toBe(true);
    expect(element.querySelector('button')).toBeNull();
    expect(element.querySelector('.landing-faq')).not.toBeNull();
    expect(element.querySelector('.landing-full-faq')).toBeNull();
    expect(element.textContent).toContain('No. It is a manual Commander table.');
  });

  it('renders only one visible FAQ section and does not duplicate questions', () => {
    const element: HTMLElement = fixture.nativeElement;
    const faqHeadings = Array.from(element.querySelectorAll('h2'))
      .map((heading) => heading.textContent?.trim())
      .filter((text) => text === 'Commander online FAQ');
    const faqQuestions = Array.from(element.querySelectorAll('.landing-faq h3, .landing-full-faq h3'))
      .map((heading) => heading.textContent?.trim())
      .filter((text): text is string => Boolean(text));

    expect(element.querySelectorAll('app-landing-faq, app-landing-full-faq')).toHaveLength(1);
    expect(faqHeadings).toHaveLength(1);
    expect(faqQuestions).toEqual([...new Set(faqQuestions)]);
  });

  it('renders a single localized FAQ heading on every home landing', () => {
    const expectedFaqHeadingByLocale = {
      en: 'Frequently asked questions',
      es: 'Preguntas frecuentes',
      de: 'Häufige Fragen',
      fr: 'Questions fréquentes',
      pt: 'Perguntas frequentes',
      it: 'Domande frequenti',
    } as const;

    for (const locale of SEO_LOCALE_CODES) {
      fixture.componentRef.setInput('content', getSeoLandingContent('home', locale));
      fixture.detectChanges();

      const element: HTMLElement = fixture.nativeElement;
      const expectedHeading = expectedFaqHeadingByLocale[locale];
      const matchingFaqHeadings = Array.from(element.querySelectorAll('h2'))
        .map((heading) => heading.textContent?.trim())
        .filter((text) => text === expectedHeading);
      const faqQuestions = Array.from(element.querySelectorAll('.landing-faq h3, .landing-full-faq h3'))
        .map((heading) => heading.textContent?.trim())
        .filter((text): text is string => Boolean(text));

      expect(element.querySelectorAll('app-landing-faq, app-landing-full-faq')).toHaveLength(1);
      expect(matchingFaqHeadings).toHaveLength(1);
      expect(faqQuestions).toEqual([...new Set(faqQuestions)]);
    }
  });

  it('renders at most one FAQ block for every SEO landing', () => {
    for (const routeKey of SEO_ROUTE_KEYS) {
      for (const locale of SEO_LOCALE_CODES) {
        fixture.componentRef.setInput('content', getSeoLandingContent(routeKey, locale));
        fixture.detectChanges();

        const element: HTMLElement = fixture.nativeElement;
        const faqBlocks = element.querySelectorAll('app-landing-faq, app-landing-full-faq');
        const faqQuestions = Array.from(element.querySelectorAll('.landing-faq h3, .landing-full-faq h3'))
          .map((heading) => heading.textContent?.trim())
          .filter((text): text is string => Boolean(text));

        expect(faqBlocks.length).toBeLessThanOrEqual(1);
        expect(faqQuestions).toEqual([...new Set(faqQuestions)]);
      }
    }
  });

  it('renders the FAQ route with the full FAQ component only', () => {
    fixture.componentRef.setInput('content', {
      ...content,
      routeKey: 'faq',
    });
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelector('app-landing-faq')).toBeNull();
    expect(element.querySelector('app-landing-full-faq')).not.toBeNull();
    expect(element.querySelector('.landing-full-faq details')?.hasAttribute('open')).toBe(true);
  });

  it('renders the CommanderZone public header with crawlable menu and logo', () => {
    const element: HTMLElement = fixture.nativeElement;
    const logo = element.querySelector('.seo-landing-layout__brand img') as HTMLImageElement;
    const publicMenuLinks = Array.from(element.querySelectorAll('.seo-landing-layout__nav a') as NodeListOf<HTMLAnchorElement>);

    expect(logo.getAttribute('src')).toBe('/assets/icons/CZ/CZ_logo_zone_header.png');
    expect(logo.getAttribute('decoding')).toBe('async');
    expect(element.querySelector('.seo-landing-layout__brand')?.getAttribute('href')).toBe('/en/');
    expect(element.querySelector('.seo-landing-layout__menu')).toBeNull();
    expect(publicMenuLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/en/faq/',
    ]);
    expect(publicMenuLinks.every((link) => link.classList.contains('primary-button'))).toBe(true);
  });

  it('hides the FAQ header button while rendering the FAQ landing', () => {
    fixture.componentRef.setInput('content', {
      ...content,
      routeKey: 'faq',
      publicNavigationLinks: [
        { label: 'Play online', href: '/en/play-commander-online/' },
        { label: 'FAQ', href: '/en/faq/' },
      ],
    });
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;
    const publicMenuLinks = Array.from(element.querySelectorAll('.seo-landing-layout__nav a') as NodeListOf<HTMLAnchorElement>);

    expect(publicMenuLinks.map((link) => link.getAttribute('href'))).toEqual(['/en/play-commander-online/']);
  });

  it('uses the app button classes for hero and final CTA links', () => {
    const element: HTMLElement = fixture.nativeElement;
    const heroPrimary = element.querySelector('.landing-hero__actions a[href="/auth/login?redirect=/decks"]');
    const heroSecondary = element.querySelector('.landing-hero__actions a.secondary-button[href="/auth/login?redirect=/decks"]');
    const ctaPrimary = element.querySelector('.landing-cta__actions a[href="/auth/login?redirect=/decks"]');

    expect(heroPrimary?.classList.contains('primary-button')).toBe(true);
    expect(heroSecondary?.classList.contains('secondary-button')).toBe(true);
    expect(ctaPrimary?.classList.contains('primary-button')).toBe(true);
  });

  it('renders a stable SEO hero image without layout shift or lazy loading', () => {
    const element: HTMLElement = fixture.nativeElement;
    const image = element.querySelector('.landing-hero__media img');

    expect(image?.getAttribute('src')).toBe('/assets/og/play-commander-og.png');
    expect(image?.getAttribute('alt')).toBe('Play Commander online - CommanderZone');
    expect(image?.getAttribute('width')).toBe('960');
    expect(image?.getAttribute('height')).toBe('504');
    expect(image?.getAttribute('decoding')).toBe('async');
    expect(image?.getAttribute('loading')).toBe('eager');
    expect(image?.getAttribute('fetchpriority')).toBe('high');
  });

  it('renders reusable responsive system sections', () => {
    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelector('app-product-landing-template')).toBeTruthy();
    expect(element.querySelector('app-seo-landing-template-renderer')).toBeTruthy();
    expect(element.querySelector('app-landing-breadcrumb')).toBeTruthy();
    expect(element.querySelector('app-seo-language-selector')).toBeTruthy();
    expect(element.querySelector('app-landing-trust-bar')).toBeTruthy();
    expect(element.querySelector('app-landing-use-cases')).toBeTruthy();
    expect(element.querySelector('app-landing-faq')).toBeTruthy();
    expect(element.querySelector('app-landing-internal-links')).toBeTruthy();
  });

  it('selects the reusable landing template by SEO intent', () => {
    const cases: readonly [SeoRouteKey, string][] = [
      ['home', 'app-product-landing-template'],
      ['playCommanderOnline', 'app-product-landing-template'],
      ['createCommanderRoom', 'app-product-landing-template'],
      ['importCommanderDeck', 'app-product-landing-template'],
      ['commanderDeckBuilder', 'app-product-landing-template'],
      ['tableAssistant', 'app-product-landing-template'],
      ['playMagicOnlineWithFriends', 'app-guide-landing-template'],
      ['howToPlayCommanderOnline', 'app-guide-landing-template'],
      ['waysToPlayCommanderOnline', 'app-comparison-landing-template'],
      ['faq', 'app-faq-landing-template'],
    ];

    for (const [routeKey, selector] of cases) {
      fixture.componentRef.setInput('content', { ...content, routeKey });
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector(selector)).toBeTruthy();
    }
  });
});
