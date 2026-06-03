import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface PowerToughnessDialogValueChange {
  readonly stat: 'power' | 'toughness';
  readonly value: string;
}

@Component({
  selector: 'app-power-toughness-dialog',
  imports: [RuntimeTranslatePipe],
  templateUrl: './power-toughness-dialog.component.html',
  styleUrl: './power-toughness-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PowerToughnessDialogComponent {
  readonly cardName = input.required<string>();
  readonly power = input.required<string>();
  readonly toughness = input.required<string>();
  readonly invalid = input(false);

  readonly valueChanged = output<PowerToughnessDialogValueChange>();
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  update(stat: 'power' | 'toughness', value: string): void {
    this.valueChanged.emit({ stat, value });
  }
}
