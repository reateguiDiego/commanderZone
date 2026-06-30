import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RoomMulliganRule, RoomTimerMode } from '../../../../core/models/room.model';
import { FormatSelectComponent } from '../../../../shared/components/format-select/format-select.component';
import { GameSetupLifeControlComponent } from '../../../../shared/components/game-setup-life-control/game-setup-life-control.component';
import { GameSetupSeatsControlComponent } from '../../../../shared/components/game-setup-seats-control/game-setup-seats-control.component';
import { ToggleComponent } from '../../../../shared/ui/toggle/toggle.component';
import { TableAssistantTimerMode } from '../../../table-assistant/models/table-assistant.models';
import { TableAssistantTimerSettingsComponent } from '../../../table-assistant/table-assistant-timer-settings/table-assistant-timer-settings.component';

@Component({
  selector: 'app-room-setup-controls',
  imports: [RuntimeTranslatePipe, 
    FormatSelectComponent,
    GameSetupLifeControlComponent,
    GameSetupSeatsControlComponent,
    TableAssistantTimerSettingsComponent,
    ToggleComponent,
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
  readonly mulliganRule = input<RoomMulliganRule>('LONDON');
  readonly firstMulliganFree = input(true);
  readonly maxPlayersOptions = input<readonly number[]>([2, 3, 4, 5, 6]);
  readonly startingLifeStep = input(1);
  readonly disabled = input(false);
  readonly updatingCapacity = input(false);
  readonly updatingStartingLife = input(false);
  readonly updatingTimer = input(false);
  readonly updatingMulligan = input(false);
  readonly mulliganOptions: readonly { value: RoomMulliganRule; labelKey: string }[] = [
    { value: 'LONDON', labelKey: 'rooms.roomSetupControls.mulliganRules.london' },
    { value: 'VANCOUVER', labelKey: 'rooms.roomSetupControls.mulliganRules.vancouver' },
    { value: 'PARIS', labelKey: 'rooms.roomSetupControls.mulliganRules.paris' },
    { value: 'GENEROUS', labelKey: 'rooms.roomSetupControls.mulliganRules.generous' },
  ];

  readonly mulliganSelectOptions = computed(() => this.mulliganOptions.map((option) => ({
    id: option.value,
    labelKey: option.labelKey,
  })));
  readonly mulliganDescriptionKey = computed(() => this.descriptionKeyForMulliganRule(this.mulliganRule()));
  readonly timerSummary = computed(() => {
    if (this.timerMode() === 'none') {
      return 'rooms.roomSetupControls.noTimer';
    }

    const minutes = Math.floor(this.timerDurationSeconds() / 60);
    const seconds = this.timerDurationSeconds() % 60;

    return seconds === 0 ? `${minutes} min` : `${minutes}:${seconds.toString().padStart(2, '0')}`;
  });

  readonly maxPlayersChange = output<number>();
  readonly startingLifeChange = output<number>();
  readonly timerModeChange = output<RoomTimerMode>();
  readonly timerDurationSecondsChange = output<number>();
  readonly mulliganRuleChange = output<RoomMulliganRule>();
  readonly firstMulliganFreeChange = output<boolean>();

  changeTimerMode(timerMode: TableAssistantTimerMode): void {
    this.timerModeChange.emit(timerMode === 'turn' ? 'turn' : 'none');
  }

  changeMulliganRule(mulliganRule: string): void {
    if (this.isRoomMulliganRule(mulliganRule)) {
      this.mulliganRuleChange.emit(mulliganRule);
    }
  }

  private isRoomMulliganRule(mulliganRule: string): mulliganRule is RoomMulliganRule {
    return this.mulliganOptions.some((option) => option.value === mulliganRule);
  }

  private descriptionKeyForMulliganRule(mulliganRule: RoomMulliganRule): string {
    return `rooms.roomSetupControls.mulliganDescriptions.${mulliganRule.toLowerCase()}`;
  }
}
