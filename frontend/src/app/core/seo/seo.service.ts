import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import {
  SEO_DEFAULT_LOCALE,
  SEO_LOCALE_CODES,
  SeoLocaleCode,
  getLocaleHreflang,
} from '../localization/locale-config';
import { SeoRouteKey, getLocalizedRouteAlternates, getSeoPath } from '../localization/seo-routes';
import { SEARCH_CONSOLE_VERIFICATION_TOKEN, normalizeSearchConsoleVerificationToken } from './search-console-verification.config';

export type SeoJsonLdValue =
  | string
  | number
  | boolean
  | null
  | readonly SeoJsonLdValue[]
  | { readonly [key: string]: SeoJsonLdValue };

export interface SeoRouteMetadata {
  readonly routeKey: SeoRouteKey;
  readonly locale: SeoLocaleCode;
  readonly title: string;
  readonly description: string;
  readonly robots?: string;
  readonly siteName?: string;
  readonly openGraphTitle: string;
  readonly openGraphDescription: string;
  readonly openGraphImage?: string;
  readonly preloadImage?: string;
  readonly jsonLd?: readonly SeoJsonLdValue[];
}

export interface SeoAlternateLink {
  readonly href: string;
  readonly hreflang: string;
}

export interface SeoLinkTag {
  readonly rel: 'canonical' | 'alternate' | 'preload';
  readonly href: string;
  readonly hreflang?: string;
  readonly as?: 'image';
  readonly fetchpriority?: 'high';
}

export type SeoMetaTag = Readonly<Record<string, string>>;

const SEO_MANAGED_ATTRIBUTE = 'data-cz-seo';
export const SEO_CANONICAL_ORIGIN = 'https://www.commanderzone.com';
export const SEO_DEFAULT_OPEN_GRAPH_IMAGE = '/assets/og/default-og.png';
const OPEN_GRAPH_LOCALES: Readonly<Record<SeoLocaleCode, string>> = {
  es: 'es_ES',
  en: 'en_US',
  de: 'de_DE',
  fr: 'fr_FR',
  it: 'it_IT',
  pt: 'pt_PT',
};
const MANAGED_HEAD_SELECTOR = [
  `meta[${SEO_MANAGED_ATTRIBUTE}="true"]`,
  `link[${SEO_MANAGED_ATTRIBUTE}="true"]`,
  `script[${SEO_MANAGED_ATTRIBUTE}="true"]`,
  'meta[data-seo-landing="true"]',
  'link[data-seo-landing="true"]',
  'script[data-seo-landing="true"]',
].join(',');

@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly title = inject(Title);
  private readonly document = inject(DOCUMENT);
  private readonly searchConsoleVerificationToken = inject(SEARCH_CONSOLE_VERIFICATION_TOKEN);

  applySeoRouteMetadata(metadata: SeoRouteMetadata): void {
    this.clearSeoRouteMetadata();

    const canonicalUrl = buildSeoCanonicalUrl(metadata.routeKey, metadata.locale);

    this.title.setTitle(metadata.title);
    this.appendMetaTags([
      ...buildSeoMetaTags(metadata, canonicalUrl),
      ...buildSearchConsoleVerificationMetaTags(this.searchConsoleVerificationToken),
    ]);
    this.appendLinkTags([
      ...(metadata.preloadImage
        ? [{
          rel: 'preload' as const,
          href: toSeoAbsoluteUrl(metadata.preloadImage),
          as: 'image' as const,
          fetchpriority: 'high' as const,
        }]
        : []),
      { rel: 'canonical', href: canonicalUrl },
      ...buildSeoAlternateLinks(metadata.routeKey).map((link) => ({
        rel: 'alternate' as const,
        href: link.href,
        hreflang: link.hreflang,
      })),
    ]);
    this.appendJsonLdScripts(metadata.jsonLd ?? []);
  }

  clearSeoRouteMetadata(): void {
    this.document.head.querySelectorAll(MANAGED_HEAD_SELECTOR).forEach((element) => element.remove());
  }

  private appendMetaTags(tags: readonly SeoMetaTag[]): void {
    for (const tag of tags) {
      const meta = this.document.createElement('meta');
      meta.setAttribute(SEO_MANAGED_ATTRIBUTE, 'true');

      for (const [attribute, value] of Object.entries(tag)) {
        meta.setAttribute(attribute, value);
      }

      this.document.head.appendChild(meta);
    }
  }

  private appendLinkTags(tags: readonly SeoLinkTag[]): void {
    for (const tag of tags) {
      const link = this.document.createElement('link');
      link.setAttribute(SEO_MANAGED_ATTRIBUTE, 'true');
      link.setAttribute('rel', tag.rel);
      link.setAttribute('href', tag.href);

      if (tag.hreflang) {
        link.setAttribute('hreflang', tag.hreflang);
      }

      if (tag.as) {
        link.setAttribute('as', tag.as);
      }

      if (tag.fetchpriority) {
        link.setAttribute('fetchpriority', tag.fetchpriority);
      }

      this.document.head.appendChild(link);
    }
  }

  private appendJsonLdScripts(jsonLdEntries: readonly SeoJsonLdValue[]): void {
    for (const jsonLd of jsonLdEntries) {
      const script = this.document.createElement('script');
      script.setAttribute(SEO_MANAGED_ATTRIBUTE, 'true');
      script.type = 'application/ld+json';
      script.text = JSON.stringify(jsonLd);
      this.document.head.appendChild(script);
    }
  }
}

