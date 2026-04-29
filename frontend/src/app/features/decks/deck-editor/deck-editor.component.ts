import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { CardAutocompleteComponent } from '../../../shared/components/card-autocomplete/card-autocomplete.component';
import { ManaSymbolsComponent } from '../../../shared/mana/mana-symbols/mana-symbols.component';
import { AppModalComponent } from '../../../shared/ui/app-modal/app-modal.component';
import { DeckCardImageCache } from '../data-access/deck-card-image-cache.service';
import { DeckEditorStore } from '../data-access/deck-editor.store';
import { DeckCardMenuComponent } from './deck-card-menu/deck-card-menu.component';
import { DeckCardSpoilerViewComponent } from './deck-card-spoiler-view/deck-card-spoiler-view.component';
import { DeckCardTextViewComponent } from './deck-card-text-view/deck-card-text-view.component';

@Component({
  selector: 'app-deck-editor',
  imports: [
    FormsModule,
    RouterLink,
    LucideAngularModule,
    AppModalComponent,
    CardAutocompleteComponent,
    ManaSymbolsComponent,
    DeckCardMenuComponent,
    DeckCardSpoilerViewComponent,
    DeckCardTextViewComponent,
  ],
  templateUrl: './deck-editor.component.html',
  styleUrl: './deck-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DeckCardImageCache, DeckEditorStore],
})
export class DeckEditorComponent implements OnDestroy {
  readonly store = inject(DeckEditorStore);

  @HostListener('document:click')
  handleDocumentClick(): void {
    this.store.closeCardMenu();
  }

  ngOnDestroy(): void {
    this.store.destroy();
  }
}
