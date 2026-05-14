import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface ContextSubmenuItem {
  readonly value: string;
  readonly label: string;
  readonly shortcut?: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
}

@Component({
  selector: 'app-context-submenu',
  templateUrl: './context-submenu.component.html',
  styleUrl: './context-submenu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextSubmenuComponent {
  readonly label = input.required<string>();
  readonly items = input.required<readonly ContextSubmenuItem[]>();
  readonly expanded = input(false);

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

    this.itemSelected.emit(item.value);
  }
}
