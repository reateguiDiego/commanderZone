import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';

interface FormatSelectOption {
  id: string;
  name: string;
}

@Component({
  selector: 'app-format-select',
  templateUrl: './format-select.component.html',
  styleUrl: './format-select.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormatSelectComponent {
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  readonly formats = input<readonly FormatSelectOption[]>([]);
  readonly value = input<string>('commander');
  readonly disabled = input(false);
  readonly required = input(false);
  readonly label = input('Format');
  readonly allLabel = input<string | null>(null);
  readonly name = input('format');

  readonly valueChange = output<string>();

  readonly dropdownOpen = signal(false);
  readonly options = computed<readonly FormatSelectOption[]>(() => {
    const formatOptions = this.formats().map((format) => ({
      id: format.id,
      name: format.name,
    }));
    const allLabel = this.allLabel();

    return allLabel ? [{ id: 'all', name: allLabel }, ...formatOptions] : formatOptions;
  });
  readonly selectedLabel = computed(() => {
    const selectedValue = this.value();
    return this.options().find((option) => option.id === selectedValue)?.name ?? 'Select format';
  });

  @HostListener('document:click', ['$event'])
  closeFromOutsideClick(event: MouseEvent): void {
    if (!this.dropdownOpen()) {
      return;
    }

    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.dropdownOpen.set(false);
    }
  }

  toggleDropdown(): void {
    if (this.disabled()) {
      return;
    }

    this.dropdownOpen.update((open) => !open);
  }

  closeDropdown(): void {
    this.dropdownOpen.set(false);
  }

  selectValue(value: string): void {
    if (this.disabled()) {
      return;
    }

    this.valueChange.emit(value);
    this.dropdownOpen.set(false);
  }
}
