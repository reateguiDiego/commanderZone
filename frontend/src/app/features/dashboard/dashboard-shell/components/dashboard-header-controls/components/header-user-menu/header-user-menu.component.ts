import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

type HeaderLanguageCode = 'es' | 'fr' | 'en' | 'it' | 'de' | 'pt' | 'ja' | 'zh' | 'nl' | 'ca';

interface HeaderLanguageOption {
  readonly code: HeaderLanguageCode;
  readonly label: string;
  readonly flagAsset: string;
}

const HEADER_LANGUAGE_OPTIONS: readonly HeaderLanguageOption[] = [
  { code: 'es', label: 'Espanol', flagAsset: 'assets/icons/flags/spain.png' },
  { code: 'fr', label: 'Frances', flagAsset: 'assets/icons/flags/france.png' },
  { code: 'en', label: 'Ingles', flagAsset: 'assets/icons/flags/uk.png' },
  { code: 'it', label: 'Italiano', flagAsset: 'assets/icons/flags/italy.png' },
  { code: 'de', label: 'Aleman', flagAsset: 'assets/icons/flags/germany.png' },
  { code: 'pt', label: 'Portugues', flagAsset: 'assets/icons/flags/portugal.png' },
  { code: 'ja', label: 'Japones', flagAsset: 'assets/icons/flags/japan.png' },
  { code: 'zh', label: 'Chino', flagAsset: 'assets/icons/flags/china.png' },
  { code: 'nl', label: 'Holandes', flagAsset: 'assets/icons/flags/holand.png' },
  { code: 'ca', label: 'Catalan', flagAsset: 'assets/icons/flags/catalan.png' },
];

@Component({
  selector: 'app-header-user-menu',
  imports: [LucideAngularModule],
  templateUrl: './header-user-menu.component.html',
  styleUrl: './header-user-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderUserMenuComponent {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly languageCollator = new Intl.Collator('es', { sensitivity: 'base' });
  readonly settingsSelected = output<void>();
  readonly fullscreenSelected = output<void>();
  readonly logoffSelected = output<void>();
  readonly menuOpen = signal(false);
  readonly languagePickerOpen = signal(false);
  readonly selectedLanguage = signal<HeaderLanguageCode>('es');
  readonly languages = HEADER_LANGUAGE_OPTIONS;
  readonly sortedLanguages = computed(() =>
    [...this.languages].sort((left, right) => this.languageCollator.compare(left.label, right.label)),
  );
  readonly selectedLanguageOption = computed(
    () => this.languages.find((language) => language.code === this.selectedLanguage()) ?? this.languages[0],
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

  selectLanguage(code: HeaderLanguageCode): void {
    this.selectedLanguage.set(code);
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

