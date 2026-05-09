import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { catchError, debounceTime, distinctUntilChanged, firstValueFrom, map, of, startWith, switchMap, tap } from 'rxjs';
import { AuthApi, AvatarUpdatePayload } from '../../../../../../../core/api/auth.api';
import { API_BASE_URL } from '../../../../../../../core/api/api.config';
import { AuthStore } from '../../../../../../../core/auth/auth.store';
import { UserAvatar } from '../../../../../../../core/models/user.model';
import { AppModalComponent } from '../../../../../../../shared/ui/app-modal/app-modal.component';
import { SettingsAvatarEditorComponent } from '../../../../../settings/settings-avatar-editor/settings-avatar-editor.component';
import { SettingsAvatarUploadComponent } from '../../../../../settings/settings-avatar-upload/settings-avatar-upload.component';

type SettingsTab = 'general' | 'game';
type FieldAvailability = 'idle' | 'checking' | 'available' | 'taken' | 'error';

interface ProfileSnapshot {
  readonly email: string;
  readonly displayName: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USER_NAME_MIN_LENGTH = 4;
const USER_NAME_MAX_LENGTH = 25;
const DEFAULT_INITIAL_BACKGROUND_COLOR = '#edcd83';
const DEFAULT_INITIAL_TEXT_COLOR = '#16120a';

@Component({
  selector: 'app-dashboard-settings-modal',
  imports: [AppModalComponent, ReactiveFormsModule, LucideAngularModule, SettingsAvatarEditorComponent, SettingsAvatarUploadComponent],
  templateUrl: './dashboard-settings-modal.component.html',
  styleUrl: './dashboard-settings-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardSettingsModalComponent {
  private readonly authStore = inject(AuthStore);
  private readonly authApi = inject(AuthApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private wasOpen = false;

  readonly open = input(false);
  readonly closeRequested = output<void>();
  readonly accountDeleted = output<void>();

  readonly activeTab = signal<SettingsTab>('general');
  readonly emailAvailability = signal<FieldAvailability>('idle');
  readonly userNameAvailability = signal<FieldAvailability>('idle');
  readonly saveInProgress = signal(false);
  readonly deleteInProgress = signal(false);
  readonly avatarSaveInProgress = signal(false);
  readonly statusMessage = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly deleteConfirmationOpen = signal(false);
  readonly avatarEditorOpen = signal(false);
  readonly avatarUploadOpen = signal(false);
  readonly profileBaseline = signal<ProfileSnapshot>({ email: '', displayName: '' });

  readonly profileForm = this.formBuilder.group({
    email: ['', [Validators.required, Validators.pattern(EMAIL_PATTERN)]],
    displayName: ['', [Validators.required, Validators.minLength(USER_NAME_MIN_LENGTH), Validators.maxLength(USER_NAME_MAX_LENGTH)]],
  });
  readonly profileFormValue = signal(this.profileForm.getRawValue());
  readonly profileFormValid = signal(this.profileForm.valid);

  readonly hasChanges = computed(() => {
    const baseline = this.profileBaseline();
    const formValue = this.profileFormValue();
    const email = formValue.email.trim().toLowerCase();
    const displayName = formValue.displayName.trim();
    return email !== baseline.email.toLowerCase() || displayName !== baseline.displayName;
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
  readonly currentUserAvatar = computed<UserAvatar | undefined>(() => this.authStore.user()?.avatar);
  readonly avatarInitial = computed(() => {
    return this.currentUserAvatar()?.initial?.letter
      ?? (this.currentUserDisplayName().trim().slice(0, 1).toUpperCase() || 'P');
  });
  readonly avatarInitialBackgroundColor = computed(() => this.currentUserAvatar()?.initial?.backgroundColor ?? DEFAULT_INITIAL_BACKGROUND_COLOR);
  readonly avatarInitialTextColor = computed(() => this.currentUserAvatar()?.initial?.textColor ?? DEFAULT_INITIAL_TEXT_COLOR);
  readonly avatarImageUrl = computed(() => resolveAvatarImageUrl(this.currentUserAvatar()?.imageUrl ?? null));

  constructor() {
    this.trackFormState();
    this.trackEmailAvailability();
    this.trackUserNameAvailability();
    effect(() => {
      const isOpen = this.open();
      if (isOpen && !this.wasOpen) {
        this.initializeForm();
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

  cancel(): void {
    if (this.avatarEditorOpen()) {
      this.closeAvatarEditor();
      return;
    }

    this.closeRequested.emit();
  }

  openAvatarEditor(): void {
    this.statusMessage.set(null);
    this.errorMessage.set(null);
    this.avatarUploadOpen.set(false);
    this.avatarEditorOpen.set(true);
  }

  closeAvatarEditor(): void {
    this.avatarEditorOpen.set(false);
    this.avatarUploadOpen.set(false);
    this.avatarSaveInProgress.set(false);
  }

  openAvatarUpload(): void {
    this.statusMessage.set(null);
    this.errorMessage.set(null);
    this.avatarUploadOpen.set(true);
  }

  toggleAvatarUploadMode(): void {
    this.statusMessage.set(null);
    this.errorMessage.set(null);
    this.avatarUploadOpen.update((isOpen) => !isOpen);
  }

  async savePreferences(): Promise<void> {
    if (!this.canSave()) {
      this.profileForm.markAllAsTouched();
      return;
    }

    const payload: { email?: string; displayName?: string } = {};
    const nextEmail = this.profileForm.controls.email.value.trim();
    const nextDisplayName = this.profileForm.controls.displayName.value.trim();

    if (this.emailChanged()) {
      payload.email = nextEmail;
    }
    if (this.displayNameChanged()) {
      payload.displayName = nextDisplayName;
    }

    this.saveInProgress.set(true);
    this.errorMessage.set(null);
    this.statusMessage.set(null);

    try {
      await firstValueFrom(this.authApi.updateMe(payload));
      await this.authStore.loadMe();
      this.profileBaseline.set({ email: nextEmail, displayName: nextDisplayName });
      this.profileForm.markAsPristine();
      this.emailAvailability.set('idle');
      this.userNameAvailability.set('idle');
      this.statusMessage.set('Preferences saved.');
    } catch {
      this.errorMessage.set('No se pudieron guardar los cambios.');
    } finally {
      this.saveInProgress.set(false);
    }
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
    const baseline = {
      email: user?.email ?? '',
      displayName: user?.displayName ?? '',
    } satisfies ProfileSnapshot;

    this.profileBaseline.set(baseline);
    this.profileForm.setValue(baseline);
    this.profileForm.markAsPristine();
    this.profileForm.markAsUntouched();
    this.profileFormValue.set(this.profileForm.getRawValue());
    this.profileFormValid.set(this.profileForm.valid);
    this.activeTab.set('general');
    this.resetLocalState();
  }

  private resetLocalState(): void {
    this.emailAvailability.set('idle');
    this.userNameAvailability.set('idle');
    this.statusMessage.set(null);
    this.errorMessage.set(null);
    this.saveInProgress.set(false);
    this.deleteInProgress.set(false);
    this.avatarSaveInProgress.set(false);
    this.avatarEditorOpen.set(false);
    this.avatarUploadOpen.set(false);
    this.deleteConfirmationOpen.set(false);
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
        debounceTime(450),
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
}

function resolveAvatarImageUrl(imageUrl: string | null): string | null {
  if (!imageUrl) {
    return null;
  }

  return imageUrl.startsWith('/') ? `${API_BASE_URL}${imageUrl}` : imageUrl;
}
