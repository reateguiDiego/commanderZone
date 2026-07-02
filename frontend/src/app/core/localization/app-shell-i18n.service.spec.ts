import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LanguagePreferencesService } from './language-preferences.service';
import { AppShellI18nService } from './app-shell-i18n.service';

describe('AppShellI18nService', () => {
  const appLanguageSignal = signal<'en' | 'fr' | 'es' | 'de' | 'ca'>('en');

  beforeEach(() => {
    appLanguageSignal.set('en');
    TestBed.configureTestingModule({
      providers: [
        AppShellI18nService,
        {
          provide: LanguagePreferencesService,
          useValue: {
            appLanguage: appLanguageSignal.asReadonly(),
          } satisfies Pick<LanguagePreferencesService, 'appLanguage'>,
        },
      ],
    });
  });

  it('returns Spanish shell labels when app language is es', () => {
    const service = TestBed.inject(AppShellI18nService);
    appLanguageSignal.set('es');

    expect(service.text('settings')).toBe('Configuración');
    expect(service.text('language')).toBe('Idioma');
    expect(service.languageName('en')).toBe('Inglés');
    expect(service.cardLanguageFallbackDisclaimer(73, service.languageName('en'))).toContain('está disponible en Inglés');
  });

  it('returns localized shell labels for non-English runtime languages', () => {
    const service = TestBed.inject(AppShellI18nService);
    appLanguageSignal.set('de');

    expect(service.text('settings')).toBe('Einstellungen');
    expect(service.text('cardLanguage')).toBe('Kartensprache');
    expect(service.languageName('es')).toBe('Spanisch');
  });

  it('localizes Catalan app shell text instead of falling back to English', () => {
    const service = TestBed.inject(AppShellI18nService);
    appLanguageSignal.set('ca');

    expect(service.text('settings')).toBe('Configuració');
    expect(service.text('save')).toBe('Desa');
    expect(service.languageName('de')).toBe('Alemany');
  });

  it('falls back to English shell labels for unsupported language values', () => {
    const service = TestBed.inject(AppShellI18nService);
    appLanguageSignal.set('xx' as never);

    expect(service.text('settings')).toBe('Settings');
    expect(service.text('language')).toBe('Language');
  });
});
