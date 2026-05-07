import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { PageHeaderState } from '../../../../../core/ui/page-header.store';

@Component({
  selector: 'app-dashboard-header-context',
  imports: [LucideAngularModule],
  templateUrl: './dashboard-header-context.component.html',
  styleUrl: './dashboard-header-context.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardHeaderContextComponent {
  readonly header = input<PageHeaderState | null>(null);
}
