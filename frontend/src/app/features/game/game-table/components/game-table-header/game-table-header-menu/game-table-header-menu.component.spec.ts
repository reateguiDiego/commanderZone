import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Check, ChevronRight, LogOut, LucideAngularModule, Maximize2, Menu, Settings } from 'lucide-angular';
import { FullscreenService } from '../../../../../../core/fullscreen/fullscreen.service';
import { LanguagePreferencesService } from '../../../../../../core/localization/language-preferences.service';
import { GameTableHeaderMenuComponent } from './game-table-header-menu.component';

describe('GameTableHeaderMenuComponent', () => {
  const cardLanguageSignal = signal<'en' | 'fr' | 'es' | 'de' | 'it' | 'ja' | 'zhs' | 'pt' | 'ru' | 'ko' | 'zht' | 'nl' | 'ca'>('en');
  const appLanguageSignal = signal<'en' | 'fr' | 'es' | 'de' | 'it' | 'ja' | 'zhs' | 'pt' | 'ru' | 'ko' | 'zht' | 'nl' | 'ca'>('en');
  const updatePreferences = vi.fn(async (payload: {
    cardLanguage?: 'en' | 'fr' | 'es' | 'de' | 'it' | 'ja' | 'zhs' | 'pt' | 'ru' | 'ko' | 'zht' | 'nl' | 'ca';
    appLanguage?: 'en' | 'fr' | 'es' | 'de' | 'it' | 'ja' | 'zhs' | 'pt' | 'ru' | 'ko' | 'zht' | 'nl' | 'ca';
  }) => {
    if (payload.cardLanguage) {
      cardLanguageSignal.set(payload.cardLanguage);
    }
    if (payload.appLanguage) {
      appLanguageSignal.set(payload.appLanguage);
    }
  });
  const fullscreenToggle = vi.fn(async () => true);

  beforeEach(async () => {
    cardLanguageSignal.set('en');
    appLanguageSignal.set('en');
    updatePreferences.mockReset();
    fullscreenToggle.mockReset();
    updatePreferences.mockImplementation(async (payload: {
      cardLanguage?: 'en' | 'fr' | 'es' | 'de' | 'it' | 'ja' | 'zhs' | 'pt' | 'ru' | 'ko' | 'zht' | 'nl' | 'ca';
      appLanguage?: 'en' | 'fr' | 'es' | 'de' | 'it' | 'ja' | 'zhs' | 'pt' | 'ru' | 'ko' | 'zht' | 'nl' | 'ca';
    }) => {
      if (payload.cardLanguage) {
        cardLanguageSignal.set(payload.cardLanguage);
      }
      if (payload.appLanguage) {
        appLanguageSignal.set(payload.appLanguage);
      }
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
    const reloadSpy = vi.spyOn(
      fixture.componentInstance as unknown as { reloadPage(): void },
      'reloadPage',
    ).mockImplementation(() => undefined);
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
    ).find((button) => button.textContent?.includes('French')) as HTMLButtonElement;
    frenchButton.click();
    fixture.detectChanges();
    await Promise.resolve();

    expect(updatePreferences).toHaveBeenCalledWith({ cardLanguage: 'fr', appLanguage: 'fr' });
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
