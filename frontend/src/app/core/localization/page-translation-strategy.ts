export type PageTranslationStrategy = 'seo-static' | 'runtime-i18n' | 'out-of-scope';

export const PAGE_TRANSLATION_STRATEGIES = {
  home: 'seo-static',
  playCommanderOnline: 'seo-static',
  playMagicOnlineWithFriends: 'seo-static',
  createCommanderRoom: 'seo-static',
  importCommanderDeck: 'seo-static',
  commanderDeckBuilder: 'seo-static',
  tableAssistant: 'seo-static',
  waysToPlayCommanderOnline: 'seo-static',
  howToPlayCommanderOnline: 'seo-static',
  spellTableAlternative: 'seo-static',
  playCommanderOnlineFree: 'seo-static',
  playCommanderWithoutWebcam: 'seo-static',
  playEdhOnline: 'seo-static',
  commanderSimulator: 'seo-static',
  faq: 'seo-static',

  login: 'runtime-i18n',
  register: 'runtime-i18n',
  passwordReset: 'runtime-i18n',
  emailVerification: 'runtime-i18n',
  app: 'runtime-i18n',
  dashboard: 'runtime-i18n',
  cards: 'runtime-i18n',
  cardDetail: 'runtime-i18n',
  rooms: 'runtime-i18n',
  waitingRoom: 'runtime-i18n',
  game: 'runtime-i18n',
  profile: 'runtime-i18n',
  settings: 'runtime-i18n',
  account: 'runtime-i18n',
  decks: 'runtime-i18n',
  deckEditor: 'runtime-i18n',
  tableAssistantApp: 'runtime-i18n',
  legal: 'runtime-i18n',

  demoRoom: 'out-of-scope',
  gameDebug: 'out-of-scope',
  wildcardRedirect: 'out-of-scope',
} as const satisfies Record<string, PageTranslationStrategy>;

export type PageKey = keyof typeof PAGE_TRANSLATION_STRATEGIES;

export function isSeoStaticPage(pageKey: PageKey): boolean {
  return PAGE_TRANSLATION_STRATEGIES[pageKey] === 'seo-static';
}

export function isRuntimeI18nPage(pageKey: PageKey): boolean {
  return PAGE_TRANSLATION_STRATEGIES[pageKey] === 'runtime-i18n';
}

export function isOutOfScopePage(pageKey: PageKey): boolean {
  return PAGE_TRANSLATION_STRATEGIES[pageKey] === 'out-of-scope';
}
