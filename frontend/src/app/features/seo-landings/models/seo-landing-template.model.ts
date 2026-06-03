import { SeoRouteKey } from '../../../core/localization/seo-routes';

export type SeoLandingTemplateName =
  | 'ProductLandingTemplate'
  | 'GuideLandingTemplate'
  | 'ComparisonLandingTemplate'
  | 'FaqLandingTemplate';

export type SeoLandingTemplateBlock =
  | 'hero'
  | 'trustBar'
  | 'sections'
  | 'featureGrid'
  | 'steps'
  | 'useCases'
  | 'comparison'
  | 'faqPreview'
  | 'fullFaq'
  | 'cta';

export const PRODUCT_LANDING_ROUTE_KEYS = [
  'home',
  'playCommanderOnline',
  'createCommanderRoom',
  'importCommanderDeck',
  'commanderDeckBuilder',
  'tableAssistant',
] as const satisfies readonly SeoRouteKey[];

export const GUIDE_LANDING_ROUTE_KEYS = [
  'playMagicOnlineWithFriends',
  'howToPlayCommanderOnline',
] as const satisfies readonly SeoRouteKey[];

export const COMPARISON_LANDING_ROUTE_KEYS = [
  'waysToPlayCommanderOnline',
] as const satisfies readonly SeoRouteKey[];

export const FAQ_LANDING_ROUTE_KEYS = [
  'faq',
] as const satisfies readonly SeoRouteKey[];

export const PRODUCT_LANDING_TEMPLATE_BLOCKS = [
  'hero',
  'trustBar',
  'sections',
  'featureGrid',
  'steps',
  'useCases',
  'faqPreview',
  'fullFaq',
  'cta',
] as const satisfies readonly SeoLandingTemplateBlock[];

export const GUIDE_LANDING_TEMPLATE_BLOCKS = [
  'hero',
  'trustBar',
  'sections',
  'steps',
  'featureGrid',
  'useCases',
  'faqPreview',
  'fullFaq',
  'cta',
] as const satisfies readonly SeoLandingTemplateBlock[];

export const COMPARISON_LANDING_TEMPLATE_BLOCKS = [
  'hero',
  'trustBar',
  'sections',
  'comparison',
  'steps',
  'featureGrid',
  'useCases',
  'faqPreview',
  'fullFaq',
  'cta',
] as const satisfies readonly SeoLandingTemplateBlock[];

export const FAQ_LANDING_TEMPLATE_BLOCKS = [
  'hero',
  'trustBar',
  'sections',
  'fullFaq',
  'cta',
] as const satisfies readonly SeoLandingTemplateBlock[];

export const SEO_LANDING_TEMPLATE_BY_ROUTE = {
  home: 'ProductLandingTemplate',
  playCommanderOnline: 'ProductLandingTemplate',
  playMagicOnlineWithFriends: 'GuideLandingTemplate',
  createCommanderRoom: 'ProductLandingTemplate',
  importCommanderDeck: 'ProductLandingTemplate',
  commanderDeckBuilder: 'ProductLandingTemplate',
  tableAssistant: 'ProductLandingTemplate',
  waysToPlayCommanderOnline: 'ComparisonLandingTemplate',
  howToPlayCommanderOnline: 'GuideLandingTemplate',
  faq: 'FaqLandingTemplate',
} as const satisfies Record<SeoRouteKey, SeoLandingTemplateName>;

export function getSeoLandingTemplateName(routeKey: SeoRouteKey): SeoLandingTemplateName {
  return SEO_LANDING_TEMPLATE_BY_ROUTE[routeKey];
}
