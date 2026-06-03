import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { PrettyScrollDirective } from '../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { TableAssistantTimerMode } from '../models/table-assistant.models';

@Component({
  selector: 'app-table-assistant-timer-settings',
  imports: [RuntimeTranslatePipe, PrettyScrollDirective],
  templateUrl: './table-assistant-timer-settings.component.html',
  styleUrl: './table-assistant-timer-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableAssistantTimerSettingsComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly timerMode = input<TableAssistantTimerMode>('none');
  readonly timerDurationSeconds = input(300);
  readonly timerModes = input<readonly TableAssistantTimerMode[]>(['none', 'turn']);
  readonly disabled = input(false);
  readonly compact = input(false);

  readonly timerModeChange = output<TableAssistantTimerMode>();
  readonly timerDurationSecondsChange = output<number>();

  readonly durationPickerOpen = signal(false);
  readonly timerMinuteOptions = Array.from({ length: 11 }, (_, index) => index);
  readonly timerSecondOptions = [0, 15, 30, 45];
  readonly timerDurationMinutes = computed(() => Math.floor(this.timerDurationSeconds() / 60));
  readonly timerDurationRemainderSeconds = computed(() => this.timerDurationSeconds() % 60);
  readonly timerDurationLabel = computed(
    () => `${this.timerDurationMinutes()}:${this.timerDurationRemainderSeconds().toString().padStart(2, '0')}`,
  );

  @HostListener('document:click', ['$event'])
  closeDurationPickerFromOutside(event: MouseEvent): void {
    if (!this.durationPickerOpen() || !(event.target instanceof Element)) {
      return;
    }

    if (!this.host.nativeElement.contains(event.target)) {
      this.durationPickerOpen.set(false);
    }
  }

  setTimerMode(mode: TableAssistantTimerMode): void {
    if (!this.disabled() && this.timerModes().includes(mode)) {
      this.timerModeChange.emit(mode);
      this.durationPickerOpen.set(mode !== 'none');
    }
  }

  setTimerDurationMinutes(value: string | number): void {
    this.setTimerDurationParts(this.normalizeWheelNumber(value), this.timerDurationRemainderSeconds());
  }

  setTimerDurationRemainderSeconds(value: string | number): void {
    this.setTimerDurationParts(this.timerDurationMinutes(), this.normalizeWheelNumber(value));
  }

  isSecondOptionDisabled(seconds: number): boolean {
    return this.disabled() || (this.timerDurationMinutes() >= 10 && seconds > 0);
  }

  private setTimerDurationParts(minutes: number, seconds: number): void {
    if (this.disabled()) {
      return;
    }

    const normalizedMinutes = Math.min(10, Math.max(0, minutes));
    const normalizedSeconds = this.timerSecondOptions.includes(seconds) ? seconds : 0;
    this.timerDurationSecondsChange.emit(Math.min(600, Math.max(30, normalizedMinutes * 60 + normalizedSeconds)));
  }

  private normalizeWheelNumber(value: string | number): number {
    return Number.parseInt(String(value), 10) || 0;
  }
}
