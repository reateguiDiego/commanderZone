import { Injectable, inject } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { GameContextMenu, GameTableUiState } from '../state/core/game-table-ui.state';
import { GameTableDragService } from './game-table-drag.service';
import { GameTableSelectionService } from './game-table-selection.service';

interface ControlPlayerView {
  id: string;
  state: { status?: string };
}

interface FocusPlayerView {
  id: string;
}

interface SelectedCardState {
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
}

export interface GameTableInteractionContext {
  currentPlayer(): ControlPlayerView | null;
  focusedPlayer(): FocusPlayerView | null;
  zoneCardCount(playerId: string, zone: GameZoneName): number;
  setError(message: string): void;
  playCard(playerId: string, zone: GameZoneName, card: GameCardInstance): Promise<void>;
}

@Injectable()
export class GameTableInteractionActionsService {
  private readonly selection = inject(GameTableSelectionService);
  private readonly uiState = inject(GameTableUiState);
  private readonly drag = inject(GameTableDragService);

  isCurrentPlayer(context: Pick<GameTableInteractionContext, 'currentPlayer'>, playerId: string): boolean {
    return this.selection.isCurrentPlayer(context.currentPlayer(), playerId);
  }

  canControlPlayer(context: Pick<GameTableInteractionContext, 'currentPlayer'>, playerId: string): boolean {
    return this.selection.canControlPlayer(context.currentPlayer(), playerId);
  }

  canControlOwnedCard(context: Pick<GameTableInteractionContext, 'currentPlayer'>, playerId: string, card: GameCardInstance): boolean {
    const currentPlayerId = context.currentPlayer()?.id;

    if (!currentPlayerId || !this.canControlPlayer(context, playerId)) {
      return false;
    }

    if (card.zone === 'battlefield' || card.zone === 'hand') {
      return !card.controllerId || card.controllerId === currentPlayerId || playerId === currentPlayerId;
    }

    return !card.ownerId || card.ownerId === currentPlayerId;
  }

  canUseHiddenZone(context: Pick<GameTableInteractionContext, 'currentPlayer'>, playerId: string, zone: GameZoneName): boolean {
    return this.selection.canUseHiddenZone(context.currentPlayer(), playerId, zone);
  }

  activeKeyboardCard(): SelectedCardState | null {
    return this.selection.activeKeyboardCard(this.uiState.activeHoveredSelection());
  }

  clearSelection(): void {
    this.selection.clearSelection();
  }

  toggleCardSelection(context: GameTableInteractionContext, event: MouseEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    this.ripple(event.currentTarget as HTMLElement);
    if (!['battlefield', 'hand'].includes(zone)) {
      return;
    }
    if (!this.canControlOwnedCard(context, playerId, card)) {
      context.setError('You can only select and move your own cards.');
      return;
    }

    this.selection.toggleSelection(event, playerId, zone, card);
  }

  handleBattlefieldCardClick(context: GameTableInteractionContext, event: MouseEvent, playerId: string, card: GameCardInstance): void {
    event.stopPropagation();
    if (!this.isCurrentPlayer(context, playerId)) {
      context.setError('You can only select cards on your own battlefield.');
      return;
    }
    if (this.drag.consumeSuppressedClick(card.instanceId)) {
      return;
    }

    const alreadySelected = this.isOnlySelectedCard(card.instanceId);
    if (alreadySelected && !event.shiftKey) {
      this.ripple(event.currentTarget as HTMLElement);
      return;
    }

    this.toggleCardSelection(context, event, playerId, 'battlefield', card);
  }

  handleHandCardClick(context: GameTableInteractionContext, event: MouseEvent, playerId: string, card: GameCardInstance): void {
    event.stopPropagation();
    if (this.drag.consumeSuppressedClick(card.instanceId)) {
      return;
    }

    const alreadySelected = this.isOnlySelectedCard(card.instanceId);
    if (alreadySelected && !event.shiftKey) {
      this.ripple(event.currentTarget as HTMLElement);
      return;
    }

    this.toggleCardSelection(context, event, playerId, 'hand', card);
  }

  openCardMenu(
    context: GameTableInteractionContext,
    event: MouseEvent,
    playerId: string,
    zone: GameZoneName,
    card: GameCardInstance,
    options: { suppressRandomSelect?: boolean } = {},
  ): void {
    this.prepareContextMenuEvent(event);
    if (zone === 'command') {
      return;
    }
    if (zone === 'battlefield' && !this.isCurrentPlayer(context, playerId)) {
      context.setError('You can only open card actions for your own battlefield.');
      return;
    }

    this.uiState.openContextMenu(event, { playerId, zone, card, kind: 'card', ...options });
  }

  openZoneMenu(context: GameTableInteractionContext, event: MouseEvent, playerId: string, zone: GameZoneName): void {
    this.prepareContextMenuEvent(event);
    if (zone === 'command') {
      return;
    }
    if (zone === 'library' && !this.isCurrentPlayer(context, playerId)) {
      return;
    }
    if (this.requiresCardsForZoneMenu(zone) && context.zoneCardCount(playerId, zone) <= 0) {
      return;
    }
    if (zone === 'battlefield' && !this.isCurrentPlayer(context, playerId)) {
      context.setError('You can only open battlefield actions for your own board.');
      return;
    }

    if (zone !== 'battlefield') {
      const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
      const bounds = target?.getBoundingClientRect();
      this.uiState.openContextMenuAt(
        { x: bounds?.left ?? event.clientX, y: bounds?.top ?? event.clientY },
        { playerId, zone, kind: 'zone' },
      );
      return;
    }

    this.uiState.openContextMenu(event, { playerId, zone, kind: 'zone' });
  }

  openGameMenu(context: GameTableInteractionContext, event: MouseEvent): void {
    this.prepareContextMenuEvent(event);
    const playerId = context.focusedPlayer()?.id ?? context.currentPlayer()?.id ?? '';
    this.uiState.openContextMenu(event, { playerId, zone: 'battlefield', kind: 'game' });
  }

  openPlayerMenu(event: MouseEvent, playerId: string): void {
    this.prepareContextMenuEvent(event);
    this.uiState.openContextMenu(event, { playerId, zone: 'battlefield', kind: 'player' });
  }

  closeContextMenu(): void {
    this.uiState.closeContextMenu();
  }

  private isOnlySelectedCard(instanceId: string): boolean {
    const selected = this.selection.selectedCards();

    return selected.length === 1 && selected[0]?.card.instanceId === instanceId;
  }

  private prepareContextMenuEvent(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  private requiresCardsForZoneMenu(zone: GameZoneName): boolean {
    return zone === 'graveyard' || zone === 'exile';
  }

  private ripple(element: HTMLElement): void {
    element.classList.remove('clicked');
    void element.offsetWidth;
    element.classList.add('clicked');
  }
}
