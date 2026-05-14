import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { FullscreenService } from '../../../../../core/fullscreen/fullscreen.service';
import { publicAssetUrl } from '../../../../../core/assets/app-image-url';

type GameTableHeaderLanguageCode = 'es' | 'fr' | 'en' | 'it' | 'de' | 'pt' | 'ja' | 'zh' | 'nl' | 'ca';

interface GameTableHeaderLanguageOption {
  readonly code: GameTableHeaderLanguageCode;
  readonly label: string;
  readonly flagAsset: string;
}

const GAME_TABLE_HEADER_LANGUAGE_OPTIONS: readonly GameTableHeaderLanguageOption[] = [
  { code: 'es', label: 'Espanol', flagAsset: publicAssetUrl('assets/icons/flags/spain.png') },
  { code: 'fr', label: 'Frances', flagAsset: publicAssetUrl('assets/icons/flags/france.png') },
  { code: 'en', label: 'Ingles', flagAsset: publicAssetUrl('assets/icons/flags/uk.png') },
  { code: 'it', label: 'Italiano', flagAsset: publicAssetUrl('assets/icons/flags/italy.png') },
  { code: 'de', label: 'Aleman', flagAsset: publicAssetUrl('assets/icons/flags/germany.png') },
  { code: 'pt', label: 'Portugues', flagAsset: publicAssetUrl('assets/icons/flags/portugal.png') },
  { code: 'ja', label: 'Japones', flagAsset: publicAssetUrl('assets/icons/flags/japan.png') },
  { code: 'zh', label: 'Chino', flagAsset: publicAssetUrl('assets/icons/flags/china.png') },
  { code: 'nl', label: 'Holandes', flagAsset: publicAssetUrl('assets/icons/flags/holand.png') },
  { code: 'ca', label: 'Catalan', flagAsset: publicAssetUrl('assets/icons/flags/catalan.png') },
];

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
  private readonly languageCollator = new Intl.Collator('es', { sensitivity: 'base' });
  readonly settingsSelected = output<void>();
  readonly logoffSelected = output<void>();
  readonly menuOpen = signal(false);
  readonly languagePickerOpen = signal(false);
  readonly selectedLanguage = signal<GameTableHeaderLanguageCode>('es');
  readonly languages = GAME_TABLE_HEADER_LANGUAGE_OPTIONS;
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

  selectLanguage(code: GameTableHeaderLanguageCode): void {
    this.selectedLanguage.set(code);
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
