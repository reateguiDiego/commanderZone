import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { LocaleCode } from './locale-config';
import { SupportedLanguageCode } from './language-preferences';
import { LanguagePreferencesService } from './language-preferences.service';
import {
  HYBRID_LANGUAGE_OPTIONS,
  RuntimeLanguageSelectorService,
  toRuntimeLanguageCode,
  toRuntimeLocale,
} from './runtime-language-selector.service';
import { TranslationService } from './translation.service';

describe('RuntimeLanguageSelectorService', () => {
  const cardLanguage = signal<SupportedLanguageCode>('en');
  const appLanguage = signal<SupportedLanguageCode>('en');
  const updatePreferences = vi.fn(async (payload: { cardLanguage?: SupportedLanguageCode; appLanguage?: SupportedLanguageCode }) => {
    if (payload.cardLanguage) {
      cardLanguage.set(payload.cardLanguage);
    }

    if (payload.appLanguage) {
      appLanguage.set(payload.appLanguage);
    }
  });
  const useLocale = vi.fn((locale: LocaleCode) => of(locale));

  beforeEach(() => {
    cardLanguage.set('en');
    appLanguage.set('en');
    updatePreferences.mockClear();
    useLocale.mockClear();

    TestBed.configureTestingModule({
      providers: [
        RuntimeLanguageSelectorService,
        {
          provide: LanguagePreferencesService,
          useValue: {
            cardLanguage: cardLanguage.asReadonly(),
            appLanguage: appLanguage.asReadonly(),
            updatePreferences,
          } satisfies Pick<LanguagePreferencesService, 'cardLanguage' | 'appLanguage' | 'updatePreferences'>,
        },
        {
          provide: TranslationService,
          useValue: {
            useLocale,
          } satisfies Pick<TranslationService, 'useLocale'>,
        },
      ],
    });
  });

  it('maps runtime language codes to SEO locale codes without mixed zh slugs', () => {
    expect(toRuntimeLocale('zhs')).toBe('zh-hans');
    expect(toRuntimeLocale('zht')).toBe('zh-hant');
    expect(toRuntimeLanguageCode('zh-hans')).toBe('zhs');
    expect(toRuntimeLanguageCode('zh-hant')).toBe('zht');
  });

  it('uses native labels for every hybrid language option', () => {
    expect(HYBRID_LANGUAGE_OPTIONS.map((option) => option.label)).toEqual([
      'Español',
      'English',
      'Deutsch',
      'Français',
      'Italiano',
      'Português',
      '日本語',
      '한국어',
      '简体中文',
      '繁體中文',
      'Nederlands',
      'Català',
      'Русский',
    ]);
  });

  it('updates runtime preferences and ngx-translate locale without route changes', async () => {
    const service = TestBed.inject(RuntimeLanguageSelectorService);
    await TestBed.runInInjectionContext(async () => {
      await service.selectLanguage('fr');
    });

    expect(updatePreferences).toHaveBeenCalledWith({ cardLanguage: 'fr', appLanguage: 'fr' });
    expect(useLocale).toHaveBeenCalledWith('fr');
  });

  it('does not persist or reapply when selecting the active language', async () => {
    const service = TestBed.inject(RuntimeLanguageSelectorService);
    useLocale.mockClear();

    await service.selectLanguage('en');

    expect(updatePreferences).not.toHaveBeenCalled();
    expect(useLocale).not.toHaveBeenCalled();
  });
});
