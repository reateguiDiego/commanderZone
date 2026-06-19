import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { PrettyScrollDirective } from '../../ui/pretty-scroll/pretty-scroll.directive';

export interface FormatSelectOption {
  readonly id: string;
  readonly name?: string;
  readonly labelKey?: string;
  readonly disabled?: boolean;
}

const FORMAT_SELECT_EXIT_ANIMATION_MS = 170;

@Component({
  selector: 'app-format-select',
  imports: [RuntimeTranslatePipe, PrettyScrollDirective],
  templateUrl: './format-select.component.html',
  styleUrl: './format-select.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormatSelectComponent {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
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

  readonly valueChange = output<string>();

  readonly dropdownOpen = signal(false);
  readonly menuVisible = signal(false);
  readonly menuClosing = signal(false);
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
  readonly visibleLabel = computed(() => this.labelKey() ?? this.label());

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
  }

  optionLabel(option: FormatSelectOption): string {
    return option.name ?? option.labelKey ?? option.id;
  }

  private openDropdown(): void {
    this.clearCloseAnimationTimeout();
    this.menuVisible.set(true);
    this.menuClosing.set(false);
    this.dropdownOpen.set(true);
  }

  private clearCloseAnimationTimeout(): void {
    if (this.closeAnimationTimeout === null) {
      return;
    }

    clearTimeout(this.closeAnimationTimeout);
    this.closeAnimationTimeout = null;
  }
}
