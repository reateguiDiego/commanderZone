import { Injectable, signal } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';

interface SelectedCardState {
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
}

interface CurrentPlayerView {
  id: string;
  state: { status?: string };
}

export type SelectionToggleResult = 'updated' | 'replacedSource';

@Injectable()
export class GameTableSelectionService {
  readonly selectedCards = signal<SelectedCardState[]>([]);

  activeKeyboardCard(hoveredSelection: SelectedCardState | null): SelectedCardState | null {
    return this.selectedCards()[0] ?? hoveredSelection;
  }

  clearSelection(): void {
    this.selectedCards.set([]);
  }

  selectSingle(playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    this.selectedCards.set([{ playerId, zone, card }]);
  }

  selectMany(playerId: string, zone: GameZoneName, cards: readonly GameCardInstance[]): void {
    this.selectedCards.set(cards.map((card) => ({ playerId, zone, card })));
  }

  toggleSelection(event: MouseEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): SelectionToggleResult {
    const selected = this.selectedCards();
    const existing = selected.some((item) => item.card.instanceId === card.instanceId);
    if (event.shiftKey) {
      const first = selected[0];
      if (!existing && first && (first.zone !== zone || first.playerId !== playerId)) {
        this.selectedCards.set([{ playerId, zone, card }]);
        return 'replacedSource';
      }

      this.selectedCards.set(existing
        ? selected.filter((item) => item.card.instanceId !== card.instanceId)
        : [...selected, { playerId, zone, card }]);
      return 'updated';
    }

    this.selectedCards.set([{ playerId, zone, card }]);
    return 'updated';
  }

  isSelected(instanceId: string): boolean {
    return this.selectedCards().some((item) => item.card.instanceId === instanceId);
  }

  isCurrentPlayer(currentPlayer: CurrentPlayerView | null, playerId: string): boolean {
    return currentPlayer?.id === playerId;
  }

  canControlPlayer(currentPlayer: CurrentPlayerView | null, playerId: string): boolean {
    return currentPlayer?.id === playerId && currentPlayer.state.status !== 'conceded';
  }

  canUseHiddenZone(currentPlayer: CurrentPlayerView | null, playerId: string, zone: GameZoneName): boolean {
    return !['library', 'hand'].includes(zone) || this.isCurrentPlayer(currentPlayer, playerId);
  }
}
