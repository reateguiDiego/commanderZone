import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-game-setup-life-control',
  imports: [LucideAngularModule, RuntimeTranslatePipe],
  templateUrl: './game-setup-life-control.component.html',
  styleUrl: './game-setup-life-control.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameSetupLifeControlComponent {
  readonly value = input(40);
  readonly label = input('rooms.setup.gameSetupLifeControl.totalLife');
  readonly summary = input('rooms.setup.gameSetupLifeControl.startingTotal');
  readonly step = input(5);
  readonly minValue = input(1);
  readonly maxValue = input(99);
  readonly disabled = input(false);
  readonly presets = input<readonly number[]>([]);

  readonly valueChange = output<number>();
  readonly decreaseDisabled = computed(() => this.disabled() || this.value() <= this.minValue());
  readonly increaseDisabled = computed(() => this.disabled() || this.value() >= this.maxValue());
  readonly hasPresets = computed(() => this.presets().length > 0);

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
}
