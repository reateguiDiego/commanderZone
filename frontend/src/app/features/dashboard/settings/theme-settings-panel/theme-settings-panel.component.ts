import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { AppShellI18nService } from '../../../../core/localization/app-shell-i18n.service';
import { APP_THEMES, AppTheme, AppThemeId } from '../../../../core/theme/app-theme';
import { AppThemeService } from '../../../../core/theme/app-theme.service';
import { CzButtonDirective } from '../../../../shared/ui/button/button.directive';
import { PremiumBadgeComponent } from '../../../../shared/ui/premium-badge/premium-badge.component';

interface ThemeOptionViewModel extends AppTheme {
  readonly paletteColors: readonly string[];
  readonly premium: boolean;
}

@Component({
  selector: 'app-theme-settings-panel',
  imports: [CzButtonDirective, PremiumBadgeComponent],
  templateUrl: './theme-settings-panel.component.html',
  styleUrl: './theme-settings-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeSettingsPanelComponent {
  private readonly i18n = inject(AppShellI18nService);
  private readonly appTheme = inject(AppThemeService);

  readonly themeSaved = output<AppThemeId>();
  readonly visualThemeLabel = computed(() => this.i18n.text('visualTheme'));
  readonly saveDisclaimer = computed(() => this.i18n.text('settingsSaveDisclaimer'));
  readonly saveLabel = computed(() => this.i18n.text('save'));
  readonly savedThemeId = signal<AppThemeId>(this.appTheme.themeId());
  readonly draftThemeId = signal<AppThemeId>(this.appTheme.themeId());
  readonly saving = signal(false);
  readonly selectedThemeId = computed(() => this.draftThemeId());
  readonly hasChanges = computed(() => this.draftThemeId() !== this.savedThemeId());
  readonly themeOptions: readonly ThemeOptionViewModel[] = APP_THEMES.map((theme) => ({
    ...theme,
    premium: theme.id !== 'sunrise',
    paletteColors: [
      theme.palette.bg,
      theme.palette.surface,
      theme.palette.primary,
      theme.palette.secondary,
      theme.palette.accent,
      theme.palette.text,
    ],
  }));
  readonly currentThemeOption = computed(() =>
    this.themeOptions.find((theme) => theme.id === this.selectedThemeId()) ?? this.themeOptions[0],
  );

  previewTheme(themeId: AppThemeId): void {
    if (this.saving()) {
      return;
    }

    this.draftThemeId.set(this.appTheme.previewTheme(themeId));
  }

  async saveTheme(): Promise<void> {
    if (!this.hasChanges() || this.saving()) {
      return;
    }

    this.saving.set(true);
    try {
      await this.appTheme.saveTheme(this.draftThemeId());
      const savedThemeId = this.appTheme.themeId();
      this.savedThemeId.set(savedThemeId);
      this.draftThemeId.set(savedThemeId);
      this.themeSaved.emit(savedThemeId);
    } catch {
      this.revertPreview();
    } finally {
      this.saving.set(false);
    }
  }

  revertPreview(): void {
    const savedThemeId = this.savedThemeId();
    this.draftThemeId.set(savedThemeId);
    this.appTheme.previewTheme(savedThemeId);
  }
}
