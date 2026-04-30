import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TableAssistantTimerMode, TableAssistantTimerStatus } from '../models/table-assistant.models';

type TimerAlertLevel = 'none' | 'warning' | 'critical';

@Component({
  selector: 'app-table-assistant-turn-controls',
  templateUrl: './table-assistant-turn-controls.component.html',
  styleUrl: './table-assistant-turn-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableAssistantTurnControlsComponent {
  readonly turnNumber = input.required<number>();
  readonly phaseLabel = input<string | null>(null);
  readonly timerMode = input.required<TableAssistantTimerMode>();
  readonly timerStatus = input.required<TableAssistantTimerStatus>();
  readonly timerAlertLevel = input.required<TimerAlertLevel>();
  readonly remainingSeconds = input<number | null>(null);

  readonly timerEnabled = computed(() => this.timerMode() !== 'none');

  readonly timerStarted = output<void>();
  readonly timerPaused = output<void>();
  readonly timerResumed = output<void>();
  readonly turnPassed = output<void>();

  formatTimer(seconds: number | null): string {
    if (seconds === null) {
      return '--:--';
    }

    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
    const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');

    return `${minutes}:${remainder}`;
  }
}
