import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

export type GameSetupLifeControlMode = 'stepper' | 'slider';

interface SliderHintPosition {
  readonly value: number;
  readonly position: string;
}

@Component({
  selector: 'app-game-setup-life-control',
  imports: [LucideAngularModule, RuntimeTranslatePipe],
  templateUrl: './game-setup-life-control.component.html',
  styleUrl: './game-setup-life-control.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameSetupLifeControlComponent {
  readonly value = input(40);
  readonly label = input('shared.text.lifeTotal');
  readonly summary = input('shared.text.startingTotal');
  readonly step = input(5);
  readonly minValue = input(1);
  readonly maxValue = input(99);
  readonly disabled = input(false);
  readonly presets = input<readonly number[]>([]);
  readonly mode = input<GameSetupLifeControlMode>('stepper');
  readonly sliderHints = input<readonly number[]>([]);
  readonly sliderSnapValues = input<readonly number[]>([]);
  readonly sliderSnapDistance = input(2);

  readonly valueChange = output<number>();
  readonly decreaseDisabled = computed(() => this.disabled() || this.value() <= this.minValue());
  readonly increaseDisabled = computed(() => this.disabled() || this.value() >= this.maxValue());
  readonly hasPresets = computed(() => this.presets().length > 0);
  readonly usesSlider = computed(() => this.mode() === 'slider');
  readonly currentSliderPosition = computed(() => this.sliderPosition(this.value()));
  readonly sliderHintPositions = computed<readonly SliderHintPosition[]>(() => this.sliderHints().map((value) => ({
    value,
    position: this.sliderPosition(value),
  })));
  private isSliderDragging = false;

  decrease(): void {
    if (this.decreaseDisabled()) {
      return;
    }

    this.valueChange.emit(Math.max(this.minValue(), this.value() - this.step()));
  }

  increase(): void {
    if (this.increaseDisabled()) {
      return;
    }

    this.valueChange.emit(Math.min(this.maxValue(), this.value() + this.step()));
  }

  selectPreset(value: number): void {
    if (this.disabled()) {
      return;
    }

    const nextValue = Math.min(this.maxValue(), Math.max(this.minValue(), value));
    if (nextValue !== this.value()) {
      this.valueChange.emit(nextValue);
    }
  }

  updateSlider(event: Event): void {
    if (this.disabled() || !(event.target instanceof HTMLInputElement)) {
      return;
    }

    const sliderValue = Number(event.target.value);
    if (!Number.isFinite(sliderValue)) {
      return;
    }

    const nextValue = this.normalizeSliderValue(sliderValue);
    if (nextValue !== sliderValue) {
      event.target.value = String(nextValue);
    }
    if (nextValue !== this.value()) {
      this.valueChange.emit(nextValue);
    }
  }

  startSliderDrag(event: PointerEvent): void {
    if (this.disabled() || event.button !== 0) {
      return;
    }

    this.isSliderDragging = true;
    const shell = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    shell?.setPointerCapture?.(event.pointerId);
    this.emitSliderValueFromPointer(event);
  }

  moveSliderDrag(event: PointerEvent): void {
    if (this.isSliderDragging) {
      this.emitSliderValueFromPointer(event);
    }
  }

  endSliderDrag(event: PointerEvent): void {
    if (!this.isSliderDragging) {
      return;
    }

    this.emitSliderValueFromPointer(event);
    this.cancelSliderDrag();
  }

  cancelSliderDrag(): void {
    this.isSliderDragging = false;
  }

  private emitSliderValueFromPointer(event: PointerEvent): void {
    const shell = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const track = shell?.querySelector<HTMLElement>('.life-slider-track') ?? null;
    if (!shell || !track) {
      return;
    }

    event.preventDefault();
    const trackRect = track.getBoundingClientRect();
    const ratio = trackRect.width > 0
      ? Math.max(0, Math.min(1, (event.clientX - trackRect.left) / trackRect.width))
      : 0;
    const nextValue = this.normalizeSliderValue(this.minValue() + ratio * (this.maxValue() - this.minValue()));
    const input = shell.querySelector<HTMLInputElement>('.life-slider');
    if (input) {
      input.value = String(nextValue);
    }
    if (nextValue !== this.value()) {
      this.valueChange.emit(nextValue);
    }
  }

  private normalizeSliderValue(value: number): number {
    const snapValues = this.sliderSnapValues().length > 0 ? this.sliderSnapValues() : this.sliderHints();
    const nearestHint = snapValues
      .filter((hint) => hint >= this.minValue() && hint <= this.maxValue())
      .reduce<number | null>((nearest, hint) => {
        if (nearest === null || Math.abs(value - hint) < Math.abs(value - nearest)) {
          return hint;
        }

        return nearest;
      }, null);
    const snapDistance = Math.max(0, this.sliderSnapDistance());
    const snappedValue = nearestHint !== null && Math.abs(value - nearestHint) <= snapDistance
      ? nearestHint
      : value;

    return Math.min(this.maxValue(), Math.max(this.minValue(), Math.round(snappedValue)));
  }

  private sliderPosition(value: number): string {
    const range = this.maxValue() - this.minValue();
    if (range <= 0) {
      return '50%';
    }

    const ratio = Math.max(0, Math.min(1, (value - this.minValue()) / range));

    return `${Number((ratio * 100).toFixed(3))}%`;
  }
}
