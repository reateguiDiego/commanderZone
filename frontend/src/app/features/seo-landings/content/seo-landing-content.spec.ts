import { SEO_LOCALE_CODES } from '../../../core/localization/locale-config';
import { getSeoPath, SEO_ROUTE_KEYS } from '../../../core/localization/seo-routes';
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
    expect(content.seo.title).toBe('Play Commander Online in Your Browser | CommanderZone');
    expect(content.seo.description).toBe('Play Commander online with your pod from the browser. Prepare decks, create rooms, track life totals and use a manual MTG Commander table.');
    expect(content.seo.ogImage).toBe('/assets/og/play-commander-og.png');
    expect(content.hero.title).toBe('Play Commander online in your browser');
    expect(content.hero.primaryLink).toEqual({
      label: 'Sign in to play Commander',
      href: '/auth/login?redirect=/decks',
    });
    expect(content.hero.secondaryLink).toEqual({
      label: 'How to play Commander',
      href: '/en/how-to-play-commander-online/',
    });
    expect(content.breadcrumb.items.length).toBeGreaterThan(0);
    expect(content.internalLinks.links.length).toBeGreaterThan(0);
    expect(content.faq.items.length).toBeGreaterThan(0);
    expect(content.jsonLd).toBeTruthy();
  });

  it('provides the five high-intent prompt 7 landings with mandatory metadata', () => {
    const promptSevenRoutes = [
      'spellTableAlternative',
      'playCommanderOnlineFree',
      'playCommanderWithoutWebcam',
      'playEdhOnline',
      'commanderSimulator',
    ] as const;

    expect(SEO_ROUTE_KEYS).toEqual(expect.arrayContaining([...promptSevenRoutes]));
    expect(getSeoLandingContent('spellTableAlternative', 'en').seo.title).toBe('SpellTable Alternative for Commander Online | CommanderZone');
    expect(getSeoLandingContent('spellTableAlternative', 'en').hero.title).toBe('A SpellTable alternative for digital Commander pods');
    expect(getSeoLandingContent('playCommanderOnlineFree', 'en').seo.title).toBe('Play Commander Online Free in Your Browser | CommanderZone');
    expect(getSeoLandingContent('playCommanderOnlineFree', 'es').hero.title).toBe('Jugar Commander online gratis desde el navegador');
    expect(getSeoLandingContent('playCommanderWithoutWebcam', 'en').hero.title).toBe('Play Commander online without a webcam setup');
    expect(getSeoLandingContent('playEdhOnline', 'en').sections?.map((section) => section.body.join(' ')).join(' ')).toContain('EDH is the community name many players still use for Commander.');
    expect(getSeoLandingContent('commanderSimulator', 'en').seo.title).toBe('MTG Commander Simulator for Manual Online Pods | CommanderZone');
    expect(getSeoLandingContent('commanderSimulator', 'en').hero.title).toBe('A manual MTG Commander simulator for online pods');

    for (const routeKey of promptSevenRoutes) {
      for (const locale of SEO_LOCALE_CODES) {
        const content = getSeoLandingContent(routeKey, locale);

        expect(content.routeKey).toBe(routeKey);
        expect(content.locale).toBe(locale);
        expect(content.seo.title).toContain('CommanderZone');
        expect(content.seo.description.length).toBeGreaterThanOrEqual(50);
        expect(content.hero.title.length).toBeGreaterThan(0);
        expect(content.faq.items.length).toBeGreaterThanOrEqual(3);
        expect(content.jsonLd).toBeTruthy();
      }
    }
  });

  it('links every prompt 7 landing to the required localized SEO pages', () => {
    const promptSevenRoutes = [
      'spellTableAlternative',
      'playCommanderOnlineFree',
      'playCommanderWithoutWebcam',
      'playEdhOnline',
      'commanderSimulator',
    ] as const;
    const requiredLinks = [
      'home',
      'playCommanderOnline',
      'createCommanderRoom',
      'importCommanderDeck',
      'tableAssistant',
      'faq',
    ] as const;

    for (const routeKey of promptSevenRoutes) {
      for (const locale of SEO_LOCALE_CODES) {
        const hrefs = getAllLandingHrefs(getSeoLandingContent(routeKey, locale));

        for (const linkedRouteKey of requiredLinks) {
          expect({ routeKey, locale, linkedRouteKey, hasLink: hrefs.includes(getSeoPath(linkedRouteKey, locale)) }).toEqual({
            routeKey,
            locale,
            linkedRouteKey,
            hasLink: true,
          });
        }
      }
    }

    expect(getAllLandingHrefs(getSeoLandingContent('spellTableAlternative', 'en'))).toContain('/en/play-commander-online-without-webcam/');
    expect(getAllLandingHrefs(getSeoLandingContent('playCommanderWithoutWebcam', 'es'))).toContain('/es/alternativa-spelltable/');
    expect(getAllLandingHrefs(getSeoLandingContent('commanderSimulator', 'en'))).toContain('/en/play-commander-online-free/');
    expect(getAllLandingHrefs(getSeoLandingContent('playEdhOnline', 'en'))).toContain('/en/play-commander-online/');
  });

  it('keeps prompt 7 claims honest and manual', () => {
    const promptSevenText = [
      'spellTableAlternative',
      'playCommanderOnlineFree',
      'playCommanderWithoutWebcam',
      'playEdhOnline',
      'commanderSimulator',
    ] as const satisfies readonly (typeof SEO_ROUTE_KEYS)[number][];

    for (const routeKey of promptSevenText) {
      for (const locale of SEO_LOCALE_CODES) {
        const visibleContent = getVisibleSeoTexts(getSeoLandingContent(routeKey, locale)).join(' ');

        expect({ routeKey, locale, automaticGameplaySimulator: visibleContent.includes('automatic gameplay simulator') }).toEqual({
          routeKey,
          locale,
          automaticGameplaySimulator: false,
        });
        expect({ routeKey, locale, promisesRuleEngine: /rules engine that enforces|motor de reglas que aplica|automatischer Regelmotor der/i.test(visibleContent) }).toEqual({
          routeKey,
          locale,
          promisesRuleEngine: false,
        });
      }
    }

    expect(getVisibleSeoTexts(getSeoLandingContent('commanderSimulator', 'en')).join(' ')).toContain('manual simulator');
    expect(getVisibleSeoTexts(getSeoLandingContent('spellTableAlternative', 'en')).join(' ')).toContain('not a rules engine');
  });

  it('keeps table assistant SEO content separate from the internal table assistant app route', () => {
    const content = getSeoLandingContent('tableAssistant', 'es');

    expect(content.hero.title.toLowerCase()).toContain('contador de vidas');
    expect(content.seo.title).toBe('Contador de vidas Commander MTG | CommanderZone');
    expect(content.seo.description).toBe('Usa CommanderZone como contador de vidas para Commander MTG físico. Controla vidas, daño de comandante y estado de mesa desde móvil o tablet.');
    expect(content.seo.ogImage).toBe('/assets/og/table-assistant-og.png');
    expect(content.internalLinks.links.map((link) => link.href)).not.toContain('/table-assistant');
    expect(content.internalLinks.links.every((link) => link.href.startsWith('/es/'))).toBe(true);
  });

  it('uses the prompt 8 SEO titles for existing landings', () => {
    const expectedTitles = {
      home: {
        en: 'CommanderZone | Play MTG Commander Online with Your Pod',
        es: 'CommanderZone | Jugar Commander MTG online con tu grupo',
        de: 'CommanderZone | MTG Commander online mit deiner Gruppe spielen',
        fr: 'CommanderZone | Jouer à Commander MTG en ligne avec votre groupe',
        pt: 'CommanderZone | Jogar Commander MTG online com seu grupo',
        it: 'CommanderZone | Giocare Commander MTG online con il tuo gruppo',
      },
      playCommanderOnline: {
        en: 'Play Commander Online in Your Browser | CommanderZone',
        es: 'Jugar Commander online en el navegador | CommanderZone',
        de: 'Commander online im Browser spielen | CommanderZone',
        fr: 'Jouer à Commander en ligne dans le navigateur | CommanderZone',
        pt: 'Jogar Commander online no navegador | CommanderZone',
        it: 'Giocare Commander online nel browser | CommanderZone',
      },
      playMagicOnlineWithFriends: {
        en: 'Play Magic Online with Friends for Commander | CommanderZone',
        es: 'Jugar Magic online con amigos en Commander | CommanderZone',
        de: 'Magic online mit Freunden für Commander spielen | CommanderZone',
        fr: 'Jouer à Magic en ligne avec des amis | CommanderZone',
        pt: 'Jogar Magic online com amigos no Commander | CommanderZone',
        it: 'Giocare Magic online con amici in Commander | CommanderZone',
      },
      createCommanderRoom: {
        en: 'Create a Private Commander Room Online | CommanderZone',
        es: 'Crear una sala privada de Commander online | CommanderZone',
        de: 'Privaten Commander-Raum online erstellen | CommanderZone',
        fr: 'Créer une salle Commander privée en ligne | CommanderZone',
        pt: 'Criar uma sala privada de Commander online | CommanderZone',
        it: 'Creare una stanza Commander privata online | CommanderZone',
      },
      importCommanderDeck: {
        en: 'Import a Commander Deck and Play Online | CommanderZone',
        es: 'Importar un mazo Commander para jugar online | CommanderZone',
        de: 'Commander-Deck importieren und online spielen | CommanderZone',
        fr: 'Importer un deck Commander pour jouer en ligne | CommanderZone',
        pt: 'Importar um deck Commander para jogar online | CommanderZone',
        it: 'Importare un mazzo Commander per giocare online | CommanderZone',
      },
      commanderDeckBuilder: {
        en: 'Commander Deck Builder for Online MTG Pods | CommanderZone',
        es: 'Deck builder Commander para MTG online | CommanderZone',
        de: 'Commander Deck Builder für Online-MTG | CommanderZone',
        fr: 'Deck builder Commander pour MTG en ligne | CommanderZone',
        pt: 'Deck builder Commander para MTG online | CommanderZone',
        it: 'Deck builder Commander per MTG online | CommanderZone',
      },
      waysToPlayCommanderOnline: {
        en: 'Ways to Play Commander Online with Your Pod | CommanderZone',
        es: 'Formas de jugar Commander online con tu grupo | CommanderZone',
        de: 'Möglichkeiten, Commander online zu spielen | CommanderZone',
        fr: 'Façons de jouer à Commander en ligne | CommanderZone',
        pt: 'Formas de jogar Commander online com seu grupo | CommanderZone',
        it: 'Modi per giocare Commander online con il tuo gruppo | CommanderZone',
      },
      howToPlayCommanderOnline: {
        en: 'How to Play Commander Online Step by Step | CommanderZone',
        es: 'Cómo jugar Commander online paso a paso | CommanderZone',
        de: 'Commander online spielen: Anleitung | CommanderZone',
        fr: 'Comment jouer à Commander en ligne | CommanderZone',
        pt: 'Como jogar Commander online passo a passo | CommanderZone',
        it: 'Come giocare Commander online passo dopo passo | CommanderZone',
      },
      faq: {
        en: 'CommanderZone FAQ | Commander Online Questions',
        es: 'FAQ de CommanderZone | Preguntas sobre Commander online',
        de: 'CommanderZone FAQ | Fragen zu Commander online',
        fr: 'FAQ CommanderZone | Questions sur Commander en ligne',
        pt: 'FAQ CommanderZone | Perguntas sobre Commander online',
        it: 'FAQ CommanderZone | Domande su Commander online',
      },
    } as const;

    for (const [routeKey, titlesByLocale] of Object.entries(expectedTitles)) {
      for (const [locale, title] of Object.entries(titlesByLocale)) {
        expect(getSeoLandingContent(routeKey as Parameters<typeof getSeoLandingContent>[0], locale as Parameters<typeof getSeoLandingContent>[1]).seo.title).toBe(title);
      }
    }

    expect(getSeoLandingContent('playCommanderOnline', 'es').seo.description).toBe('Juega Commander online con tu grupo desde el navegador. Prepara mazos, crea salas, controla vidas y usa una mesa manual para MTG Commander.');
    expect(getSeoLandingContent('tableAssistant', 'en').seo.description).toBe('Use CommanderZone as a Commander life counter for paper MTG games. Track life totals, commander damage and table state on phone or tablet.');
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
        ['¿Qué es CommanderZone?', 'CommanderZone es una mesa digital manual para Magic: The Gathering Commander. Ayuda a tu grupo a preparar mazos, crear salas, controlar vidas y daño de comandante, y jugar online desde el navegador.'],
        ['¿CommanderZone es oficial?', 'No. CommanderZone es contenido de fans no oficial. No está aprobado, respaldado, patrocinado ni afiliado a Wizards of the Coast, Hasbro ni Magic: The Gathering.'],
        ['¿CommanderZone aplica reglas de Magic automáticamente?', 'No. CommanderZone es manual a propósito. Los jugadores siguen siendo responsables de acciones, triggers, prioridad, pila y decisiones legales, como en una mesa real de Commander.'],
      ],
      en: [
        ['What is CommanderZone?', 'CommanderZone is a manual digital table for Magic: The Gathering Commander. It helps your group prepare decks, create rooms, track life totals and commander damage, and play online from the browser.'],
        ['Is CommanderZone official?', 'No. CommanderZone is unofficial fan content. It is not approved, endorsed, sponsored or affiliated with Wizards of the Coast, Hasbro or Magic: The Gathering.'],
        ['Does CommanderZone enforce Magic rules automatically?', 'No. CommanderZone is intentionally manual. Players remain responsible for game actions, triggers, priority, the stack and legal decisions, just like at a real Commander table.'],
      ],
      de: [
        ['Was ist CommanderZone?', 'CommanderZone ist ein manueller digitaler Tisch für Magic: The Gathering Commander. Er hilft deiner Gruppe, Decks vorzubereiten, Räume zu erstellen, Lebenspunkte und Commander-Schaden zu verfolgen und online im Browser zu spielen.'],
        ['Ist CommanderZone offiziell?', 'Nein. CommanderZone ist inoffizieller Fan Content. Es ist nicht von Wizards of the Coast, Hasbro oder Magic: The Gathering genehmigt, unterstützt, gesponsert oder mit ihnen verbunden.'],
        ['Wendet CommanderZone Magic-Regeln automatisch an?', 'Nein. CommanderZone ist bewusst manuell. Die Spieler bleiben für Aktionen, Trigger, Priorität, den Stack und legale Entscheidungen verantwortlich, wie an einem echten Commander-Tisch.'],
      ],
      fr: [
        ['Qu’est-ce que CommanderZone ?', 'CommanderZone est une table numérique manuelle pour Magic: The Gathering Commander. Elle aide votre groupe à préparer des decks, créer des salles, suivre les points de vie et les blessures de commandant, et jouer en ligne depuis le navigateur.'],
        ['CommanderZone est-il officiel ?', 'Non. CommanderZone est un contenu de fan non officiel. Il n’est pas approuvé, soutenu, sponsorisé ni affilié à Wizards of the Coast, Hasbro ou Magic: The Gathering.'],
        ['CommanderZone applique-t-il automatiquement les règles de Magic ?', 'Non. CommanderZone est volontairement manuel. Les joueurs restent responsables des actions, triggers, priorités, de la pile et des décisions légales, comme autour d’une vraie table Commander.'],
      ],
      pt: [
        ['O que é o CommanderZone?', 'CommanderZone é uma mesa digital manual para Magic: The Gathering Commander. Ele ajuda seu grupo a preparar decks, criar salas, acompanhar vida e dano de comandante, e jogar online pelo navegador.'],
        ['CommanderZone é oficial?', 'Não. CommanderZone é conteúdo de fã não oficial. Não é aprovado, endossado, patrocinado nem afiliado à Wizards of the Coast, Hasbro ou Magic: The Gathering.'],
        ['CommanderZone aplica regras de Magic automaticamente?', 'Não. CommanderZone é manual de propósito. Os jogadores continuam responsáveis por ações, triggers, prioridade, pilha e decisões legais, como em uma mesa real de Commander.'],
      ],
      it: [
        ['Che cos’è CommanderZone?', 'CommanderZone è un tavolo digitale manuale per Magic: The Gathering Commander. Aiuta il tuo gruppo a preparare mazzi, creare stanze, seguire punti vita e danno da comandante, e giocare online dal browser.'],
        ['CommanderZone è ufficiale?', 'No. CommanderZone è contenuto fan non ufficiale. Non è approvato, supportato, sponsorizzato né affiliato a Wizards of the Coast, Hasbro o Magic: The Gathering.'],
        ['CommanderZone applica automaticamente le regole di Magic?', 'No. CommanderZone è volutamente manuale. I giocatori restano responsabili di azioni, trigger, priorità, pila e decisioni legali, come a un vero tavolo Commander.'],
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
    expect(content.hero.title).toBe('FAQ de CommanderZone sobre Commander online');
    expect(content.faq.items.length).toBe(12);
    expect(content.faq.items.map((item) => item.question)).toContain('¿Qué es CommanderZone?');
    expect(content.faq.items.map((item) => item.question)).toContain('¿CommanderZone es oficial?');
    expect(content.faq.items.map((item) => item.question)).toContain('¿CommanderZone sustituye a MTG Arena o Magic Online?');
    expect(content.faq.items.map((item) => item.question)).toContain('¿Dónde puedo reportar bugs o problemas de derechos?');
    expect(JSON.stringify(content.jsonLd)).toContain('FAQPage');
  });

  it('keeps FAQ questions unique and final-copy oriented', () => {
    const forbiddenFaqCopy = /ideal|should|may include|puede incluir|experiencia ideal|tendrá sentido|podrá formar parte|podrán formar parte/i;

    for (const { routeKey, locale, content } of getAllSeoLandingContentEntries()) {
      const questions = content.faq.items.map((item) => item.question);
      const faqText = content.faq.items.flatMap((item) => [item.question, ...item.answer]).join(' ');

      expect({ routeKey, locale, duplicateQuestions: findDuplicates(questions) }).toEqual({
        routeKey,
        locale,
        duplicateQuestions: [],
      });
      expect({ routeKey, locale, hasSpeculativeCopy: forbiddenFaqCopy.test(faqText) }).toEqual({
        routeKey,
        locale,
        hasSpeculativeCopy: false,
      });
    }
  });

  it('uses the final English home copy and deck registration CTA', () => {
    const content = getSeoLandingContent('home', 'en');

    expect(content.seo.title).toBe('CommanderZone | Play MTG Commander Online with Your Pod');
    expect(content.hero.title).toBe('Play Commander online with your pod');
    expect(content.hero.subtitle).toBe('Prepare your Commander deck, open CommanderZone in the browser and play with a clear manual table for rooms, life totals and commander damage.');
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
    expect(content.hero.primaryLink.href).toBe('/auth/login?redirect=/decks');
    expect(content.hero.secondaryLink?.href).toBe('/en/how-to-play-commander-online/');
    expect(content.cta?.primaryLink.href).toBe('/auth/login?redirect=/decks');
    expect(content.cta?.secondaryLink?.href).toBe('/en/how-to-play-commander-online/');
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

    expect(JSON.stringify(content.jsonLd)).toContain('https://www.commanderzone.com/es/contador-vidas-commander/');
    expect(JSON.stringify(content.jsonLd)).toContain('"inLanguage":"es"');
    expect(softwareApplication?.['name']).toBe(content.hero.title);
    expect(softwareApplication?.['description']).toBe(content.seo.description);
    expect(breadcrumbList?.['itemListElement']).toEqual(expect.arrayContaining([
      expect.objectContaining({
        '@type': 'ListItem',
        position: 2,
        name: content.hero.title,
        item: 'https://www.commanderzone.com/es/contador-vidas-commander/',
      }),
    ]));
    expect(faqQuestions.length).toBe(content.faq.items.length);
    expect(faqQuestions.map((item) => {
      const question = asJsonLdObject(item);
      const answer = asJsonLdObject(question?.['acceptedAnswer']);

      return {
        question: question?.['name'],
        answer: answer?.['text'],
      };
    })).toEqual(content.faq.items.map((item) => ({
      question: item.question,
      answer: item.answer.join(' '),
    })));
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
      '/es/crear-sala-commander/',
      '/es/importar-mazo-commander/',
      '/es/deck-builder-commander/',
      '/es/contador-vidas-commander/',
      '/es/formas-jugar-commander-online/',
      '/es/como-jugar-commander-online/',
    ]));
  });

  it('routes primary CTAs through the real app entry funnel and secondary CTAs through SEO pages', () => {
    const decksLoginEntryPath = '/auth/login?redirect=/decks';
    const tableAssistantEntryPath = '/auth/login?redirect=/table-assistant';
    const forbiddenDirectCtaHrefs = new Set(['/rooms', '/decks/import', '/decks/new', '/rooms/create']);
    const expectedSecondaryRoute = {
      home: 'howToPlayCommanderOnline',
      playCommanderOnline: 'howToPlayCommanderOnline',
      playMagicOnlineWithFriends: 'waysToPlayCommanderOnline',
      createCommanderRoom: 'howToPlayCommanderOnline',
      importCommanderDeck: 'faq',
      commanderDeckBuilder: 'faq',
      tableAssistant: 'faq',
      waysToPlayCommanderOnline: 'howToPlayCommanderOnline',
      howToPlayCommanderOnline: 'waysToPlayCommanderOnline',
      spellTableAlternative: 'playCommanderWithoutWebcam',
      playCommanderOnlineFree: 'faq',
      playCommanderWithoutWebcam: 'spellTableAlternative',
      playEdhOnline: 'playCommanderOnline',
      commanderSimulator: 'playCommanderOnlineFree',
      faq: 'playCommanderOnline',
    } as const satisfies Record<(typeof SEO_ROUTE_KEYS)[number], (typeof SEO_ROUTE_KEYS)[number]>;

    for (const { routeKey, content } of getAllSeoLandingContentEntries()) {
      const expectedPrimaryHref = routeKey === 'tableAssistant' ? tableAssistantEntryPath : decksLoginEntryPath;
      const expectedSecondaryHref = getSeoPath(expectedSecondaryRoute[routeKey], content.locale);
      const primaryHrefs = [content.hero.primaryLink.href, content.cta?.primaryLink.href].filter((href): href is string => href !== undefined);
      const secondaryHrefs = [content.hero.secondaryLink?.href, content.cta?.secondaryLink?.href].filter((href): href is string => href !== undefined);

      expect({ routeKey, locale: content.locale, primaryHrefs }).toEqual({
        routeKey,
        locale: content.locale,
        primaryHrefs: [expectedPrimaryHref, expectedPrimaryHref],
      });
      expect({ routeKey, locale: content.locale, secondaryHrefs }).toEqual({
        routeKey,
        locale: content.locale,
        secondaryHrefs: [expectedSecondaryHref, expectedSecondaryHref],
      });

      for (const href of [...primaryHrefs, ...secondaryHrefs]) {
        expect(forbiddenDirectCtaHrefs.has(href)).toBe(false);
        expect(href.startsWith('/decks?intent=')).toBe(false);
      }
    }

    expect(getSeoLandingContent('home', 'es').hero.primaryLink.label).toBe('Entrar y preparar mazo');
    expect(getSeoLandingContent('playCommanderOnline', 'en').hero.secondaryLink?.label).toBe('How to play Commander');
    expect(getSeoLandingContent('createCommanderRoom', 'en').hero.secondaryLink?.href).toBe('/en/how-to-play-commander-online/');
    expect(getSeoLandingContent('tableAssistant', 'fr').hero.primaryLink.label).toBe('Ouvrir le compteur Commander');
    expect(getSeoLandingContent('tableAssistant', 'it').hero.secondaryLink?.label).toBe('Leggi FAQ');
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
    expect(getSeoLandingContent('playCommanderOnline', 'it').hero.title).toBe('Giocare Commander online nel browser');
    expect(getSeoLandingContent('faq', 'it').faq.items.map((item) => item.question)).toContain('Che cos’è CommanderZone?');
  });

  it('keeps SEO titles, descriptions and H1s useful per locale', () => {
    for (const locale of SEO_LOCALE_CODES) {
      const titles = SEO_ROUTE_KEYS.map((routeKey) => getSeoLandingContent(routeKey, locale).seo.title);
      const descriptions = SEO_ROUTE_KEYS.map((routeKey) => getSeoLandingContent(routeKey, locale).seo.description);
      const h1s = SEO_ROUTE_KEYS.map((routeKey) => getSeoLandingContent(routeKey, locale).hero.title);

      expect({ locale, duplicateTitles: findDuplicates(titles) }).toEqual({
        locale,
        duplicateTitles: [],
      });
      expect({ locale, duplicateDescriptions: findDuplicates(descriptions) }).toEqual({
        locale,
        duplicateDescriptions: [],
      });
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

  it('keeps EDH wording scoped to the dedicated EDH landing', () => {
    for (const { routeKey, content } of getAllSeoLandingContentEntries()) {
      const visibleContent = getVisibleSeoTexts(content).join(' ');
      const containsEdh = /\bEDH\b/.test(visibleContent);

      expect({ routeKey, locale: content.locale, containsEdh }).toEqual({
        routeKey,
        locale: content.locale,
        containsEdh: routeKey === 'playEdhOnline',
      });
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

function findDuplicates(values: readonly string[]): readonly string[] {
  return values.filter((value, index) => values.indexOf(value) !== index);
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
