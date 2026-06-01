import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LanguagePreferencesService } from './language-preferences.service';
import { AppShellI18nService } from './app-shell-i18n.service';

describe('AppShellI18nService', () => {
  const appLanguageSignal = signal<'en' | 'fr' | 'es'>('en');

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

    expect(service.text('settings')).toBe('Configuracion');
    expect(service.text('language')).toBe('Idioma');
    expect(service.languageName('en')).toBe('Ingles');
  });

  it('falls back to English shell labels when app language is not explicitly mapped', () => {
    const service = TestBed.inject(AppShellI18nService);
    appLanguageSignal.set('fr');

    expect(service.text('settings')).toBe('Settings');
    expect(service.text('language')).toBe('Language');
    expect(service.languageName('es')).toBe('Spanish');
  });
});
