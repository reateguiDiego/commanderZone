import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { DeckCard } from '../../../../core/models/deck.model';
import { PrettyScrollDirective } from '../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { DeckEditorStore } from '../../data-access/deck-editor.store';

@Component({
  selector: 'app-deck-card-menu',
  imports: [RuntimeTranslatePipe, FormsModule, LucideAngularModule, PrettyScrollDirective],
  templateUrl: './deck-card-menu.component.html',
  styleUrl: './deck-card-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckCardMenuComponent {
  readonly entry = input.required<DeckCard>();
  readonly store = inject(DeckEditorStore);
}
