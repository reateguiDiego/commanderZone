import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-game-x-quantity-stepper',
  imports: [RuntimeTranslatePipe, LucideAngularModule],
  templateUrl: './game-x-quantity-stepper.component.html',
  styleUrl: './game-x-quantity-stepper.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameXQuantityStepperComponent {
  readonly value = input.required<number>();
  readonly min = input(1);
  readonly max = input(99);
  readonly disabled = input(false);
  readonly strict = input(false);
  readonly ariaLabel = input('Quantity');
  readonly testIdPrefix = input<string | null>(null);

  readonly valueChanged = output<number>();

  readonly canStepDown = computed(() => !this.disabled() && this.value() > this.min());
  readonly canStepUp = computed(() => !this.disabled() && this.value() < this.max());
  readonly valueValid = computed(() => Number.isInteger(this.value()) && this.value() >= this.min() && this.value() <= this.max());

  updateFromInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }

    this.updateValue(event.target.value);
  }

  updateValue(value: string | number): void {
    if (this.disabled()) {
      return;
    }

    this.valueChanged.emit(this.strict() ? this.strictValue(value) : this.normalizedValue(value));
  }

  adjust(delta: number): void {
    if (this.disabled()) {
      return;
    }

    const next = this.value() + delta;
    this.valueChanged.emit(this.strict() ? this.strictValue(next) : this.normalizedValue(next));
  }

  private normalizedValue(value: string | number): number {
    const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);

    if (!Number.isFinite(parsed)) {
      return this.min();
    }

    return Math.max(this.min(), Math.min(this.max(), parsed));
  }

  private strictValue(value: string | number): number {
    return typeof value === 'number' ? value : Number(value);
  }
}
