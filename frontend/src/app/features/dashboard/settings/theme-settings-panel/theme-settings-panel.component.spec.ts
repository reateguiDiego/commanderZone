import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ThemesService } from '../../../../core/api/themes.service';
import { AppShellI18nService } from '../../../../core/localization/app-shell-i18n.service';
import { AppThemeId } from '../../../../core/theme/app-theme';
import { AppThemeService } from '../../../../core/theme/app-theme.service';
import { ThemeSettingsPanelComponent } from './theme-settings-panel.component';

describe('ThemeSettingsPanelComponent', () => {
  const themesUpdate = vi.fn((themeId: AppThemeId) => of({ themeId }));

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [ThemeSettingsPanelComponent],
      providers: [
        {
          provide: AppShellI18nService,
          useValue: {
            text: vi.fn((key: string) => key),
          } satisfies Pick<AppShellI18nService, 'text'>,
        },
        {
          provide: ThemesService,
          useValue: {
            update: themesUpdate,
          } satisfies Pick<ThemesService, 'update'>,
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('shows premium badges on every theme except sunrise', () => {
    const fixture = TestBed.createComponent(ThemeSettingsPanelComponent);
    fixture.detectChanges();

    const themeButtons = Array.from(fixture.nativeElement.querySelectorAll('.theme-option') as NodeListOf<HTMLButtonElement>);
    const sunriseButton = themeButtons.find((button) => button.textContent?.includes('Sunrise')) as HTMLButtonElement;
    const premiumButtons = themeButtons.filter((button) => !button.textContent?.includes('Sunrise'));

    expect(themeButtons).toHaveLength(6);
    expect(sunriseButton.querySelector('app-premium-badge')).toBeNull();
    expect(premiumButtons).toHaveLength(5);
    for (const themeButton of premiumButtons) {
      expect(themeButton.querySelector('app-premium-badge')).not.toBeNull();
    }
  });

  it('previews a theme without calling the API or persisting local storage', () => {
    const fixture = TestBed.createComponent(ThemeSettingsPanelComponent);

    fixture.componentInstance.previewTheme('mystic-grove');
    fixture.detectChanges();

    expect(TestBed.inject(AppThemeService).themeId()).toBe('mystic-grove');
    expect(localStorage.getItem('commanderzone.theme')).toBeNull();
    expect(themesUpdate).not.toHaveBeenCalled();
    expect(fixture.componentInstance.hasChanges()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('settingsSaveDisclaimer');
  });

  it('emits the saved account theme after the explicit API update succeeds', async () => {
    const fixture = TestBed.createComponent(ThemeSettingsPanelComponent);
    const savedThemes: AppThemeId[] = [];
    fixture.componentInstance.themeSaved.subscribe((themeId) => savedThemes.push(themeId));

    fixture.componentInstance.previewTheme('mystic-grove');
    await fixture.componentInstance.saveTheme();

    expect(themesUpdate).toHaveBeenCalledWith('mystic-grove');
    expect(savedThemes).toEqual(['mystic-grove']);
    expect(localStorage.getItem('commanderzone.theme')).toBe('mystic-grove');
    expect(fixture.componentInstance.hasChanges()).toBe(false);
  });

  it('does not emit a saved theme and reverts the preview when the API update fails', async () => {
    themesUpdate.mockReturnValueOnce(throwError(() => new Error('failed')));
    const fixture = TestBed.createComponent(ThemeSettingsPanelComponent);
    const savedThemes: AppThemeId[] = [];
    fixture.componentInstance.themeSaved.subscribe((themeId) => savedThemes.push(themeId));

    fixture.componentInstance.previewTheme('mystic-grove');
    await fixture.componentInstance.saveTheme();

    expect(savedThemes).toEqual([]);
    expect(TestBed.inject(AppThemeService).themeId()).toBe('sunrise');
    expect(localStorage.getItem('commanderzone.theme')).toBeNull();
    expect(fixture.componentInstance.hasChanges()).toBe(false);
  });
});
