import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';

export interface WaitingRoomLogEntry {
  id: string;
  label: string;
  time: string;
}

@Component({
  selector: 'app-waiting-room-log-panel',
  imports: [PrettyScrollDirective],
  templateUrl: './waiting-room-log-panel.component.html',
  styleUrl: './waiting-room-log-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WaitingRoomLogPanelComponent {
  readonly entries = input<readonly WaitingRoomLogEntry[]>([]);
}
