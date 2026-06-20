import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AppShellI18nService } from '../../../../core/localization/app-shell-i18n.service';
import { APP_THEMES, AppTheme, AppThemeId } from '../../../../core/theme/app-theme';
import { AppThemeService } from '../../../../core/theme/app-theme.service';

interface ThemeOptionViewModel extends AppTheme {
  readonly paletteColors: readonly string[];
}

@Component({
  selector: 'app-theme-settings-panel',
  templateUrl: './theme-settings-panel.component.html',
  styleUrl: './theme-settings-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeSettingsPanelComponent {
  private readonly i18n = inject(AppShellI18nService);
  private readonly appTheme = inject(AppThemeService);

  readonly visualThemeLabel = computed(() => this.i18n.text('visualTheme'));
  readonly visualThemeHelp = computed(() => this.i18n.text('visualThemeHelp'));
  readonly selectedThemeId = this.appTheme.themeId;
  readonly themeOptions: readonly ThemeOptionViewModel[] = APP_THEMES.map((theme) => ({
    ...theme,
    paletteColors: [
      theme.palette.bg,
      theme.palette.surface,
      theme.palette.primary,
      theme.palette.secondary,
      theme.palette.accent,
      theme.palette.text,
    ],
  }));

  async selectTheme(themeId: AppThemeId): Promise<void> {
    await this.appTheme.saveTheme(themeId).catch(() => undefined);
  }
}
