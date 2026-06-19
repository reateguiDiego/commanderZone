import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { SupportedLanguageCode } from '../../../../../../../core/localization/language-preferences';
import { AppShellI18nService } from '../../../../../../../core/localization/app-shell-i18n.service';
import { RuntimeLanguageSelectorService } from '../../../../../../../core/localization/runtime-language-selector.service';
import { CzButtonDirective } from '../../../../../../../shared/ui/button/button.directive';

@Component({
  selector: 'app-header-user-menu',
  imports: [LucideAngularModule, CzButtonDirective],
  templateUrl: './header-user-menu.component.html',
  styleUrl: './header-user-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderUserMenuComponent {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly runtimeLanguageSelector = inject(RuntimeLanguageSelectorService);
  private readonly i18n = inject(AppShellI18nService);
  readonly settingsSelected = output<void>();
  readonly fullscreenSelected = output<void>();
  readonly logoffSelected = output<void>();
  readonly menuOpened = output<void>();
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
  readonly publicFaqLabel = computed(() => this.i18n.text('publicFaq'));
  readonly publicFaqHref = computed(() => this.selectedLanguage() === 'es' ? '/es/faq/' : '/en/faq/');
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
  readonly selectedLanguageLabel = computed(
    () => this.selectedLanguageOption().label,
  );
  readonly selectedLanguageFlagAsset = computed(() => this.selectedLanguageOption().flagAsset);

  constructor() {
    const closeOnOutsidePointer = (event: PointerEvent) => this.closeOnOutsidePointer(event.target);
    this.document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    this.destroyRef.onDestroy(() => {
      this.document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
    });
  }

  private closeOnOutsidePointer(target: EventTarget | null): void {
    if (!(target instanceof Node)) {
      return;
    }

    if (!this.elementRef.nativeElement.contains(target)) {
      this.closeMenu();
    }
  }

  toggleMenu(): void {
    const nextOpen = !this.menuOpen();
    this.menuOpen.set(nextOpen);

    if (nextOpen) {
      this.menuOpened.emit();
      return;
    }

    this.languagePickerOpen.set(false);
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
}

