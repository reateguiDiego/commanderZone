import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { CardAutocompleteComponent } from '../../../shared/components/card-autocomplete/card-autocomplete.component';
import { AppModalComponent } from '../../../shared/ui/app-modal/app-modal.component';
import { DeckListStore } from '../data-access/deck-list.store';

@Component({
  selector: 'app-deck-list',
  imports: [FormsModule, RouterLink, LucideAngularModule, AppModalComponent, CardAutocompleteComponent],
  templateUrl: './deck-list.component.html',
  styleUrl: './deck-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DeckListStore],
})
export class DeckListComponent {
  readonly store = inject(DeckListStore);
}
