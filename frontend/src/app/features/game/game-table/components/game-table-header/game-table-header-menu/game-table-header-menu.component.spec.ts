import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Check, ChevronRight, LogOut, LucideAngularModule, Maximize2, Menu, Settings } from 'lucide-angular';
import { FullscreenService } from '../../../../../../core/fullscreen/fullscreen.service';
import { SupportedLanguageCode } from '../../../../../../core/localization/language-preferences';
import { LanguagePreferencesService } from '../../../../../../core/localization/language-preferences.service';
import { HYBRID_LANGUAGE_OPTIONS, RuntimeLanguageSelectorService } from '../../../../../../core/localization/runtime-language-selector.service';
import { GameTableHeaderMenuComponent } from './game-table-header-menu.component';

describe('GameTableHeaderMenuComponent', () => {
  const cardLanguageSignal = signal<SupportedLanguageCode>('en');
  const appLanguageSignal = signal<SupportedLanguageCode>('en');
  const updatePreferences = vi.fn(async (payload: {
    cardLanguage?: SupportedLanguageCode;
    appLanguage?: SupportedLanguageCode;
  }) => {
    if (payload.cardLanguage) {
      cardLanguageSignal.set(payload.cardLanguage);
    }
    if (payload.appLanguage) {
      appLanguageSignal.set(payload.appLanguage);
    }
  });
  const selectRuntimeLanguage = vi.fn(async (code: SupportedLanguageCode) => {
    await updatePreferences({ cardLanguage: code, appLanguage: code });
  });
  const fullscreenToggle = vi.fn(async () => true);

  beforeEach(async () => {
    cardLanguageSignal.set('en');
    appLanguageSignal.set('en');
    updatePreferences.mockReset();
    selectRuntimeLanguage.mockReset();
    fullscreenToggle.mockReset();
    updatePreferences.mockImplementation(async (payload: {
      cardLanguage?: SupportedLanguageCode;
      appLanguage?: SupportedLanguageCode;
    }) => {
      if (payload.cardLanguage) {
        cardLanguageSignal.set(payload.cardLanguage);
      }
      if (payload.appLanguage) {
        appLanguageSignal.set(payload.appLanguage);
      }
    });
    selectRuntimeLanguage.mockImplementation(async (code: SupportedLanguageCode) => {
      await updatePreferences({ cardLanguage: code, appLanguage: code });
    });
    await TestBed.configureTestingModule({
      imports: [GameTableHeaderMenuComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Check, ChevronRight, LogOut, Maximize2, Menu, Settings })),
        {
          provide: LanguagePreferencesService,
          useValue: {
            cardLanguage: cardLanguageSignal.asReadonly(),
            appLanguage: appLanguageSignal.asReadonly(),
            updatePreferences,
          } satisfies Pick<LanguagePreferencesService, 'cardLanguage' | 'appLanguage' | 'updatePreferences'>,
        },
        {
          provide: RuntimeLanguageSelectorService,
          useValue: {
            selectedLanguage: appLanguageSignal.asReadonly(),
            languageOptions: HYBRID_LANGUAGE_OPTIONS,
            selectLanguage: selectRuntimeLanguage,
          } satisfies Pick<RuntimeLanguageSelectorService, 'selectedLanguage' | 'languageOptions' | 'selectLanguage'>,
        },
        {
          provide: FullscreenService,
          useValue: {
            toggleFullscreen: fullscreenToggle,
          } satisfies Pick<FullscreenService, 'toggleFullscreen'>,
        },
      ],
    }).compileComponents();
  });

  it('emits settings when selecting settings option', () => {
    const fixture = TestBed.createComponent(GameTableHeaderMenuComponent);
    const settingsSpy = vi.fn();
    fixture.componentInstance.settingsSelected.subscribe(settingsSpy);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.icon-button') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const settingsButton = Array.from(
      fixture.nativeElement.querySelectorAll('.menu-item') as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.textContent?.includes('Settings')) as HTMLButtonElement;
    settingsButton.click();
    fixture.detectChanges();

    expect(settingsSpy).toHaveBeenCalledTimes(1);
  });

  it('updates both card and app language from the language picker', async () => {
    const fixture = TestBed.createComponent(GameTableHeaderMenuComponent);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.icon-button') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const languageButton = Array.from(
      fixture.nativeElement.querySelectorAll('.menu-item') as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.textContent?.includes('Language')) as HTMLButtonElement;
    languageButton.click();
    fixture.detectChanges();

    const frenchButton = Array.from(
      fixture.nativeElement.querySelectorAll('.language-item') as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.textContent?.includes('Français')) as HTMLButtonElement;
    frenchButton.click();
    fixture.detectChanges();
    await Promise.resolve();

    expect(selectRuntimeLanguage).toHaveBeenCalledWith('fr');
    expect(updatePreferences).toHaveBeenCalledWith({ cardLanguage: 'fr', appLanguage: 'fr' });
  });
});
