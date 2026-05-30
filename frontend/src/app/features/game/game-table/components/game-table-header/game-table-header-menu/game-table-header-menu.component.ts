import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { FullscreenService } from '../../../../../../core/fullscreen/fullscreen.service';
import { LANGUAGE_OPTIONS, SupportedLanguageCode } from '../../../../../../core/localization/language-preferences';
import { LanguagePreferencesService } from '../../../../../../core/localization/language-preferences.service';

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
  private readonly languagePreferences = inject(LanguagePreferencesService);
  private readonly languageCollator = new Intl.Collator('es', { sensitivity: 'base' });
  readonly settingsSelected = output<void>();
  readonly logoffSelected = output<void>();
  readonly menuOpen = signal(false);
  readonly languagePickerOpen = signal(false);
  readonly selectedLanguage = this.languagePreferences.cardLanguage;
  readonly languages = LANGUAGE_OPTIONS;
  readonly sortedLanguages = computed(() =>
    [...this.languages].sort((left, right) => this.languageCollator.compare(left.label, right.label)),
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

    await this.languagePreferences.updateCardLanguage(code);
    window.location.reload();
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
