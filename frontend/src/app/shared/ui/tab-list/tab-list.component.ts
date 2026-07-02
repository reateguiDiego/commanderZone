import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { TextFitDirective } from '../text-fit/text-fit.directive';

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
export type TabListSize = 'md' | 'lg';

@Component({
  selector: 'app-tab-list',
  imports: [LucideAngularModule, RuntimeTranslatePipe, TextFitDirective],
  templateUrl: './tab-list.component.html',
  styleUrl: './tab-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabListComponent {
  readonly items = input.required<readonly TabListItem[]>();
  readonly activeId = input.required<string>();
  readonly ariaLabel = input('');
  readonly variant = input<TabListVariant>('pill');
  readonly size = input<TabListSize>('md');
  readonly iconSize = input(16);
  readonly activeIndex = computed(() => this.items().findIndex((item) => item.id === this.activeId()));
  readonly activeIndicatorWidth = computed(() => `${100 / Math.max(this.items().length, 1)}%`);
  readonly tabSelected = output<string>();

  selectTab(item: TabListItem): void {
    if (item.disabled) {
      return;
    }

    this.tabSelected.emit(item.id);
  }
}
