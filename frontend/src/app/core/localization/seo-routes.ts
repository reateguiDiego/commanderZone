import { LocaleCode, SUPPORTED_LOCALE_CODES } from './locale-config';
import { PAGE_TRANSLATION_STRATEGIES, PageKey } from './page-translation-strategy';

export type SeoRouteKey = {
  [Key in PageKey]: typeof PAGE_TRANSLATION_STRATEGIES[Key] extends 'seo-static' ? Key : never;
}[PageKey];

export type SeoLocalizedSlugs = Readonly<Record<LocaleCode, string>>;

export interface SeoRouteConfig {
  readonly routeKey: SeoRouteKey;
  readonly slugs: SeoLocalizedSlugs;
}

export interface SeoRouteMatch {
  readonly routeKey: SeoRouteKey;
  readonly locale: LocaleCode;
  readonly path: string;
}

export const SEO_ROUTES = {
  home: {
    routeKey: 'home',
    slugs: {
      es: '',
      en: '',
      de: '',
      fr: '',
      it: '',
      pt: '',
      ja: '',
      ko: '',
      'zh-hans': '',
      'zh-hant': '',
      nl: '',
      ca: '',
      ru: '',
    },
  },
  playCommanderOnline: {
    routeKey: 'playCommanderOnline',
    slugs: {
      es: 'jugar-commander-online',
      en: 'play-commander-online',
      de: 'commander-online-spielen',
      fr: 'jouer-commander-en-ligne',
      it: 'giocare-commander-online',
      pt: 'jogar-commander-online',
      ja: 'commander-online-play',
      ko: 'commander-online-peullei',
      'zh-hans': 'zaixian-commander',
      'zh-hant': 'zaixian-commander',
      nl: 'commander-online-spelen',
      ca: 'jugar-commander-online',
      ru: 'igrat-commander-onlain',
    },
  },
  playMagicOnlineWithFriends: {
    routeKey: 'playMagicOnlineWithFriends',
    slugs: {
      es: 'jugar-magic-online-con-amigos',
      en: 'play-magic-online-with-friends',
      de: 'magic-online-mit-freunden-spielen',
      fr: 'jouer-magic-en-ligne-avec-des-amis',
      it: 'giocare-magic-online-con-amici',
      pt: 'jogar-magic-online-com-amigos',
      ja: 'tomodachi-to-magic-online',
      ko: 'chinguwa-magic-online',
      'zh-hans': 'he-pengyou-zaixian-wan-magic',
      'zh-hant': 'he-pengyou-zaixian-wan-magic',
      nl: 'magic-online-met-vrienden-spelen',
      ca: 'jugar-magic-online-amb-amics',
      ru: 'igrat-magic-onlain-s-druzyami',
    },
  },
  createCommanderRoom: {
    routeKey: 'createCommanderRoom',
    slugs: {
      es: 'crear-sala-commander-online',
      en: 'create-commander-room',
      de: 'commander-raum-erstellen',
      fr: 'creer-salon-commander',
      it: 'creare-stanza-commander',
      pt: 'criar-sala-commander',
      ja: 'commander-room-create',
      ko: 'commander-bang-mandeulgi',
      'zh-hans': 'chuangjian-commander-fangjian',
      'zh-hant': 'jianli-commander-fangjian',
      nl: 'commander-kamer-maken',
      ca: 'crear-sala-commander',
      ru: 'sozdat-komnatu-commander',
    },
  },
  importCommanderDeck: {
    routeKey: 'importCommanderDeck',
    slugs: {
      es: 'importar-mazo-commander',
      en: 'import-commander-deck',
      de: 'commander-deck-importieren',
      fr: 'importer-deck-commander',
      it: 'importare-mazzo-commander',
      pt: 'importar-deck-commander',
      ja: 'commander-deck-import',
      ko: 'commander-deck-import',
      'zh-hans': 'daoru-commander-kazupai',
      'zh-hant': 'daoru-commander-kazupai',
      nl: 'commander-deck-importeren',
      ca: 'importar-baralla-commander',
      ru: 'import-kolody-commander',
    },
  },
  commanderDeckBuilder: {
    routeKey: 'commanderDeckBuilder',
    slugs: {
      es: 'deck-builder-commander',
      en: 'commander-deck-builder',
      de: 'commander-deck-builder',
      fr: 'constructeur-deck-commander',
      it: 'deck-builder-commander',
      pt: 'construtor-deck-commander',
      ja: 'commander-deck-builder',
      ko: 'commander-deck-builder',
      'zh-hans': 'commander-kazupai-goujianqi',
      'zh-hant': 'commander-kazupai-goujianqi',
      nl: 'commander-deckbuilder',
      ca: 'constructor-baralles-commander',
      ru: 'konstruktor-kolod-commander',
    },
  },
  tableAssistant: {
    routeKey: 'tableAssistant',
    slugs: {
      es: 'asistente-de-mesa-magic',
      en: 'commander-life-counter',
      de: 'mtg-life-counter',
      fr: 'compteur-vie-mtg',
      it: 'contatore-vite-mtg',
      pt: 'contador-vida-mtg',
      ja: 'mtg-life-counter',
      ko: 'mtg-life-counter',
      'zh-hans': 'mtg-shengming-jishuqi',
      'zh-hant': 'mtg-shengming-jishuqi',
      nl: 'mtg-levens-teller',
      ca: 'assistent-de-taula-magic',
      ru: 'schetchik-zhizni-mtg',
    },
  },
  waysToPlayCommanderOnline: {
    routeKey: 'waysToPlayCommanderOnline',
    slugs: {
      es: 'formas-de-jugar-commander-online',
      en: 'ways-to-play-commander-online',
      de: 'commander-online-spielarten',
      fr: 'facons-de-jouer-commander-en-ligne',
      it: 'modi-per-giocare-commander-online',
      pt: 'formas-de-jogar-commander-online',
      ja: 'commander-online-play-ways',
      ko: 'commander-online-bangbeop',
      'zh-hans': 'zaixian-commander-wanfa',
      'zh-hant': 'zaixian-commander-wanfa',
      nl: 'manieren-om-commander-online-te-spelen',
      ca: 'formes-de-jugar-commander-online',
      ru: 'sposoby-igrat-commander-onlain',
    },
  },
  howToPlayCommanderOnline: {
    routeKey: 'howToPlayCommanderOnline',
    slugs: {
      es: 'como-jugar-commander-online',
      en: 'how-to-play-commander-online',
      de: 'commander-online-anleitung',
      fr: 'comment-jouer-commander-en-ligne',
      it: 'come-giocare-commander-online',
      pt: 'como-jogar-commander-online',
      ja: 'commander-online-how-to-play',
      ko: 'commander-online-haneun-beop',
      'zh-hans': 'ruhe-wan-zaixian-commander',
      'zh-hant': 'ruhe-wan-zaixian-commander',
      nl: 'hoe-speel-je-commander-online',
      ca: 'com-jugar-commander-online',
      ru: 'kak-igrat-commander-onlain',
    },
  },
  faq: {
    routeKey: 'faq',
    slugs: {
      es: 'faq',
      en: 'faq',
      de: 'faq',
      fr: 'faq',
      it: 'faq',
      pt: 'faq',
      ja: 'faq',
      ko: 'faq',
      'zh-hans': 'faq',
      'zh-hant': 'faq',
      nl: 'faq',
      ca: 'faq',
      ru: 'faq',
    },
  },
} as const satisfies Record<SeoRouteKey, SeoRouteConfig>;

