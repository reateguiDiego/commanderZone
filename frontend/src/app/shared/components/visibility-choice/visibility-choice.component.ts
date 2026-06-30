import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { DeckVisibility } from '../../../core/models/deck.model';
import { TextFitDirective } from '../../ui/text-fit/text-fit.directive';

@Component({
  selector: 'app-visibility-choice',
  imports: [RuntimeTranslatePipe, LucideAngularModule, TextFitDirective],
  templateUrl: './visibility-choice.component.html',
  styleUrl: './visibility-choice.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisibilityChoiceComponent {
  @Input({ required: true }) value: DeckVisibility | null = null;
  @Input() label = 'common.visibility.visibilityChoice.label';
  @Input() required = false;
  @Input() publicSubtitle = 'common.visibility.visibilityChoice.publicSubtitle';
  @Input() privateSubtitle = 'common.visibility.visibilityChoice.privateSubtitle';
  @Output() readonly valueChange = new EventEmitter<DeckVisibility>();

  readonly options: DeckVisibility[] = ['public', 'private'];

  choose(value: DeckVisibility): void {
    this.valueChange.emit(value);
  }

  subtitle(value: DeckVisibility): string {
    return value === 'public' ? this.publicSubtitle : this.privateSubtitle;
  }
}
