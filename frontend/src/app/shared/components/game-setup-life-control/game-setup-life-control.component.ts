import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

@Component({
  selector: 'app-game-setup-life-control',
  templateUrl: './game-setup-life-control.component.html',
  styleUrl: './game-setup-life-control.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameSetupLifeControlComponent {
  readonly value = input(40);
  readonly label = input('Total life');
  readonly summary = input('Starting total');
  readonly step = input(5);
  readonly minValue = input(1);
  readonly maxValue = input(99);
  readonly disabled = input(false);

  readonly valueChange = output<number>();
  readonly decreaseDisabled = computed(() => this.disabled() || this.value() <= this.minValue());
  readonly increaseDisabled = computed(() => this.disabled() || this.value() >= this.maxValue());

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
}
