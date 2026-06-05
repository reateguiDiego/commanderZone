import { SEO_ROUTE_KEYS } from '../../../core/localization/seo-routes';
import {
  COMPARISON_LANDING_ROUTE_KEYS,
  FAQ_LANDING_ROUTE_KEYS,
  GUIDE_LANDING_ROUTE_KEYS,
  PRODUCT_LANDING_ROUTE_KEYS,
  SEO_LANDING_TEMPLATE_BY_ROUTE,
  getSeoLandingTemplateName,
} from './seo-landing-template.model';

describe('SEO landing templates', () => {
  it('assigns every SEO route to exactly one reusable template', () => {
    expect(Object.keys(SEO_LANDING_TEMPLATE_BY_ROUTE).sort()).toEqual([...SEO_ROUTE_KEYS].sort());
  });

  it('maps product-intent landings to ProductLandingTemplate', () => {
    expect(PRODUCT_LANDING_ROUTE_KEYS).toEqual([
      'home',
      'playCommanderOnline',
      'createCommanderRoom',
      'importCommanderDeck',
      'commanderDeckBuilder',
      'tableAssistant',
      'playCommanderOnlineFree',
      'playEdhOnline',
      'commanderSimulator',
    ]);

    for (const routeKey of PRODUCT_LANDING_ROUTE_KEYS) {
      expect(getSeoLandingTemplateName(routeKey)).toBe('ProductLandingTemplate');
    }
  });

  it('maps guide, comparison and FAQ intents to their shared templates', () => {
    expect(GUIDE_LANDING_ROUTE_KEYS).toEqual([
      'playMagicOnlineWithFriends',
      'howToPlayCommanderOnline',
    ]);
    expect(COMPARISON_LANDING_ROUTE_KEYS).toEqual([
      'waysToPlayCommanderOnline',
      'spellTableAlternative',
      'playCommanderWithoutWebcam',
    ]);
    expect(FAQ_LANDING_ROUTE_KEYS).toEqual(['faq']);

    for (const routeKey of GUIDE_LANDING_ROUTE_KEYS) {
      expect(getSeoLandingTemplateName(routeKey)).toBe('GuideLandingTemplate');
    }

    for (const routeKey of COMPARISON_LANDING_ROUTE_KEYS) {
      expect(getSeoLandingTemplateName(routeKey)).toBe('ComparisonLandingTemplate');
    }

    for (const routeKey of FAQ_LANDING_ROUTE_KEYS) {
      expect(getSeoLandingTemplateName(routeKey)).toBe('FaqLandingTemplate');
    }
  });
});
