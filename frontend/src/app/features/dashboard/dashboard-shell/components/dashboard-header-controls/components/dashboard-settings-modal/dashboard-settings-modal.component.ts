import { RuntimeTranslatePipe } from '../../../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewChild, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { catchError, debounceTime, distinctUntilChanged, firstValueFrom, map, of, startWith, switchMap, tap } from 'rxjs';
import { AuthApi, AvatarUpdatePayload, DisplayNameStyleUpdatePayload } from '../../../../../../../core/api/auth.api';
import { CardLanguageCoverage, CardsLanguageService } from '../../../../../../../core/api/cards-language.service';
import { AuthStore } from '../../../../../../../core/auth/auth.store';
import { AppShellI18nService } from '../../../../../../../core/localization/app-shell-i18n.service';
import { AppThemeId } from '../../../../../../../core/theme/app-theme';
import {
  CARD_LANGUAGE_OPTIONS,
  isSupportedCardLanguageCode,
  isSupportedLanguageCode,
  normalizeCardLanguageCode,
  normalizeLanguageCode,
  SupportedCardLanguageCode,
  SupportedLanguageCode,
} from '../../../../../../../core/localization/language-preferences';
import { LanguagePreferencesService } from '../../../../../../../core/localization/language-preferences.service';
import { HYBRID_LANGUAGE_OPTIONS, RuntimeLanguageSelectorService } from '../../../../../../../core/localization/runtime-language-selector.service';
import { UserAvatar, UserDisplayNameStyle, UserGamePreferences } from '../../../../../../../core/models/user.model';
import { AppModalComponent } from '../../../../../../../shared/ui/app-modal/app-modal.component';
import { type FormatSelectOption } from '../../../../../../../shared/components/format-select/format-select.component';
import { PlayerInfoComponent } from '../../../../../../../shared/ui/player-info/player-info.component';
import { TabListComponent, type TabListItem } from '../../../../../../../shared/ui/tab-list/tab-list.component';
import { ToggleComponent } from '../../../../../../../shared/ui/toggle/toggle.component';
import { SettingsDisplayNameStyleEditorComponent } from '../../../../../settings/settings-display-name-style-editor/settings-display-name-style-editor.component';
import { SettingsAvatarEditorComponent } from '../../../../../settings/settings-avatar-editor/settings-avatar-editor.component';
import { SettingsAvatarUploadComponent } from '../../../../../settings/settings-avatar-upload/settings-avatar-upload.component';
import { SettingsLanguagePreferencesComponent } from '../../../../../settings/settings-language-preferences/settings-language-preferences.component';
import { ThemeSettingsPanelComponent } from '../../../../../settings/theme-settings-panel/theme-settings-panel.component';
import { CzButtonDirective } from '../../../../../../../shared/ui/button/button.directive';

type SettingsTab = 'general' | 'game';
type FieldAvailability = 'idle' | 'checking' | 'available' | 'taken' | 'error';
type AvatarTierTab = 'basic' | 'premium';
type PasswordResetRequestState = 'idle' | 'sending' | 'sent' | 'error';
type GameSettingsToggleId = 'showManaHelperOnStartup' | 'enableManaRow' | 'enableStackMana' | 'gameAnimations' | 'chatNotificationSounds';
export type SettingsLaunchTarget = 'general' | 'avatar' | 'name-style';

interface ProfileSnapshot {
  readonly email: string;
  readonly displayName: string;
  readonly cardLanguage: SupportedCardLanguageCode;
  readonly appLanguage: SupportedLanguageCode;
  readonly gamePreferences: UserGamePreferences;
}

