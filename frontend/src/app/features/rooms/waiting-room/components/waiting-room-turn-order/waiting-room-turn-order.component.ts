import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

export interface WaitingTurnOrderRow {
  id: string;
  label: string;
  rollLabel: string;
  rolled: boolean;
}

@Component({
  selector: 'app-waiting-room-turn-order',
  imports: [LucideAngularModule],
  templateUrl: './waiting-room-turn-order.component.html',
  styleUrl: './waiting-room-turn-order.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WaitingRoomTurnOrderComponent {
  readonly rows = input<readonly WaitingTurnOrderRow[]>([]);
  readonly canRoll = input(false);
  readonly currentPlayerRoll = input<number | null>(null);

  readonly rollRequested = output<void>();
}
