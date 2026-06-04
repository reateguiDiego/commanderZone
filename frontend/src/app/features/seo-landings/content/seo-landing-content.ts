import { SEO_LOCALE_CODES, SeoLocaleCode, getLocaleHreflang } from '../../../core/localization/locale-config';
import { SEO_ROUTE_KEYS, SeoRouteKey, getSeoPath } from '../../../core/localization/seo-routes';
import { toSeoAbsoluteUrl } from '../../../core/seo/seo.service';
import { SeoJsonLdValue, SeoLandingContent } from '../models/seo-landing-content.model';
import {
  COMPARISON_LANDING_ROUTE_KEYS,
  GUIDE_LANDING_ROUTE_KEYS,
  PRODUCT_LANDING_ROUTE_KEYS,
} from '../models/seo-landing-template.model';
import { COMMANDER_DECK_BUILDER_SEO_LANDING_CONTENT } from './commander-deck-builder.content';
import { CREATE_COMMANDER_ROOM_SEO_LANDING_CONTENT } from './create-commander-room.content';
import { FAQ_SEO_LANDING_CONTENT } from './faq.content';
import { HOME_SEO_LANDING_CONTENT } from './home.content';
import { HOW_TO_PLAY_COMMANDER_ONLINE_SEO_LANDING_CONTENT } from './how-to-play-commander-online.content';
import { IMPORT_COMMANDER_DECK_SEO_LANDING_CONTENT } from './import-commander-deck.content';
import { PLAY_COMMANDER_ONLINE_SEO_LANDING_CONTENT } from './play-commander-online.content';
import { PLAY_MAGIC_ONLINE_WITH_FRIENDS_SEO_LANDING_CONTENT } from './play-magic-online-with-friends.content';
import { TABLE_ASSISTANT_SEO_LANDING_CONTENT } from './table-assistant.content';
import { WAYS_TO_PLAY_COMMANDER_ONLINE_SEO_LANDING_CONTENT } from './ways-to-play-commander-online.content';

export type SeoLandingContentByLocale = Readonly<Record<SeoLocaleCode, SeoLandingContent>>;
export type SeoLandingContentRegistry = Readonly<Record<SeoRouteKey, SeoLandingContentByLocale>>;

export interface SeoLandingContentEntry {
  readonly routeKey: SeoRouteKey;
  readonly locale: SeoLocaleCode;
  readonly content: SeoLandingContent;
}

const SEO_APP_ENTRY_PATHS = new Set([
  '/auth/login?redirect=/decks',
  '/auth/login?redirect=/table-assistant',
  '/auth/register?redirect=/decks',
  '/auth/register?redirect=/table-assistant',
]);
const SEO_CONVERSION_LINK_FIELDS = new Set([
  'hero.primaryLink.href',
  'hero.secondaryLink.href',
  'cta.primaryLink.href',
  'cta.secondaryLink.href',
]);

export const SEO_LANDING_CONTENT = {
  home: HOME_SEO_LANDING_CONTENT,
  playCommanderOnline: PLAY_COMMANDER_ONLINE_SEO_LANDING_CONTENT,
  playMagicOnlineWithFriends: PLAY_MAGIC_ONLINE_WITH_FRIENDS_SEO_LANDING_CONTENT,
  createCommanderRoom: CREATE_COMMANDER_ROOM_SEO_LANDING_CONTENT,
  importCommanderDeck: IMPORT_COMMANDER_DECK_SEO_LANDING_CONTENT,
  commanderDeckBuilder: COMMANDER_DECK_BUILDER_SEO_LANDING_CONTENT,
  tableAssistant: TABLE_ASSISTANT_SEO_LANDING_CONTENT,
  waysToPlayCommanderOnline: WAYS_TO_PLAY_COMMANDER_ONLINE_SEO_LANDING_CONTENT,
  howToPlayCommanderOnline: HOW_TO_PLAY_COMMANDER_ONLINE_SEO_LANDING_CONTENT,
  faq: FAQ_SEO_LANDING_CONTENT,
} as const satisfies SeoLandingContentRegistry;

export function getSeoLandingContent(routeKey: SeoRouteKey, locale: SeoLocaleCode): SeoLandingContent {
  return SEO_LANDING_CONTENT[routeKey][locale];
}

export function getAllSeoLandingContentEntries(): readonly SeoLandingContentEntry[] {
  return SEO_ROUTE_KEYS.flatMap((routeKey) =>
    SEO_LOCALE_CODES.map((locale) => ({
      routeKey,
      locale,
      content: getSeoLandingContent(routeKey, locale),
    })),
  );
}

