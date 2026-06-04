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
    expect(content.seo.description).toBe('Play Commander online with friends from your browser. Prepare your MTG Commander deck, create a room, share the link and track life totals and commander damage.');
    expect(content.seo.ogImage).toBe('/assets/og/play-commander-og.png');
    expect(content.hero.title).toBe('Play Commander online without the setup headache');
    expect(content.hero.primaryLink).toEqual({
      label: 'Sign in to play Commander',
      href: '/auth/login?redirect=/decks',
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
    expect(content.seo.description).toBe('Usa CommanderZone como asistente de mesa para partidas físicas de Commander MTG. Controla vidas, daño de comandante y estado de la partida desde móvil o tablet.');
    expect(content.seo.ogImage).toBe('/assets/og/table-assistant-og.png');
    expect(content.internalLinks.links.map((link) => link.href)).not.toContain('/table-assistant');
    expect(content.internalLinks.links.every((link) => link.href.startsWith('/es/'))).toBe(true);
  });

  it('uses MTG Commander SEO wording in priority landing metadata', () => {
    expect(getSeoLandingContent('home', 'es').seo.description).toBe('Prepara tu mazo, entra en CommanderZone y juega Commander online con tu grupo. Una mesa manual para Commander MTG, pensada para pods reales.');
    expect(getSeoLandingContent('home', 'en').seo.description).toBe('Prepare your deck, sign in and play Commander online with your pod. CommanderZone is a manual table for MTG Commander games, built for real multiplayer pods.');
    expect(getSeoLandingContent('playCommanderOnline', 'es').seo.description).toBe('Juega Commander online con amigos desde el navegador. Prepara tu mazo de Commander MTG, crea una sala, comparte el enlace y controla vidas y daño de comandante.');
    expect(getSeoLandingContent('importCommanderDeck', 'es').seo.title).toBe('Importar mazo Commander MTG | CommanderZone');
    expect(getSeoLandingContent('importCommanderDeck', 'en').seo.title).toBe('Import MTG Commander Deck | CommanderZone');
    expect(getSeoLandingContent('commanderDeckBuilder', 'es').seo.title).toBe('Deck builder Commander MTG | Crea e importa mazos');
    expect(getSeoLandingContent('commanderDeckBuilder', 'en').seo.title).toBe('MTG Commander Deck Builder | Build, Import and Play');
    expect(getSeoLandingContent('tableAssistant', 'en').seo.description).toBe('Use CommanderZone as a table assistant for paper MTG Commander games. Track life totals, commander damage and game state from your phone or tablet.');

    for (const locale of ['de', 'fr', 'pt', 'it'] as const) {
      const searchableMetadata = [
        getSeoLandingContent('home', locale).seo.description,
        getSeoLandingContent('playCommanderOnline', locale).seo.description,
        getSeoLandingContent('importCommanderDeck', locale).seo.title,
        getSeoLandingContent('importCommanderDeck', locale).seo.description,
        getSeoLandingContent('commanderDeckBuilder', locale).seo.title,
        getSeoLandingContent('commanderDeckBuilder', locale).seo.description,
        getSeoLandingContent('tableAssistant', locale).seo.description,
      ].join(' ');

      expect(searchableMetadata).toMatch(/MTG|Commander MTG|MTG-Commander/);
    }
  });

  it('uses user-facing related-link copy without internal landing terminology', () => {
    expect(getSeoLandingContent('home', 'es').internalLinks.intro).toBe('Descubre más formas de jugar, preparar mazos y usar CommanderZone.');
    expect(getSeoLandingContent('home', 'en').internalLinks.intro).toBe('Explore more ways to play, prepare decks and use CommanderZone.');
    expect(getSeoLandingContent('home', 'de').internalLinks.intro).toBe('Entdecke weitere Möglichkeiten, CommanderZone zu nutzen.');
    expect(getSeoLandingContent('home', 'fr').internalLinks.intro).toBe('Découvrez d’autres façons d’utiliser CommanderZone.');
    expect(getSeoLandingContent('home', 'pt').internalLinks.intro).toBe('Explore outras formas de usar o CommanderZone.');
    expect(getSeoLandingContent('home', 'it').internalLinks.intro).toBe('Scopri altri modi per giocare, preparare mazzi e usare CommanderZone.');

    for (const { content } of getAllSeoLandingContentEntries()) {
      expect(content.internalLinks.intro).not.toMatch(/landing|landings|public pages|páginas públicas|pages publiques|öffentliche .*Seiten/i);
    }
  });

  it('includes the mandatory Commander MTG FAQ questions in every SEO locale', () => {
    const mandatoryFaqsByLocale = {
      es: [
        ['¿CommanderZone sirve para Commander MTG?', 'Sí. CommanderZone está pensada específicamente para partidas de Commander MTG, tanto online como en mesa física.'],
        ['¿Necesito un mazo para crear una partida?', 'Sí. Para jugar en CommanderZone necesitas importar, crear o seleccionar un mazo antes de empezar.'],
        ['¿Puedo crear una sala sin mazo?', 'La experiencia principal está pensada para preparar primero el mazo y después crear la sala, para que la partida empiece sin pasos pendientes.'],
        ['¿CommanderZone sirve para otros formatos de Magic?', 'CommanderZone está enfocada principalmente en Commander. Algunas herramientas pueden servir para otros formatos, pero el producto está diseñado alrededor de partidas multijugador de Commander.'],
      ],
      en: [
        ['Is CommanderZone built for MTG Commander?', 'Yes. CommanderZone is built specifically for MTG Commander games, both online and around a physical table.'],
        ['Do I need a deck to create a game?', 'Yes. To play in CommanderZone, you need to import, build or select a deck before starting.'],
        ['Can I create a room without a deck?', 'The main experience is designed to prepare the deck first and then create the room, so the game starts without missing steps.'],
        ['Can I use CommanderZone for other Magic formats?', 'CommanderZone is mainly focused on Commander. Some tools may work for other formats, but the product is designed around multiplayer Commander games.'],
      ],
      de: [
        ['Ist CommanderZone für MTG Commander gedacht?', 'Ja. CommanderZone ist speziell für MTG Commander-Partien gedacht, online und am physischen Tisch.'],
        ['Brauche ich ein Deck, um eine Partie zu erstellen?', 'Ja. Um in CommanderZone zu spielen, musst du zuerst ein Deck importieren, erstellen oder auswählen.'],
        ['Kann ich einen Raum ohne Deck erstellen?', 'Die Hauptnutzung ist darauf ausgelegt, zuerst das Deck vorzubereiten und danach den Raum zu erstellen, damit die Partie ohne fehlende Schritte beginnt.'],
        ['Kann ich CommanderZone für andere Magic-Formate nutzen?', 'CommanderZone ist hauptsächlich auf Commander ausgelegt. Einige Werkzeuge können auch für andere Formate nützlich sein, aber das Produkt ist für Multiplayer-Commander-Partien entwickelt.'],
      ],
      fr: [
        ['CommanderZone est-il pensé pour Commander MTG ?', 'Oui. CommanderZone est pensé spécifiquement pour les parties de Commander MTG, en ligne comme autour d’une table physique.'],
        ['Ai-je besoin d’un deck pour créer une partie ?', 'Oui. Pour jouer dans CommanderZone, vous devez importer, créer ou sélectionner un deck avant de commencer.'],
        ['Puis-je créer une salle sans deck ?', 'L’expérience principale est conçue pour préparer d’abord le deck, puis créer la salle, afin que la partie commence sans étape manquante.'],
        ['Puis-je utiliser CommanderZone pour d’autres formats de Magic ?', 'CommanderZone est principalement centré sur Commander. Certains outils peuvent servir à d’autres formats, mais le produit est conçu autour des parties multijoueurs de Commander.'],
      ],
      pt: [
        ['CommanderZone é feito para Commander MTG?', 'Sim. CommanderZone foi feito especificamente para partidas de Commander MTG, online ou em mesa física.'],
        ['Preciso de um deck para criar uma partida?', 'Sim. Para jogar no CommanderZone, você precisa importar, criar ou selecionar um deck antes de começar.'],
        ['Posso criar uma sala sem deck?', 'A experiência principal foi pensada para preparar primeiro o deck e depois criar a sala, para que a partida comece sem etapas pendentes.'],
        ['Posso usar CommanderZone para outros formatos de Magic?', 'CommanderZone é focado principalmente em Commander. Algumas ferramentas podem servir para outros formatos, mas o produto foi desenhado para partidas multiplayer de Commander.'],
      ],
      it: [
        ['CommanderZone è pensato per Commander MTG?', 'Sì. CommanderZone è pensato specificamente per partite di Commander MTG, online o al tavolo fisico.'],
        ['Mi serve un mazzo per creare una partita?', 'Sì. Per giocare in CommanderZone devi importare, creare o selezionare un mazzo prima di iniziare.'],
        ['Posso creare una stanza senza mazzo?', 'L’esperienza principale è pensata per preparare prima il mazzo e poi creare la stanza, così la partita parte senza passaggi mancanti.'],
        ['Posso usare CommanderZone per altri formati di Magic?', 'CommanderZone è focalizzato principalmente su Commander. Alcuni strumenti possono essere utili anche per altri formati, ma il prodotto è progettato intorno alle partite multiplayer di Commander.'],
      ],
    } as const satisfies Record<(typeof SEO_LOCALE_CODES)[number], readonly (readonly [string, string])[]>;

    for (const locale of SEO_LOCALE_CODES) {
      const content = getSeoLandingContent('faq', locale);
      const visibleFaqs = new Map(content.faq.items.map((item) => [item.question, item.answer.join(' ')]));
      const serializedJsonLd = JSON.stringify(content.jsonLd);

      for (const [question, answer] of mandatoryFaqsByLocale[locale]) {
        expect(visibleFaqs.get(question)).toBe(answer);
        expect(serializedJsonLd).toContain(question);
        expect(serializedJsonLd).toContain(answer);
      }
    }
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
    expect(content.faq.items.length).toBe(18);
    expect(content.faq.items.map((item) => item.question)).toContain('¿Qué es CommanderZone?');
    expect(content.faq.items.map((item) => item.question)).toContain('¿Necesito un mazo para crear una partida?');
    expect(content.faq.items.map((item) => item.question)).toContain('¿CommanderZone sirve para Commander MTG?');
    expect(content.faq.items.map((item) => item.question)).toContain('¿CommanderZone sirve para otros formatos de Magic?');
    expect(content.faq.items.map((item) => item.question)).toContain('¿Premium vende contenido oficial de Magic?');
    expect(JSON.stringify(content.jsonLd)).toContain('FAQPage');
  });

  it('uses the final English home copy and deck registration CTA', () => {
    const content = getSeoLandingContent('home', 'en');

    expect(content.seo.title).toBe('CommanderZone | Play MTG Commander Online with Your Pod');
    expect(content.hero.title).toBe('Play Commander online with your pod');
    expect(content.hero.subtitle).toBe('Prepare your MTG Commander deck, enter CommanderZone and play online with a clear, manual table built for real multiplayer games.');
    expect(content.hero.highlights).toEqual([
      'Manual Commander table',
      'Decks connected to games',
      'Built for real pods',
      'Browser-based',
    ]);
    expect(content.sections).toHaveLength(4);
    expect(content.featureGrid?.features).toHaveLength(6);
    expect(content.faq.items).toHaveLength(4);
    expect(content.faq.items.map((item) => item.question)).toEqual([
      'Is CommanderZone built for MTG Commander?',
      'Do I need a deck to start?',
      'Does CommanderZone enforce Magic rules automatically?',
      'Can I use it for paper games?',
    ]);
    expect(content.hero.primaryLink.href).toBe('/auth/register?redirect=/decks');
    expect(content.hero.secondaryLink?.href).toBe('/auth/register?redirect=/decks');
    expect(content.cta?.primaryLink.href).toBe('/auth/register?redirect=/decks');
    expect(content.cta?.secondaryLink?.href).toBe('/auth/register?redirect=/decks');
  });

  it('uses a single self breadcrumb item for localized home pages', () => {
    for (const locale of SEO_LOCALE_CODES) {
      const content = getSeoLandingContent('home', locale);
      const breadcrumbList = findJsonLdNode(jsonLdGraph(content.jsonLd), 'BreadcrumbList');
      const itemListElement = breadcrumbList?.['itemListElement'];
      const breadcrumbEntries = Array.isArray(itemListElement) ? itemListElement : [];

      const expectedHomePath = locale === 'en' ? '/' : `/${locale}/`;

      expect(content.breadcrumb.items).toEqual([
        { label: 'CommanderZone', href: expectedHomePath },
      ]);
      expect(breadcrumbEntries).toEqual([
        expect.objectContaining({
          '@type': 'ListItem',
          position: 1,
          name: 'CommanderZone',
          item: `https://www.commanderzone.com${expectedHomePath}`,
        }),
      ]);
    }
  });

  it('uses the root URL for English home links and alternates', () => {
    const content = getSeoLandingContent('home', 'en');
    const localeLinks = new Map((content.localeLinks ?? []).map((link) => [link.locale, link.href]));

    expect(content.homeLink?.href).toBe('/');
    expect(localeLinks.get('en')).toBe('/');
    expect(localeLinks.get('es')).toBe('/es/');
    expect(getAllLandingHrefs(content)).not.toContain('/en/');
    expect(JSON.stringify(content.jsonLd)).toContain('https://www.commanderzone.com/');
    expect(JSON.stringify(content.jsonLd)).not.toContain('https://www.commanderzone.com/en/');
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

    expect(JSON.stringify(content.jsonLd)).toContain('https://www.commanderzone.com/es/asistente-mesa-commander/');
    expect(JSON.stringify(content.jsonLd)).toContain('"inLanguage":"es"');
    expect(softwareApplication?.['name']).toBe(content.hero.title);
    expect(softwareApplication?.['description']).toBe(content.seo.description);
    expect(breadcrumbList?.['itemListElement']).toEqual(expect.arrayContaining([
      expect.objectContaining({
        '@type': 'ListItem',
        position: 2,
        name: content.hero.title,
        item: 'https://www.commanderzone.com/es/asistente-mesa-commander/',
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

  it('uses localized public footer labels on non-English landings', () => {
    const content = getSeoLandingContent('home', 'de');
    const footerLabels = [
      ...(content.footerLinks?.map((link) => link.label) ?? []),
      ...(content.legalFooterLinks?.map((link) => link.label) ?? []),
    ];

    expect(footerLabels).toEqual([
      'Häufige Fragen',
      'Tischassistent',
      'Commander-Deck importieren',
      'Datenschutz',
      'Cookies',
      'Bedingungen',
      'Kontakt',
    ]);
    expect(footerLabels).not.toContain('Frequently asked questions');
    expect(footerLabels).not.toContain('Privacy Policy');
  });

  it('links from home to every main SEO landing with crawlable hrefs', () => {
    const content = getSeoLandingContent('home', 'en');
    const hrefs = getAllLandingHrefs(content);

    expect(hrefs).toEqual(expect.arrayContaining([
      '/en/play-commander-online/',
      '/en/play-magic-online-with-friends/',
      '/en/create-commander-room/',
      '/en/import-mtg-commander-deck/',
      '/en/mtg-commander-deck-builder/',
      '/en/commander-table-assistant/',
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
      '/es/jugar-magic-online-amigos/',
      '/es/crear-sala-commander/',
      '/es/importar-mazo-commander-mtg/',
      '/es/deck-builder-commander-mtg/',
      '/es/asistente-mesa-commander/',
      '/es/formas-jugar-commander-online/',
      '/es/como-jugar-commander-online/',
    ]));
  });

  it('routes conversion CTAs through the real auth entry funnel', () => {
    const decksLoginEntryPath = '/auth/login?redirect=/decks';
    const decksRegisterEntryPath = '/auth/register?redirect=/decks';
    const tableAssistantEntryPath = '/auth/register?redirect=/table-assistant';
    const forbiddenDirectCtaHrefs = new Set(['/rooms', '/decks/import', '/decks/new', '/rooms/create']);

    for (const { routeKey, content } of getAllSeoLandingContentEntries()) {
      const expectedHref = routeKey === 'home'
        ? decksRegisterEntryPath
        : routeKey === 'tableAssistant'
          ? tableAssistantEntryPath
          : decksLoginEntryPath;
      const ctaHrefs = [
        content.hero.primaryLink.href,
        content.hero.secondaryLink?.href,
        content.cta?.primaryLink.href,
        content.cta?.secondaryLink?.href,
      ].filter((href): href is string => href !== undefined);

      expect({
        routeKey,
        locale: content.locale,
        ctaHrefs,
      }).toEqual({
        routeKey,
        locale: content.locale,
        ctaHrefs: [expectedHref, expectedHref, expectedHref, expectedHref],
      });

      for (const href of ctaHrefs) {
        expect(forbiddenDirectCtaHrefs.has(href)).toBe(false);
        expect(href.startsWith('/decks?intent=')).toBe(false);
      }
    }

    expect(getSeoLandingContent('home', 'es').hero.primaryLink.label).toBe('Entrar y preparar mazo');
    expect(getSeoLandingContent('playCommanderOnline', 'en').hero.primaryLink.label).toBe('Sign in to play Commander');
    expect(getSeoLandingContent('createCommanderRoom', 'en').hero.secondaryLink?.label).toBe('Go to my decks');
    expect(getSeoLandingContent('tableAssistant', 'fr').hero.primaryLink.label).toBe('Ouvrir l’assistant de table');
    expect(getSeoLandingContent('tableAssistant', 'it').hero.secondaryLink?.label).toBe('Apri CommanderZone');
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
    ...(content.legalFooterLinks?.map((link) => link.href) ?? []),
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
    ...(content.legalFooterLinks?.map((link) => link.label) ?? []),
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
