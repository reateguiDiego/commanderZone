import { RuntimeTranslatePipe, runtimeTranslationFallback } from '../../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, forwardRef, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { MTGIconComponent } from '../../../../../../shared/mtg/mtg-icon/mtg-icon.component';
import { contextMenuDisplayLabel } from '../context-menu-label';

export type ContextSubmenuDirection = 'down' | 'up';
export type ContextSubmenuSide = 'right' | 'left';
export type ContextSubmenuDepth = 1 | 2 | 3 | 4 | 5;

const SUBMENU_EDGE_GAP_PX = 12;
const SUBMENU_PANEL_GAP_PX = 6;
const SUBMENU_PANEL_ESTIMATED_WIDTH_PX = 208;

export interface ContextSubmenuItem {
  readonly value: string;
  readonly label: string;
  readonly icon?: string;
  readonly iconKind?: 'mana';
  readonly imageOnly?: boolean;
  readonly shortcut?: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly preserveCase?: boolean;
  readonly children?: readonly ContextSubmenuItem[];
}

@Component({
  selector: 'app-context-submenu',
  imports: [RuntimeTranslatePipe, LucideAngularModule, MTGIconComponent, forwardRef(() => ContextSubmenuComponent)],
  templateUrl: './context-submenu.component.html',
  styleUrl: './context-submenu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextSubmenuComponent {
  readonly label = input.required<string>();
  readonly icon = input<string | null>(null);
  readonly items = input.required<readonly ContextSubmenuItem[]>();
  readonly expanded = input(false);
  readonly direction = input<ContextSubmenuDirection>('down');
  readonly side = input<ContextSubmenuSide>('right');
  readonly childSide = input<ContextSubmenuSide>('right');
  readonly themeIcons = input(false);
  readonly depth = input<ContextSubmenuDepth>(1);
  readonly disabled = input(false);
  readonly danger = input(false);
  readonly preserveCase = input(false);
  readonly expandedChild = signal<string | null>(null);
  private readonly resolvedPanelSide = signal<ContextSubmenuSide | null>(null);
  readonly panelSide = computed(() => this.resolvedPanelSide() ?? this.side());
  readonly opensLeftToFit = computed(() => this.side() === 'right' && this.resolvedPanelSide() === 'left');
  readonly activeChildSide = computed(() => this.childSide());
  readonly isExpanded = computed(() => this.expanded());
  readonly nestedDepth = computed<ContextSubmenuDepth>(() => Math.min(this.depth() + 1, 5) as ContextSubmenuDepth);
  readonly arrowDirection = computed<ContextSubmenuSide>(() => this.panelSide());
  readonly triggerLabel = computed(() => this.preserveCase()
    ? runtimeTranslationFallback(this.label())
    : contextMenuDisplayLabel(this.label()));

  readonly toggled = output<MouseEvent>();
  readonly itemSelected = output<string>();

  toggle(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.disabled()) {
      return;
    }

    const willExpand = !this.isExpanded();
    this.resolvedPanelSide.set(
      !willExpand
        ? null
        : this.resolveSide(event.currentTarget, SUBMENU_PANEL_ESTIMATED_WIDTH_PX, this.side()),
    );
    this.toggled.emit(event);
  }

  toggleChild(event: MouseEvent, value: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.expandedChild.update((current) => current === value ? null : value);
  }

  selectItem(event: MouseEvent, item: ContextSubmenuItem): void {
    event.preventDefault();
    event.stopPropagation();
    if (item.disabled) {
      return;
    }
    this.itemSelected.emit(item.value);
  }

  displayLabel(itemOrLabel: ContextSubmenuItem | string): string {
    if (typeof itemOrLabel !== 'string' && itemOrLabel.preserveCase === true) {
      return runtimeTranslationFallback(itemOrLabel.label);
    }

    return contextMenuDisplayLabel(typeof itemOrLabel === 'string' ? itemOrLabel : itemOrLabel.label);
  }

  isAssetIcon(icon: string): boolean {
    return icon.startsWith('assets/') || icon.startsWith('/assets/');
  }

  isCounterPillIcon(icon: string): boolean {
    return icon === 'counter-pill';
  }

  isGraveyardAssetIcon(icon: string): boolean {
    return icon.endsWith('/assets/icons/gameplay/graveyard.svg')
      || icon.endsWith('assets/icons/gameplay/graveyard.svg')
      || icon.endsWith('/assets/icons/gameplay/graveyard-gold.svg')
      || icon.endsWith('assets/icons/gameplay/graveyard-gold.svg');
  }

  private resolveSide(
    target: EventTarget | null,
    panelWidth: number,
    preferredSide: ContextSubmenuSide,
  ): ContextSubmenuSide {
    if (preferredSide === 'left' || typeof window === 'undefined' || !(target instanceof HTMLElement)) {
      return preferredSide;
    }

    const viewportWidth = window.innerWidth;
    if (viewportWidth <= 0) {
      return preferredSide;
    }

    return target.getBoundingClientRect().right + SUBMENU_PANEL_GAP_PX + panelWidth > viewportWidth - SUBMENU_EDGE_GAP_PX
      ? 'left'
      : 'right';
  }
}
