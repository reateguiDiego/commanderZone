import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';

export interface TabListItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly badge?: string | number;
  readonly ariaLabel?: string;
  readonly title?: string;
  readonly attention?: boolean;
  readonly alignEnd?: boolean;
  readonly labelHidden?: boolean;
  readonly disabled?: boolean;
}

export type TabListVariant = 'pill' | 'underline';

@Component({
  selector: 'app-tab-list',
  imports: [LucideAngularModule, RuntimeTranslatePipe],
  templateUrl: './tab-list.component.html',
  styleUrl: './tab-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabListComponent {
  readonly items = input.required<readonly TabListItem[]>();
  readonly activeId = input.required<string>();
  readonly ariaLabel = input('');
  readonly variant = input<TabListVariant>('pill');
  readonly iconSize = input(16);
  readonly tabSelected = output<string>();

  selectTab(item: TabListItem): void {
    if (item.disabled) {
      return;
    }

    this.tabSelected.emit(item.id);
  }
}