export function validateSeoLandingContentCoverage(): readonly string[] {
  const errors: string[] = [];

  for (const routeKey of SEO_ROUTE_KEYS) {
    const contentByLocale = SEO_LANDING_CONTENT[routeKey];

    if (!contentByLocale) {
      errors.push(`Missing SEO landing content for ${routeKey}.`);
      continue;
    }

    for (const locale of SEO_LOCALE_CODES) {
      const content = contentByLocale[locale];

      if (!content) {
        errors.push(`Missing SEO landing content for ${routeKey}/${locale}.`);
        continue;
      }

      if (content.routeKey !== routeKey) {
        errors.push(`Content routeKey mismatch for ${routeKey}/${locale}.`);
      }

      if (content.locale !== locale) {
        errors.push(`Content locale mismatch for ${routeKey}/${locale}.`);
      }

      validateRequiredText(errors, routeKey, locale, 'seo.title', content.seo.title);
      validateRequiredText(errors, routeKey, locale, 'seo.description', content.seo.description);
      validateRequiredText(errors, routeKey, locale, 'seo.ogTitle', content.seo.ogTitle);
      validateRequiredText(errors, routeKey, locale, 'seo.ogDescription', content.seo.ogDescription);
      validateRequiredText(errors, routeKey, locale, 'seo.ogImage', content.seo.ogImage);
      validateRequiredText(errors, routeKey, locale, 'hero.eyebrow', content.hero.eyebrow);
      validateRequiredText(errors, routeKey, locale, 'hero.title', content.hero.title);
      validateRequiredText(errors, routeKey, locale, 'hero.subtitle', content.hero.subtitle);
      validateRequiredText(errors, routeKey, locale, 'hero.primaryLink.label', content.hero.primaryLink.label);
      validateSeoLandingImage(errors, routeKey, locale, content);

      if ((content.sections?.length ?? 0) === 0) {
        errors.push(`Missing sections for ${routeKey}/${locale}.`);
      }

      if (content.faq.items.length === 0) {
        errors.push(`Missing FAQ items for ${routeKey}/${locale}.`);
      }

      if (content.breadcrumb.items.length === 0) {
        errors.push(`Missing breadcrumb items for ${routeKey}/${locale}.`);
      }

      if (content.internalLinks.links.length === 0) {
        errors.push(`Missing internal links for ${routeKey}/${locale}.`);
      }

      if (!content.jsonLd) {
        errors.push(`Missing JSON-LD for ${routeKey}/${locale}.`);
      }

      validateCrawlableSeoLinks(errors, routeKey, locale, content);
      validateJsonLd(errors, routeKey, locale, content);
    }
  }

  return errors;
}

function validateSeoLandingImage(
  errors: string[],
  routeKey: SeoRouteKey,
  locale: SeoLocaleCode,
  content: SeoLandingContent,
): void {
  const image = content.hero.image;

  if (!image) {
    errors.push(`Missing hero image for ${routeKey}/${locale}.`);
    return;
  }

  validateRequiredText(errors, routeKey, locale, 'hero.image.src', image.src);
  validateRequiredText(errors, routeKey, locale, 'hero.image.alt', image.alt);

  if (image.src !== content.seo.ogImage) {
    errors.push(`Hero image must reuse stable OG image for ${routeKey}/${locale}: ${image.src}.`);
  }

  if (!/^\/assets\/og\/[a-z0-9-]+\.png$/.test(image.src)) {
    errors.push(`Hero image must use a stable descriptive public asset URL for ${routeKey}/${locale}: ${image.src}.`);
  }

  if (image.width !== 1200 || image.height !== 630) {
    errors.push(`Hero image dimensions must be 1200x630 for ${routeKey}/${locale}.`);
  }

  if (image.loading === 'lazy') {
    errors.push(`Hero image must not be lazy-loaded for ${routeKey}/${locale}.`);
  }
}

