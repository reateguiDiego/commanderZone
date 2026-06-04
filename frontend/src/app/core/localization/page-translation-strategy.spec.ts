import {
  isOutOfScopePage,
  isRuntimeI18nPage,
  isSeoStaticPage,
  PAGE_TRANSLATION_STRATEGIES,
  PageKey,
} from './page-translation-strategy';

describe('page translation strategy manifest', () => {
  const seoStaticPages = [
    'home',
    'playCommanderOnline',
    'playMagicOnlineWithFriends',
    'createCommanderRoom',
    'importCommanderDeck',
    'commanderDeckBuilder',
    'tableAssistant',
    'waysToPlayCommanderOnline',
    'howToPlayCommanderOnline',
    'faq',
  ] as const satisfies readonly PageKey[];

  const runtimeI18nPages = [
    'login',
    'register',
    'passwordReset',
    'emailVerification',
    'app',
    'dashboard',
    'cards',
    'cardDetail',
    'rooms',
    'waitingRoom',
    'game',
    'profile',
    'settings',
    'account',
    'decks',
    'deckEditor',
    'tableAssistantApp',
    'legal',
  ] as const satisfies readonly PageKey[];

  const outOfScopePages = [
    'demoRoom',
    'gameDebug',
    'wildcardRedirect',
  ] as const satisfies readonly PageKey[];

  it('classifies the approved SEO surface as seo-static only', () => {
    for (const pageKey of seoStaticPages) {
      expect(isSeoStaticPage(pageKey)).toBe(true);
      expect(isRuntimeI18nPage(pageKey)).toBe(false);
      expect(isOutOfScopePage(pageKey)).toBe(false);
    }
  });

  it('classifies internal app pages as runtime-i18n only', () => {
    for (const pageKey of runtimeI18nPages) {
      expect(isSeoStaticPage(pageKey)).toBe(false);
      expect(isRuntimeI18nPage(pageKey)).toBe(true);
      expect(isOutOfScopePage(pageKey)).toBe(false);
    }
  });

  it('classifies debug, demo, and fallback routes as out-of-scope only', () => {
    for (const pageKey of outOfScopePages) {
      expect(isSeoStaticPage(pageKey)).toBe(false);
      expect(isRuntimeI18nPage(pageKey)).toBe(false);
      expect(isOutOfScopePage(pageKey)).toBe(true);
    }
  });

  it('keeps the SEO table assistant landing separate from the internal table assistant app', () => {
    expect(PAGE_TRANSLATION_STRATEGIES.tableAssistant).toBe('seo-static');
    expect(PAGE_TRANSLATION_STRATEGIES.tableAssistantApp).toBe('runtime-i18n');
  });

  it('contains every expected page key exactly once', () => {
    const expectedPageKeys = [
      ...seoStaticPages,
      ...runtimeI18nPages,
      ...outOfScopePages,
    ];

    expect(Object.keys(PAGE_TRANSLATION_STRATEGIES).sort()).toEqual([...expectedPageKeys].sort());
  });
});
