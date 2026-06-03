import {
  PAGE_TRANSLATION_STRATEGIES,
  PageKey,
  PageTranslationStrategy,
} from '../localization/page-translation-strategy';

export type RobotsMetaContent = 'index, follow' | 'noindex, follow' | 'noindex, nofollow';

export function getPageRobotsMeta(pageKey: PageKey): RobotsMetaContent {
  return getStrategyRobotsMeta(PAGE_TRANSLATION_STRATEGIES[pageKey]);
}

export function getStrategyRobotsMeta(strategy: PageTranslationStrategy): RobotsMetaContent {
  switch (strategy) {
    case 'seo-static':
      return 'index, follow';
    case 'runtime-i18n':
      return 'noindex, follow';
    case 'out-of-scope':
      return 'noindex, nofollow';
  }
}

export function isSeoIndexablePage(pageKey: PageKey): boolean {
  return getPageRobotsMeta(pageKey) === 'index, follow';
}
