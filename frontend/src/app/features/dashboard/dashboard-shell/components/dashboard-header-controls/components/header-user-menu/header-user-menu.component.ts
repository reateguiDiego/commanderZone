import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { LANGUAGE_OPTIONS, SupportedLanguageCode } from '../../../../../../../core/localization/language-preferences';
import { AppShellI18nService } from '../../../../../../../core/localization/app-shell-i18n.service';
import { LanguagePreferencesService } from '../../../../../../../core/localization/language-preferences.service';

@Component({
  selector: 'app-header-user-menu',
  imports: [LucideAngularModule],
  templateUrl: './header-user-menu.component.html',
  styleUrl: './header-user-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderUserMenuComponent {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly languagePreferences = inject(LanguagePreferencesService);
  private readonly i18n = inject(AppShellI18nService);
  readonly settingsSelected = output<void>();
  readonly fullscreenSelected = output<void>();
  readonly logoffSelected = output<void>();
  readonly menuOpen = signal(false);
  readonly languagePickerOpen = signal(false);
  readonly selectedLanguage = this.languagePreferences.appLanguage;
  readonly languages = LANGUAGE_OPTIONS;
  readonly menuLabel = computed(() => this.i18n.text('menu'));
  readonly headerMenuLabel = computed(() => this.i18n.text('headerMenu'));
  readonly userMenuLabel = computed(() => this.i18n.text('userMenu'));
  readonly settingsLabel = computed(() => this.i18n.text('settings'));
  readonly fullscreenLabel = computed(() => this.i18n.text('fullscreen'));
  readonly languageLabel = computed(() => this.i18n.text('language'));
  readonly languageOptionsLabel = computed(() => this.i18n.text('languageOptions'));
  readonly publicFaqLabel = computed(() => this.i18n.text('publicFaq'));
  readonly publicFaqHref = computed(() => this.selectedLanguage() === 'es' ? '/es/faq/' : '/en/faq/');
  readonly logOffLabel = computed(() => this.i18n.text('logOff'));
  readonly flagAltPrefix = computed(() => this.i18n.text('flagAltPrefix'));
  readonly localizedLanguages = computed(() =>
    this.languages.map((language) => ({
      ...language,
      label: this.i18n.languageName(language.code),
    })),
  );
  readonly sortedLanguages = computed(() =>
    [...this.localizedLanguages()].sort((left, right) =>
      left.label.localeCompare(right.label, this.selectedLanguage(), { sensitivity: 'base' }),
    ),
  );
  readonly selectedLanguageOption = computed(
    () => this.localizedLanguages().find((language) => language.code === this.selectedLanguage()) ?? this.localizedLanguages()[0],
  );
  readonly selectedLanguageLabel = computed(
    () => this.selectedLanguageOption().label,
  );
  readonly selectedLanguageFlagAsset = computed(() => this.selectedLanguageOption().flagAsset);

  @HostListener('document:click', ['$event.target'])
  closeOnOutsideClick(target: EventTarget | null): void {
    if (!(target instanceof Node)) {
      return;
    }

    if (!this.elementRef.nativeElement.contains(target)) {
      this.closeMenu();
    }
  }

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
    if (!this.menuOpen()) {
      this.languagePickerOpen.set(false);
    }
  }

  toggleLanguagePicker(): void {
    this.languagePickerOpen.update((open) => !open);
  }

  async selectLanguage(code: SupportedLanguageCode): Promise<void> {
    if (code === this.selectedLanguage()) {
      this.languagePickerOpen.set(false);
      return;
    }

    await this.languagePreferences.updatePreferences({ cardLanguage: code, appLanguage: code });
    this.reloadPage();
    this.languagePickerOpen.set(false);
  }

  selectSettings(): void {
    this.closeMenu();
    this.settingsSelected.emit();
  }

  selectFullscreen(): void {
    this.closeMenu();
    this.fullscreenSelected.emit();
  }

  selectLogoff(): void {
    this.closeMenu();
    this.logoffSelected.emit();
  }

  closeMenu(): void {
    this.menuOpen.set(false);
    this.languagePickerOpen.set(false);
  }

  private reloadPage(): void {
    window.location.reload();
  }
}

