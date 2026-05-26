import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Check, ChevronRight, LogOut, LucideAngularModule, Maximize2, Menu, Settings } from 'lucide-angular';
import { LanguagePreferencesService } from '../../../../../../../core/localization/language-preferences.service';
import { HeaderUserMenuComponent } from './header-user-menu.component';

describe('HeaderUserMenuComponent', () => {
  const languageSignal = signal<'en' | 'fr' | 'es' | 'de' | 'it' | 'ja' | 'zhs' | 'pt' | 'ru' | 'ko' | 'zht' | 'nl' | 'ca'>('en');
  const updateCardLanguage = vi.fn(async (code: 'en' | 'fr' | 'es' | 'de' | 'it' | 'ja' | 'zhs' | 'pt' | 'ru' | 'ko' | 'zht' | 'nl' | 'ca') => {
    languageSignal.set(code);
  });

  beforeEach(async () => {
    languageSignal.set('en');
    updateCardLanguage.mockReset();
    updateCardLanguage.mockImplementation(async (code: 'en' | 'fr' | 'es' | 'de' | 'it' | 'ja' | 'zhs' | 'pt' | 'ru' | 'ko' | 'zht' | 'nl' | 'ca') => {
      languageSignal.set(code);
    });
    await TestBed.configureTestingModule({
      imports: [HeaderUserMenuComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Check, ChevronRight, LogOut, Maximize2, Menu, Settings })),
        {
          provide: LanguagePreferencesService,
          useValue: {
            cardLanguage: languageSignal.asReadonly(),
            updateCardLanguage,
          } satisfies Pick<LanguagePreferencesService, 'cardLanguage' | 'updateCardLanguage'>,
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
      .find((button) => button.textContent?.includes('Frances')) as HTMLButtonElement;
    frenchButton.click();
    fixture.detectChanges();
    await Promise.resolve();

    expect(updateCardLanguage).toHaveBeenCalledWith('fr');
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

  it('includes dutch and catalan options in language picker', () => {
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

    expect(labels.some((text) => text.includes('Holandes'))).toBe(true);
    expect(labels.some((text) => text.includes('Catalan'))).toBe(true);
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
