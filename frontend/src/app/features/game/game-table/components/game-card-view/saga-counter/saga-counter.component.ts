import { ChangeDetectionStrategy, Component, HostBinding, OnDestroy, input, output, signal } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../../../core/localization/runtime-translate.pipe';
import { StatCounterChangeEvent } from '../stat-counter/stat-counter.component';

type StatPulse = 'increase' | 'decrease' | null;
const PRESS_FEEDBACK_MS = 420;

@Component({
  selector: 'app-saga-counter',
  imports: [RuntimeTranslatePipe],
  templateUrl: './saga-counter.component.html',
  styleUrl: './saga-counter.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SagaCounterComponent implements OnDestroy {
  readonly value = input.required<number>();
  readonly pulse = input<StatPulse>(null);
  readonly entrySettling = input(false);
  readonly inline = input(false);
  readonly sagaChanged = output<StatCounterChangeEvent>();
  readonly pressPulse = signal<StatPulse>(null);
  private pressFeedbackTimer: number | null = null;

  @HostBinding('class.inline-saga-counter')
  get inlineSagaCounter(): boolean {
    return this.inline();
  }

  onChanged(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (event.button !== 0 && event.button !== 2) {
      return;
    }

    this.sagaChanged.emit({
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

  romanValue(): string {
    return formatSagaValue(this.value());
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

function formatSagaValue(value: number): string {
  const clampedValue = Math.max(1, Math.min(9, Math.trunc(Number(value) || 0)));
  if (clampedValue <= 0) {
    return String(clampedValue);
  }

  return toRomanNumeral(clampedValue);
}

function toRomanNumeral(value: number): string {
  const clampedValue = Math.max(1, Math.min(9, Math.trunc(Number(value) || 0)));
  const onesNumerals: readonly string[] = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

  return onesNumerals[clampedValue] ?? '';
}
