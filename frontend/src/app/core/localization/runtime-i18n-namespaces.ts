export const RUNTIME_I18N_NAMESPACES = [
  'common',
  'navigation',
  'auth',
  'rooms',
  'game',
  'deckBuilder',
  'tableAssistant',
  'profile',
  'settings',
  'forms',
  'errors',
  'modals',
  'toasts',
  'emptyStates',
  'onboarding',
] as const;

export type RuntimeI18nNamespace = typeof RUNTIME_I18N_NAMESPACES[number];
