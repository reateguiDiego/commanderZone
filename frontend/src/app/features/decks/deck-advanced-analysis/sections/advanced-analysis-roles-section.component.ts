import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import type { RoleBreakdownCard } from '../deck-advanced-analysis-view.models';

@Component({
  selector: 'app-advanced-analysis-roles-section',
  imports: [RuntimeTranslatePipe],
  templateUrl: './advanced-analysis-roles-section.component.html',
  styleUrl: './advanced-analysis-roles-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdvancedAnalysisRolesSectionComponent {
  readonly cards = input<readonly RoleBreakdownCard[]>([]);
}
