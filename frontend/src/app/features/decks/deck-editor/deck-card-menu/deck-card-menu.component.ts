import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeckCard } from '../../../../core/models/deck.model';
import { DeckEditorStore } from '../../data-access/deck-editor.store';

@Component({
  selector: 'app-deck-card-menu',
  imports: [FormsModule],
  templateUrl: './deck-card-menu.component.html',
  styleUrl: './deck-card-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckCardMenuComponent {
  readonly entry = input.required<DeckCard>();
  readonly store = inject(DeckEditorStore);
}