interface GameSettingsToggleOption {
  readonly id: GameSettingsToggleId;
  readonly labelKey: string;
  readonly descriptionKey: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USER_NAME_MIN_LENGTH = 2;
const USER_NAME_MAX_LENGTH = 20;
const DISPLAY_NAME_AVAILABILITY_DEBOUNCE_MS = 900;
const CARD_LANGUAGE_FLAGS = new Map<string, string | undefined>(
  CARD_LANGUAGE_OPTIONS.map((language) => [language.code, language.flagAsset]),
);
const GAME_SETTINGS_TOGGLE_DEFAULTS: UserGamePreferences = {
  showManaHelperOnStartup: false,
  enableManaRow: true,
  enableStackMana: false,
  gameAnimations: true,
  chatNotificationSounds: true,
};
const GAME_SETTINGS_TOGGLE_OPTIONS: readonly GameSettingsToggleOption[] = [
  {
    id: 'showManaHelperOnStartup',
    labelKey: 'settings.dashboardSettingsModal.gameSettings.showManaHelperOnStartup.label',
    descriptionKey: 'settings.dashboardSettingsModal.gameSettings.showManaHelperOnStartup.description',
  },
  {
    id: 'enableManaRow',
    labelKey: 'settings.dashboardSettingsModal.gameSettings.enableManaRow.label',
    descriptionKey: 'settings.dashboardSettingsModal.gameSettings.enableManaRow.description',
  },
  {
    id: 'enableStackMana',
    labelKey: 'settings.dashboardSettingsModal.gameSettings.enableStackMana.label',
    descriptionKey: 'settings.dashboardSettingsModal.gameSettings.enableStackMana.description',
  },
  {
    id: 'gameAnimations',
    labelKey: 'settings.dashboardSettingsModal.gameSettings.gameAnimations.label',
    descriptionKey: 'settings.dashboardSettingsModal.gameSettings.gameAnimations.description',
  },
  {
    id: 'chatNotificationSounds',
    labelKey: 'settings.dashboardSettingsModal.gameSettings.chatNotificationSounds.label',
    descriptionKey: 'settings.dashboardSettingsModal.gameSettings.chatNotificationSounds.description',
  },
];

@Component({
  selector: 'app-dashboard-settings-modal',
  imports: [
    RuntimeTranslatePipe,
    AppModalComponent,
    ReactiveFormsModule,
    LucideAngularModule,
    PlayerInfoComponent,
    TabListComponent,
    ToggleComponent,
    SettingsAvatarEditorComponent,
    SettingsAvatarUploadComponent,
    SettingsDisplayNameStyleEditorComponent,
    SettingsLanguagePreferencesComponent,
    ThemeSettingsPanelComponent,
    CzButtonDirective,
  ],
  templateUrl: './dashboard-settings-modal.component.html',
  styleUrl: './dashboard-settings-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardSettingsModalComponent {
  @ViewChild('settingsContent') private settingsContent?: ElementRef<HTMLElement>;
  @ViewChild(ThemeSettingsPanelComponent) private themeSettingsPanel?: ThemeSettingsPanelComponent;

  private readonly authStore = inject(AuthStore);
  private readonly authApi = inject(AuthApi);
  private readonly cardsLanguage = inject(CardsLanguageService);
  private readonly languagePreferences = inject(LanguagePreferencesService);
  private readonly runtimeLanguageSelector = inject(RuntimeLanguageSelectorService);
  private readonly i18n = inject(AppShellI18nService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private wasOpen = false;

  readonly open = input(false);
  readonly launchTarget = input<SettingsLaunchTarget>('general');
  readonly closeRequested = output<void>();
  readonly accountDeleted = output<void>();

  readonly activeTab = signal<SettingsTab>('general');
  readonly emailAvailability = signal<FieldAvailability>('idle');
  readonly userNameAvailability = signal<FieldAvailability>('idle');
  readonly saveInProgress = signal(false);
  readonly deleteInProgress = signal(false);
  readonly passwordResetRequestState = signal<PasswordResetRequestState>('idle');
  readonly avatarSaveInProgress = signal(false);
  readonly displayNameStyleSaveInProgress = signal(false);
  readonly statusMessage = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly deleteConfirmationOpen = signal(false);
  readonly avatarEditorOpen = signal(false);
  readonly avatarUploadOpen = signal(false);
  readonly avatarEditorTier = signal<AvatarTierTab>('basic');
  readonly displayNameStyleEditorOpen = signal(false);
  readonly themeEditorOpen = signal(false);
  readonly profileBaseline = signal<ProfileSnapshot>({
    email: '',
    displayName: '',
    cardLanguage: 'en',
    appLanguage: 'en',
    gamePreferences: { ...GAME_SETTINGS_TOGGLE_DEFAULTS },
  });
  readonly appLanguageOptions = HYBRID_LANGUAGE_OPTIONS;
  readonly cardLanguageSelectOptions = computed<readonly FormatSelectOption[]>(() =>
    this.cardLanguageCoverage().map((language) => ({
      id: language.code,
      name: this.i18n.languageName(language.code),
      flagAsset: CARD_LANGUAGE_FLAGS.get(language.code),
    })),
  );
  readonly appLanguageSelectOptions = computed<readonly FormatSelectOption[]>(() =>
    [...this.appLanguageOptions]
      .sort((left, right) => left.label.localeCompare(right.label, this.selectedAppLanguage(), { sensitivity: 'base' }))
      .map((language) => ({ id: language.code, name: language.label, flagAsset: language.flagAsset })),
  );
  readonly settingsTitle = computed(() => this.i18n.text('settingsTitle'));
  readonly cancelLabel = computed(() => this.i18n.text('cancel'));
  readonly saveLabel = computed(() => this.i18n.text('save'));
  readonly saveDisclaimer = computed(() => this.i18n.text('settingsSaveDisclaimer'));
  readonly backToSettingsLabel = computed(() => this.i18n.text('backToSettings'));
  readonly predefinedAvatarsLabel = computed(() => this.i18n.text('predefinedAvatars'));
  readonly uploadImageLabel = computed(() => this.i18n.text('uploadImage'));
  readonly settingsSectionsLabel = computed(() => this.i18n.text('settingsSections'));
  readonly generalTabLabel = computed(() => this.i18n.text('generalTab'));
  readonly gameTabLabel = computed(() => this.i18n.text('gameTab'));
  readonly settingsTabItems = computed<readonly TabListItem[]>(() => [
    { id: 'general', label: this.generalTabLabel() },
    { id: 'game', label: this.gameTabLabel() },
  ]);
  readonly selectedCardLanguage = signal<SupportedCardLanguageCode>('en');
  readonly selectedAppLanguage = signal<SupportedLanguageCode>('en');
  readonly cardLanguageCoverage = signal<readonly CardLanguageCoverage[]>([]);
  readonly gameSettingsToggleOptions = GAME_SETTINGS_TOGGLE_OPTIONS;
  readonly gameSettingsToggleState = signal<UserGamePreferences>({ ...GAME_SETTINGS_TOGGLE_DEFAULTS });

  readonly profileForm = this.formBuilder.group({
    email: ['', [Validators.required, Validators.pattern(EMAIL_PATTERN)]],
    displayName: ['', [Validators.required, Validators.minLength(USER_NAME_MIN_LENGTH), Validators.maxLength(USER_NAME_MAX_LENGTH)]],
  });
  readonly profileFormValue = signal(this.profileForm.getRawValue());
  readonly profileFormValid = signal(this.profileForm.valid);
  readonly userNameMaxLength = USER_NAME_MAX_LENGTH;
  readonly userNameCharacterCount = computed(() => this.profileFormValue().displayName.length);
  readonly passwordResetRequestInProgress = computed(() => this.passwordResetRequestState() === 'sending');
  readonly canRequestPasswordChange = computed(() =>
    this.profileBaseline().email.trim() !== ''
    && this.passwordResetRequestState() !== 'sent'
    && !this.passwordResetRequestInProgress()
    && !this.saveInProgress()
    && !this.deleteInProgress(),
  );

  readonly hasChanges = computed(() => {
    const baseline = this.profileBaseline();
    const formValue = this.profileFormValue();
    const email = formValue.email.trim().toLowerCase();
    const displayName = formValue.displayName.trim();
    return email !== baseline.email.toLowerCase()
      || displayName !== baseline.displayName
      || this.selectedCardLanguage() !== baseline.cardLanguage
      || this.selectedAppLanguage() !== baseline.appLanguage
      || this.gameSettingsChanged();
  });

  readonly canSave = computed(() => {
    if (!this.hasChanges() || !this.profileFormValid() || this.saveInProgress() || this.deleteInProgress()) {
      return false;
    }

    const emailChanged = this.emailChanged();
    const userNameChanged = this.displayNameChanged();
    const emailAvailability = this.emailAvailability();
    const userNameAvailability = this.userNameAvailability();

    const emailOk = !emailChanged || (emailAvailability !== 'taken' && emailAvailability !== 'checking');
    const userNameOk = !userNameChanged || (userNameAvailability !== 'taken' && userNameAvailability !== 'checking');

    return emailOk && userNameOk;
  });

  readonly currentUserDisplayName = computed(() => this.authStore.user()?.displayName ?? 'Player');
  readonly currentUserDisplayNameStyle = computed<UserDisplayNameStyle | undefined>(() => this.authStore.user()?.displayNameStyle);
  readonly currentUserAvatar = computed<UserAvatar | undefined>(() => this.authStore.user()?.avatar);
  readonly nestedEditorOpen = computed(() => this.avatarEditorOpen() || this.displayNameStyleEditorOpen() || this.themeEditorOpen());

  constructor() {
    this.trackFormState();
    this.trackEmailAvailability();
    this.trackUserNameAvailability();
    effect(() => {
      const isOpen = this.open();
      const launchTarget = this.launchTarget();
      if (isOpen && !this.wasOpen) {
        this.initializeForm();
        this.openLaunchTarget(launchTarget);
      } else if (isOpen && this.wasOpen && launchTarget !== 'general') {
        this.openLaunchTarget(launchTarget);
      }
      if (!isOpen && this.wasOpen) {
        this.resetLocalState();
      }
      this.wasOpen = isOpen;
    });
  }

  switchTab(tab: SettingsTab): void {
    this.activeTab.set(tab);
  }

  selectSettingsTab(tab: string): void {
    if (tab !== 'general' && tab !== 'game') {
      return;
    }

    this.switchTab(tab);
  }

  openThemeSettings(): void {
    this.statusMessage.set(null);
    this.errorMessage.set(null);
    this.avatarEditorOpen.set(false);
    this.avatarUploadOpen.set(false);
    this.displayNameStyleEditorOpen.set(false);
    this.themeEditorOpen.set(true);
  }

  cancel(): void {
    if (this.nestedEditorOpen()) {
      this.closeNestedEditor();
      return;
    }

    this.restoreBaselineAppLanguage();
    this.restoreBaselineGameSettings();
    this.closeRequested.emit();
  }

  openAvatarEditor(): void {
    this.statusMessage.set(null);
    this.errorMessage.set(null);
    this.avatarUploadOpen.set(false);
    this.avatarEditorTier.set('basic');
    this.avatarEditorOpen.set(true);
    this.displayNameStyleEditorOpen.set(false);
    this.closeThemeEditor();
  }

  closeAvatarEditor(): void {
    this.avatarEditorOpen.set(false);
    this.avatarUploadOpen.set(false);
    this.avatarEditorTier.set('basic');
    this.avatarSaveInProgress.set(false);
  }

  openDisplayNameStyleEditor(): void {
    this.statusMessage.set(null);
    this.errorMessage.set(null);
    this.avatarEditorOpen.set(false);
    this.avatarUploadOpen.set(false);
    this.displayNameStyleEditorOpen.set(true);
    this.closeThemeEditor();
  }

  private openLaunchTarget(target: SettingsLaunchTarget): void {
    if (target === 'avatar') {
      this.openAvatarEditor();
      return;
    }

    if (target === 'name-style') {
      this.openDisplayNameStyleEditor();
    }
  }

  closeNestedEditor(): void {
    this.closeAvatarEditor();
    this.displayNameStyleEditorOpen.set(false);
    this.displayNameStyleSaveInProgress.set(false);
    this.closeThemeEditor();
  }

  openAvatarUpload(): void {
    this.statusMessage.set(null);
    this.errorMessage.set(null);
    this.avatarUploadOpen.set(true);
  }

  toggleAvatarUploadMode(): void {
    if (!this.avatarUploadOpen() && this.avatarEditorTier() !== 'premium') {
      return;
    }

    this.statusMessage.set(null);
    this.errorMessage.set(null);
    this.avatarUploadOpen.update((isOpen) => !isOpen);
  }

  setAvatarEditorTier(tier: AvatarTierTab): void {
    this.avatarEditorTier.set(tier);
  }

  requestDeleteAccount(event?: MouseEvent): void {
    event?.stopPropagation();
    this.statusMessage.set(null);
    this.errorMessage.set(null);
    this.deleteConfirmationOpen.set(true);
    this.scrollSettingsContentToBottom();
  }

  closeDeleteConfirmationOnOutsideClick(event: MouseEvent): void {
    if (!this.deleteConfirmationOpen() || this.deleteInProgress()) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element) || target.closest('.delete-confirmation')) {
      return;
    }

    this.deleteConfirmationOpen.set(false);
  }

  cancelDeleteAccount(): void {
    if (this.deleteInProgress()) {
      return;
    }

    this.deleteConfirmationOpen.set(false);
  }

  async savePreferences(): Promise<void> {
    if (!this.canSave()) {
      this.profileForm.markAllAsTouched();
      return;
    }

    const payload: {
      email?: string;
      displayName?: string;
      cardLanguage?: SupportedCardLanguageCode;
      appLanguage?: SupportedLanguageCode;
      gamePreferences?: UserGamePreferences;
    } = {};
    const nextEmail = this.profileForm.controls.email.value.trim();
    const nextDisplayName = this.profileForm.controls.displayName.value.trim();
    const nextCardLanguage = this.selectedCardLanguage();
    const nextAppLanguage = this.selectedAppLanguage();

    if (this.emailChanged()) {
      payload.email = nextEmail;
    }
    if (this.displayNameChanged()) {
      payload.displayName = nextDisplayName;
    }
    if (nextCardLanguage !== this.profileBaseline().cardLanguage) {
      payload.cardLanguage = nextCardLanguage;
    }
    if (nextAppLanguage !== this.profileBaseline().appLanguage) {
      payload.appLanguage = nextAppLanguage;
    }
    if (this.gameSettingsChanged()) {
      payload.gamePreferences = this.gameSettingsToggleState();
    }

    this.saveInProgress.set(true);
    this.errorMessage.set(null);
    this.statusMessage.set(null);
    const shouldReloadForCardLanguage = payload.cardLanguage !== undefined;

    try {
      await firstValueFrom(this.authApi.updateMe(payload));
      await this.authStore.loadMe();
      this.profileBaseline.set({
        email: nextEmail,
        displayName: nextDisplayName,
        cardLanguage: nextCardLanguage,
        appLanguage: nextAppLanguage,
        gamePreferences: this.gameSettingsToggleState(),
      });
      this.profileForm.markAsPristine();
      this.emailAvailability.set('idle');
      this.userNameAvailability.set('idle');
      if (shouldReloadForCardLanguage) {
        this.reloadPage();
        return;
      }
      this.statusMessage.set('Preferences saved.');
    } catch {
      this.restoreBaselineAppLanguage();
      this.errorMessage.set('No se pudieron guardar los cambios.');
    } finally {
      this.saveInProgress.set(false);
    }
  }

  async requestPasswordChange(): Promise<void> {
    if (!this.canRequestPasswordChange()) {
      return;
    }

    this.passwordResetRequestState.set('sending');
    this.errorMessage.set(null);

    try {
      const response = await firstValueFrom(this.authApi.requestPasswordReset(this.profileBaseline().email.trim()));
      this.passwordResetRequestState.set(response.accepted ? 'sent' : 'error');
    } catch {
      this.passwordResetRequestState.set('error');
    }
  }

  requestPremiumUpgrade(): void {
    this.errorMessage.set(null);
    this.statusMessage.set(this.i18n.text('premiumComingSoon'));
  }

  syncThemePreference(themeId: AppThemeId): void {
    this.authStore.updateThemePreference(themeId);
  }

  async deleteAccount(): Promise<void> {
    this.deleteInProgress.set(true);
    this.errorMessage.set(null);

    try {
      await firstValueFrom(this.authApi.deleteMe());
      this.deleteConfirmationOpen.set(false);
      this.statusMessage.set(null);
      this.closeRequested.emit();
      this.accountDeleted.emit();
    } catch {
      this.errorMessage.set('No se pudo eliminar la cuenta ahora.');
    } finally {
      this.deleteInProgress.set(false);
    }
  }

  async saveAvatar(payload: AvatarUpdatePayload): Promise<void> {
    this.avatarSaveInProgress.set(true);
    this.errorMessage.set(null);
    this.statusMessage.set(null);

    try {
      await firstValueFrom(this.authApi.updateAvatar(payload));
      await this.authStore.loadMe();
      this.avatarEditorOpen.set(false);
      this.avatarUploadOpen.set(false);
      this.statusMessage.set('Avatar updated.');
    } catch {
      this.errorMessage.set('No se pudo guardar el avatar.');
    } finally {
      this.avatarSaveInProgress.set(false);
    }
  }

  async saveDisplayNameStyle(payload: DisplayNameStyleUpdatePayload): Promise<void> {
    this.displayNameStyleSaveInProgress.set(true);
    this.errorMessage.set(null);
    this.statusMessage.set(null);

    try {
      await firstValueFrom(this.authApi.updateDisplayNameStyle(payload));
      await this.authStore.loadMe();
      this.displayNameStyleEditorOpen.set(false);
      this.statusMessage.set('Name style updated.');
    } catch {
      this.errorMessage.set('No se pudo guardar el estilo del nombre.');
    } finally {
      this.displayNameStyleSaveInProgress.set(false);
    }
  }

  emailAvailabilityVisible(): boolean {
    if (!this.emailChanged()) {
      return false;
    }

    return this.emailAvailability() !== 'idle' && !this.emailInvalid();
  }

  userNameAvailabilityVisible(): boolean {
    if (!this.displayNameChanged()) {
      return false;
    }

    return this.userNameAvailability() !== 'idle' && !this.displayNameInvalid();
  }

  emailInvalid(): boolean {
    return this.controlInvalid(this.profileForm.controls.email);
  }

  displayNameInvalid(): boolean {
    return this.controlInvalid(this.profileForm.controls.displayName);
  }

  private initializeForm(): void {
    const user = this.authStore.user();
    const cardLanguage = normalizeCardLanguageCode(user?.preferences?.cardLanguage ?? this.languagePreferences.cardLanguage());
    const appLanguage = normalizeLanguageCode(user?.preferences?.appLanguage ?? this.languagePreferences.appLanguage());
    const baseline = {
      email: user?.email ?? '',
      displayName: user?.displayName ?? '',
      cardLanguage,
      appLanguage,
      gamePreferences: this.normalizeGamePreferences(user?.preferences?.game),
    } satisfies ProfileSnapshot;

    this.profileBaseline.set(baseline);
    this.selectedCardLanguage.set(cardLanguage);
    this.selectedAppLanguage.set(appLanguage);
    this.gameSettingsToggleState.set(baseline.gamePreferences);
    this.profileForm.setValue({ email: baseline.email, displayName: baseline.displayName });
    this.profileForm.markAsPristine();
    this.profileForm.markAsUntouched();
    this.profileFormValue.set(this.profileForm.getRawValue());
    this.profileFormValid.set(this.profileForm.valid);
    this.activeTab.set('general');
    this.resetLocalState();
    void this.loadCardLanguageCoverage();
  }

  setCardLanguage(language: string): void {
    if (!this.cardLanguageCoverage().some((coverage) => coverage.code === language)) {
      return;
    }

    this.selectedCardLanguage.set(normalizeCardLanguageCode(language));
  }

  setAppLanguage(language: string): void {
    if (!isSupportedLanguageCode(language)) {
      return;
    }

    this.selectedAppLanguage.set(language);
    this.runtimeLanguageSelector.applyLanguage(language);
  }

  setGameSettingsToggle(toggleId: GameSettingsToggleId, enabled: boolean): void {
    this.gameSettingsToggleState.update((current) => ({
      ...current,
      [toggleId]: enabled,
    }));
  }

  private gameSettingsChanged(): boolean {
    const baseline = this.profileBaseline().gamePreferences;
    const current = this.gameSettingsToggleState();

    return GAME_SETTINGS_TOGGLE_OPTIONS.some((option) => current[option.id] !== baseline[option.id]);
  }

  private normalizeGamePreferences(preferences: Partial<UserGamePreferences> | null | undefined): UserGamePreferences {
    return {
      ...GAME_SETTINGS_TOGGLE_DEFAULTS,
      ...preferences,
    };
  }

  private restoreBaselineAppLanguage(): void {
    const baselineAppLanguage = this.profileBaseline().appLanguage;

    if (this.selectedAppLanguage() === baselineAppLanguage) {
      return;
    }

    this.selectedAppLanguage.set(baselineAppLanguage);
    this.runtimeLanguageSelector.applyLanguage(baselineAppLanguage);
  }

  private restoreBaselineGameSettings(): void {
    this.gameSettingsToggleState.set(this.profileBaseline().gamePreferences);
  }

  private scrollSettingsContentToBottom(): void {
    window.setTimeout(() => {
      const settingsContent = this.settingsContent?.nativeElement;

      if (!settingsContent) {
        return;
      }

      if (typeof settingsContent.scrollTo === 'function') {
        settingsContent.scrollTo({
          top: settingsContent.scrollHeight,
          behavior: 'smooth',
        });
        return;
      }

      settingsContent.scrollTop = settingsContent.scrollHeight;
    });
  }

  private async loadCardLanguageCoverage(): Promise<void> {
    try {
      const response = await firstValueFrom(this.cardsLanguage.list());
      this.cardLanguageCoverage.set(response.data);
      this.selectedCardLanguage.set(this.resolveSelectableCardLanguage(response.selectedCardLanguage, response.data));
    } catch {
      this.cardLanguageCoverage.set([]);
    }
  }

  private resolveSelectableCardLanguage(
    requestedLanguage: SupportedCardLanguageCode,
    coverage: readonly CardLanguageCoverage[],
  ): SupportedCardLanguageCode {
    if (coverage.some((language) => language.code === requestedLanguage)) {
      return requestedLanguage;
    }

    if (coverage.some((language) => language.code === 'en')) {
      return 'en';
    }

    const firstSupportedLanguage = coverage
      .map((language) => language.code)
      .find((language): language is SupportedCardLanguageCode => isSupportedCardLanguageCode(language));

    return firstSupportedLanguage ?? 'en';
  }

  private resetLocalState(): void {
    this.closeThemeEditor();
    this.emailAvailability.set('idle');
    this.userNameAvailability.set('idle');
    this.statusMessage.set(null);
    this.errorMessage.set(null);
    this.saveInProgress.set(false);
    this.deleteInProgress.set(false);
    this.passwordResetRequestState.set('idle');
    this.avatarSaveInProgress.set(false);
    this.displayNameStyleSaveInProgress.set(false);
    this.avatarEditorOpen.set(false);
    this.avatarUploadOpen.set(false);
    this.avatarEditorTier.set('basic');
    this.displayNameStyleEditorOpen.set(false);
    this.deleteConfirmationOpen.set(false);
  }

  private closeThemeEditor(): void {
    if (this.themeEditorOpen()) {
      this.themeSettingsPanel?.revertPreview();
    }

    this.themeEditorOpen.set(false);
  }

  private emailChanged(): boolean {
    const baseline = this.profileBaseline();
    return this.profileFormValue().email.trim().toLowerCase() !== baseline.email.toLowerCase();
  }

  private displayNameChanged(): boolean {
    const baseline = this.profileBaseline();
    return this.profileFormValue().displayName.trim() !== baseline.displayName;
  }

  private controlInvalid(control: FormControl<string>): boolean {
    return control.invalid && (control.touched || control.dirty);
  }

  private trackEmailAvailability(): void {
    this.profileForm.controls.email.valueChanges
      .pipe(
        map((value) => value.trim()),
        distinctUntilChanged(),
        tap(() => this.emailAvailability.set('idle')),
        debounceTime(550),
        switchMap((email) => {
          if (!this.open() || !this.emailChanged()) {
            return of<FieldAvailability>('idle');
          }

          if (!EMAIL_PATTERN.test(email)) {
            return of<FieldAvailability>('idle');
          }

          this.emailAvailability.set('checking');
          return this.authApi.checkEmailAvailability(email).pipe(
            map((response) => (response.available ? 'available' : 'taken') satisfies FieldAvailability),
            catchError(() => of<FieldAvailability>('error')),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((availability) => this.emailAvailability.set(availability));
  }

  private trackFormState(): void {
    this.profileForm.valueChanges
      .pipe(
        startWith(this.profileForm.getRawValue()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.profileFormValue.set(this.profileForm.getRawValue()));

    this.profileForm.statusChanges
      .pipe(
        startWith(this.profileForm.status),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.profileFormValid.set(this.profileForm.valid));
  }

  private trackUserNameAvailability(): void {
    this.profileForm.controls.displayName.valueChanges
      .pipe(
        map((value) => value.trim()),
        distinctUntilChanged(),
        tap(() => this.userNameAvailability.set('idle')),
        debounceTime(DISPLAY_NAME_AVAILABILITY_DEBOUNCE_MS),
        switchMap((displayName) => {
          if (!this.open() || !this.displayNameChanged()) {
            return of<FieldAvailability>('idle');
          }

          if (displayName.length < USER_NAME_MIN_LENGTH) {
            return of<FieldAvailability>('idle');
          }

          this.userNameAvailability.set('checking');
          return this.authApi.checkDisplayNameAvailability(displayName).pipe(
            map((response) => (response.available ? 'available' : 'taken') satisfies FieldAvailability),
            catchError(() => of<FieldAvailability>('error')),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((availability) => this.userNameAvailability.set(availability));
  }

  private reloadPage(): void {
    window.location.reload();
  }
}
