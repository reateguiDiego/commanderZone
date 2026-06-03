import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { DeckVisibility } from '../../../core/models/deck.model';

@Component({
  selector: 'app-visibility-choice',
  imports: [RuntimeTranslatePipe, LucideAngularModule],
  templateUrl: './visibility-choice.component.html',
  styleUrl: './visibility-choice.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisibilityChoiceComponent {
  @Input({ required: true }) value: DeckVisibility | null = null;
  @Input() label = 'Visibility';
  @Input() publicSubtitle = 'Anyone can join';
  @Input() privateSubtitle = 'Invite only';
  @Output() readonly valueChange = new EventEmitter<DeckVisibility>();

  readonly options: DeckVisibility[] = ['public', 'private'];

  choose(value: DeckVisibility): void {
    this.valueChange.emit(value);
  }

  subtitle(value: DeckVisibility): string {
    return value === 'public' ? this.publicSubtitle : this.privateSubtitle;
  }
}
