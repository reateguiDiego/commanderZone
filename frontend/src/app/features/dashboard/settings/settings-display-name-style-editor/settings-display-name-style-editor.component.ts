import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { DisplayNameStyleUpdatePayload } from '../../../../core/api/auth.api';
import { AppShellI18nService } from '../../../../core/localization/app-shell-i18n.service';
import { UserDisplayNameStyle } from '../../../../core/models/user.model';
import { DEFAULT_PREMIUM_NAME_COLOR, DISPLAY_NAME_STYLE_PRESETS, DisplayNameStylePreset, displayNameStylePreset } from '../../../../core/profile/display-name-style-presets';
import { PlayerNameComponent } from '../../../../shared/ui/player-name/player-name.component';
import { CzButtonDirective } from '../../../../shared/ui/button/button.directive';
import { TabListComponent, type TabListItem } from '../../../../shared/ui/tab-list/tab-list.component';
import { PremiumBadgeComponent } from '../../../../shared/ui/premium-badge/premium-badge.component';

type DisplayNameStyleTierTab = 'basic' | 'premium';

interface DisplayNameStyleOption {
  readonly preset: DisplayNameStylePreset;
  readonly style: UserDisplayNameStyle;
}

@Component({
  selector: 'app-settings-display-name-style-editor',
  imports: [RuntimeTranslatePipe, PlayerNameComponent, CzButtonDirective, TabListComponent, PremiumBadgeComponent],
  templateUrl: './settings-display-name-style-editor.component.html',
  styleUrl: './settings-display-name-style-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsDisplayNameStyleEditorComponent {
  private readonly i18n = inject(AppShellI18nService);

  readonly displayName = input('');
  readonly nameStyle = input<UserDisplayNameStyle | null | undefined>(undefined);
  readonly saving = input(false);

  readonly saveRequested = output<DisplayNameStyleUpdatePayload>();

  readonly activeTier = signal<DisplayNameStyleTierTab>('basic');
  readonly tierTabItems: readonly TabListItem[] = [
    {
      id: 'basic',
      label: 'settings.settingsDisplayNameStyleEditor.basic',
    },
    {
      id: 'premium',
      label: 'settings.settingsDisplayNameStyleEditor.premium',
    },
  ];
  readonly selectedPresetId = signal<string | null>(null);
  readonly selectedTextColor = signal(DEFAULT_PREMIUM_NAME_COLOR);
  readonly basicPresets = DISPLAY_NAME_STYLE_PRESETS.filter((preset) => preset.tier === 'basic');
  readonly premiumPresets = DISPLAY_NAME_STYLE_PRESETS.filter((preset) => preset.tier === 'premium');
  readonly saveDisclaimer = computed(() => this.i18n.text('settingsSaveDisclaimer'));

  readonly currentPreset = computed(() => displayNameStylePreset(this.nameStyle()));
  readonly currentTextColor = computed(() => this.nameStyle()?.textColor ?? DEFAULT_PREMIUM_NAME_COLOR);
  readonly previewTextColor = computed(() => this.selectedPresetId() === null ? this.currentTextColor() : this.selectedTextColor());
  readonly previewPreset = computed(() => {
    const selectedId = this.selectedPresetId();
    return selectedId ? this.presetById(selectedId) : this.currentPreset();
  });
  readonly previewStyle = computed<UserDisplayNameStyle>(() => ({
    type: this.previewPreset().id === 'plain' ? 'plain' : 'preset',
    presetId: this.previewPreset().id,
    textColor: this.previewTextColor(),
  }));
  readonly visiblePresetOptions = computed<readonly DisplayNameStyleOption[]>(() => {
    const presets = this.activeTier() === 'basic' ? this.basicPresets : this.premiumPresets;
    const selectedPresetId = this.previewPreset().id;
    const selectedTextColor = this.previewTextColor();

    return presets.map((preset) => ({
      preset,
      style: {
        type: preset.id === 'plain' ? 'plain' : 'preset',
        presetId: preset.id,
        textColor: preset.id === selectedPresetId ? selectedTextColor : DEFAULT_PREMIUM_NAME_COLOR,
      },
    }));
  });
  readonly colorChanged = computed(() => {
    return this.previewTextColor().toLowerCase() !== this.currentTextColor().toLowerCase();
  });
  readonly canSave = computed(() => {
    return !this.saving() && (this.previewPreset().id !== this.currentPreset().id || this.colorChanged());
  });

  switchTier(tier: DisplayNameStyleTierTab): void {
    this.activeTier.set(tier);
  }

  switchTierFromList(tier: string): void {
    if (tier === 'basic' || tier === 'premium') {
      this.switchTier(tier);
    }
  }

  choosePreset(preset: DisplayNameStylePreset): void {
    this.selectedPresetId.set(preset.id);
    if (this.selectedTextColor() === DEFAULT_PREMIUM_NAME_COLOR) {
      this.selectedTextColor.set(this.nameStyle()?.textColor ?? DEFAULT_PREMIUM_NAME_COLOR);
    }
  }

  updateTextColor(color: string): void {
    this.selectedTextColor.set(normalizeHexColor(color, DEFAULT_PREMIUM_NAME_COLOR));
  }

  save(): void {
    if (!this.canSave()) {
      return;
    }

    this.saveRequested.emit({
      presetId: this.previewPreset().id,
      textColor: this.previewTextColor(),
    });
  }

  private presetById(presetId: string): DisplayNameStylePreset {
    return DISPLAY_NAME_STYLE_PRESETS.find((preset) => preset.id === presetId) ?? this.currentPreset();
  }
}

function normalizeHexColor(value: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}
