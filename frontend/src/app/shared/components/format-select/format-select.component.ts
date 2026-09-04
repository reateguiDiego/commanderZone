import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { MobileViewportSyncService } from '../../services/mobile-viewport-sync.service';
import { PrettyScrollDirective } from '../../ui/pretty-scroll/pretty-scroll.directive';

export interface FormatSelectOption {
  readonly id: string;
  readonly name?: string;
  readonly searchText?: string;
  readonly labelKey?: string;
  readonly translationParams?: Record<string, unknown>;
  readonly flagAsset?: string;
  readonly disabled?: boolean;
}

const FORMAT_SELECT_EXIT_ANIMATION_MS = 170;

@Component({
  selector: 'app-format-select',
  imports: [RuntimeTranslatePipe, PrettyScrollDirective],
  templateUrl: './format-select.component.html',
  styleUrl: './format-select.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-open]': 'dropdownOpen()',
    '[class.is-closing]': 'menuClosing()',
  },
})
export class FormatSelectComponent {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly mobileViewportSync = inject(MobileViewportSyncService);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private closeAnimationTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly formats = input<readonly FormatSelectOption[]>([]);
  readonly options = input<readonly FormatSelectOption[]>([]);
  readonly value = input<string>('commander');
  readonly disabled = input(false);
  readonly required = input(false);
  readonly label = input('Format');
  readonly labelKey = input<string | null>(null);
  readonly labelHidden = input(false);
  readonly allLabel = input<string | null>(null);
  readonly name = input('format');
  readonly searchable = input(false);
  readonly searchPlaceholder = input('Search');

  readonly valueChange = output<string>();

  readonly dropdownOpen = signal(false);
  readonly menuVisible = signal(false);
  readonly menuClosing = signal(false);
  readonly searchQuery = signal('');
  readonly optionItems = computed<readonly FormatSelectOption[]>(() => {
    const providedOptions = this.options();
    const formatOptions = this.formats().map((format) => ({
      id: format.id,
      name: this.optionLabel(format),
    }));
    const allLabel = this.allLabel();
    const baseOptions = providedOptions.length > 0 ? providedOptions : formatOptions;

    return allLabel && !baseOptions.some((option) => option.id === 'all')
      ? [{ id: 'all', name: allLabel }, ...baseOptions]
      : baseOptions;
  });
  readonly selectedOption = computed(() => {
    const selectedValue = this.value();
    return this.optionItems().find((option) => option.id === selectedValue) ?? null;
  });
  readonly selectedLabel = computed(() => {
    const selectedOption = this.selectedOption();
    return selectedOption ? this.optionLabel(selectedOption) : 'Select format';
  });
  readonly selectedTranslationParams = computed(() => this.selectedOption()?.translationParams);
  readonly visibleLabel = computed(() => this.labelKey() ?? this.label());
  readonly visibleOptionItems = computed(() => {
    const query = this.normalizedSearchText(this.searchQuery());
    if (!this.searchable() || query === '') {
      return this.optionItems();
    }

    return this.optionItems().filter((option) => this.normalizedSearchText([
      this.optionLabel(option),
      option.searchText ?? '',
    ].join(' ')).includes(query));
  });

  constructor() {
    const closeFromOutsidePointerDown = (event: Event): void => this.closeFromOutsidePointerDown(event);
    this.document.addEventListener('pointerdown', closeFromOutsidePointerDown, true);
    this.destroyRef.onDestroy(() => {
      this.document.removeEventListener('pointerdown', closeFromOutsidePointerDown, true);
      this.clearCloseAnimationTimeout();
    });
  }

  private closeFromOutsidePointerDown(event: Event): void {
    if (!this.dropdownOpen()) {
      return;
    }

    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.closeDropdown();
    }
  }

  toggleDropdown(): void {
    if (this.disabled()) {
      return;
    }

    if (this.dropdownOpen()) {
      this.closeDropdown();
      return;
    }

    this.openDropdown();
  }

  closeDropdown(): void {
    if (!this.dropdownOpen() && !this.menuVisible()) {
      return;
    }

    this.clearCloseAnimationTimeout();
    this.restoreTriggerFocusBeforeHidingMenu();
    this.searchQuery.set('');
    this.dropdownOpen.set(false);
    this.menuClosing.set(true);
    this.closeAnimationTimeout = setTimeout(() => {
      this.menuVisible.set(false);
      this.menuClosing.set(false);
      this.closeAnimationTimeout = null;
    }, FORMAT_SELECT_EXIT_ANIMATION_MS);
  }

  selectValue(option: FormatSelectOption): void {
    if (this.disabled() || option.disabled) {
      return;
    }

    this.valueChange.emit(option.id);
    this.closeDropdown();
    this.mobileViewportSync.syncAfterSharedSelectChange();
  }

  optionLabel(option: FormatSelectOption): string {
    return option.name ?? option.labelKey ?? option.id;
  }

  updateSearchQuery(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.searchQuery.set(target.value);
    }
  }

  private openDropdown(): void {
    this.clearCloseAnimationTimeout();
    this.menuVisible.set(true);
    this.menuClosing.set(false);
    this.dropdownOpen.set(true);
    if (this.searchable()) {
      queueMicrotask(() => this.searchInput()?.nativeElement.focus());
    }
  }

  private clearCloseAnimationTimeout(): void {
    if (this.closeAnimationTimeout === null) {
      return;
    }

    clearTimeout(this.closeAnimationTimeout);
    this.closeAnimationTimeout = null;
  }

  private restoreTriggerFocusBeforeHidingMenu(): void {
    const host = this.elementRef.nativeElement as HTMLElement;
    const menu = host.querySelector<HTMLElement>('.format-select-menu');
    if (!menu?.contains(this.document.activeElement)) {
      return;
    }

    host.querySelector<HTMLButtonElement>('.format-select-trigger')?.focus({ preventScroll: true });
  }

  private normalizedSearchText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase();
  }
}
