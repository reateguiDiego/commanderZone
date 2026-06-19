import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { PageHeaderState } from '../../../../../core/ui/page-header.store';

@Component({
  selector: 'app-dashboard-page-context',
  imports: [RuntimeTranslatePipe, LucideAngularModule],
  templateUrl: './dashboard-page-context.component.html',
  styleUrl: './dashboard-page-context.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPageContextComponent {
  readonly header = input<PageHeaderState | null>(null);
}
