import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, output, signal, viewChild } from '@angular/core';
import { RoomTimerMode } from '../../../../../core/models/room.model';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { GameSetupLifeControlComponent } from '../../../../../shared/components/game-setup-life-control/game-setup-life-control.component';
import { GameSetupSeatsControlComponent } from '../../../../../shared/components/game-setup-seats-control/game-setup-seats-control.component';
import { TableAssistantTimerMode } from '../../../../table-assistant/models/table-assistant.models';
import { TableAssistantTimerSettingsComponent } from '../../../../table-assistant/table-assistant-timer-settings/table-assistant-timer-settings.component';

export interface WaitingRoomLogEntry {
  id: string;
  label: string;
  time: string;
}

type WaitingRoomSetupTab = 'setup' | 'log';

@Component({
  selector: 'app-waiting-room-game-setup',
  imports: [
    PrettyScrollDirective,
    GameSetupLifeControlComponent,
    GameSetupSeatsControlComponent,
    TableAssistantTimerSettingsComponent,
  ],
  templateUrl: './waiting-room-game-setup.component.html',
  styleUrl: './waiting-room-game-setup.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WaitingRoomGameSetupComponent {
  private latestLogId: string | null = null;
  private readonly roomLogViewport = viewChild<ElementRef<HTMLElement>>('roomLogViewport');

  readonly activeTab = signal<WaitingRoomSetupTab>('setup');
  readonly unreadLogCount = signal(0);
  readonly isOwner = input(false);
  readonly joinedPlayers = input(0);
  readonly roomCapacity = input(4);
  readonly startingLife = input(40);
  readonly timerMode = input<RoomTimerMode>('none');
  readonly timerDurationSeconds = input(300);
  readonly updatingCapacity = input(false);
  readonly updatingStartingLife = input(false);
  readonly updatingTimer = input(false);
  readonly maxPlayersOptions = input<readonly number[]>([]);
  readonly startingLifeStep = input(5);
  readonly roomLog = input<readonly WaitingRoomLogEntry[]>([]);
  readonly timerSummary = computed(() => {
    if (this.timerMode() === 'none') {
      return 'No timer';
    }

    const minutes = Math.floor(this.timerDurationSeconds() / 60);
    const seconds = this.timerDurationSeconds() % 60;

    return seconds === 0 ? `${minutes} min` : `${minutes}:${seconds.toString().padStart(2, '0')}`;
  });

  readonly capacityChange = output<number>();
  readonly startingLifeChange = output<number>();
  readonly timerModeChange = output<RoomTimerMode>();
  readonly timerDurationSecondsChange = output<number>();

  constructor() {
    effect(() => {
      const entries = this.roomLog();
      const latestEntry = entries[entries.length - 1] ?? null;

      if (!latestEntry || latestEntry.id === this.latestLogId) {
        return;
      }

      this.latestLogId = latestEntry.id;
      if (this.activeTab() === 'log') {
        this.scrollLogToLatest();
        return;
      }

      this.unreadLogCount.update((count) => count + 1);
    });
  }

  decreaseStartingLife(): void {
    if (!this.isOwner() || this.updatingStartingLife()) {
      return;
    }

    this.startingLifeChange.emit(Math.max(1, this.startingLife() - this.startingLifeStep()));
  }

  increaseStartingLife(): void {
    if (!this.isOwner() || this.updatingStartingLife()) {
      return;
    }

    this.startingLifeChange.emit(this.startingLife() + this.startingLifeStep());
  }

  changeTimerMode(timerMode: TableAssistantTimerMode): void {
    if (!this.isOwner() || this.updatingTimer()) {
      return;
    }

    this.timerModeChange.emit(timerMode === 'turn' ? 'turn' : 'none');
  }

  changeTimerDuration(seconds: number): void {
    if (!this.isOwner() || this.updatingTimer()) {
      return;
    }

    this.timerDurationSecondsChange.emit(seconds);
  }

  changeCapacity(value: number): void {
    if (!this.isOwner() || this.updatingCapacity() || value < this.joinedPlayers()) {
      return;
    }

    this.capacityChange.emit(value);
  }

  selectTab(tab: WaitingRoomSetupTab): void {
    this.activeTab.set(tab);
    if (tab === 'log') {
      this.unreadLogCount.set(0);
      this.scrollLogToLatest();
    }
  }

  private scrollLogToLatest(): void {
    window.setTimeout(() => {
      const viewport = this.roomLogViewport()?.nativeElement;
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
  }
}
