import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-room-create-panel',
  imports: [LucideAngularModule],
  templateUrl: './room-create-panel.component.html',
  styleUrl: './room-create-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomCreatePanelComponent {
  readonly lockedRoomTooltip = 'You are already in a room. Leave it before joining another one.';
  readonly actionsLocked = input(false);
  readonly codeJoinRequested = output<string>();
  readonly createRequested = output<void>();
  readonly roomCode = signal('');

  setRoomCode(event: Event): void {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    this.roomCode.set(input?.value ?? '');
  }

  joinByCode(): void {
    if (this.actionsLocked()) {
      return;
    }

    const code = this.roomCode().trim();
    if (!code) {
      return;
    }

    this.codeJoinRequested.emit(code);
  }

  requestCreate(): void {
    if (this.actionsLocked()) {
      return;
    }

    this.createRequested.emit();
  }
}
