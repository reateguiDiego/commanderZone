import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Check, ChevronRight, CircleQuestionMark, LogOut, LucideAngularModule, Maximize2, Menu, Settings } from 'lucide-angular';
import { SupportedLanguageCode } from '../../../../../../../core/localization/language-preferences';
import { LanguagePreferencesService } from '../../../../../../../core/localization/language-preferences.service';
import { HYBRID_LANGUAGE_OPTIONS, RuntimeLanguageSelectorService } from '../../../../../../../core/localization/runtime-language-selector.service';
import { HeaderUserMenuComponent } from './header-user-menu.component';

describe('HeaderUserMenuComponent', () => {
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

  beforeEach(async () => {
    cardLanguageSignal.set('en');
    appLanguageSignal.set('en');
    updatePreferences.mockReset();
    selectRuntimeLanguage.mockReset();
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
      imports: [HeaderUserMenuComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Check, ChevronRight, CircleQuestionMark, LogOut, Maximize2, Menu, Settings })),
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
      ],
    }).compileComponents();
  });

  it('emits settings when selecting settings option', () => {
    const fixture = TestBed.createComponent(HeaderUserMenuComponent);
    const settingsSpy = vi.fn();
    fixture.componentInstance.settingsSelected.subscribe(settingsSpy);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.icon-button') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const menuItems = Array.from(
      fixture.nativeElement.querySelectorAll('.menu-item') as NodeListOf<HTMLButtonElement>,
    );
    const settingsButton = menuItems
      .find((button) => button.textContent?.includes('Settings')) as HTMLButtonElement;
    settingsButton.click();
    fixture.detectChanges();

    expect(settingsSpy).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('.header-menu-panel')).toBeNull();
  });

  it('emits fullscreen when selecting fullscreen option', () => {
    const fixture = TestBed.createComponent(HeaderUserMenuComponent);
    const fullscreenSpy = vi.fn();
    fixture.componentInstance.fullscreenSelected.subscribe(fullscreenSpy);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.icon-button') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const menuItems = Array.from(
      fixture.nativeElement.querySelectorAll('.menu-item') as NodeListOf<HTMLButtonElement>,
    );
    const fullscreenButton = menuItems
      .find((button) => button.textContent?.includes('Fullscreen')) as HTMLButtonElement;
    fullscreenButton.click();
    fixture.detectChanges();

    expect(fullscreenSpy).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('.header-menu-panel')).toBeNull();
  });

  it('updates selected language from the language picker', async () => {
    const fixture = TestBed.createComponent(HeaderUserMenuComponent);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.icon-button') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const menuItems = Array.from(
      fixture.nativeElement.querySelectorAll('.menu-item') as NodeListOf<HTMLButtonElement>,
    );
    const languageButton = menuItems
      .find((button) => button.textContent?.includes('Language')) as HTMLButtonElement;
    languageButton.click();
    fixture.detectChanges();

    const languageItems = Array.from(
      fixture.nativeElement.querySelectorAll('.language-item') as NodeListOf<HTMLButtonElement>,
    );
    const frenchButton = languageItems
      .find((button) => button.textContent?.includes('Français')) as HTMLButtonElement;
    frenchButton.click();
    fixture.detectChanges();
    await Promise.resolve();

    expect(selectRuntimeLanguage).toHaveBeenCalledWith('fr');
    expect(updatePreferences).toHaveBeenCalledWith({ cardLanguage: 'fr', appLanguage: 'fr' });
    expect(
      (fixture.nativeElement.querySelector('.menu-item-flag') as HTMLImageElement)?.getAttribute('src'),
    ).toContain('france.png');
  });

  it('renders language picker options sorted alphabetically by label', () => {
    const fixture = TestBed.createComponent(HeaderUserMenuComponent);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.icon-button') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const menuItems = Array.from(
      fixture.nativeElement.querySelectorAll('.menu-item') as NodeListOf<HTMLButtonElement>,
    );
    const languageButton = menuItems
      .find((button) => button.textContent?.includes('Language')) as HTMLButtonElement;
    languageButton.click();
    fixture.detectChanges();

    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.language-item .language-option span:last-child') as NodeListOf<HTMLElement>,
    ).map((element) => element.textContent?.trim() ?? '');

    const sorted = [...labels].sort((left, right) => left.localeCompare(right, 'es', { sensitivity: 'base' }));
    expect(labels).toEqual(sorted);
  });

  it('includes dutch and catalan native options in language picker', () => {
    const fixture = TestBed.createComponent(HeaderUserMenuComponent);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.icon-button') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const menuItems = Array.from(
      fixture.nativeElement.querySelectorAll('.menu-item') as NodeListOf<HTMLButtonElement>,
    );
    const languageButton = menuItems
      .find((button) => button.textContent?.includes('Language')) as HTMLButtonElement;
    languageButton.click();
    fixture.detectChanges();

    const languageItems = Array.from(
      fixture.nativeElement.querySelectorAll('.language-item') as NodeListOf<HTMLButtonElement>,
    );
    const labels = languageItems.map((button) => button.textContent ?? '');

    expect(labels.some((text) => text.includes('Nederlands'))).toBe(true);
    expect(labels.some((text) => text.includes('Català'))).toBe(true);
  });

  it('links to the public FAQ from the internal app menu', () => {
    const fixture = TestBed.createComponent(HeaderUserMenuComponent);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.icon-button') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const faqLink = fixture.nativeElement.querySelector('a.menu-item[href="/en/faq/"]') as HTMLAnchorElement | null;

    expect(faqLink).toBeTruthy();
    expect(faqLink?.textContent).toContain('FAQ');
  });

  it('emits logoff when selecting log off option', () => {
    const fixture = TestBed.createComponent(HeaderUserMenuComponent);
    const logoffSpy = vi.fn();
    fixture.componentInstance.logoffSelected.subscribe(logoffSpy);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.icon-button') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const menuItems = Array.from(
      fixture.nativeElement.querySelectorAll('.menu-item') as NodeListOf<HTMLButtonElement>,
    );
    const logoffButton = menuItems
      .find((button) => button.textContent?.includes('Log off')) as HTMLButtonElement;
    logoffButton.click();
    fixture.detectChanges();

    expect(logoffSpy).toHaveBeenCalledTimes(1);
  });
});
