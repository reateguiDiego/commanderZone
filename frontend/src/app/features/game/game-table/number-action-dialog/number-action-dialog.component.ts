import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-number-action-dialog',
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

  private currentValue: number | null = null;

  updateValue(rawValue: string): void {
    const parsed = Number(rawValue);
    this.currentValue = Number.isFinite(parsed) ? parsed : null;
  }

  confirm(): void {
    const rounded = Math.floor(this.currentValue ?? this.defaultValue());
    const min = this.min();
    const max = this.max();
    const withMin = Math.max(min, rounded);
    this.confirmed.emit(max === null ? withMin : Math.min(max, withMin));
  }
}
