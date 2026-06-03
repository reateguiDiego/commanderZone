import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { DEFAULT_LOCALE, LocaleCode, getLocaleHreflang } from '../localization/locale-config';
import { SeoRouteKey, getLocalizedRouteAlternates, getSeoPath } from '../localization/seo-routes';

export type SeoJsonLdValue =
  | string
  | number
  | boolean
  | null
  | readonly SeoJsonLdValue[]
  | { readonly [key: string]: SeoJsonLdValue };

export interface SeoRouteMetadata {
  readonly routeKey: SeoRouteKey;
  readonly locale: LocaleCode;
  readonly title: string;
  readonly description: string;
  readonly robots?: string;
  readonly siteName?: string;
  readonly openGraphTitle: string;
  readonly openGraphDescription: string;
  readonly openGraphImage?: string;
  readonly jsonLd?: readonly SeoJsonLdValue[];
}

export interface SeoAlternateLink {
  readonly href: string;
  readonly hreflang: string;
}

export interface SeoLinkTag {
  readonly rel: 'canonical' | 'alternate';
  readonly href: string;
  readonly hreflang?: string;
}

export type SeoMetaTag = Readonly<Record<string, string>>;

const SEO_MANAGED_ATTRIBUTE = 'data-cz-seo';
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

  applySeoRouteMetadata(metadata: SeoRouteMetadata): void {
    this.clearSeoRouteMetadata();

    const canonicalUrl = buildSeoCanonicalUrl(metadata.routeKey, metadata.locale, this.currentOrigin());

    this.title.setTitle(metadata.title);
    this.appendMetaTags(buildSeoMetaTags(metadata, canonicalUrl));
    this.appendLinkTags([
      { rel: 'canonical', href: canonicalUrl },
      ...buildSeoAlternateLinks(metadata.routeKey, this.currentOrigin()).map((link) => ({
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

  private currentOrigin(): string | undefined {
    const origin = this.document.location?.origin;
    return origin && origin !== 'null' ? origin : undefined;
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

export function buildSeoCanonicalUrl(routeKey: SeoRouteKey, locale: LocaleCode, origin?: string): string {
  return toSeoAbsoluteUrl(getSeoPath(routeKey, locale), origin);
}

export function buildSeoAlternateLinks(routeKey: SeoRouteKey, origin?: string): readonly SeoAlternateLink[] {
  const localizedAlternates = getLocalizedRouteAlternates(routeKey);
  const alternates = Object.entries(localizedAlternates).map(([locale, href]) => ({
    hreflang: getLocaleHreflang(locale as LocaleCode),
    href: toSeoAbsoluteUrl(href, origin),
  }));

  return [
    ...alternates,
    {
      hreflang: 'x-default',
      href: toSeoAbsoluteUrl(getSeoPath(routeKey, DEFAULT_LOCALE.code), origin),
    },
  ];
}

export function buildSeoMetaTags(metadata: SeoRouteMetadata, canonicalUrl: string): readonly SeoMetaTag[] {
  const robots = metadata.robots ?? 'index, follow';
  const openGraphImage = metadata.openGraphImage ? toSeoAbsoluteUrl(metadata.openGraphImage, originFromUrl(canonicalUrl)) : undefined;
  const tags: SeoMetaTag[] = [
    { name: 'description', content: metadata.description },
    { name: 'robots', content: robots },
    { property: 'og:title', content: metadata.openGraphTitle },
    { property: 'og:description', content: metadata.openGraphDescription },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: canonicalUrl },
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: metadata.openGraphTitle },
    { name: 'twitter:description', content: metadata.openGraphDescription },
  ];

  if (metadata.siteName) {
    tags.push({ property: 'og:site_name', content: metadata.siteName });
  }

  if (openGraphImage) {
    tags.push(
      { property: 'og:image', content: openGraphImage },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { name: 'twitter:image', content: openGraphImage },
    );
  }

  return tags;
}

export function toSeoAbsoluteUrl(pathOrUrl: string, origin?: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const normalizedOrigin = normalizeSeoOrigin(origin);
  const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return normalizedOrigin ? `${normalizedOrigin}${normalizedPath}` : normalizedPath;
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
