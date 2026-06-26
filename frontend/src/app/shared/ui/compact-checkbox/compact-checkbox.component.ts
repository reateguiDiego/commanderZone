import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TooltipComponent } from '../tooltip/tooltip.component';

@Component({
  selector: 'app-compact-checkbox',
  imports: [TooltipComponent],
  templateUrl: './compact-checkbox.component.html',
  styleUrl: './compact-checkbox.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactCheckboxComponent {
  readonly checked = input(false);
  readonly disabled = input(false);
  readonly label = input('');
  readonly multiline = input(false);
  readonly title = input<string | null>(null);
  readonly name = input<string | null>(null);
  readonly accentRgb = input<string | null>(null);
  readonly swatch = input(false);
  readonly checkedChange = output<boolean>();

  updateChecked(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.checkedChange.emit(target.checked);
    }
  }
}
