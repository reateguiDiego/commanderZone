import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AuthStore } from '../../../core/auth/auth.store';
import { DashboardTopCommandersComponent } from './components/dashboard-top-commanders/dashboard-top-commanders.component';

@Component({
  selector: 'app-dashboard-home',
  imports: [RuntimeTranslatePipe, DashboardTopCommandersComponent],
  templateUrl: './dashboard-home.component.html',
  styleUrl: './dashboard-home.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardHomeComponent {
  private readonly auth = inject(AuthStore);

  readonly userName = computed(() => this.auth.displayName() ?? 'Planeswalker');
}
