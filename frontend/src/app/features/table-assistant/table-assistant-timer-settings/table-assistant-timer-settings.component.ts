import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { PrettyScrollDirective } from '../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { TableAssistantTimerMode } from '../models/table-assistant.models';

const MIN_TIMER_DURATION_SECONDS = 30;
const MAX_TIMER_DURATION_SECONDS = 30 * 60;
const MAX_TIMER_DURATION_MINUTES = MAX_TIMER_DURATION_SECONDS / 60;
const TIMER_MODE_LABEL_KEYS: Record<TableAssistantTimerMode, string> = {
  none: 'rooms.roomSetupControls.noTimer',
  turn: 'tableAssistant.tableAssistantTimerSettings.timerModes.turn',
  phase: 'tableAssistant.tableAssistantTimerSettings.timerModes.phase',
};

@Component({
  selector: 'app-table-assistant-timer-settings',
  imports: [RuntimeTranslatePipe, PrettyScrollDirective],
  templateUrl: './table-assistant-timer-settings.component.html',
  styleUrl: './table-assistant-timer-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableAssistantTimerSettingsComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private closedDurationPickerFromDocumentPointer = false;

  readonly timerMode = input<TableAssistantTimerMode>('none');
  readonly timerDurationSeconds = input(300);
  readonly timerModes = input<readonly TableAssistantTimerMode[]>(['none', 'turn']);
  readonly disabled = input(false);
  readonly compact = input(false);

  readonly timerModeChange = output<TableAssistantTimerMode>();
  readonly timerDurationSecondsChange = output<number>();

  readonly durationPickerOpen = signal(false);
  readonly timerMinuteOptions = Array.from({ length: MAX_TIMER_DURATION_MINUTES + 1 }, (_, index) => index);
  readonly timerSecondOptions = [0, 15, 30, 45];
  readonly visibleTimerModes = computed(() => this.timerModes().map((mode) => ({
    mode,
    labelKey: TIMER_MODE_LABEL_KEYS[mode],
  })));
  readonly timerDurationMinutes = computed(() => Math.floor(this.timerDurationSeconds() / 60));
  readonly timerDurationRemainderSeconds = computed(() => this.timerDurationSeconds() % 60);
  readonly timerDurationLabel = computed(
    () => `${this.timerDurationMinutes()}:${this.timerDurationRemainderSeconds().toString().padStart(2, '0')}`,
  );

  constructor() {
    this.document.addEventListener('pointerdown', this.closeDurationPickerFromOutside, { capture: true });
    this.destroyRef.onDestroy(() => {
      this.document.removeEventListener('pointerdown', this.closeDurationPickerFromOutside, { capture: true });
    });
  }

  setTimerMode(mode: TableAssistantTimerMode): void {
    if (!this.disabled() && this.timerModes().includes(mode)) {
      const keepClosedAfterOutsidePointer = this.closedDurationPickerFromDocumentPointer && mode === this.timerMode();
      this.closedDurationPickerFromDocumentPointer = false;
      this.timerModeChange.emit(mode);
      this.durationPickerOpen.set(mode !== 'none' && !keepClosedAfterOutsidePointer);
    }
  }

  setTimerDurationMinutes(value: string | number): void {
    this.setTimerDurationParts(this.normalizeWheelNumber(value), this.timerDurationRemainderSeconds());
  }

  setTimerDurationRemainderSeconds(value: string | number): void {
    this.setTimerDurationParts(this.timerDurationMinutes(), this.normalizeWheelNumber(value));
  }

  isSecondOptionDisabled(seconds: number): boolean {
    return this.disabled() || (this.timerDurationMinutes() >= MAX_TIMER_DURATION_MINUTES && seconds > 0);
  }

  private setTimerDurationParts(minutes: number, seconds: number): void {
    if (this.disabled()) {
      return;
    }

    const normalizedMinutes = Math.min(MAX_TIMER_DURATION_MINUTES, Math.max(0, minutes));
    const normalizedSeconds = this.timerSecondOptions.includes(seconds) ? seconds : 0;
    this.timerDurationSecondsChange.emit(Math.min(
      MAX_TIMER_DURATION_SECONDS,
      Math.max(MIN_TIMER_DURATION_SECONDS, normalizedMinutes * 60 + normalizedSeconds),
    ));
  }

  private normalizeWheelNumber(value: string | number): number {
    return Number.parseInt(String(value), 10) || 0;
  }

  private readonly closeDurationPickerFromOutside = (event: PointerEvent): void => {
    if (!this.durationPickerOpen() || !(event.target instanceof Element)) {
      return;
    }

    const timerWheel = this.host.nativeElement.querySelector('.timer-wheel');
    if (timerWheel?.contains(event.target)) {
      return;
    }

    this.closedDurationPickerFromDocumentPointer = true;
    this.durationPickerOpen.set(false);
  };
}
