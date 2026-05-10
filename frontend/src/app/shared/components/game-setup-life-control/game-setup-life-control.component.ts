import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

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
  readonly disabled = input(false);

  readonly valueChange = output<number>();

  decrease(): void {
    if (this.disabled()) {
      return;
    }

    this.valueChange.emit(Math.max(1, this.value() - this.step()));
  }

  increase(): void {
    if (this.disabled()) {
      return;
    }

    this.valueChange.emit(this.value() + this.step());
  }
}