function validateCrawlableSeoLinks(
  errors: string[],
  routeKey: SeoRouteKey,
  locale: SeoLocaleCode,
  content: SeoLandingContent,
): void {
  const seoPaths = new Set(SEO_ROUTE_KEYS.map((seoRouteKey) => getSeoPath(seoRouteKey, locale)));
  const links = getLandingLinks(content);

  for (const [field, href] of links) {
    if (!href.trim()) {
      errors.push(`Missing crawlable href for ${routeKey}/${locale} ${field}.`);
      continue;
    }

    if (SEO_CONVERSION_LINK_FIELDS.has(field)) {
      if (!SEO_APP_ENTRY_PATHS.has(href)) {
        errors.push(`SEO conversion CTA for ${routeKey}/${locale} must use an approved app entry path in ${field}: ${href}.`);
      }

      continue;
    }

    if (href.startsWith('/auth') || href.startsWith('/app')) {
      errors.push(`SEO landing ${routeKey}/${locale} links to non-crawlable app route in ${field}: ${href}.`);
    }
  }

  for (const link of [...(content.publicNavigationLinks ?? []), ...(content.footerLinks ?? []), ...content.internalLinks.links]) {
    if (!seoPaths.has(link.href)) {
      errors.push(`SEO discovery link for ${routeKey}/${locale} must point to a localized SEO URL: ${link.href}.`);
    }
  }

  if (routeKey === 'home') {
    assertLinksIncludeSeoRoutes(errors, routeKey, locale, content, SEO_ROUTE_KEYS.filter((seoRouteKey) => seoRouteKey !== 'home'));
  }

  if (routeKey === 'faq') {
    assertLinksIncludeSeoRoutes(errors, routeKey, locale, content, SEO_ROUTE_KEYS.filter((seoRouteKey) => seoRouteKey !== 'faq'));
  }
}

function getLandingLinks(content: SeoLandingContent): readonly [string, string][] {
  const links: [string, string][] = [
    ['homeLink.href', content.homeLink?.href ?? ''],
    ['hero.primaryLink.href', content.hero.primaryLink.href],
    ['hero.secondaryLink.href', content.hero.secondaryLink?.href ?? ''],
    ['cta.primaryLink.href', content.cta?.primaryLink.href ?? ''],
    ['cta.secondaryLink.href', content.cta?.secondaryLink?.href ?? ''],
    ...getNamedLinks('publicNavigationLinks', content.publicNavigationLinks ?? []),
    ...getNamedLinks('footerLinks', content.footerLinks ?? []),
    ...getNamedLinks('legalFooterLinks', content.legalFooterLinks ?? []),
    ...getNamedLinks('breadcrumb.items', content.breadcrumb.items),
    ...getNamedLinks('internalLinks.links', content.internalLinks.links),
    ...getNamedLinks('localeLinks', content.localeLinks ?? []),
    ...getSectionLinks(content),
  ];

  return links.filter(([, href]) => href !== '');
}

function getNamedLinks(prefix: string, links: readonly { readonly href: string }[]): readonly [string, string][] {
  return links.map((link, index) => [`${prefix}[${index}].href`, link.href]);
}

function getSectionLinks(content: SeoLandingContent): readonly [string, string][] {
  return (content.sections ?? []).flatMap((section, sectionIndex) =>
    (section.links ?? []).map((link, linkIndex): [string, string] => [
      `sections[${sectionIndex}].links[${linkIndex}].href`,
      link.href,
    ]),
  );
}

function assertLinksIncludeSeoRoutes(
  errors: string[],
  routeKey: SeoRouteKey,
  locale: SeoLocaleCode,
  content: SeoLandingContent,
  expectedRouteKeys: readonly SeoRouteKey[],
): void {
  const hrefs = new Set(getLandingLinks(content).map(([, href]) => href));

  for (const expectedRouteKey of expectedRouteKeys) {
    const expectedPath = getSeoPath(expectedRouteKey, locale);

    if (!hrefs.has(expectedPath)) {
      errors.push(`SEO landing ${routeKey}/${locale} must crawlably link to ${expectedRouteKey}: ${expectedPath}.`);
    }
  }
}

type JsonLdObject = Readonly<Record<string, SeoJsonLdValue>>;

