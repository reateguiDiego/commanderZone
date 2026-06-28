import { ChangeDetectionStrategy, Component, HostBinding, OnDestroy, input, output, signal } from '@angular/core';
import { GameCardStatValue } from '../../../../../../core/models/game.model';
import { RuntimeTranslatePipe } from '../../../../../../core/localization/runtime-translate.pipe';
import { ManaIconComponent } from '../../../../../../shared/mana/mana-icon/mana-icon.component';
import { StatCounterChangeEvent } from '../stat-counter/stat-counter.component';

type StatPulse = 'increase' | 'decrease' | null;
const PRESS_FEEDBACK_MS = 420;

@Component({
  selector: 'app-battle-counter',
  imports: [RuntimeTranslatePipe, ManaIconComponent],
  templateUrl: './battle-counter.component.html',
  styleUrl: './battle-counter.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BattleCounterComponent implements OnDestroy {
  readonly value = input.required<GameCardStatValue>();
  readonly pulse = input<StatPulse>(null);
  readonly entrySettling = input(false);
  readonly inline = input(false);
  readonly rotatedPlacement = input(false);
  readonly battleChanged = output<StatCounterChangeEvent>();
  readonly pressPulse = signal<StatPulse>(null);
  private pressFeedbackTimer: number | null = null;

  @HostBinding('class.inline-battle-counter')
  get inlineBattleCounter(): boolean {
    return this.inline();
  }

  @HostBinding('class.battle-counter-rotated-placement')
  get battleCounterRotatedPlacement(): boolean {
    return this.rotatedPlacement();
  }

  onChanged(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (event.button !== 0 && event.button !== 2) {
      return;
    }

    this.battleChanged.emit({
      event,
      delta: event.button === 2 ? -1 : 1,
    });
  }

  stopPointer(event: PointerEvent): void {
    if (event.button === 0 || event.button === 2) {
      this.setPressFeedback(event.button === 2 ? 'decrease' : 'increase');
    }

    if (event.button === 2) {
      event.preventDefault();
    }

    event.stopPropagation();
  }

  stopClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  stopContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  stopDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  ngOnDestroy(): void {
    this.clearPressFeedbackTimer();
  }

  private setPressFeedback(pulse: StatPulse): void {
    this.pressPulse.set(pulse);
    this.clearPressFeedbackTimer();
    this.pressFeedbackTimer = window.setTimeout(() => {
      this.pressPulse.set(null);
      this.pressFeedbackTimer = null;
    }, PRESS_FEEDBACK_MS);
  }

  private clearPressFeedbackTimer(): void {
    if (this.pressFeedbackTimer !== null) {
      window.clearTimeout(this.pressFeedbackTimer);
      this.pressFeedbackTimer = null;
    }
  }
}
