import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { CzButtonDirective } from '../../../../../shared/ui/button/button.directive';
import { TooltipComponent } from '../../../../../shared/ui/tooltip/tooltip.component';
import { isValidRoomCodeInput, normalizeRoomCodeInput } from '../../../shared/room-code.util';

@Component({
  selector: 'app-room-create-panel',
  imports: [RuntimeTranslatePipe, LucideAngularModule, CzButtonDirective, TooltipComponent],
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
  readonly joinCodeInputOpen = signal(false);

  private readonly validRoomCode = computed(() => isValidRoomCodeInput(this.roomCode()));

  readonly joinCodeButtonDisabled = computed(() => this.actionsLocked() || (this.joinCodeInputOpen() && !this.validRoomCode()));
  readonly roomCodeInvalid = computed(() => this.joinCodeInputOpen() && this.roomCode().trim().length > 0 && !this.validRoomCode());

  setRoomCode(event: Event): void {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    this.roomCode.set(input?.value ?? '');
  }

  joinByCode(): void {
    if (this.actionsLocked()) {
      return;
    }

    if (!this.joinCodeInputOpen()) {
      this.joinCodeInputOpen.set(true);
      return;
    }

    const code = normalizeRoomCodeInput(this.roomCode());
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
