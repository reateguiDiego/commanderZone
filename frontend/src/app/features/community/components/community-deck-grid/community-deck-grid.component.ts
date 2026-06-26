import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommunityDeckSummary, toDeckCardListItem } from '../../../../core/models/community.model';
import { DeckListCardComponent } from '../../../decks/deck-list/components/deck-list-card/deck-list-card.component';

@Component({
  selector: 'app-community-deck-grid',
  imports: [DeckListCardComponent],
  templateUrl: './community-deck-grid.component.html',
  styleUrl: './community-deck-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityDeckGridComponent {
  readonly decks = input<readonly CommunityDeckSummary[]>([]);
  readonly deckSelected = output<string>();

  deckItem(deck: CommunityDeckSummary) {
    return toDeckCardListItem(deck);
  }

  commanderBackground(deck: CommunityDeckSummary): string | null {
    return deck.cropImage ? `url("${deck.cropImage}")` : null;
  }

  secondaryCommanderBackground(deck: CommunityDeckSummary): string | null {
    return deck.secondaryCropImage ? `url("${deck.secondaryCropImage}")` : null;
  }

  hasCommanderArt(deck: CommunityDeckSummary): boolean {
    return typeof deck.cropImage === 'string' && deck.cropImage.trim() !== '';
  }

  hasDualCommanderArt(deck: CommunityDeckSummary): boolean {
    return this.hasCommanderArt(deck) && typeof deck.secondaryCropImage === 'string' && deck.secondaryCropImage.trim() !== '';
  }

  openDeck(deckId: string): void {
    this.deckSelected.emit(deckId);
  }
}