export function buildSeoCanonicalUrl(routeKey: SeoRouteKey, locale: SeoLocaleCode, origin?: string): string {
  return toSeoAbsoluteUrl(getSeoPath(routeKey, locale), origin);
}

export function buildSeoAlternateLinks(routeKey: SeoRouteKey, origin?: string): readonly SeoAlternateLink[] {
  const localizedAlternates = getLocalizedRouteAlternates(routeKey);
  const alternates = Object.entries(localizedAlternates).map(([locale, href]) => ({
    hreflang: getLocaleHreflang(locale as SeoLocaleCode),
    href: toSeoAbsoluteUrl(href, origin),
  }));

  return [
    ...alternates,
    {
      hreflang: 'x-default',
      href: toSeoAbsoluteUrl(getSeoPath(routeKey, SEO_DEFAULT_LOCALE.code), origin),
    },
  ];
}

export function buildSeoMetaTags(metadata: SeoRouteMetadata, canonicalUrl: string): readonly SeoMetaTag[] {
  const robots = metadata.robots ?? 'index, follow';
  const openGraphImage = toSeoAbsoluteUrl(
    metadata.openGraphImage ?? SEO_DEFAULT_OPEN_GRAPH_IMAGE,
    originFromUrl(canonicalUrl),
  );
  const tags: SeoMetaTag[] = [
    { name: 'description', content: metadata.description },
    { name: 'robots', content: robots },
    { property: 'og:title', content: metadata.openGraphTitle },
    { property: 'og:description', content: metadata.openGraphDescription },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: canonicalUrl },
    { property: 'og:image', content: openGraphImage },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:locale', content: getOpenGraphLocale(metadata.locale) },
    ...buildOpenGraphLocaleAlternates(metadata.locale),
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: metadata.openGraphTitle },
    { name: 'twitter:description', content: metadata.openGraphDescription },
    { name: 'twitter:image', content: openGraphImage },
  ];

  if (metadata.siteName) {
    tags.push({ property: 'og:site_name', content: metadata.siteName });
  }

  return tags;
}

export function buildSearchConsoleVerificationMetaTags(token: string | null | undefined): readonly SeoMetaTag[] {
  const normalizedToken = normalizeSearchConsoleVerificationToken(token);
  return normalizedToken ? [{ name: 'google-site-verification', content: normalizedToken }] : [];
}

export function getOpenGraphLocale(locale: SeoLocaleCode): string {
  return OPEN_GRAPH_LOCALES[locale];
}

export function buildOpenGraphLocaleAlternates(locale: SeoLocaleCode): readonly SeoMetaTag[] {
  return SEO_LOCALE_CODES
    .filter((supportedLocale) => supportedLocale !== locale)
    .map((supportedLocale) => ({
      property: 'og:locale:alternate',
      content: getOpenGraphLocale(supportedLocale),
    }));
}

export function toSeoAbsoluteUrl(pathOrUrl: string, origin?: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const normalizedOrigin = normalizeSeoOrigin(origin ?? SEO_CANONICAL_ORIGIN);
  const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${normalizedOrigin}${normalizedPath}`;
}

export function normalizeSeoOrigin(origin: string | null | undefined): string {
  return (origin ?? '').replace(/\/+$/, '');
}

function originFromUrl(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
