import { TestBed } from '@angular/core/testing';
import { importProvidersFrom, signal } from '@angular/core';
import { of } from 'rxjs';
import { ArrowLeft, Check, LucideAngularModule, Trash2, Upload, X } from 'lucide-angular';
import { AuthApi } from '../../../../../../../core/api/auth.api';
import { AuthStore } from '../../../../../../../core/auth/auth.store';
import { LanguagePreferencesService } from '../../../../../../../core/localization/language-preferences.service';
import { AppThemeService } from '../../../../../../../core/theme/app-theme.service';
import { DashboardSettingsModalComponent } from './dashboard-settings-modal.component';

describe('DashboardSettingsModalComponent', () => {
  const authApiMock = {
    checkEmailAvailability: vi.fn(() => of({ available: true })),
    checkDisplayNameAvailability: vi.fn(() => of({ available: true })),
    updateMe: vi.fn(() => of({ user: { id: 'user-1', email: 'player@example.test', displayName: 'Player', roles: ['ROLE_USER'] } })),
    updateAvatar: vi.fn(() => of({ user: { id: 'user-1', email: 'player@example.test', displayName: 'Player', roles: ['ROLE_USER'] } })),
    updateDisplayNameStyle: vi.fn(() => of({ user: { id: 'user-1', email: 'player@example.test', displayName: 'Player', roles: ['ROLE_USER'], displayNameStyle: { type: 'preset', presetId: 'obsidian-crown', textColor: '#ffeeaa' } } })),
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
      preferences: { cardLanguage: 'en', appLanguage: 'en' },
    }),
    loadMe: vi.fn(async () => undefined),
  };
  const languagePreferencesMock = {
    cardLanguage: signal<'en' | 'fr' | 'de' | 'it' | 'es' | 'ja' | 'zhs' | 'pt' | 'ru' | 'ko' | 'zht' | 'nl' | 'ca'>('en').asReadonly(),
    appLanguage: signal<'en' | 'fr' | 'de' | 'it' | 'es' | 'ja' | 'zhs' | 'pt' | 'ru' | 'ko' | 'zht' | 'nl' | 'ca'>('en').asReadonly(),
  };

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [DashboardSettingsModalComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ ArrowLeft, Check, Trash2, Upload, X })),
        { provide: AuthApi, useValue: authApiMock },
        { provide: AuthStore, useValue: authStoreMock },
        { provide: LanguagePreferencesService, useValue: languagePreferencesMock },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders general tab and game tab content when toggling tabs', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('General');
    expect(fixture.nativeElement.textContent).toContain('Game');

    const gameTab = Array.from(fixture.nativeElement.querySelectorAll('.settings-tabs button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Game')) as HTMLButtonElement;
    gameTab.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Card language');
    expect(fixture.nativeElement.textContent).toContain('App language');
    expect(fixture.nativeElement.textContent).toContain('Visual theme');
  });

  it('renders theme presets with sunrise selected by default', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.switchTab('game');
    fixture.detectChanges();

    const selectedTheme = fixture.nativeElement.querySelector('.theme-option.selected') as HTMLButtonElement;

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

  it('changes visual theme locally without calling the profile API', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.switchTab('game');
    fixture.detectChanges();

    const mysticButton = Array.from(fixture.nativeElement.querySelectorAll('.theme-option') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Mystic Grove')) as HTMLButtonElement;
    mysticButton.click();
    fixture.detectChanges();

    expect(TestBed.inject(AppThemeService).themeId()).toBe('mystic-grove');
    expect(localStorage.getItem('commanderzone.theme')).toBe('mystic-grove');
    expect(document.documentElement.dataset['theme']).toBe('mystic-grove');
    expect(authApiMock.updateMe).not.toHaveBeenCalled();
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
  });

  it('persists game language preferences through /me', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    const reloadSpy = vi.spyOn(fixture.componentInstance as unknown as { reloadPage(): void }, 'reloadPage')
      .mockImplementation(() => undefined);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

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

  it('shows persisted language selections in game tab selectors', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.profileBaseline.set({
      email: 'player@example.test',
      displayName: 'Player',
      cardLanguage: 'fr',
      appLanguage: 'de',
    });
    fixture.componentInstance.selectedCardLanguage.set('fr');
    fixture.componentInstance.selectedAppLanguage.set('de');
    fixture.componentInstance.switchTab('game');
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

    const cancelButton = fixture.nativeElement.querySelector('.keep-account-button') as HTMLButtonElement;
    expect(cancelButton.textContent).toContain('Cancel');
    expect(cancelButton.classList.contains('secondary-button')).toBe(true);

    cancelButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.deleteConfirmationOpen()).toBe(false);
    expect(authApiMock.deleteMe).not.toHaveBeenCalled();
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
