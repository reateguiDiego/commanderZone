import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { AvatarUpdatePayload } from '../../../../core/api/auth.api';
import { appImageUrl } from '../../../../core/assets/app-image-url';
import { AppShellI18nService } from '../../../../core/localization/app-shell-i18n.service';
import { UserAvatar } from '../../../../core/models/user.model';
import { SettingsInitialAvatarOptionComponent } from './components/settings-initial-avatar-option/settings-initial-avatar-option.component';
import { PRESET_AVATARS, type PresetAvatar } from './preset-avatars';
import { CzButtonDirective } from '../../../../shared/ui/button/button.directive';
import { TabListComponent, type TabListItem } from '../../../../shared/ui/tab-list/tab-list.component';
import { PremiumBadgeComponent } from '../../../../shared/ui/premium-badge/premium-badge.component';
import { TooltipComponent } from '../../../../shared/ui/tooltip/tooltip.component';

type PendingAvatarType = 'current' | 'initial' | 'preset';
type AvatarTierTab = 'basic' | 'premium';

const DEFAULT_INITIAL_BACKGROUND_COLOR = '#edcd83';
const DEFAULT_INITIAL_TEXT_COLOR = '#16120a';
const INITIAL_LETTER_MAX_LENGTH = 2;

@Component({
  selector: 'app-settings-avatar-editor',
  imports: [RuntimeTranslatePipe, SettingsInitialAvatarOptionComponent, CzButtonDirective, TabListComponent, PremiumBadgeComponent, TooltipComponent],
  templateUrl: './settings-avatar-editor.component.html',
  styleUrl: './settings-avatar-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsAvatarEditorComponent {
  private readonly i18n = inject(AppShellI18nService);

  readonly displayName = input('');
  readonly avatar = input<UserAvatar | undefined>(undefined);
  readonly saving = input(false);

  readonly backRequested = output<void>();
  readonly saveRequested = output<AvatarUpdatePayload>();
  readonly tierChanged = output<AvatarTierTab>();

  readonly presetAvatars = PRESET_AVATARS;
  readonly basicPresetAvatars = PRESET_AVATARS.filter((avatar) => avatar.tier === 'basic');
  readonly premiumPresetAvatars = PRESET_AVATARS.filter((avatar) => avatar.tier === 'premium');
  readonly activeTier = signal<AvatarTierTab>('basic');
  readonly tierTabItems: readonly TabListItem[] = [
    {
      id: 'basic',
      label: 'settings.settingsAvatarEditor.basic',
    },
    {
      id: 'premium',
      label: 'settings.settingsAvatarEditor.premium',
    },
  ];
  readonly pendingType = signal<PendingAvatarType>('current');
  readonly selectedPresetUrl = signal<string | null>(null);
  readonly initialLetter = signal('');
  readonly initialBackgroundColor = signal(DEFAULT_INITIAL_BACKGROUND_COLOR);
  readonly initialTextColor = signal(DEFAULT_INITIAL_TEXT_COLOR);
  readonly initialControlsOpen = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly saveDisclaimer = computed(() => this.i18n.text('settingsSaveDisclaimer'));

  readonly initial = computed(() => this.displayName().trim().slice(0, 1).toUpperCase() || 'P');
  readonly selectedPresetImageUrl = computed(() => {
    if (this.pendingType() === 'preset') {
      return appImageUrl(this.selectedPresetUrl());
    }

    const avatar = this.avatar();
    return this.pendingType() === 'current' && avatar?.type === 'preset' ? avatar.imageUrl : null;
  });
  readonly initialSelected = computed(() => {
    return this.pendingType() === 'initial' || (this.pendingType() === 'current' && this.avatar()?.type === 'initial');
  });
  readonly previewImageUrl = computed(() => {
    if (this.pendingType() === 'preset') {
      return this.selectedPresetUrl();
    }

    if (this.pendingType() === 'initial') {
      return null;
    }

    return appImageUrl(this.avatar()?.imageUrl ?? null);
  });
  readonly previewIsPremium = computed(() => {
    const imageUrl = this.pendingType() === 'preset'
      ? this.selectedPresetUrl()
      : this.avatar()?.imageUrl ?? null;

    return PRESET_AVATARS.some((avatar) => avatar.imageUrl === imageUrl && avatar.tier === 'premium');
  });
  readonly previewInitialLetter = computed(() => {
    if (this.pendingType() === 'initial') {
      return this.initialLetter().trim().toUpperCase() || this.initial();
    }

    const avatar = this.avatar();
    if (this.pendingType() === 'current' && avatar?.type === 'initial') {
      return normalizeInitialLetter(avatar.initial?.letter ?? '', this.initial());
    }

    return this.initial();
  });
  readonly previewInitialBackgroundColor = computed(() => {
    if (this.pendingType() === 'initial') {
      return normalizeHexColor(this.initialBackgroundColor(), DEFAULT_INITIAL_BACKGROUND_COLOR);
    }

    const avatar = this.avatar();
    if (this.pendingType() === 'current' && avatar?.type === 'initial') {
      return normalizeHexColor(avatar.initial?.backgroundColor ?? '', DEFAULT_INITIAL_BACKGROUND_COLOR);
    }

    return DEFAULT_INITIAL_BACKGROUND_COLOR;
  });
  readonly previewInitialTextColor = computed(() => {
    if (this.pendingType() === 'initial') {
      return normalizeHexColor(this.initialTextColor(), DEFAULT_INITIAL_TEXT_COLOR);
    }

    const avatar = this.avatar();
    if (this.pendingType() === 'current' && avatar?.type === 'initial') {
      return normalizeHexColor(avatar.initial?.textColor ?? '', DEFAULT_INITIAL_TEXT_COLOR);
    }

    return DEFAULT_INITIAL_TEXT_COLOR;
  });
  readonly currentSelectionLabel = computed(() => {
    return this.displayName().trim() || 'Player';
  });

  readonly canSave = computed(() => {
    if (this.saving()) {
      return false;
    }

    return this.pendingType() === 'initial' || this.pendingType() === 'preset';
  });

  chooseInitial(): void {
    this.errorMessage.set(null);
    this.pendingType.set('initial');
    this.selectedPresetUrl.set(null);
    if (!this.initialControlsOpen()) {
      this.initialLetter.set(normalizeInitialLetter(this.avatar()?.initial?.letter ?? this.previewInitialLetter(), this.initial()));
      this.initialBackgroundColor.set(normalizeHexColor(this.avatar()?.initial?.backgroundColor ?? this.previewInitialBackgroundColor(), DEFAULT_INITIAL_BACKGROUND_COLOR));
      this.initialTextColor.set(normalizeHexColor(this.avatar()?.initial?.textColor ?? this.previewInitialTextColor(), DEFAULT_INITIAL_TEXT_COLOR));
    }
    this.initialControlsOpen.set(true);
  }

  choosePreset(avatar: PresetAvatar): void {
    this.errorMessage.set(null);
    this.pendingType.set('preset');
    this.selectedPresetUrl.set(avatar.imageUrl);
    this.initialControlsOpen.set(false);
  }

  switchTier(tier: AvatarTierTab): void {
    this.activeTier.set(tier);
    this.tierChanged.emit(tier);
  }

  switchTierFromList(tier: string): void {
    if (tier === 'basic' || tier === 'premium') {
      this.switchTier(tier);
    }
  }

  updateInitialLetter(value: string): void {
    this.errorMessage.set(null);
    this.pendingType.set('initial');
    this.selectedPresetUrl.set(null);
    this.initialControlsOpen.set(true);
    this.initialLetter.set(value.trim().slice(0, INITIAL_LETTER_MAX_LENGTH).toUpperCase());
  }

  updateInitialBackgroundColor(value: string): void {
    this.errorMessage.set(null);
    this.pendingType.set('initial');
    this.selectedPresetUrl.set(null);
    this.initialControlsOpen.set(true);
    this.initialBackgroundColor.set(normalizeHexColor(value, DEFAULT_INITIAL_BACKGROUND_COLOR));
  }

  updateInitialTextColor(value: string): void {
    this.errorMessage.set(null);
    this.pendingType.set('initial');
    this.selectedPresetUrl.set(null);
    this.initialControlsOpen.set(true);
    this.initialTextColor.set(normalizeHexColor(value, DEFAULT_INITIAL_TEXT_COLOR));
  }

  closeInitialControls(): void {
    this.initialControlsOpen.set(false);
  }

  keepInitialControlsOpen(event: MouseEvent): void {
    event.stopPropagation();
  }

  preventAvatarDrag(event: DragEvent): void {
    event.preventDefault();
  }

  async save(): Promise<void> {
    this.errorMessage.set(null);

    if (this.pendingType() === 'initial') {
      this.saveRequested.emit({
        type: 'initial',
        letter: this.previewInitialLetter(),
        backgroundColor: this.previewInitialBackgroundColor(),
        textColor: this.previewInitialTextColor(),
      });
      return;
    }

    if (this.pendingType() === 'preset') {
      const imageUrl = this.selectedPresetUrl();
      if (!imageUrl) {
        return;
      }

      this.saveRequested.emit({ type: 'preset', imageUrl });
    }
  }
}

function normalizeInitialLetter(value: string, fallback: string): string {
  const normalized = value.trim().slice(0, INITIAL_LETTER_MAX_LENGTH).toUpperCase();
  return normalized || fallback;
}

function normalizeHexColor(value: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}
