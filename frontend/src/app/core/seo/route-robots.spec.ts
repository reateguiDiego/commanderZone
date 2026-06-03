import {
  PAGE_TRANSLATION_STRATEGIES,
  PageKey,
} from '../localization/page-translation-strategy';
import { getPageRobotsMeta, getStrategyRobotsMeta, isSeoIndexablePage } from './route-robots';

describe('route robots rules', () => {
  it('maps SEO-static pages to index, follow', () => {
    expect(getStrategyRobotsMeta('seo-static')).toBe('index, follow');

    for (const pageKey of pageKeysForStrategy('seo-static')) {
      expect(getPageRobotsMeta(pageKey)).toBe('index, follow');
      expect(isSeoIndexablePage(pageKey)).toBe(true);
    }
  });

  it('maps runtime-i18n pages to noindex, follow', () => {
    expect(getStrategyRobotsMeta('runtime-i18n')).toBe('noindex, follow');

    for (const pageKey of pageKeysForStrategy('runtime-i18n')) {
      expect(getPageRobotsMeta(pageKey)).toBe('noindex, follow');
      expect(isSeoIndexablePage(pageKey)).toBe(false);
    }
  });

  it('maps out-of-scope pages to noindex, nofollow', () => {
    expect(getStrategyRobotsMeta('out-of-scope')).toBe('noindex, nofollow');

    for (const pageKey of pageKeysForStrategy('out-of-scope')) {
      expect(getPageRobotsMeta(pageKey)).toBe('noindex, nofollow');
      expect(isSeoIndexablePage(pageKey)).toBe(false);
    }
  });
});

function pageKeysForStrategy(strategy: typeof PAGE_TRANSLATION_STRATEGIES[PageKey]): PageKey[] {
  return Object.entries(PAGE_TRANSLATION_STRATEGIES)
    .filter(([, pageStrategy]) => pageStrategy === strategy)
    .map(([pageKey]) => pageKey as PageKey);
}
