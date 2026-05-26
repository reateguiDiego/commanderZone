import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-number-action-dialog',
  imports: [LucideAngularModule],
  templateUrl: './number-action-dialog.component.html',
  styleUrl: './number-action-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NumberActionDialogComponent {
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly min = input(1);
  readonly max = input<number | null>(null);
  readonly defaultValue = input(1);
  readonly confirmLabel = input('Confirm');
  readonly cancelLabel = input('Cancel');

  readonly confirmed = output<number>();
  readonly cancelled = output<void>();

  private readonly rawValue = signal<string | null>(null);
  readonly displayValue = computed(() => this.rawValue() ?? String(this.defaultValue()));
  readonly canStepDown = computed(() => this.normalizedCurrentValue() > this.min());
  readonly canStepUp = computed(() => {
    const max = this.max();

    return max === null || this.normalizedCurrentValue() < max;
  });

  updateValueFromInput(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.rawValue.set(event.target.value);
    }
  }

  step(delta: number): void {
    this.rawValue.set(String(this.clamp(this.normalizedCurrentValue() + delta)));
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    this.confirm();
  }

  confirm(): void {
    this.confirmed.emit(this.normalizedCurrentValue());
  }

  private normalizedCurrentValue(): number {
    const rawValue = this.rawValue();
    const parsed = Number(rawValue === null || rawValue.trim() === '' ? this.defaultValue() : rawValue);
    const rounded = Math.floor(Number.isFinite(parsed) ? parsed : this.defaultValue());

    return this.clamp(rounded);
  }

  private clamp(value: number): number {
    const min = this.min();
    const max = this.max();
    const withMin = Math.max(min, value);

    return max === null ? withMin : Math.min(max, withMin);
  }
}
