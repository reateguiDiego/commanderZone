import { SEO_LOCALE_CODES } from '../../../core/localization/locale-config';
import { SEO_ROUTE_KEYS } from '../../../core/localization/seo-routes';
import {
  SEO_LANDING_CONTENT,
  getAllSeoLandingContentEntries,
  getSeoLandingContent,
  validateSeoLandingContentCoverage,
} from './seo-landing-content';

describe('SEO landing static content', () => {
  it('provides content for every SEO landing and every SEO-indexable locale', () => {
    expect(Object.keys(SEO_LANDING_CONTENT).sort()).toEqual([...SEO_ROUTE_KEYS].sort());

    for (const routeKey of SEO_ROUTE_KEYS) {
      expect(Object.keys(SEO_LANDING_CONTENT[routeKey]).sort()).toEqual([...SEO_LOCALE_CODES].sort());
    }

    expect(getAllSeoLandingContentEntries()).toHaveLength(SEO_ROUTE_KEYS.length * SEO_LOCALE_CODES.length);
  });

  it('passes required SEO content coverage validation', () => {
    expect(validateSeoLandingContentCoverage()).toEqual([]);
  });

  it('returns SSR-ready static content without client fetch requirements', () => {
    const content = getSeoLandingContent('playCommanderOnline', 'en');

    expect(content.routeKey).toBe('playCommanderOnline');
    expect(content.locale).toBe('en');
    expect(content.seo.title).toBe('Play Commander Online | Create a Free Room on CommanderZone');
    expect(content.seo.description).toBe('Play Commander online with friends from your browser: import or build your deck, open a room, share the link and track the game.');
    expect(content.seo.ogImage).toBe('/assets/og/play-commander-og.png');
    expect(content.hero.title).toBe('Play Commander online without the setup headache');
    expect(content.hero.primaryLink).toEqual({
      label: 'Prepare deck to play',
      href: '/decks?intent=import&next=/rooms',
    });
    expect(content.breadcrumb.items.length).toBeGreaterThan(0);
    expect(content.internalLinks.links.length).toBeGreaterThan(0);
    expect(content.faq.items.length).toBeGreaterThan(0);
    expect(content.jsonLd).toBeTruthy();
  });

  it('keeps table assistant SEO content separate from the internal table assistant app route', () => {
    const content = getSeoLandingContent('tableAssistant', 'es');

    expect(content.hero.title.toLowerCase()).toContain('asistente de mesa');
    expect(content.seo.title).toBe('Asistente de mesa Commander | Contador de vidas y daño de comandante');
    expect(content.seo.ogImage).toBe('/assets/og/table-assistant-og.png');
    expect(content.internalLinks.links.map((link) => link.href)).not.toContain('/table-assistant');
    expect(content.internalLinks.links.every((link) => link.href.startsWith('/es/'))).toBe(true);
  });

  it('does not duplicate the legal disclaimer inside SEO content', () => {
    const content = getSeoLandingContent('home', 'en') as unknown as Record<string, unknown>;

    expect('legalDisclaimer' in content).toBe(false);
  });

  it('provides default and route-specific Open Graph image paths', () => {
    expect(getSeoLandingContent('home', 'en').seo.ogImage).toBe('/assets/og/home-og.png');
    expect(getSeoLandingContent('playCommanderOnline', 'en').seo.ogImage).toBe('/assets/og/play-commander-og.png');
    expect(getSeoLandingContent('tableAssistant', 'en').seo.ogImage).toBe('/assets/og/table-assistant-og.png');
    expect(getSeoLandingContent('faq', 'en').seo.ogImage).toBe('/assets/og/faq-og.png');
    expect(getSeoLandingContent('waysToPlayCommanderOnline', 'en').seo.ogImage).toBe('/assets/og/ways-to-play-og.png');
    expect(getSeoLandingContent('howToPlayCommanderOnline', 'en').seo.ogImage).toBe('/assets/og/default-og.png');
  });

  it('provides localized hero images with stable dimensions and no lazy loading', () => {
    for (const { content } of getAllSeoLandingContentEntries()) {
      expect(content.hero.image?.src).toBe(content.seo.ogImage);
      expect(content.hero.image?.alt).toContain(content.hero.title);
      expect(content.hero.image?.alt).toContain('CommanderZone');
      expect(content.hero.image?.width).toBe(1200);
      expect(content.hero.image?.height).toBe(630);
      expect(content.hero.image?.loading).toBe('eager');
      expect(content.hero.image?.fetchPriority).toBe('high');
    }
  });

  it('provides the public FAQ with full FAQPage content', () => {
    const content = getSeoLandingContent('faq', 'es');

    expect(content.seo.title).toContain('FAQ');
    expect(content.hero.title).toBe('Preguntas frecuentes sobre CommanderZone');
    expect(content.faq.items.length).toBe(16);
    expect(content.faq.items.map((item) => item.question)).toContain('¿Qué es CommanderZone?');
    expect(content.faq.items.map((item) => item.question)).toContain('¿Necesito un mazo para crear una partida?');
    expect(content.faq.items.map((item) => item.question)).toContain('¿Premium vende contenido oficial de Magic?');
    expect(JSON.stringify(content.jsonLd)).toContain('FAQPage');
  });

  it('generates complete localized JSON-LD graphs for the SEO landing intents', () => {
    expect(jsonLdTypes('home', 'en')).toEqual(expect.arrayContaining([
      'Organization',
      'BreadcrumbList',
      'WebSite',
      'SoftwareApplication',
      'FAQPage',
    ]));
    expect(jsonLdTypes('tableAssistant', 'es')).toEqual(expect.arrayContaining([
      'Organization',
      'BreadcrumbList',
      'SoftwareApplication',
      'FAQPage',
    ]));
    expect(jsonLdTypes('playMagicOnlineWithFriends', 'en')).toEqual(expect.arrayContaining([
      'Organization',
      'BreadcrumbList',
      'Article',
      'FAQPage',
    ]));
    expect(jsonLdTypes('waysToPlayCommanderOnline', 'en')).toEqual(expect.arrayContaining([
      'Organization',
      'BreadcrumbList',
      'Article',
      'FAQPage',
    ]));
    expect(jsonLdTypes('faq', 'es')).toEqual(expect.arrayContaining([
      'Organization',
      'BreadcrumbList',
      'FAQPage',
    ]));
    expect(jsonLdTypes('faq', 'es')).not.toContain('SoftwareApplication');
    expect(jsonLdTypes('faq', 'es')).not.toContain('Article');
  });

  it('keeps JSON-LD aligned with localized visible content and absolute URLs', () => {
    const content = getSeoLandingContent('tableAssistant', 'es');
    const graph = jsonLdGraph(content.jsonLd);
    const faqPage = findJsonLdNode(graph, 'FAQPage');
    const breadcrumbList = findJsonLdNode(graph, 'BreadcrumbList');
    const softwareApplication = findJsonLdNode(graph, 'SoftwareApplication');
    const mainEntity = faqPage?.['mainEntity'];
    const faqQuestions = Array.isArray(mainEntity) ? mainEntity : [];

    expect(JSON.stringify(content.jsonLd)).toContain('https://www.commanderzone.com/es/asistente-de-mesa-magic/');
    expect(JSON.stringify(content.jsonLd)).toContain('"inLanguage":"es"');
    expect(softwareApplication?.['name']).toBe(content.hero.title);
    expect(softwareApplication?.['description']).toBe(content.seo.description);
    expect(breadcrumbList?.['itemListElement']).toEqual(expect.arrayContaining([
      expect.objectContaining({
        '@type': 'ListItem',
        position: 2,
        name: content.hero.title,
        item: 'https://www.commanderzone.com/es/asistente-de-mesa-magic/',
      }),
    ]));
    expect(faqQuestions.length).toBe(content.faq.items.length);
    expect(faqQuestions[0]).toEqual(expect.objectContaining({
      '@type': 'Question',
      name: content.faq.items[0].question,
      acceptedAnswer: expect.objectContaining({
        '@type': 'Answer',
        text: content.faq.items[0].answer.join(' '),
      }),
    }));
  });

  it('does not add unsupported review or rating JSON-LD', () => {
    for (const { content } of getAllSeoLandingContentEntries()) {
      const serializedJsonLd = JSON.stringify(content.jsonLd);

      expect(serializedJsonLd).not.toContain('"Review"');
      expect(serializedJsonLd).not.toContain('"AggregateRating"');
      expect(serializedJsonLd).not.toContain('"ratingValue"');
      expect(serializedJsonLd).not.toContain('"reviewRating"');
    }
  });

  it('links to the FAQ from public navigation, footer and home content', () => {
    const content = getSeoLandingContent('home', 'en');
    const publicNavigationHrefs = content.publicNavigationLinks?.map((link) => link.href) ?? [];
    const footerHrefs = content.footerLinks?.map((link) => link.href) ?? [];
    const allHrefs = getAllLandingHrefs(content);

    expect(publicNavigationHrefs).toContain('/en/faq/');
    expect(footerHrefs).toContain('/en/faq/');
    expect(allHrefs).toContain('/en/faq/');
  });

  it('links from home to every main SEO landing with crawlable hrefs', () => {
    const content = getSeoLandingContent('home', 'en');
    const hrefs = getAllLandingHrefs(content);

    expect(hrefs).toEqual(expect.arrayContaining([
      '/en/play-commander-online/',
      '/en/play-magic-online-with-friends/',
      '/en/create-commander-room/',
      '/en/import-commander-deck/',
      '/en/commander-deck-builder/',
      '/en/commander-life-counter/',
      '/en/ways-to-play-commander-online/',
      '/en/how-to-play-commander-online/',
      '/en/faq/',
    ]));
  });

  it('links from FAQ to relevant SEO landings with crawlable hrefs', () => {
    const content = getSeoLandingContent('faq', 'es');
    const hrefs = getAllLandingHrefs(content);

    expect(hrefs).toEqual(expect.arrayContaining([
      '/es/',
      '/es/jugar-commander-online/',
      '/es/jugar-magic-online-con-amigos/',
      '/es/crear-sala-commander-online/',
      '/es/importar-mazo-commander/',
      '/es/deck-builder-commander/',
      '/es/asistente-de-mesa-magic/',
      '/es/formas-de-jugar-commander-online/',
      '/es/como-jugar-commander-online/',
    ]));
  });

  it('routes conversion CTAs through the deck preparation funnel before rooms', () => {
    expect(getSeoLandingContent('home', 'en').hero.primaryLink.href).toBe('/decks?intent=import&next=/rooms');
    expect(getSeoLandingContent('playCommanderOnline', 'en').hero.primaryLink.href).toBe('/decks?intent=import&next=/rooms');
    expect(getSeoLandingContent('createCommanderRoom', 'en').hero.primaryLink.href).toBe('/decks?intent=import&next=/rooms');
    expect(getSeoLandingContent('createCommanderRoom', 'en').hero.secondaryLink?.href).toBe('/decks?intent=new&next=/rooms');
    expect(getSeoLandingContent('importCommanderDeck', 'en').hero.primaryLink.href).toBe('/decks?intent=import&next=/rooms');
    expect(getSeoLandingContent('commanderDeckBuilder', 'en').hero.primaryLink.href).toBe('/decks?intent=new&next=/rooms');
    expect(getSeoLandingContent('tableAssistant', 'en').hero.primaryLink.href).toBe('/table-assistant');
  });

  it('passes linguistic SEO QA for visible static content', () => {
    const placeholderPattern = /\b(?:TODO|FIXME)\b|(?:Lorem ipsum|placeholder|translation missing)|\{\{|\}\}|__/;
    const mojibakePattern = /Â|Ã|Ð|Ñ|ãƒ|ã|åœ|ì˜|í™|�/;
    const visibleKeyPattern = /\b[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*){2,}\b/i;

    for (const { content } of getAllSeoLandingContentEntries()) {
      for (const text of getVisibleSeoTexts(content)) {
        expect({
          location: `${content.routeKey}/${content.locale}`,
          text,
          hasPlaceholder: placeholderPattern.test(text),
        }).toEqual({ location: `${content.routeKey}/${content.locale}`, text, hasPlaceholder: false });
        expect({
          location: `${content.routeKey}/${content.locale}`,
          text,
          hasMojibake: mojibakePattern.test(text),
        }).toEqual({ location: `${content.routeKey}/${content.locale}`, text, hasMojibake: false });
        expect({
          location: `${content.routeKey}/${content.locale}`,
          text,
          hasVisibleKey: visibleKeyPattern.test(text),
        }).toEqual({ location: `${content.routeKey}/${content.locale}`, text, hasVisibleKey: false });
      }
    }
  });

  it('uses localized product copy for every SEO-indexable locale', () => {
    const untranslatedEnglishFragments = [
      'invitations and room links',
      'free Commander games',
      'accounts and room creation',
      'pasted decklists',
      'creating Commander decks from scratch',
      'editing decks before playing',
      'Moxfield, Archidekt and other deck sources',
      'decklist formats',
      'existing Commander decks online',
      'physical Magic games',
      'phone life counter use',
      'tablet table assistant use',
      'in-person games',
      'commander damage tracking',
      'several player life totals',
      'poison or infect tracking',
      'table assistant without online room',
      'SpellTable comparison',
      'Cockatrice comparison',
      'MTGO comparison',
      'MTG Arena comparison',
      'Untap.in comparison',
      'EDHPlay comparison',
      'mobile devices',
      'camera or webcam requirements',
      'playing without webcam',
      'physical cards',
      'private games',
      'starting requirements',
      'Commander online options',
    ];
    const priorityLocales = new Set(['es', 'de', 'fr', 'pt', 'it']);

    for (const { content } of getAllSeoLandingContentEntries()) {
      if (content.locale === 'en' || !priorityLocales.has(content.locale)) {
        continue;
      }

      const visibleContent = getVisibleSeoTexts(content).join(' ');

      for (const fragment of untranslatedEnglishFragments) {
        expect({
          location: `${content.routeKey}/${content.locale}`,
          fragment,
          containsFragment: visibleContent.includes(fragment),
        }).toEqual({ location: `${content.routeKey}/${content.locale}`, fragment, containsFragment: false });
      }
    }
    expect(getSeoLandingContent('playCommanderOnline', 'it').hero.title).toBe('Giocare a Commander online senza complicazioni');
    expect(getSeoLandingContent('faq', 'it').faq.items.map((item) => item.question)).toContain('Cos’è CommanderZone?');
  });

  it('keeps SEO titles, descriptions and H1s useful per locale', () => {
    for (const locale of SEO_LOCALE_CODES) {
      const h1s = SEO_ROUTE_KEYS.map((routeKey) => getSeoLandingContent(routeKey, locale).hero.title);

      expect({ locale, uniqueH1Count: new Set(h1s).size }).toEqual({
        locale,
        uniqueH1Count: SEO_ROUTE_KEYS.length,
      });
    }

    for (const { content } of getAllSeoLandingContentEntries()) {
      expect(content.seo.title.length).toBeLessThanOrEqual(75);
      expect(content.seo.description.length).toBeGreaterThanOrEqual(50);
      expect(content.seo.description.length).toBeLessThanOrEqual(220);
    }
  });

  it('keeps claims and competitor comparisons neutral', () => {
    const forbiddenClaimPattern = /\b(official Wizards|Wizards-approved|tournament-ready|ranked matchmaking|AI judge|full rules automation|legal-play validation)\b/i;
    const nonNeutralComparisonPattern = /\b(beats|destroys|better than|worse than|superior to|the best alternative to)\b/i;

    for (const { content } of getAllSeoLandingContentEntries()) {
      const visibleContent = getVisibleSeoTexts(content).join(' ');

      expect({
        location: `${content.routeKey}/${content.locale}`,
        hasForbiddenClaim: forbiddenClaimPattern.test(visibleContent),
      }).toEqual({ location: `${content.routeKey}/${content.locale}`, hasForbiddenClaim: false });
      expect({
        location: `${content.routeKey}/${content.locale}`,
        hasNonNeutralComparison: nonNeutralComparisonPattern.test(visibleContent),
      }).toEqual({ location: `${content.routeKey}/${content.locale}`, hasNonNeutralComparison: false });
    }
  });
});

