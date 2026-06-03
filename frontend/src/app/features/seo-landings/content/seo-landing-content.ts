import { LocaleCode, SUPPORTED_LOCALE_CODES } from '../../../core/localization/locale-config';
import { SEO_ROUTE_KEYS, SeoRouteKey } from '../../../core/localization/seo-routes';
import { SeoLandingContent } from '../models/seo-landing-content.model';
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

export type SeoLandingContentByLocale = Readonly<Record<LocaleCode, SeoLandingContent>>;
export type SeoLandingContentRegistry = Readonly<Record<SeoRouteKey, SeoLandingContentByLocale>>;

export interface SeoLandingContentEntry {
  readonly routeKey: SeoRouteKey;
  readonly locale: LocaleCode;
  readonly content: SeoLandingContent;
}

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

export function getSeoLandingContent(routeKey: SeoRouteKey, locale: LocaleCode): SeoLandingContent {
  return SEO_LANDING_CONTENT[routeKey][locale];
}

export function getAllSeoLandingContentEntries(): readonly SeoLandingContentEntry[] {
  return SEO_ROUTE_KEYS.flatMap((routeKey) =>
    SUPPORTED_LOCALE_CODES.map((locale) => ({
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

    for (const locale of SUPPORTED_LOCALE_CODES) {
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
      validateRequiredText(errors, routeKey, locale, 'hero.eyebrow', content.hero.eyebrow);
      validateRequiredText(errors, routeKey, locale, 'hero.title', content.hero.title);
      validateRequiredText(errors, routeKey, locale, 'hero.subtitle', content.hero.subtitle);
      validateRequiredText(errors, routeKey, locale, 'hero.primaryLink.label', content.hero.primaryLink.label);

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
    }
  }

  return errors;
}

function validateRequiredText(
  errors: string[],
  routeKey: SeoRouteKey,
  locale: LocaleCode,
  field: string,
  value: string | undefined,
): void {
  if (!value?.trim()) {
    errors.push(`Missing ${field} for ${routeKey}/${locale}.`);
  }
}
