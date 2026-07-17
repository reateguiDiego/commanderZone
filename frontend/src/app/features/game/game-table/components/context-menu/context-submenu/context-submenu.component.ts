import { RuntimeTranslatePipe, runtimeTranslationFallback } from '../../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { MTGIconComponent } from '../../../../../../shared/mtg/mtg-icon/mtg-icon.component';
import { contextMenuDisplayLabel } from '../context-menu-label';

export type ContextSubmenuDirection = 'down' | 'up';
export type ContextSubmenuSide = 'right' | 'left';

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
  imports: [RuntimeTranslatePipe, LucideAngularModule, MTGIconComponent],
  templateUrl: './context-submenu.component.html',
  styleUrl: './context-submenu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextSubmenuComponent {
	private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
	private readonly viewportMargin = 8;
	private readonly panelGap = 6;
  readonly label = input.required<string>();
  readonly icon = input<string | null>(null);
  readonly items = input.required<readonly ContextSubmenuItem[]>();
  readonly expanded = input(false);
  readonly direction = input<ContextSubmenuDirection>('down');
  readonly side = input<ContextSubmenuSide>('right');
  readonly childSide = input<ContextSubmenuSide>('right');
  readonly expandedChild = signal<string | null>(null);
	readonly resolvedDirection = signal<ContextSubmenuDirection | null>(null);
	readonly resolvedSide = signal<ContextSubmenuSide | null>(null);
	readonly resolvedChildSide = signal<ContextSubmenuSide | null>(null);

  readonly toggled = output<MouseEvent>();
  readonly itemSelected = output<string>();

  toggle(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
		this.resolvePanelPosition(event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
    this.toggled.emit(event);
		queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>('.submenu-panel [role="menuitem"]:not(:disabled)')?.focus());
  }

  selectItem(event: MouseEvent, item: ContextSubmenuItem): void {
    event.preventDefault();
    event.stopPropagation();
    if (item.disabled) {
      return;
    }
    if (item.children?.length) {
			this.resolveChildPosition(event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
      this.expandedChild.update((current) => current === item.value ? null : item.value);
			queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>('.submenu-child-panel [role="menuitem"]:not(:disabled)')?.focus());
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

	@HostListener('window:resize')
	repositionExpandedPanel(): void {
		if (!this.expanded()) {
			return;
		}
		this.resolvePanelPosition(this.host.nativeElement.querySelector<HTMLElement>('.submenu-trigger'));
	}

	private resolvePanelPosition(trigger: HTMLElement | null): void {
		const rect = trigger?.getBoundingClientRect();
		if (!rect) {
			this.resolvedSide.set(this.side());
			this.resolvedDirection.set(this.direction());
			return;
		}
		const panelWidth = Math.min(208, Math.max(0, window.innerWidth - this.viewportMargin * 2));
		const panelHeight = Math.min(this.items().length * 40 + 12, Math.max(0, window.innerHeight - this.viewportMargin * 2));
		const rightFits = rect.right + this.panelGap + panelWidth <= window.innerWidth - this.viewportMargin;
		const leftFits = rect.left - this.panelGap - panelWidth >= this.viewportMargin;
		const preferredSide = this.side();
		this.resolvedSide.set(
			preferredSide === 'right'
				? (rightFits || !leftFits ? 'right' : 'left')
				: (leftFits || !rightFits ? 'left' : 'right'),
		);
		const downFits = rect.top + panelHeight <= window.innerHeight - this.viewportMargin;
		const upFits = rect.bottom - panelHeight >= this.viewportMargin;
		const preferredDirection = this.direction();
		this.resolvedDirection.set(
			preferredDirection === 'down'
				? (downFits || !upFits ? 'down' : 'up')
				: (upFits || !downFits ? 'up' : 'down'),
		);
	}

	private resolveChildPosition(trigger: HTMLElement | null): void {
		const rect = trigger?.getBoundingClientRect();
		if (!rect) {
			this.resolvedChildSide.set(this.childSide());
			return;
		}
		const panelWidth = Math.min(192, Math.max(0, window.innerWidth - this.viewportMargin * 2));
		const rightFits = rect.right + this.panelGap + panelWidth <= window.innerWidth - this.viewportMargin;
		const leftFits = rect.left - this.panelGap - panelWidth >= this.viewportMargin;
		this.resolvedChildSide.set(
			this.childSide() === 'right'
				? (rightFits || !leftFits ? 'right' : 'left')
				: (leftFits || !rightFits ? 'left' : 'right'),
		);
	}
}