function validateJsonLd(
  errors: string[],
  routeKey: SeoRouteKey,
  locale: SeoLocaleCode,
  content: SeoLandingContent,
): void {
  const jsonLd = asJsonLdObject(content.jsonLd);

  if (!jsonLd || jsonLd['@context'] !== 'https://schema.org') {
    errors.push(`Invalid JSON-LD context for ${routeKey}/${locale}.`);
    return;
  }

  const graph = getJsonLdGraph(jsonLd);
  if (graph.length === 0) {
    errors.push(`Missing JSON-LD graph for ${routeKey}/${locale}.`);
    return;
  }

  const requiredTypes = getRequiredJsonLdTypes(routeKey);
  for (const type of requiredTypes) {
    if (!graph.some((node) => node['@type'] === type)) {
      errors.push(`Missing ${type} JSON-LD for ${routeKey}/${locale}.`);
    }
  }

  const serializedJsonLd = JSON.stringify(jsonLd);
  const canonicalUrl = toSeoAbsoluteUrl(getSeoPath(routeKey, locale));
  const requiredLocalizedValues = [
    canonicalUrl,
    getLocaleHreflang(locale),
    content.hero.title,
    content.seo.description,
  ];

  for (const value of requiredLocalizedValues) {
    if (!serializedJsonLd.includes(value)) {
      errors.push(`JSON-LD for ${routeKey}/${locale} is missing localized value: ${value}.`);
    }
  }

  validateFaqJsonLd(errors, routeKey, locale, content, graph);
  validateNoFakeReviewJsonLd(errors, routeKey, locale, serializedJsonLd);
}

function getRequiredJsonLdTypes(routeKey: SeoRouteKey): readonly string[] {
  const requiredTypes = ['Organization', 'BreadcrumbList'];

  if (routeKey === 'home') {
    requiredTypes.push('WebSite');
  }

  if (isRouteInGroup(routeKey, PRODUCT_LANDING_ROUTE_KEYS)) {
    requiredTypes.push('SoftwareApplication');
  }

  if (isRouteInGroup(routeKey, GUIDE_LANDING_ROUTE_KEYS) || isRouteInGroup(routeKey, COMPARISON_LANDING_ROUTE_KEYS)) {
    requiredTypes.push('Article');
  }

  return [...requiredTypes, 'FAQPage'];
}

function isRouteInGroup(routeKey: SeoRouteKey, routes: readonly SeoRouteKey[]): boolean {
  return routes.includes(routeKey);
}

function validateFaqJsonLd(
  errors: string[],
  routeKey: SeoRouteKey,
  locale: SeoLocaleCode,
  content: SeoLandingContent,
  graph: readonly JsonLdObject[],
): void {
  const faqPage = graph.find((node) => node['@type'] === 'FAQPage');

  if (!faqPage) {
    errors.push(`Missing FAQPage JSON-LD for visible FAQ in ${routeKey}/${locale}.`);
    return;
  }

  const mainEntity = faqPage['mainEntity'];
  if (!Array.isArray(mainEntity) || mainEntity.length !== content.faq.items.length) {
    errors.push(`FAQPage JSON-LD question count mismatch for ${routeKey}/${locale}.`);
    return;
  }

  const visibleFaq = content.faq.items.map((item) => ({
    question: item.question,
    answer: item.answer.join(' '),
  }));
  const jsonLdFaq = mainEntity.map((item) => {
    const question = asJsonLdObject(item);
    const answer = asJsonLdObject(question?.['acceptedAnswer']);

    return {
      question: question?.['name'],
      answer: answer?.['text'],
    };
  });

  if (JSON.stringify(jsonLdFaq) !== JSON.stringify(visibleFaq)) {
    errors.push(`FAQPage JSON-LD must match visible FAQ exactly for ${routeKey}/${locale}.`);
  }
}

function validateNoFakeReviewJsonLd(
  errors: string[],
  routeKey: SeoRouteKey,
  locale: SeoLocaleCode,
  serializedJsonLd: string,
): void {
  const forbiddenFragments = ['"Review"', '"AggregateRating"', '"ratingValue"', '"reviewRating"', '"review"'];

  for (const fragment of forbiddenFragments) {
    if (serializedJsonLd.includes(fragment)) {
      errors.push(`Unsupported review or rating JSON-LD found for ${routeKey}/${locale}: ${fragment}.`);
    }
  }
}

function getJsonLdGraph(jsonLd: JsonLdObject): readonly JsonLdObject[] {
  const graph = jsonLd['@graph'];
  return Array.isArray(graph)
    ? graph.map((node) => asJsonLdObject(node)).filter((node): node is JsonLdObject => node !== undefined)
    : [];
}

function asJsonLdObject(value: SeoJsonLdValue | undefined): JsonLdObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonLdObject
    : undefined;
}

function validateRequiredText(
  errors: string[],
  routeKey: SeoRouteKey,
  locale: SeoLocaleCode,
  field: string,
  value: string | undefined,
): void {
  if (!value?.trim()) {
    errors.push(`Missing ${field} for ${routeKey}/${locale}.`);
  }
}
