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

  it('maps private runtime-i18n pages to noindex, nofollow', () => {
    expect(getStrategyRobotsMeta('runtime-i18n')).toBe('noindex, nofollow');

    for (const pageKey of pageKeysForStrategy('runtime-i18n').filter((pageKey) => !['legal', 'contact'].includes(pageKey))) {
      expect(getPageRobotsMeta(pageKey)).toBe('noindex, nofollow');
      expect(isSeoIndexablePage(pageKey)).toBe(false);
    }
  });

  it('maps out-of-scope pages to noindex, nofollow', () => {
    expect(getStrategyRobotsMeta('out-of-scope')).toBe('noindex, nofollow');

    for (const pageKey of pageKeysForStrategy('out-of-scope').filter((pageKey) => pageKey !== 'wildcardRedirect')) {
      expect(getPageRobotsMeta(pageKey)).toBe('noindex, nofollow');
      expect(isSeoIndexablePage(pageKey)).toBe(false);
    }
  });

  it('uses noindex, nofollow for the wildcard 404 route', () => {
    expect(getPageRobotsMeta('wildcardRedirect')).toBe('noindex, nofollow');
    expect(isSeoIndexablePage('wildcardRedirect')).toBe(false);
  });

  it('uses noindex, follow for public legal pages', () => {
    expect(getPageRobotsMeta('legal')).toBe('noindex, follow');
    expect(isSeoIndexablePage('legal')).toBe(false);
  });

  it('uses noindex, follow for the public contact page', () => {
    expect(getPageRobotsMeta('contact')).toBe('noindex, follow');
    expect(isSeoIndexablePage('contact')).toBe(false);
  });
});

function pageKeysForStrategy(strategy: typeof PAGE_TRANSLATION_STRATEGIES[PageKey]): PageKey[] {
  return Object.entries(PAGE_TRANSLATION_STRATEGIES)
    .filter(([, pageStrategy]) => pageStrategy === strategy)
    .map(([pageKey]) => pageKey as PageKey);
}
