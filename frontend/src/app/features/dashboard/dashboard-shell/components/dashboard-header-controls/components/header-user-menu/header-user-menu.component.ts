import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

type HeaderLanguageCode = 'es' | 'fr' | 'en' | 'it' | 'de' | 'pt' | 'ja' | 'zh';

interface HeaderLanguageOption {
  readonly code: HeaderLanguageCode;
  readonly label: string;
}

const HEADER_LANGUAGE_OPTIONS: readonly HeaderLanguageOption[] = [
  { code: 'es', label: 'Espanol' },
  { code: 'fr', label: 'Frances' },
  { code: 'en', label: 'Ingles' },
  { code: 'it', label: 'Italiano' },
  { code: 'de', label: 'Aleman' },
  { code: 'pt', label: 'Portugues' },
  { code: 'ja', label: 'Japones' },
  { code: 'zh', label: 'Chino' },
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
  readonly settingsSelected = output<void>();
  readonly logoffSelected = output<void>();
  readonly menuOpen = signal(false);
  readonly languagePickerOpen = signal(false);
  readonly selectedLanguage = signal<HeaderLanguageCode>('es');
  readonly languages = HEADER_LANGUAGE_OPTIONS;
  readonly selectedLanguageLabel = computed(
    () => this.languages.find((language) => language.code === this.selectedLanguage())?.label ?? 'Espanol',
  );

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

  selectLogoff(): void {
    this.closeMenu();
    this.logoffSelected.emit();
  }

  closeMenu(): void {
    this.menuOpen.set(false);
    this.languagePickerOpen.set(false);
  }
}
