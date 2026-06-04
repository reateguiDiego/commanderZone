import { SEO_LOCALE_CODES, SeoLocaleCode } from './locale-config';
import { PAGE_TRANSLATION_STRATEGIES, PageKey } from './page-translation-strategy';

export type SeoRouteKey = {
  [Key in PageKey]: typeof PAGE_TRANSLATION_STRATEGIES[Key] extends 'seo-static' ? Key : never;
}[PageKey];

export type SeoLocalizedSlugs = Readonly<Record<SeoLocaleCode, string>>;

export interface SeoRouteConfig {
  readonly routeKey: SeoRouteKey;
  readonly slugs: SeoLocalizedSlugs;
}

export interface SeoRouteMatch {
  readonly routeKey: SeoRouteKey;
  readonly locale: SeoLocaleCode;
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
    },
  },
  playMagicOnlineWithFriends: {
    routeKey: 'playMagicOnlineWithFriends',
    slugs: {
      es: 'jugar-magic-online-amigos',
      en: 'play-magic-online-with-friends',
      de: 'magic-online-mit-freunden-spielen',
      fr: 'jouer-magic-en-ligne-amis',
      it: 'giocare-magic-online-amici',
      pt: 'jogar-magic-online-amigos',
    },
  },
  createCommanderRoom: {
    routeKey: 'createCommanderRoom',
    slugs: {
      es: 'crear-sala-commander',
      en: 'create-commander-room',
      de: 'commander-raum-erstellen',
      fr: 'creer-salle-commander',
      it: 'creare-stanza-commander',
      pt: 'criar-sala-commander',
    },
  },
  importCommanderDeck: {
    routeKey: 'importCommanderDeck',
    slugs: {
      es: 'importar-mazo-commander-mtg',
      en: 'import-mtg-commander-deck',
      de: 'mtg-commander-deck-importieren',
      fr: 'importer-deck-commander-mtg',
      it: 'importare-mazzo-commander-mtg',
      pt: 'importar-deck-commander-mtg',
    },
  },
  commanderDeckBuilder: {
    routeKey: 'commanderDeckBuilder',
    slugs: {
      es: 'deck-builder-commander-mtg',
      en: 'mtg-commander-deck-builder',
      de: 'mtg-commander-deck-builder',
      fr: 'deck-builder-commander-mtg',
      it: 'deck-builder-commander-mtg',
      pt: 'deck-builder-commander-mtg',
    },
  },
  tableAssistant: {
    routeKey: 'tableAssistant',
    slugs: {
      es: 'asistente-mesa-commander',
      en: 'commander-table-assistant',
      de: 'commander-tischassistent',
      fr: 'assistant-table-commander',
      it: 'assistente-tavolo-commander',
      pt: 'assistente-mesa-commander',
    },
  },
  waysToPlayCommanderOnline: {
    routeKey: 'waysToPlayCommanderOnline',
    slugs: {
      es: 'formas-jugar-commander-online',
      en: 'ways-to-play-commander-online',
      de: 'commander-online-spielen-moeglichkeiten',
      fr: 'facons-jouer-commander-en-ligne',
      it: 'modi-giocare-commander-online',
      pt: 'formas-jogar-commander-online',
    },
  },
  howToPlayCommanderOnline: {
    routeKey: 'howToPlayCommanderOnline',
    slugs: {
      es: 'como-jugar-commander-online',
      en: 'how-to-play-commander-online',
      de: 'commander-online-spielen-anleitung',
      fr: 'comment-jouer-commander-en-ligne',
      it: 'come-giocare-commander-online',
      pt: 'como-jogar-commander-online',
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
    },
  },
} as const satisfies Record<SeoRouteKey, SeoRouteConfig>;

export const SEO_ROUTE_KEYS = Object.keys(SEO_ROUTES) as SeoRouteKey[];

assertValidSeoRoutes();

export function getSeoPath(routeKey: SeoRouteKey, locale: SeoLocaleCode): string {
  const slug = SEO_ROUTES[routeKey].slugs[locale];
  if (routeKey === 'home' && locale === 'en') {
    return '/';
  }

  return slug ? `/${locale}/${slug}/` : `/${locale}/`;
}

export function getLocalizedRouteAlternates(routeKey: SeoRouteKey): Readonly<Record<SeoLocaleCode, string>> {
  return Object.fromEntries(
    SEO_LOCALE_CODES.map((locale) => [locale, getSeoPath(routeKey, locale)]),
  ) as Record<SeoLocaleCode, string>;
}

export function findSeoRouteByPath(path: string): SeoRouteMatch | undefined {
  const normalizedPath = normalizeSeoPath(path);

  for (const routeKey of SEO_ROUTE_KEYS) {
    for (const locale of SEO_LOCALE_CODES) {
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

  for (const locale of SEO_LOCALE_CODES) {
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