type JsonLdObject = Readonly<Record<string, unknown>>;

function jsonLdTypes(routeKey: Parameters<typeof getSeoLandingContent>[0], locale: Parameters<typeof getSeoLandingContent>[1]): readonly unknown[] {
  return jsonLdGraph(getSeoLandingContent(routeKey, locale).jsonLd).map((node) => node['@type']);
}

function jsonLdGraph(jsonLd: unknown): readonly JsonLdObject[] {
  const jsonLdObject = asJsonLdObject(jsonLd);
  const graph = jsonLdObject?.['@graph'];

  expect(jsonLdObject?.['@context']).toBe('https://schema.org');
  expect(Array.isArray(graph)).toBe(true);

  return Array.isArray(graph)
    ? graph.map((node) => asJsonLdObject(node)).filter((node): node is JsonLdObject => node !== undefined)
    : [];
}

function findJsonLdNode(graph: readonly JsonLdObject[], type: string): JsonLdObject | undefined {
  return graph.find((node) => node['@type'] === type);
}

function asJsonLdObject(value: unknown): JsonLdObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonLdObject
    : undefined;
}

function getAllLandingHrefs(content: ReturnType<typeof getSeoLandingContent>): readonly string[] {
  return [
    content.homeLink?.href,
    content.hero.primaryLink.href,
    content.hero.secondaryLink?.href,
    content.cta?.primaryLink.href,
    content.cta?.secondaryLink?.href,
    ...(content.publicNavigationLinks?.map((link) => link.href) ?? []),
    ...(content.footerLinks?.map((link) => link.href) ?? []),
    ...content.breadcrumb.items.map((link) => link.href),
    ...content.internalLinks.links.map((link) => link.href),
    ...(content.sections?.flatMap((section) => section.links?.map((link) => link.href) ?? []) ?? []),
  ].filter((href): href is string => href !== undefined);
}

