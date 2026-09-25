import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { DeviceProfileService } from '../../../../../shared/services/device-profile.service';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';

export interface WaitingRoomLogEntry {
  id: string;
  label: string;
  tone?: 'default' | 'success';
  createdAt: string;
}

@Component({
  selector: 'app-waiting-room-log-panel',
  imports: [RuntimeTranslatePipe, PrettyScrollDirective],
  templateUrl: './waiting-room-log-panel.component.html',
  styleUrl: './waiting-room-log-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WaitingRoomLogPanelComponent {
  private readonly device = inject(DeviceProfileService);

  readonly entries = input<readonly WaitingRoomLogEntry[]>([]);
  readonly fillAvailableHeight = input(false);
  readonly hasEntries = computed(() => this.entries().length > 0);
  readonly compactLayout = this.device.isMobileLayout;
  readonly expanded = signal(true);

  constructor() {
    effect(() => {
      this.expanded.set(!this.compactLayout());
    });
  }

  toggleExpanded(): void {
    this.expanded.update((expanded) => !expanded);
  }

  entryTime(entry: WaitingRoomLogEntry): string {
    const date = new Date(entry.createdAt);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
