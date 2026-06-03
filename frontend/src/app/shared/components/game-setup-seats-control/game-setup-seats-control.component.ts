import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-game-setup-seats-control',
  imports: [RuntimeTranslatePipe],
  templateUrl: './game-setup-seats-control.component.html',
  styleUrl: './game-setup-seats-control.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameSetupSeatsControlComponent {
  readonly value = input(4);
  readonly minimumValue = input(2);
  readonly label = input('Seats');
  readonly disabled = input(false);
  readonly options = input<readonly number[]>([2, 3, 4, 5, 6]);

  readonly valueChange = output<number>();

  selectValue(value: number): void {
    if (this.disabled() || value < this.minimumValue()) {
      return;
    }

    this.valueChange.emit(value);
  }
}
