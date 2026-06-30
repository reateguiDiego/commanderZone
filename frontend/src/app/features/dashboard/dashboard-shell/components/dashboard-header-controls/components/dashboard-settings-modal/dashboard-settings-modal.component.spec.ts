import { TestBed } from '@angular/core/testing';
import { importProvidersFrom, signal } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { ArrowLeft, Check, LucideAngularModule, Settings, Trash2, Upload, X } from 'lucide-angular';
import { AuthApi } from '../../../../../../../core/api/auth.api';
import { CardLanguageCoverageResponse, CardsLanguageService } from '../../../../../../../core/api/cards-language.service';
import { ThemesService } from '../../../../../../../core/api/themes.service';
import { AuthStore } from '../../../../../../../core/auth/auth.store';
import { LanguagePreferencesService } from '../../../../../../../core/localization/language-preferences.service';
import { RuntimeLanguageSelectorService } from '../../../../../../../core/localization/runtime-language-selector.service';
import { AppThemeId } from '../../../../../../../core/theme/app-theme';
import { AppThemeService } from '../../../../../../../core/theme/app-theme.service';
import { DashboardSettingsModalComponent } from './dashboard-settings-modal.component';

describe('DashboardSettingsModalComponent', () => {
  const authApiMock = {
    checkEmailAvailability: vi.fn(() => of({ available: true })),
    checkDisplayNameAvailability: vi.fn(() => of({ available: true })),
    updateMe: vi.fn(() => of({ user: { id: 'user-1', email: 'player@example.test', displayName: 'Player', roles: ['ROLE_USER'] } })),
    updateAvatar: vi.fn(() => of({ user: { id: 'user-1', email: 'player@example.test', displayName: 'Player', roles: ['ROLE_USER'] } })),
    updateDisplayNameStyle: vi.fn(() => of({ user: { id: 'user-1', email: 'player@example.test', displayName: 'Player', roles: ['ROLE_USER'], displayNameStyle: { type: 'preset', presetId: 'obsidian-crown', textColor: '#ffeeaa' } } })),
    requestPasswordReset: vi.fn(() => of({ accepted: true })),
    deleteMe: vi.fn(() => of(void 0)),
  };

  const authStoreMock = {
    user: signal({
      id: 'user-1',
      email: 'player@example.test',
      displayName: 'Player',
      roles: ['ROLE_USER'],
      avatar: { type: 'initial', imageUrl: null },
      displayNameStyle: { type: 'plain', presetId: 'plain' },
      preferences: {
        cardLanguage: 'en',
        appLanguage: 'en',
        themeId: 'sunrise',
        game: {
          showManaHelperOnStartup: false,
          enableManaRow: true,
          enableStackMana: false,
          gameAnimations: true,
          chatNotificationSounds: true,
        },
      },
    }),
    loadMe: vi.fn(async () => undefined),
    updateThemePreference: vi.fn(),
  };
  const languagePreferencesMock = {
    cardLanguage: signal<'en' | 'fr' | 'de' | 'it' | 'es' | 'ja' | 'zhs' | 'pt' | 'ru' | 'nl' | 'ca'>('en').asReadonly(),
    appLanguage: signal<'en' | 'fr' | 'de' | 'it' | 'es' | 'ja' | 'zhs' | 'pt' | 'ru' | 'nl' | 'ca'>('en').asReadonly(),
  };
  const runtimeLanguageSelectorMock = {
    applyLanguage: vi.fn(),
  };
  const defaultCardLanguageCoverage = [
    { code: 'en', label: 'English', distinctCardNames: 100, percentageOfEnglish: 100 },
    { code: 'es', label: 'Español', distinctCardNames: 73, percentageOfEnglish: 73 },
    { code: 'fr', label: 'Français', distinctCardNames: 76, percentageOfEnglish: 76 },
    { code: 'zht', label: '繁體中文', distinctCardNames: 42, percentageOfEnglish: 42 },
  ] satisfies CardLanguageCoverageResponse['data'];
  const cardsLanguageList = vi.fn<() => Observable<CardLanguageCoverageResponse>>(() =>
    of({ selectedCardLanguage: 'en', data: defaultCardLanguageCoverage } satisfies CardLanguageCoverageResponse),
  );
  const cardsLanguageMock = {
    list: cardsLanguageList,
  } satisfies Pick<CardsLanguageService, 'list'>;
  const themesUpdate = vi.fn((themeId: AppThemeId) => of({ themeId }));
  const themesMock = {
    update: themesUpdate,
  } satisfies Pick<ThemesService, 'update'>;

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [DashboardSettingsModalComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ ArrowLeft, Check, Settings, Trash2, Upload, X })),
        { provide: AuthApi, useValue: authApiMock },
        { provide: CardsLanguageService, useValue: cardsLanguageMock },
        { provide: ThemesService, useValue: themesMock },
        { provide: AuthStore, useValue: authStoreMock },
        { provide: LanguagePreferencesService, useValue: languagePreferencesMock },
        {
          provide: RuntimeLanguageSelectorService,
          useValue: runtimeLanguageSelectorMock satisfies Pick<RuntimeLanguageSelectorService, 'applyLanguage'>,
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders general tab and keeps theme settings out of the game tab', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('General');
    expect(fixture.nativeElement.textContent).toContain('Game');
    expect(fixture.nativeElement.textContent).toContain('Card language');
    expect(fixture.nativeElement.textContent).toContain('App language');
    expect(fixture.nativeElement.textContent).toContain('Change password');
    expect(fixture.nativeElement.textContent).toContain('6/20');
    expect(fixture.nativeElement.querySelector('.modal-title-icon')).not.toBeNull();

    const generalText = fixture.nativeElement.textContent as string;
    expect(generalText.indexOf('App language')).toBeLessThan(generalText.indexOf('Card language'));
    expect(generalText.indexOf('Card language')).toBeLessThan(generalText.indexOf('Delete account'));
    expect(generalText).not.toContain('Cards we cannot serve');

    const gameTab = Array.from(fixture.nativeElement.querySelectorAll('.settings-tabs button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Game')) as HTMLButtonElement;
    gameTab.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Visual theme');
    expect(fixture.nativeElement.querySelector('.theme-option')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Card language');
    expect(fixture.nativeElement.textContent).not.toContain('App language');
    expect(fixture.nativeElement.textContent).not.toContain('Change password');
    expect(fixture.nativeElement.textContent).toContain('Show mana helper on startup');
    expect(fixture.nativeElement.textContent).toContain('Enable mana row');
    expect(fixture.nativeElement.textContent).toContain('Preserve mana pool');
    expect(fixture.nativeElement.textContent).toContain('Game animations');
    expect(fixture.nativeElement.textContent).toContain('Chat notification sounds');
  });

  it('saves gameplay preferences from the game tab through /me', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    const gameTab = Array.from(fixture.nativeElement.querySelectorAll('.settings-tabs button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Game')) as HTMLButtonElement;
    gameTab.click();
    fixture.detectChanges();

    const manaRowToggle = Array.from(fixture.nativeElement.querySelectorAll('[role="switch"]') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Enable mana row')) as HTMLButtonElement;
    manaRowToggle.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.canSave()).toBe(true);

    await fixture.componentInstance.savePreferences();

    expect(authApiMock.updateMe).toHaveBeenCalledWith({
      gamePreferences: {
        showManaHelperOnStartup: false,
        enableManaRow: false,
        enableStackMana: false,
        gameAnimations: true,
        chatNotificationSounds: true,
      },
    });
    expect(authStoreMock.loadMe).toHaveBeenCalled();
    expect(fixture.componentInstance.canSave()).toBe(false);
  });

  it('restores unsaved gameplay preferences when cancelling settings', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.setGameSettingsToggle('enableManaRow', false);
    expect(fixture.componentInstance.canSave()).toBe(true);

    fixture.componentInstance.cancel();

    expect(fixture.componentInstance.gameSettingsToggleState().enableManaRow).toBe(true);
  });

  it('updates the username character counter from the profile form value', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.profileForm.controls.displayName.setValue('Aaguilera210');
    fixture.detectChanges();

    expect(fixture.componentInstance.userNameCharacterCount()).toBe(12);
    expect(fixture.nativeElement.textContent).toContain('12/20');
  });

  it('loads card language coverage when settings opens', async () => {
    cardsLanguageList.mockReturnValueOnce(of({
      selectedCardLanguage: 'en',
      data: [{ code: 'en', label: 'English', distinctCardNames: 100, percentageOfEnglish: 100 }],
    } satisfies CardLanguageCoverageResponse));
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(cardsLanguageList).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.cardLanguageCoverage()).toEqual([
      { code: 'en', label: 'English', distinctCardNames: 100, percentageOfEnglish: 100 },
    ]);
  });

  it('uses selected card language returned by the language coverage service', async () => {
    cardsLanguageList.mockReturnValueOnce(of({
      selectedCardLanguage: 'zht',
      data: defaultCardLanguageCoverage,
    } satisfies CardLanguageCoverageResponse));
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.selectedCardLanguage()).toBe('zht');
  });

  it('shows the language disclaimer only when card language is not English', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Cards we cannot serve');

    fixture.componentInstance.setCardLanguage('fr');
    fixture.detectChanges();

    const generalText = fixture.nativeElement.textContent as string;
    expect(generalText).toContain('76% of cards are available in French.');
    expect(generalText).toContain('Cards we cannot serve in that language will be shown in English.');
    expect(generalText.indexOf('76% of cards')).toBeLessThan(generalText.indexOf('Delete account'));
  });

  it('fills card language options from the coverage service response only', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const cardLanguageSelect = fixture.nativeElement.querySelector('app-format-select input[name="cardLanguage"]')
      ?.closest('app-format-select') as HTMLElement;
    const trigger = cardLanguageSelect.querySelector('.format-select-trigger') as HTMLButtonElement;

    trigger.click();
    fixture.detectChanges();

    const optionLabels = Array.from(cardLanguageSelect.querySelectorAll('.format-select-option-content span:last-child') as NodeListOf<HTMLElement>)
      .map((element) => element.textContent?.trim() ?? '');

    expect(optionLabels).toEqual(['English', 'Spanish', 'French', 'Traditional Chinese']);
    expect(optionLabels).not.toContain('Dutch');
    expect(cardLanguageSelect.textContent).toContain('English');
    expect(cardLanguageSelect.querySelector('.format-select-option img[src*="taiwan"]')).not.toBeNull();
  });

  it('uses translated language options with flags for app language', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const appLanguageSelect = fixture.nativeElement.querySelector('app-format-select input[name="appLanguage"]')
      ?.closest('app-format-select') as HTMLElement;
    const trigger = appLanguageSelect.querySelector('.format-select-trigger') as HTMLButtonElement;

    expect(appLanguageSelect.textContent).toContain('English');
    expect(appLanguageSelect.querySelector('.format-select-trigger .format-select-flag')).not.toBeNull();

    trigger.click();
    fixture.detectChanges();

    const optionLabels = Array.from(appLanguageSelect.querySelectorAll('.format-select-option-content span:last-child') as NodeListOf<HTMLElement>)
      .map((element) => element.textContent?.trim() ?? '');
    const optionFlags = appLanguageSelect.querySelectorAll('.format-select-option .format-select-flag');

    expect(optionLabels).toContain('German');
    expect(optionLabels).toContain('Dutch');
    expect(optionLabels).not.toContain('Deutsch');
    expect(optionFlags.length).toBe(optionLabels.length);
  });

  it('renders theme presets with sunrise selected by default', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.openThemeSettings();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const selectedTheme = fixture.nativeElement.querySelector('.theme-option.selected') as HTMLButtonElement;

    expect(fixture.componentInstance.themeEditorOpen()).toBe(true);
    expect(fixture.nativeElement.querySelector('.settings-tabs')).toBeNull();
    expect(fixture.nativeElement.querySelector('.modal-back-button')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Sunrise');
    expect(fixture.nativeElement.textContent).toContain('Arcade Neon Clash');
    expect(selectedTheme?.textContent).toContain('Sunrise');
    const themeButtons = Array.from(fixture.nativeElement.querySelectorAll('.theme-option') as NodeListOf<HTMLButtonElement>);
    expect(themeButtons).toHaveLength(6);
    for (const themeButton of themeButtons) {
      expect(themeButton.querySelectorAll('.theme-swatches span')).toHaveLength(6);
      expect(themeButton.querySelectorAll('.theme-swatches + *')).toHaveLength(0);
    }
    expect(TestBed.inject(AppThemeService).themeId()).toBe('sunrise');
  });

  it('previews the visual theme locally and saves it only from the theme save button', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.openThemeSettings();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const mysticButton = Array.from(fixture.nativeElement.querySelectorAll('.theme-option') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Mystic Grove')) as HTMLButtonElement;
    mysticButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(TestBed.inject(AppThemeService).themeId()).toBe('mystic-grove');
    expect(localStorage.getItem('commanderzone.theme')).toBeNull();
    expect(document.documentElement.dataset['theme']).toBe('mystic-grove');
    expect(themesUpdate).not.toHaveBeenCalled();
    expect(authApiMock.updateMe).not.toHaveBeenCalled();

    const saveThemeButton = fixture.nativeElement.querySelector('.save-theme-button') as HTMLButtonElement;
    expect(saveThemeButton.disabled).toBe(false);

    saveThemeButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();

    expect(themesUpdate).toHaveBeenCalledWith('mystic-grove');
    expect(authStoreMock.updateThemePreference).toHaveBeenCalledWith('mystic-grove');
    expect(localStorage.getItem('commanderzone.theme')).toBe('mystic-grove');
    expect(authApiMock.updateMe).not.toHaveBeenCalled();
  });

  it('reverts an unsaved theme preview when leaving the theme editor', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.openThemeSettings();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const mysticButton = Array.from(fixture.nativeElement.querySelectorAll('.theme-option') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Mystic Grove')) as HTMLButtonElement;
    mysticButton.click();
    fixture.detectChanges();

    expect(TestBed.inject(AppThemeService).themeId()).toBe('mystic-grove');

    const backButton = fixture.nativeElement.querySelector('.modal-back-button') as HTMLButtonElement;
    backButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.themeEditorOpen()).toBe(false);
    expect(TestBed.inject(AppThemeService).themeId()).toBe('sunrise');
    expect(document.documentElement.dataset['theme']).toBe('sunrise');
    expect(themesUpdate).not.toHaveBeenCalled();
  });

  it('syncs saved theme preferences into the auth user cache', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);

    fixture.componentInstance.syncThemePreference('mystic-grove');

    expect(authStoreMock.updateThemePreference).toHaveBeenCalledWith('mystic-grove');
  });

  it('opens theme settings from the general action button and back returns to settings', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    const themeButton = fixture.nativeElement.querySelector('.theme-language-action') as HTMLButtonElement;
    themeButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.themeEditorOpen()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Visual theme');
    expect(fixture.nativeElement.querySelector('.settings-tabs')).toBeNull();

    const backButton = fixture.nativeElement.querySelector('.modal-back-button') as HTMLButtonElement;
    backButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.themeEditorOpen()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('General');
    expect(fixture.nativeElement.textContent).toContain('Change theme');
  });

  it('disables save when there are no changes', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.profileBaseline.set({
      email: 'player@example.test',
      displayName: 'Player',
      cardLanguage: 'en',
      appLanguage: 'en',
      gamePreferences: {
        showManaHelperOnStartup: false,
        enableManaRow: true,
        enableStackMana: false,
        gameAnimations: true,
        chatNotificationSounds: true,
      },
    });
    fixture.componentInstance.profileForm.setValue({ email: 'player@example.test', displayName: 'Player' });
    expect(fixture.componentInstance.canSave()).toBe(false);
  });

  it('enables save when profile form values change', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.profileForm.controls.displayName.setValue('Renamed Player');
    fixture.detectChanges();

    expect(fixture.componentInstance.canSave()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('You have unsaved changes. Save to keep them.');
  });

  it('persists game language preferences through /me', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    const reloadSpy = vi.spyOn(fixture.componentInstance as unknown as { reloadPage(): void }, 'reloadPage')
      .mockImplementation(() => undefined);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.setCardLanguage('es');
    fixture.componentInstance.setAppLanguage('fr');
    fixture.detectChanges();

    await fixture.componentInstance.savePreferences();

    expect(authApiMock.updateMe).toHaveBeenCalledWith({ cardLanguage: 'es', appLanguage: 'fr' });
    expect(authStoreMock.loadMe).toHaveBeenCalled();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('persists only app language changes without forcing reload', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    const reloadSpy = vi.spyOn(fixture.componentInstance as unknown as { reloadPage(): void }, 'reloadPage')
      .mockImplementation(() => undefined);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.setAppLanguage('fr');
    fixture.detectChanges();

    await fixture.componentInstance.savePreferences();

    expect(authApiMock.updateMe).toHaveBeenCalledWith({ appLanguage: 'fr' });
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('requests a password reset email for the persisted account email', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.profileForm.controls.email.setValue('unsaved@example.test');
    await fixture.componentInstance.requestPasswordChange();
    fixture.detectChanges();

    expect(authApiMock.requestPasswordReset).toHaveBeenCalledWith('player@example.test');
    expect(fixture.componentInstance.passwordResetRequestState()).toBe('sent');
    const changePasswordButton = fixture.nativeElement.querySelector('.change-password-button') as HTMLButtonElement;
    expect(changePasswordButton.textContent).toContain('Sent');
  });

  it('does not request another password reset email after one was already sent', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    await fixture.componentInstance.requestPasswordChange();
    await fixture.componentInstance.requestPasswordChange();

    expect(authApiMock.requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.canRequestPasswordChange()).toBe(false);
  });

  it('shows a local error when the password reset email request fails', async () => {
    authApiMock.requestPasswordReset.mockReturnValueOnce(throwError(() => new Error('network')));
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    await fixture.componentInstance.requestPasswordChange();
    fixture.detectChanges();

    expect(authApiMock.requestPasswordReset).toHaveBeenCalledWith('player@example.test');
    expect(fixture.componentInstance.passwordResetRequestState()).toBe('error');
    expect(fixture.nativeElement.textContent).toContain('Could not send the password reset email.');
  });

  it('applies app language immediately without mutating card language', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.setAppLanguage('fr');

    expect(fixture.componentInstance.selectedAppLanguage()).toBe('fr');
    expect(fixture.componentInstance.selectedCardLanguage()).toBe('en');
    expect(runtimeLanguageSelectorMock.applyLanguage).toHaveBeenCalledWith('fr');
    expect(authApiMock.updateMe).not.toHaveBeenCalled();
  });

  it('restores the previous runtime language when cancelling unsaved app language changes', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.setAppLanguage('fr');
    fixture.componentInstance.cancel();

    expect(fixture.componentInstance.selectedAppLanguage()).toBe('en');
    expect(runtimeLanguageSelectorMock.applyLanguage).toHaveBeenLastCalledWith('en');
  });

  it('shows persisted language selections in general tab selectors', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentInstance.profileBaseline.set({
      email: 'player@example.test',
      displayName: 'Player',
      cardLanguage: 'fr',
      appLanguage: 'de',
      gamePreferences: {
        showManaHelperOnStartup: false,
        enableManaRow: true,
        enableStackMana: false,
        gameAnimations: true,
        chatNotificationSounds: true,
      },
    });
    fixture.componentInstance.selectedCardLanguage.set('fr');
    fixture.componentInstance.selectedAppLanguage.set('de');
    fixture.detectChanges();

    const cardLanguageSelect = fixture.nativeElement.querySelector('input[name="cardLanguage"]') as HTMLInputElement;
    const appLanguageSelect = fixture.nativeElement.querySelector('input[name="appLanguage"]') as HTMLInputElement;

    expect(cardLanguageSelect?.value).toBe('fr');
    expect(appLanguageSelect?.value).toBe('de');
  });

  it('shows avatar editor and persists preset selection through the API', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.openAvatarEditor();
    fixture.detectChanges();

    await fixture.componentInstance.saveAvatar({ type: 'preset', imageUrl: 'assets/images/avatars/storm-seer.png' });

    expect(authApiMock.updateAvatar).toHaveBeenCalledWith({ type: 'preset', imageUrl: 'assets/images/avatars/storm-seer.png' });
    expect(authStoreMock.loadMe).toHaveBeenCalled();
    expect(fixture.componentInstance.avatarEditorOpen()).toBe(false);
  });

  it('opens directly in avatar editor from launch target', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('launchTarget', 'avatar');
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    expect(fixture.componentInstance.avatarEditorOpen()).toBe(true);
    expect(fixture.componentInstance.displayNameStyleEditorOpen()).toBe(false);
  });

  it('opens name style editor and persists selected preset through the API', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.openDisplayNameStyleEditor();
    fixture.detectChanges();

    await fixture.componentInstance.saveDisplayNameStyle({ presetId: 'obsidian-crown', textColor: '#ffeeaa' });

    expect(authApiMock.updateDisplayNameStyle).toHaveBeenCalledWith({ presetId: 'obsidian-crown', textColor: '#ffeeaa' });
    expect(authStoreMock.loadMe).toHaveBeenCalled();
    expect(fixture.componentInstance.displayNameStyleEditorOpen()).toBe(false);
  });

  it('opens directly in name style editor from launch target', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('launchTarget', 'name-style');
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    expect(fixture.componentInstance.displayNameStyleEditorOpen()).toBe(true);
    expect(fixture.componentInstance.avatarEditorOpen()).toBe(false);
  });

  it('asks for inline confirmation before deleting the account', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    const deleteButton = Array.from(fixture.nativeElement.querySelectorAll('.danger-button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Delete account')) as HTMLButtonElement;
    deleteButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.deleteConfirmationOpen()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Are you sure you want to permanently delete your account?');
    expect(
      Array.from(fixture.nativeElement.querySelectorAll('.danger-button') as NodeListOf<HTMLButtonElement>)
        .some((button) => !button.classList.contains('compact') && button.textContent?.includes('Delete account')),
    ).toBe(false);

    const cancelButton = fixture.nativeElement.querySelector('.keep-account-button') as HTMLButtonElement;
    expect(cancelButton.textContent).toContain('Cancel');
    expect(cancelButton.classList.contains('secondary-button')).toBe(true);

    cancelButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.deleteConfirmationOpen()).toBe(false);
    expect(authApiMock.deleteMe).not.toHaveBeenCalled();
  });

  it('closes delete confirmation when clicking outside it and restores the initial delete button', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    const deleteButton = Array.from(fixture.nativeElement.querySelectorAll('.danger-button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Delete account')) as HTMLButtonElement;
    deleteButton.click();
    fixture.detectChanges();

    const confirmation = fixture.nativeElement.querySelector('.delete-confirmation') as HTMLElement;
    confirmation.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.deleteConfirmationOpen()).toBe(true);

    const emailInput = fixture.nativeElement.querySelector('input[type="email"]') as HTMLInputElement;
    emailInput.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.deleteConfirmationOpen()).toBe(false);
    expect(
      Array.from(fixture.nativeElement.querySelectorAll('.danger-button') as NodeListOf<HTMLButtonElement>)
        .some((button) => !button.classList.contains('compact') && button.textContent?.includes('Delete account')),
    ).toBe(true);
  });

  it('scrolls settings content to the bottom when delete confirmation opens', () => {
    vi.useFakeTimers();

    try {
      const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
      fixture.componentRef.setInput('open', true);
      fixture.detectChanges();

      const settingsContent = fixture.nativeElement.querySelector('.settings-content') as HTMLElement;
      const scrollTo = vi.fn();
      Object.defineProperty(settingsContent, 'scrollHeight', { configurable: true, value: 840 });
      Object.defineProperty(settingsContent, 'scrollTo', { configurable: true, value: scrollTo });

      fixture.componentInstance.requestDeleteAccount();
      fixture.detectChanges();
      vi.runOnlyPendingTimers();

      expect(scrollTo).toHaveBeenCalledWith({ top: 840, behavior: 'smooth' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens upload mode from avatar editor header action and back returns to general settings', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.openAvatarEditor();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const premiumTab = Array.from(fixture.nativeElement.querySelectorAll('.avatar-tier-tabs button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Premium')) as HTMLButtonElement;
    premiumTab.click();
    fixture.detectChanges();

    let uploadButton = fixture.nativeElement.querySelector('.modal-header-action') as HTMLButtonElement;
    uploadButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.avatarUploadOpen()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Maximum 2MB');
    uploadButton = fixture.nativeElement.querySelector('.modal-header-action') as HTMLButtonElement;
    expect(uploadButton.textContent).toContain('Predefined avatars');

    uploadButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.avatarUploadOpen()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Choose avatar');

    uploadButton = fixture.nativeElement.querySelector('.modal-header-action') as HTMLButtonElement;
    uploadButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const backButton = fixture.nativeElement.querySelector('.modal-back-button') as HTMLButtonElement;
    backButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.avatarEditorOpen()).toBe(false);
    expect(fixture.componentInstance.avatarUploadOpen()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('General');
  });
});
