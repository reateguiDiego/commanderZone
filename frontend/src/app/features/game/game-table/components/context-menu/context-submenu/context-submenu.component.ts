import { RuntimeTranslatePipe } from '../../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { contextMenuDisplayLabel } from '../context-menu-label';

export type ContextSubmenuDirection = 'down' | 'up';
export type ContextSubmenuSide = 'right' | 'left';

export interface ContextSubmenuItem {
  readonly value: string;
  readonly label: string;
  readonly icon?: string;
  readonly imageOnly?: boolean;
  readonly shortcut?: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly preserveCase?: boolean;
  readonly children?: readonly ContextSubmenuItem[];
}

@Component({
  selector: 'app-context-submenu',
  imports: [RuntimeTranslatePipe, LucideAngularModule],
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
  readonly expandedChild = signal<string | null>(null);

  readonly toggled = output<MouseEvent>();
  readonly itemSelected = output<string>();

  toggle(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggled.emit(event);
  }

  selectItem(event: MouseEvent, item: ContextSubmenuItem): void {
    event.preventDefault();
    event.stopPropagation();
    if (item.disabled) {
      return;
    }
    if (item.children?.length) {
      this.expandedChild.update((current) => current === item.value ? null : item.value);
      return;
    }

    this.itemSelected.emit(item.value);
  }

  displayLabel(itemOrLabel: ContextSubmenuItem | string): string {
    if (typeof itemOrLabel !== 'string' && itemOrLabel.preserveCase === true) {
      return itemOrLabel.label;
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
}
