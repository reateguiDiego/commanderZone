import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { AppModalComponent } from '../../../../../../../shared/ui/app-modal/app-modal.component';

@Component({
  selector: 'app-dashboard-settings-modal',
  imports: [AppModalComponent],
  templateUrl: './dashboard-settings-modal.component.html',
  styleUrl: './dashboard-settings-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardSettingsModalComponent {
  readonly open = input(false);
  readonly closeRequested = output<void>();
}
