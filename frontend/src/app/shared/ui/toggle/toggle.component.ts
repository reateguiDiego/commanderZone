import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-toggle',
  templateUrl: './toggle.component.html',
  styleUrl: './toggle.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToggleComponent {
  readonly checked = input(false);
  readonly disabled = input(false);
  readonly label = input('');
  readonly description = input('');
  readonly ariaLabel = input<string | null>(null);
  readonly checkedChange = output<boolean>();

  toggle(): void {
    if (this.disabled()) {
      return;
    }

    this.checkedChange.emit(!this.checked());
  }
}
