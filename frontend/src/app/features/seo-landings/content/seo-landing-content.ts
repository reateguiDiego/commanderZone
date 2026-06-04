import { SEO_LOCALE_CODES, SeoLocaleCode, getLocaleHreflang } from '../../../core/localization/locale-config';
import { SEO_ROUTE_KEYS, SeoRouteKey, getSeoPath } from '../../../core/localization/seo-routes';
import { SEO_CANONICAL_ORIGIN, toSeoAbsoluteUrl } from '../../../core/seo/seo.service';
import { SeoJsonLdValue, SeoLandingContent } from '../models/seo-landing-content.model';
import {
  PRODUCT_LANDING_ROUTE_KEYS,
} from '../models/seo-landing-template.model';
import { COMMANDER_DECK_BUILDER_SEO_LANDING_CONTENT } from './commander-deck-builder.content';
import { COMMANDER_SIMULATOR_SEO_LANDING_CONTENT } from './commander-simulator.content';
import { CREATE_COMMANDER_ROOM_SEO_LANDING_CONTENT } from './create-commander-room.content';
import { FAQ_SEO_LANDING_CONTENT } from './faq.content';
import { HOME_SEO_LANDING_CONTENT } from './home.content';
import { HOW_TO_PLAY_COMMANDER_ONLINE_SEO_LANDING_CONTENT } from './how-to-play-commander-online.content';
import { IMPORT_COMMANDER_DECK_SEO_LANDING_CONTENT } from './import-commander-deck.content';
import { PLAY_COMMANDER_ONLINE_SEO_LANDING_CONTENT } from './play-commander-online.content';
import { PLAY_COMMANDER_ONLINE_FREE_SEO_LANDING_CONTENT } from './play-commander-online-free.content';
import { PLAY_COMMANDER_WITHOUT_WEBCAM_SEO_LANDING_CONTENT } from './play-commander-without-webcam.content';
import { PLAY_EDH_ONLINE_SEO_LANDING_CONTENT } from './play-edh-online.content';
import { PLAY_MAGIC_ONLINE_WITH_FRIENDS_SEO_LANDING_CONTENT } from './play-magic-online-with-friends.content';
import { SPELLTABLE_ALTERNATIVE_SEO_LANDING_CONTENT } from './spell-table-alternative.content';
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
const SEO_PRIMARY_CONVERSION_LINK_FIELDS = new Set([
  'hero.primaryLink.href',
  'cta.primaryLink.href',
]);
const SEO_SECONDARY_CTA_LINK_FIELDS = new Set([
  'hero.secondaryLink.href',
  'cta.secondaryLink.href',
]);
const ARTICLE_JSON_LD_ROUTE_KEYS = [
  'howToPlayCommanderOnline',
  'waysToPlayCommanderOnline',
  'spellTableAlternative',
  'playCommanderWithoutWebcam',
] as const satisfies readonly SeoRouteKey[];

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
  spellTableAlternative: SPELLTABLE_ALTERNATIVE_SEO_LANDING_CONTENT,
  playCommanderOnlineFree: PLAY_COMMANDER_ONLINE_FREE_SEO_LANDING_CONTENT,
  playCommanderWithoutWebcam: PLAY_COMMANDER_WITHOUT_WEBCAM_SEO_LANDING_CONTENT,
  playEdhOnline: PLAY_EDH_ONLINE_SEO_LANDING_CONTENT,
  commanderSimulator: COMMANDER_SIMULATOR_SEO_LANDING_CONTENT,
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

  if (!/^\/assets\/seo\/[a-z0-9-]+-hero\.webp$/.test(image.src)) {
    errors.push(`Hero image must use an optimized descriptive public SEO WebP asset for ${routeKey}/${locale}: ${image.src}.`);
  }

  if (image.width !== 960 || image.height !== 504) {
    errors.push(`Hero image dimensions must be 960x504 for ${routeKey}/${locale}.`);
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

    if (SEO_PRIMARY_CONVERSION_LINK_FIELDS.has(field)) {
      if (!SEO_APP_ENTRY_PATHS.has(href)) {
        errors.push(`SEO conversion CTA for ${routeKey}/${locale} must use an approved app entry path in ${field}: ${href}.`);
      }

      continue;
    }

    if (SEO_SECONDARY_CTA_LINK_FIELDS.has(field)) {
      if (!seoPaths.has(href)) {
        errors.push(`SEO secondary CTA for ${routeKey}/${locale} must point to a localized SEO URL in ${field}: ${href}.`);
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

  validateJsonLdNodeIds(errors, routeKey, locale, graph, canonicalUrl);
  validateBreadcrumbJsonLd(errors, routeKey, locale, content, graph);
  validateWebApplicationJsonLd(errors, routeKey, locale, content, graph, canonicalUrl);
  validateArticleJsonLd(errors, routeKey, locale, content, graph, canonicalUrl);
  validateFaqJsonLd(errors, routeKey, locale, content, graph);
  validateNoFakeReviewJsonLd(errors, routeKey, locale, serializedJsonLd);
}

function getRequiredJsonLdTypes(routeKey: SeoRouteKey): readonly string[] {
  const requiredTypes = ['Organization', 'BreadcrumbList'];

  if (routeKey === 'home') {
    requiredTypes.push('WebSite');
  }

  if (isRouteInGroup(routeKey, PRODUCT_LANDING_ROUTE_KEYS)) {
    requiredTypes.push('WebApplication');
  }

  if (isRouteInGroup(routeKey, ARTICLE_JSON_LD_ROUTE_KEYS)) {
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

function validateJsonLdNodeIds(
  errors: string[],
  routeKey: SeoRouteKey,
  locale: SeoLocaleCode,
  graph: readonly JsonLdObject[],
  canonicalUrl: string,
): void {
  const expectedIdsByType = new Map<string, string>([
    ['Organization', `${SEO_CANONICAL_ORIGIN}/#organization`],
    ['BreadcrumbList', `${canonicalUrl}#breadcrumb`],
    ['FAQPage', `${canonicalUrl}#faq`],
  ]);

  if (routeKey === 'home') {
    expectedIdsByType.set('WebSite', `${SEO_CANONICAL_ORIGIN}/#website`);
  }

  if (isRouteInGroup(routeKey, PRODUCT_LANDING_ROUTE_KEYS)) {
    expectedIdsByType.set('WebApplication', `${canonicalUrl}#software`);
  }

  if (isRouteInGroup(routeKey, ARTICLE_JSON_LD_ROUTE_KEYS)) {
    expectedIdsByType.set('Article', `${canonicalUrl}#article`);
  }

  for (const [type, expectedId] of expectedIdsByType) {
    const node = graph.find((item) => item['@type'] === type);
    if (node?.['@id'] !== expectedId) {
      errors.push(`JSON-LD ${type} @id mismatch for ${routeKey}/${locale}: expected ${expectedId}, got ${String(node?.['@id'] ?? '(missing)')}.`);
    }
  }
}

function validateBreadcrumbJsonLd(
  errors: string[],
  routeKey: SeoRouteKey,
  locale: SeoLocaleCode,
  content: SeoLandingContent,
  graph: readonly JsonLdObject[],
): void {
  const breadcrumbList = graph.find((node) => node['@type'] === 'BreadcrumbList');
  const itemListElement = breadcrumbList?.['itemListElement'];

  if (!Array.isArray(itemListElement)) {
    errors.push(`BreadcrumbList JSON-LD must expose itemListElement for ${routeKey}/${locale}.`);
    return;
  }

  const jsonLdBreadcrumbs = itemListElement.map((item) => {
    const listItem = asJsonLdObject(item);

    return {
      name: listItem?.['name'],
      item: listItem?.['item'],
    };
  });
  const visibleBreadcrumbs = content.breadcrumb.items.map((item) => ({
    name: item.label,
    item: toSeoAbsoluteUrl(item.href),
  }));

  if (JSON.stringify(jsonLdBreadcrumbs) !== JSON.stringify(visibleBreadcrumbs)) {
    errors.push(`BreadcrumbList JSON-LD must match visible breadcrumbs exactly for ${routeKey}/${locale}.`);
  }
}

function validateWebApplicationJsonLd(
  errors: string[],
  routeKey: SeoRouteKey,
  locale: SeoLocaleCode,
  content: SeoLandingContent,
  graph: readonly JsonLdObject[],
  canonicalUrl: string,
): void {
  const webApplication = graph.find((node) => node['@type'] === 'WebApplication');

  if (!isRouteInGroup(routeKey, PRODUCT_LANDING_ROUTE_KEYS)) {
    if (webApplication) {
      errors.push(`Unexpected WebApplication JSON-LD for non-product route ${routeKey}/${locale}.`);
    }
    return;
  }

  if (!webApplication) {
    return;
  }

  const expectedValues: Readonly<Record<string, SeoJsonLdValue>> = {
    name: 'CommanderZone',
    applicationCategory: 'GameApplication',
    operatingSystem: 'Web',
    isAccessibleForFree: true,
    description: content.seo.description,
    url: canonicalUrl,
    inLanguage: getLocaleHreflang(locale),
  };

  for (const [field, expectedValue] of Object.entries(expectedValues)) {
    if (webApplication[field] !== expectedValue) {
      errors.push(`WebApplication ${field} mismatch for ${routeKey}/${locale}.`);
    }
  }

  if (webApplication['offers'] !== undefined) {
    errors.push(`WebApplication must not include offers for ${routeKey}/${locale}.`);
  }
}

function validateArticleJsonLd(
  errors: string[],
  routeKey: SeoRouteKey,
  locale: SeoLocaleCode,
  content: SeoLandingContent,
  graph: readonly JsonLdObject[],
  canonicalUrl: string,
): void {
  const article = graph.find((node) => node['@type'] === 'Article');

  if (!isRouteInGroup(routeKey, ARTICLE_JSON_LD_ROUTE_KEYS)) {
    if (article) {
      errors.push(`Unexpected Article JSON-LD for route ${routeKey}/${locale}.`);
    }
    return;
  }

  if (!article) {
    return;
  }

  if (article['headline'] !== content.hero.title) {
    errors.push(`Article headline must match H1 for ${routeKey}/${locale}.`);
  }

  if (article['description'] !== content.seo.description) {
    errors.push(`Article description must match meta description for ${routeKey}/${locale}.`);
  }

  if (article['inLanguage'] !== getLocaleHreflang(locale)) {
    errors.push(`Article inLanguage mismatch for ${routeKey}/${locale}.`);
  }

  if (article['mainEntityOfPage'] !== canonicalUrl) {
    errors.push(`Article mainEntityOfPage must match canonical for ${routeKey}/${locale}.`);
  }

  if (!article['dateModified']) {
    errors.push(`Article dateModified is required for ${routeKey}/${locale}.`);
  }
}

function validateNoFakeReviewJsonLd(
  errors: string[],
  routeKey: SeoRouteKey,
  locale: SeoLocaleCode,
  serializedJsonLd: string,
): void {
  const forbiddenFragments = ['"Review"', '"AggregateRating"', '"ratingValue"', '"reviewRating"', '"review"', '"offers"'];

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