function getVisibleSeoTexts(content: ReturnType<typeof getSeoLandingContent>): readonly string[] {
  return [
    content.seo.title,
    content.seo.description,
    content.seo.ogTitle,
    content.seo.ogDescription,
    content.homeLink?.label,
    content.hero.eyebrow,
    content.hero.title,
    content.hero.subtitle,
    content.hero.image?.alt,
    content.hero.primaryLink.label,
    content.hero.secondaryLink?.label,
    ...(content.hero.highlights ?? []),
    content.trustBar?.label,
    ...(content.trustBar?.items.flatMap((item) => [item.value, item.label]) ?? []),
    ...(content.publicNavigationLinks?.map((link) => link.label) ?? []),
    ...(content.footerLinks?.map((link) => link.label) ?? []),
    ...content.breadcrumb.items.map((item) => item.label),
    ...(content.sections?.flatMap((section) => [
      section.title,
      ...(section.body ?? []),
      ...(section.links?.map((link) => link.label) ?? []),
    ]) ?? []),
    content.featureGrid?.title,
    content.featureGrid?.intro,
    ...(content.featureGrid?.features.flatMap((feature) => [feature.title, feature.description]) ?? []),
    content.steps?.title,
    ...(content.steps?.steps.flatMap((step) => [step.title, step.description]) ?? []),
    content.useCases?.title,
    content.useCases?.intro,
    ...(content.useCases?.useCases.flatMap((useCase) => [useCase.title, useCase.description]) ?? []),
    content.comparison?.title,
    content.comparison?.intro,
    content.comparison?.firstColumnLabel,
    content.comparison?.secondColumnLabel,
    ...(content.comparison?.rows.flatMap((row) => [row.label, row.firstValue, row.secondValue]) ?? []),
    content.faq.title,
    content.faq.intro,
    ...content.faq.items.flatMap((item) => [item.question, ...item.answer]),
    content.cta?.title,
    content.cta?.description,
    content.cta?.primaryLink.label,
    content.cta?.secondaryLink?.label,
    content.internalLinks.title,
    content.internalLinks.intro,
    ...content.internalLinks.links.map((link) => link.label),
  ].filter((text): text is string => text !== undefined && text.trim().length > 0);
}
