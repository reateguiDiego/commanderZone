import { SeoLocaleCode, isSeoLocale } from '../localization/locale-config';

export type LegalPageKey = 'privacy' | 'cookies' | 'terms' | 'contact';

export interface LegalRouteMatch {
  readonly pageKey: LegalPageKey;
  readonly locale: SeoLocaleCode;
  readonly path: string;
}

export interface LegalLink {
  readonly pageKey: LegalPageKey;
  readonly label: string;
  readonly href: string;
}

// Do not ship until this inbox exists and is monitored.
export const LEGAL_CONTACT_EMAIL = 'support@commanderzone.com';

export const LEGAL_PAGE_KEYS = ['privacy', 'cookies', 'terms', 'contact'] as const satisfies readonly LegalPageKey[];

export const LEGAL_ROUTE_SLUGS = {
  privacy: {
    en: 'privacy-policy',
    es: 'politica-privacidad',
    de: 'datenschutzerklaerung',
    fr: 'politique-confidentialite',
    pt: 'politica-privacidade',
    it: 'privacy-policy',
  },
  cookies: {
    en: 'cookie-policy',
    es: 'politica-cookies',
    de: 'cookie-richtlinie',
    fr: 'politique-cookies',
    pt: 'politica-cookies',
    it: 'cookie-policy',
  },
  terms: {
    en: 'terms',
    es: 'terminos',
    de: 'nutzungsbedingungen',
    fr: 'conditions-utilisation',
    pt: 'termos',
    it: 'termini',
  },
  contact: {
    en: 'contact',
    es: 'contacto',
    de: 'kontakt',
    fr: 'contact',
    pt: 'contato',
    it: 'contatto',
  },
} as const satisfies Record<LegalPageKey, Record<SeoLocaleCode, string>>;

export const LEGAL_LINK_LABELS = {
  en: {
    privacy: 'Privacy Policy',
    cookies: 'Cookie Policy',
    terms: 'Terms',
    contact: 'Contact',
  },
  es: {
    privacy: 'Privacidad',
    cookies: 'Cookies',
    terms: 'Términos',
    contact: 'Contacto',
  },
  de: {
    privacy: 'Datenschutz',
    cookies: 'Cookies',
    terms: 'Bedingungen',
    contact: 'Kontakt',
  },
  fr: {
    privacy: 'Confidentialité',
    cookies: 'Cookies',
    terms: 'Conditions',
    contact: 'Contact',
  },
  pt: {
    privacy: 'Privacidade',
    cookies: 'Cookies',
    terms: 'Termos',
    contact: 'Contato',
  },
  it: {
    privacy: 'Privacy',
    cookies: 'Cookie',
    terms: 'Termini',
    contact: 'Contatto',
  },
} as const satisfies Record<SeoLocaleCode, Record<LegalPageKey, string>>;

export const LEGAL_PRERENDER_ROUTES = LEGAL_PAGE_KEYS.flatMap((pageKey) =>
  (Object.keys(LEGAL_ROUTE_SLUGS[pageKey]) as SeoLocaleCode[]).map((locale) => getLegalPath(pageKey, locale)),
);

export function getLegalPath(pageKey: LegalPageKey, locale: SeoLocaleCode): string {
  const slug = LEGAL_ROUTE_SLUGS[pageKey][locale];
  return locale === 'en' ? `/${slug}/` : `/${locale}/${slug}/`;
}

export function getLegalLinks(locale: SeoLocaleCode): readonly LegalLink[] {
  return LEGAL_PAGE_KEYS.map((pageKey) => ({
    pageKey,
    label: LEGAL_LINK_LABELS[locale][pageKey],
    href: getLegalPath(pageKey, locale),
  }));
}

export function findLegalRouteByPath(path: string): LegalRouteMatch | undefined {
  const normalizedPath = normalizeLegalPath(path);

  for (const pageKey of LEGAL_PAGE_KEYS) {
    for (const locale of Object.keys(LEGAL_ROUTE_SLUGS[pageKey]) as SeoLocaleCode[]) {
      const legalPath = getLegalPath(pageKey, locale);

      if (normalizeLegalPath(legalPath) === normalizedPath) {
        return {
          pageKey,
          locale,
          path: legalPath,
        };
      }
    }
  }

  return undefined;
}

export function toLegalLocale(locale: string | null | undefined): SeoLocaleCode {
  return isSeoLocale(locale) ? locale : 'en';
}

function normalizeLegalPath(path: string): string {
  const [pathWithoutHash] = path.split('#');
  const [pathWithoutQuery] = (pathWithoutHash ?? '').split('?');
  const pathOnly = pathWithoutQuery ?? '';
  const withLeadingSlash = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  return withLeadingSlash.replace(/\/+$/, '') || '/';
}
