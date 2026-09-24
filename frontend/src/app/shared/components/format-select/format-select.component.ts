import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { ManaSymbolsComponent } from '../../mana/mana-symbols/mana-symbols.component';
import { MobileViewportSyncService } from '../../services/mobile-viewport-sync.service';
import { PrettyScrollDirective } from '../../ui/pretty-scroll/pretty-scroll.directive';

export interface FormatSelectOption {
  readonly id: string;
  readonly name?: string;
  readonly searchText?: string;
  readonly labelKey?: string;
  readonly translationParams?: Record<string, unknown>;
  readonly flagAsset?: string;
  readonly manaSymbols?: readonly string[];
  readonly disabled?: boolean;
}

const FORMAT_SELECT_EXIT_ANIMATION_MS = 170;
const MENU_VIEWPORT_MARGIN_PX = 8;
const MENU_GAP_PX = 7;
const DEFAULT_MENU_MAX_HEIGHT_PX = 224;

interface MenuViewportPosition {
  readonly left: number;
  readonly top: number | null;
  readonly bottom: number | null;
  readonly width: number;
  readonly maxHeight: number;
  readonly opensUp: boolean;
}

export type FormatSelectMenuPositioning = 'fixed' | 'absolute';

@Component({
  selector: 'app-format-select',
  imports: [RuntimeTranslatePipe, ManaSymbolsComponent, PrettyScrollDirective],
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
  private readonly menuElement = viewChild<ElementRef<HTMLElement>>('menu');
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
  readonly menuPositioning = input<FormatSelectMenuPositioning>('fixed');

  readonly valueChange = output<string>();

  readonly dropdownOpen = signal(false);
  readonly menuVisible = signal(false);
  readonly menuClosing = signal(false);
  readonly searchQuery = signal('');
  readonly menuViewportPosition = signal<MenuViewportPosition | null>(null);
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
      this.stopMenuPositionTracking();
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
    this.stopMenuPositionTracking();
    this.closeAnimationTimeout = setTimeout(() => {
      this.menuVisible.set(false);
      this.menuClosing.set(false);
      this.menuViewportPosition.set(null);
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
    this.startMenuPositionTracking();
    queueMicrotask(() => this.updateMenuViewportPosition());
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

  private startMenuPositionTracking(): void {
    this.document.addEventListener('scroll', this.updateMenuViewportPosition, true);
    this.document.defaultView?.addEventListener('resize', this.updateMenuViewportPosition);
  }

  private stopMenuPositionTracking(): void {
    this.document.removeEventListener('scroll', this.updateMenuViewportPosition, true);
    this.document.defaultView?.removeEventListener('resize', this.updateMenuViewportPosition);
  }

  private readonly updateMenuViewportPosition = (): void => {
    const trigger = this.elementRef.nativeElement.querySelector('.format-select-trigger') as HTMLElement | null;
    const viewport = this.document.defaultView;
    if (!trigger || !viewport || !this.menuVisible()) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const menu = this.menuElement()?.nativeElement;
    this.elementRef.nativeElement.style.setProperty('--format-select-trigger-width', `${triggerRect.width}px`);
    menu?.style.removeProperty('width');
    menu?.style.removeProperty('max-height');
    const parsedMaxHeight = menu ? Number.parseFloat(getComputedStyle(menu).maxHeight) : Number.NaN;
    const configuredMaxHeight = Number.isFinite(parsedMaxHeight) && parsedMaxHeight > 0
      ? parsedMaxHeight
      : DEFAULT_MENU_MAX_HEIGHT_PX;
    const desiredHeight = Math.min(menu?.scrollHeight ?? configuredMaxHeight, configuredMaxHeight);
    const availableBelow = viewport.innerHeight - triggerRect.bottom - MENU_GAP_PX - MENU_VIEWPORT_MARGIN_PX;
    const availableAbove = triggerRect.top - MENU_GAP_PX - MENU_VIEWPORT_MARGIN_PX;
    const opensUp = availableBelow < desiredHeight && availableAbove > availableBelow;
    const availableHeight = opensUp ? availableAbove : availableBelow;
    const maxHeight = Math.max(0, Math.min(desiredHeight, availableHeight));
    const preferredWidth = menu?.getBoundingClientRect().width ?? triggerRect.width;
    const width = Math.min(preferredWidth, viewport.innerWidth - (MENU_VIEWPORT_MARGIN_PX * 2));
    const positioningContext = this.menuPositioning() === 'absolute'
      ? this.elementRef.nativeElement.querySelector('.format-select-control') as HTMLElement | null
      : this.fixedPositioningContext(menu);
    const positioningContextRect = positioningContext
      ? positioningContext.getBoundingClientRect()
      : null;
    const positioningContextTop = positioningContextRect
      ? positioningContextRect.top + (positioningContext?.clientTop ?? 0)
      : 0;
    const positioningContextLeft = positioningContextRect
      ? positioningContextRect.left + (positioningContext?.clientLeft ?? 0)
      : 0;
    const hostStyles = getComputedStyle(this.elementRef.nativeElement);
    const alignMenuToEnd = hostStyles.getPropertyValue('--format-select-menu-left').trim() === 'auto'
      && hostStyles.getPropertyValue('--format-select-menu-right').trim() !== 'auto';
    const alignedLeft = alignMenuToEnd ? triggerRect.right - width : triggerRect.left;
    const left = Math.min(
      Math.max(MENU_VIEWPORT_MARGIN_PX, alignedLeft),
      viewport.innerWidth - width - MENU_VIEWPORT_MARGIN_PX,
    );

    this.menuViewportPosition.set({
      left: left - positioningContextLeft,
      top: opensUp && !positioningContextRect
        ? null
        : (opensUp ? triggerRect.top - MENU_GAP_PX - maxHeight : triggerRect.bottom + MENU_GAP_PX) - positioningContextTop,
      bottom: opensUp && !positioningContextRect ? viewport.innerHeight - triggerRect.top + MENU_GAP_PX : null,
      width,
      maxHeight,
      opensUp,
    });
  };

  private fixedPositioningContext(menu: HTMLElement | undefined): HTMLElement | null {
    let ancestor = menu?.parentElement ?? null;
    while (ancestor && ancestor !== this.document.body) {
      const styles = getComputedStyle(ancestor);
      const containment = styles.contain;
      const willChange = styles.willChange;
      if (
        styles.transform !== 'none'
        || styles.perspective !== 'none'
        || styles.filter !== 'none'
        || styles.getPropertyValue('backdrop-filter') !== 'none'
        || containment.includes('layout')
        || containment.includes('paint')
        || containment.includes('strict')
        || containment.includes('content')
        || /\b(?:transform|perspective|filter|backdrop-filter)\b/.test(willChange)
      ) {
        return ancestor;
      }

      ancestor = ancestor.parentElement;
    }

    return null;
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
