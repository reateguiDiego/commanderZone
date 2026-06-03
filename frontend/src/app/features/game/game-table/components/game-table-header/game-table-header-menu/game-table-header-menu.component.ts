import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { FullscreenService } from '../../../../../../core/fullscreen/fullscreen.service';
import { SupportedLanguageCode } from '../../../../../../core/localization/language-preferences';
import { AppShellI18nService } from '../../../../../../core/localization/app-shell-i18n.service';
import { RuntimeLanguageSelectorService } from '../../../../../../core/localization/runtime-language-selector.service';

@Component({
  selector: 'app-game-table-header-menu',
  imports: [LucideAngularModule],
  templateUrl: './game-table-header-menu.component.html',
  styleUrl: './game-table-header-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameTableHeaderMenuComponent {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fullscreen = inject(FullscreenService);
  private readonly runtimeLanguageSelector = inject(RuntimeLanguageSelectorService);
  private readonly i18n = inject(AppShellI18nService);
  readonly settingsSelected = output<void>();
  readonly logoffSelected = output<void>();
  readonly menuOpen = signal(false);
  readonly languagePickerOpen = signal(false);
  readonly selectedLanguage = this.runtimeLanguageSelector.selectedLanguage;
  readonly languages = this.runtimeLanguageSelector.languageOptions;
  readonly menuLabel = computed(() => this.i18n.text('menu'));
  readonly headerMenuLabel = computed(() => this.i18n.text('headerMenu'));
  readonly userMenuLabel = computed(() => this.i18n.text('userMenu'));
  readonly settingsLabel = computed(() => this.i18n.text('settings'));
  readonly fullscreenLabel = computed(() => this.i18n.text('fullscreen'));
  readonly languageLabel = computed(() => this.i18n.text('language'));
  readonly languageOptionsLabel = computed(() => this.i18n.text('languageOptions'));
  readonly logOffLabel = computed(() => this.i18n.text('logOff'));
  readonly flagAltPrefix = computed(() => this.i18n.text('flagAltPrefix'));
  readonly sortedLanguages = computed(() =>
    [...this.languages].sort((left, right) =>
      left.label.localeCompare(right.label, this.selectedLanguage(), { sensitivity: 'base' }),
    ),
  );
  readonly selectedLanguageOption = computed(
    () => this.languages.find((language) => language.code === this.selectedLanguage()) ?? this.languages[0],
  );
  readonly selectedLanguageLabel = computed(() => this.selectedLanguageOption().label);
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

    await this.runtimeLanguageSelector.selectLanguage(code);
    this.languagePickerOpen.set(false);
  }

  selectSettings(): void {
    this.closeMenu();
    this.settingsSelected.emit();
  }

  async selectFullscreen(): Promise<void> {
    this.closeMenu();
    await this.fullscreen.toggleFullscreen();
  }

  selectLogoff(): void {
    this.closeMenu();
    this.logoffSelected.emit();
  }

  closeMenu(): void {
    this.menuOpen.set(false);
    this.languagePickerOpen.set(false);
  }
}
