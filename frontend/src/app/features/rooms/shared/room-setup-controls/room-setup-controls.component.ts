import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RoomTimerMode } from '../../../../core/models/room.model';
import { GameSetupLifeControlComponent } from '../../../../shared/components/game-setup-life-control/game-setup-life-control.component';
import { GameSetupSeatsControlComponent } from '../../../../shared/components/game-setup-seats-control/game-setup-seats-control.component';
import { TableAssistantTimerMode } from '../../../table-assistant/models/table-assistant.models';
import { TableAssistantTimerSettingsComponent } from '../../../table-assistant/table-assistant-timer-settings/table-assistant-timer-settings.component';

@Component({
  selector: 'app-room-setup-controls',
  imports: [
    GameSetupLifeControlComponent,
    GameSetupSeatsControlComponent,
    TableAssistantTimerSettingsComponent,
  ],
  templateUrl: './room-setup-controls.component.html',
  styleUrl: './room-setup-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomSetupControlsComponent {
  readonly maxPlayers = input(4);
  readonly minimumPlayers = input(2);
  readonly startingLife = input(40);
  readonly timerMode = input<RoomTimerMode>('none');
  readonly timerDurationSeconds = input(300);
  readonly maxPlayersOptions = input<readonly number[]>([2, 3, 4, 5, 6]);
  readonly startingLifeStep = input(1);
  readonly disabled = input(false);
  readonly updatingCapacity = input(false);
  readonly updatingStartingLife = input(false);
  readonly updatingTimer = input(false);

  readonly timerSummary = computed(() => {
    if (this.timerMode() === 'none') {
      return 'No timer';
    }

    const minutes = Math.floor(this.timerDurationSeconds() / 60);
    const seconds = this.timerDurationSeconds() % 60;

    return seconds === 0 ? `${minutes} min` : `${minutes}:${seconds.toString().padStart(2, '0')}`;
  });

  readonly maxPlayersChange = output<number>();
  readonly startingLifeChange = output<number>();
  readonly timerModeChange = output<RoomTimerMode>();
  readonly timerDurationSecondsChange = output<number>();

  changeTimerMode(timerMode: TableAssistantTimerMode): void {
    this.timerModeChange.emit(timerMode === 'turn' ? 'turn' : 'none');
  }
}
