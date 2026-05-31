import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';

export interface WaitingRoomLogEntry {
  id: string;
  label: string;
  tone?: 'default' | 'success';
  createdAt: string;
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

  entryTime(entry: WaitingRoomLogEntry): string {
    const date = new Date(entry.createdAt);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
