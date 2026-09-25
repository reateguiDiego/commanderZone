import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TabListComponent, type TabListItem } from '../../ui/tab-list/tab-list.component';

@Component({
  selector: 'app-game-setup-seats-control',
  imports: [RuntimeTranslatePipe, TabListComponent],
  templateUrl: './game-setup-seats-control.component.html',
  styleUrl: './game-setup-seats-control.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameSetupSeatsControlComponent {
  readonly value = input(4);
  readonly minimumValue = input(2);
  readonly label = input('rooms.setup.gameSetupSeatsControl.seats');
  readonly disabled = input(false);
  readonly options = input<readonly number[]>([2, 3, 4, 5, 6]);

  readonly valueChange = output<number>();
  readonly playerTabs = computed<readonly TabListItem[]>(() => this.options().map((option) => ({
    id: option.toString(),
    label: option.toString(),
    disabled: this.disabled() || option < this.minimumValue(),
  })));

  selectTab(optionId: string): void {
    const value = Number(optionId);
    if (Number.isInteger(value)) {
      this.selectValue(value);
    }
  }

  selectValue(value: number): void {
    if (this.disabled() || value < this.minimumValue()) {
      return;
    }

    this.valueChange.emit(value);
  }
}