export const SEO_ROUTE_KEYS = Object.keys(SEO_ROUTES) as SeoRouteKey[];

assertValidSeoRoutes();

export function getSeoPath(routeKey: SeoRouteKey, locale: LocaleCode): string {
  const slug = SEO_ROUTES[routeKey].slugs[locale];
  return slug ? `/${locale}/${slug}/` : `/${locale}/`;
}

export function getLocalizedRouteAlternates(routeKey: SeoRouteKey): Readonly<Record<LocaleCode, string>> {
  return Object.fromEntries(
    SUPPORTED_LOCALE_CODES.map((locale) => [locale, getSeoPath(routeKey, locale)]),
  ) as Record<LocaleCode, string>;
}

export function findSeoRouteByPath(path: string): SeoRouteMatch | undefined {
  const normalizedPath = normalizeSeoPath(path);

  for (const routeKey of SEO_ROUTE_KEYS) {
    for (const locale of SUPPORTED_LOCALE_CODES) {
      const seoPath = getSeoPath(routeKey, locale);

      if (normalizeSeoPath(seoPath) === normalizedPath) {
        return {
          routeKey,
          locale,
          path: seoPath,
        };
      }
    }
  }

  return undefined;
}

function assertValidSeoRoutes(): void {
  for (const routeKey of SEO_ROUTE_KEYS) {
    if (PAGE_TRANSLATION_STRATEGIES[routeKey] !== 'seo-static') {
      throw new Error(`SEO route ${routeKey} is not classified as seo-static.`);
    }
  }

  for (const locale of SUPPORTED_LOCALE_CODES) {
    const slugs = SEO_ROUTE_KEYS.map((routeKey) => SEO_ROUTES[routeKey].slugs[locale]);
    const duplicateSlug = slugs.find((slug, index) => slugs.indexOf(slug) !== index);

    if (duplicateSlug !== undefined) {
      throw new Error(`Duplicated SEO slug for locale ${locale}: ${duplicateSlug || '(home)'}.`);
    }

    for (const slug of slugs) {
      if (slug.startsWith('/') || slug.endsWith('/')) {
        throw new Error(`SEO slug for locale ${locale} must not include slashes: ${slug}.`);
      }
    }
  }
}

function normalizeSeoPath(path: string): string {
  const [pathWithoutHash] = path.split('#');
  const [pathWithoutQuery] = (pathWithoutHash ?? '').split('?');
  const pathOnly = pathWithoutQuery ?? '';
  const withLeadingSlash = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  return withLeadingSlash.replace(/\/+$/, '') || '/';
}
