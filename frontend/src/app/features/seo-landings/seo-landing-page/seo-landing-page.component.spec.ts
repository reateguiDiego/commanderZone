import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SeoRouteKey } from '../../../core/localization/seo-routes';
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
    localeLinks: [
      { locale: 'en', label: 'English', href: '/en/play-commander-online/' },
      { locale: 'de', label: 'Deutsch mit extra langem lokalisierten Text', href: '/de/commander-online-spielen/' },
      { locale: 'ru', label: 'Russkiy', href: '/ru/igrat-commander-onlain/' },
      { locale: 'ja', label: '日本語', href: '/ja/commander-online-play/' },
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
        width: 1200,
        height: 630,
        loading: 'eager',
        fetchPriority: 'high',
      },
      primaryLink: { label: 'Create a room', href: '/rooms' },
      secondaryLink: { label: 'Import a deck', href: '/decks' },
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
        links: [{ label: 'See rooms', href: '/rooms' }],
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
          link: { label: 'Create a remote room', href: '/rooms' },
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
    faqPreview: {
      title: 'Quick answers',
      items: [
        {
          question: 'Can my group use long localized text safely?',
          answer: ['Yes, layout content wraps instead of overflowing.'],
        },
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
      description: 'Create a room and invite your pod.',
      primaryLink: { label: 'Create room', href: '/rooms' },
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

  it('renders a complete SEO landing from typed static content', () => {
    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelector('.seo-landing-layout')?.getAttribute('data-route-key')).toBe('playCommanderOnline');
    expect(element.querySelector('.seo-landing-layout')?.getAttribute('lang')).toBe('en');
    expect(element.textContent).toContain('Play Commander online');
    expect(element.textContent).toContain('Built for Commander pods');
    expect(element.textContent).toContain('Commander online FAQ');
    expect(element.textContent).toContain('Related CommanderZone pages');
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

    expect(links).toContain('/rooms');
    expect(links).toContain('/decks');
    expect(links).toContain('/de/commander-online-spielen/');
    expect(links).toContain('/en/import-commander-deck/');
    expect(anchors.every((link) => Boolean(link.getAttribute('href')))).toBe(true);
    expect(element.querySelector('button')).toBeNull();
    expect(element.querySelector('details')?.hasAttribute('open')).toBe(true);
    expect(element.textContent).toContain('No. It is a manual Commander table.');
  });

  it('renders a stable SEO hero image without layout shift or lazy loading', () => {
    const element: HTMLElement = fixture.nativeElement;
    const image = element.querySelector('.landing-hero__media img');

    expect(image?.getAttribute('src')).toBe('/assets/og/play-commander-og.png');
    expect(image?.getAttribute('alt')).toBe('Play Commander online - CommanderZone');
    expect(image?.getAttribute('width')).toBe('1200');
    expect(image?.getAttribute('height')).toBe('630');
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
    expect(element.querySelector('app-landing-faq-preview')).toBeTruthy();
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
