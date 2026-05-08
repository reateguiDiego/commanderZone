import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeckFormat } from '../../../core/models/deck.model';

@Component({
  selector: 'app-format-select',
  imports: [FormsModule],
  templateUrl: './format-select.component.html',
  styleUrl: './format-select.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormatSelectComponent {
  readonly formats = input<readonly DeckFormat[]>([]);
  readonly value = input<string>('commander');
  readonly disabled = input(false);
  readonly required = input(false);
  readonly label = input('Format');
  readonly allLabel = input<string | null>(null);
  readonly name = input('format');

  readonly valueChange = output<string>();
}
