import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { PageHeaderAction, PageHeaderState } from '../../../../../core/ui/page-header.store';
import { BackButtonComponent } from '../../../../../shared/ui/back-button/back-button.component';
import { CzButtonDirective } from '../../../../../shared/ui/button/button.directive';
import { HeroRuleComponent } from '../../../../../shared/ui/hero-rule/hero-rule.component';
import { TooltipComponent } from '../../../../../shared/ui/tooltip/tooltip.component';

@Component({
  selector: 'app-dashboard-page-context',
  imports: [RuntimeTranslatePipe, LucideAngularModule, BackButtonComponent, CzButtonDirective, HeroRuleComponent, TooltipComponent],
  templateUrl: './dashboard-page-context.component.html',
  styleUrl: './dashboard-page-context.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPageContextComponent {
  readonly header = input<PageHeaderState | null>(null);
  readonly backAction = computed<PageHeaderAction | null>(() => (
    this.header()?.actions?.find((action) => action.isBack) ?? null
  ));
  readonly visibleActions = computed<readonly PageHeaderAction[]>(() => (
    this.header()?.actions?.filter((action) => !action.isBack) ?? []
  ));
}
