import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { DeckBracketLabel } from '../../../core/models/deck-analysis.model';

@Component({
  selector: 'app-bracket-label-pill',
  imports: [RuntimeTranslatePipe],
  templateUrl: './bracket-label-pill.component.html',
  styleUrl: './bracket-label-pill.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BracketLabelPillComponent {
  readonly bracket = input<DeckBracketLabel | null>(null);
}
