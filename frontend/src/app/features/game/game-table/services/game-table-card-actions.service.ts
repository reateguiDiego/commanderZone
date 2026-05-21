import { Injectable } from '@angular/core';
import { Card } from '../../../../core/models/card.model';
import { GameCardInstance, GameCardPosition, GameCommandType, GameZoneName } from '../../../../core/models/game.model';
import { GameContextMenu } from '../state/core/game-table-ui.state';
import { ZoneModalState } from '../state/zones/game-table-zone-modal.state';
import type { PendingBattlefieldMove, PendingLibraryMove } from './game-table-drop-actions.service';
import { buildLandStackGroups, landStackGroupContaining, removeLandStackMoves } from '../utils/land-stack';

export interface GameTableCardSelection {
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
}

export interface GameTableCardActionContext {
  canControlPlayer(playerId: string): boolean;
  activeKeyboardCard(): GameTableCardSelection | null;
  selectedCards(): GameTableCardSelection[];
  clearSelectedCards(): void;
  zoneModal(): ZoneModalState | null;
  replaceZoneModalCards(cards: GameCardInstance[]): void;
  loadZone(): Promise<void>;
  battlefieldCards(playerId: string): readonly GameCardInstance[];
  cardPosition(card: GameCardInstance): { x: number; y: number } | null;
  battlefieldPosition(playerId: string, instanceId: string, position: { x: number; y: number }): GameCardPosition;
  updateLocalCardPosition(playerId: string, instanceId: string, position: { x: number; y: number }): void;
  playerName(playerId: string): string;
  setError(message: string): void;
  closeContextMenu(): void;
  setPendingBattlefieldMove(move: PendingBattlefieldMove | null): void;
  setPendingLibraryMove(move: PendingLibraryMove | null): void;
  recordCommanderCastIfNeeded(playerId: string, fromZone: GameZoneName, toZone?: GameZoneName): Promise<void>;
  command(type: GameCommandType, payload: Record<string, unknown>): Promise<void>;
}

@Injectable()
export class GameTableCardActionsService {
  async playCard(context: GameTableCardActionContext, playerId: string, zone: GameZoneName, card: GameCardInstance): Promise<void> {
    if (!context.canControlPlayer(playerId)) {
      context.setError('You can only move your own cards.');
      return;
    }

    await context.command('card.moved', {
      playerId,
      fromZone: zone,
      toZone: 'battlefield',
      instanceId: card.instanceId,
    });
    await context.recordCommanderCastIfNeeded(playerId, zone);
    context.clearSelectedCards();
  }

  async playFaceDown(context: GameTableCardActionContext, menu: GameContextMenu): Promise<void> {
    if (!menu.card || menu.zone !== 'hand') {
      return;
    }
    if (!context.canControlPlayer(menu.playerId)) {
      context.setError('You can only move your own cards.');
      context.closeContextMenu();
      return;
    }

    await context.command('card.moved', {
      playerId: menu.playerId,
      fromZone: 'hand',
      toZone: 'battlefield',
      instanceId: menu.card.instanceId,
      faceDown: true,
    });
    context.clearSelectedCards();
    context.closeContextMenu();
  }

  async moveCard(
    context: GameTableCardActionContext,
    menu: GameContextMenu,
    toZone: GameZoneName,
    options: { position?: 'top' | 'bottom' } = {},
  ): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!context.canControlPlayer(menu.playerId)) {
      context.setError('You can only move your own cards.');
      context.closeContextMenu();
      return;
    }
    const payload: Record<string, unknown> = {
      playerId: menu.playerId,
      fromZone: menu.zone,
      toZone,
      instanceId: menu.card.instanceId,
      ...(options.position ? { position: options.position } : {}),
    };

    if (toZone === 'library' && !options.position) {
      context.setPendingLibraryMove({
        cardName: menu.card.name,
        commandType: 'card.moved',
        payload,
      });
      context.closeContextMenu();
      return;
    }

    await context.command('card.moved', payload);
    await context.recordCommanderCastIfNeeded(menu.playerId, menu.zone, toZone);
    this.removeMovedLibraryCardFromFixedModal(context, menu, toZone, options.position);
    context.clearSelectedCards();
    context.closeContextMenu();
  }

  async moveLibraryCardToHand(context: GameTableCardActionContext, menu: GameContextMenu, reveal: boolean): Promise<void> {
    if (!menu.card || menu.zone !== 'library') {
      return;
    }
    if (!context.canControlPlayer(menu.playerId)) {
      context.setError('You can only move your own cards.');
      context.closeContextMenu();
      return;
    }

    await context.command('card.moved', {
      playerId: menu.playerId,
      fromZone: 'library',
      toZone: 'hand',
      instanceId: menu.card.instanceId,
      reveal,
    });
    context.clearSelectedCards();
    context.closeContextMenu();
    if (context.zoneModal()?.playerId === menu.playerId && context.zoneModal()?.zone === 'library') {
      await context.loadZone();
    }
  }

  async giveCardToPlayer(context: GameTableCardActionContext, menu: GameContextMenu, targetPlayerId: string): Promise<void> {
    if (!menu.card || menu.zone !== 'battlefield') {
      return;
    }
    if (!context.canControlPlayer(menu.playerId)) {
      context.setError('You can only give cards from your own battlefield.');
      context.closeContextMenu();
      return;
    }
    if (targetPlayerId === menu.playerId) {
      context.closeContextMenu();
      return;
    }

    context.setPendingBattlefieldMove({
      cardName: menu.card.name,
      targetPlayerName: context.playerName(targetPlayerId),
      commandType: 'card.controller.changed',
      payload: {
        playerId: menu.playerId,
        zone: 'battlefield',
        instanceId: menu.card.instanceId,
        targetPlayerId,
      },
    });
    context.closeContextMenu();
  }

  async moveSelected(context: GameTableCardActionContext, toZone: GameZoneName): Promise<void> {
    const selected = context.selectedCards();
    const first = selected[0];
    if (!first) {
      return;
    }
    if (!context.canControlPlayer(first.playerId)) {
      context.setError('You can only move your own cards.');
      return;
    }
    const sameSource = selected.every((item) => item.playerId === first.playerId && item.zone === first.zone);
    if (!sameSource) {
      return;
    }

    const instanceIds = selected.map((item) => item.card.instanceId);
    if (toZone === 'library') {
      context.setPendingLibraryMove({
        cardName: `${selected.length} cards`,
        commandType: 'cards.moved',
        payload: {
          playerId: first.playerId,
          fromZone: first.zone,
          toZone,
          instanceIds,
        },
      });
      return;
    }

    await context.command('cards.moved', {
      playerId: first.playerId,
      fromZone: first.zone,
      toZone,
      instanceIds,
    });
    context.clearSelectedCards();
  }

  isLandStacked(context: Pick<GameTableCardActionContext, 'battlefieldCards' | 'cardPosition'>, playerId: string, card: GameCardInstance): boolean {
    const group = landStackGroupContaining(
      buildLandStackGroups(context.battlefieldCards(playerId), context.cardPosition),
      card.instanceId,
    );

    return group !== null;
  }

  async removeLandStack(context: GameTableCardActionContext, menu: GameContextMenu): Promise<void> {
    if (!menu.card || menu.zone !== 'battlefield') {
      return;
    }
    if (!context.canControlPlayer(menu.playerId)) {
      context.setError('You can only change your own cards.');
      context.closeContextMenu();
      return;
    }

    const group = landStackGroupContaining(
      buildLandStackGroups(context.battlefieldCards(menu.playerId), context.cardPosition),
      menu.card.instanceId,
    );
    if (!group) {
      context.closeContextMenu();
      return;
    }

    const moves = removeLandStackMoves(group);
    if (moves.length === 0) {
      context.closeContextMenu();
      return;
    }

    for (const move of moves) {
      context.updateLocalCardPosition(menu.playerId, move.card.instanceId, move.position);
    }

    context.closeContextMenu();
    await context.command('cards.position.changed', {
      playerId: menu.playerId,
      zone: 'battlefield',
      positions: moves.map((move) => ({
        instanceId: move.card.instanceId,
        position: context.battlefieldPosition(menu.playerId, move.card.instanceId, move.position),
      })),
    });
  }

  async moveActiveCard(context: GameTableCardActionContext, toZone: GameZoneName): Promise<void> {
    const selected = context.selectedCards();
    if (selected.length > 1) {
      await this.moveSelected(context, toZone);
      return;
    }

    const item = context.activeKeyboardCard();
    if (!item || !context.canControlPlayer(item.playerId)) {
      return;
    }

    if (toZone === 'library') {
      context.setPendingLibraryMove({
        cardName: item.card.name,
        commandType: 'card.moved',
        payload: {
          playerId: item.playerId,
          fromZone: item.zone,
          toZone,
          instanceId: item.card.instanceId,
        },
      });
      return;
    }

    await context.command('card.moved', {
      playerId: item.playerId,
      fromZone: item.zone,
      toZone,
      instanceId: item.card.instanceId,
    });
    await context.recordCommanderCastIfNeeded(item.playerId, item.zone, toZone);
    context.clearSelectedCards();
  }

  async tapCard(context: GameTableCardActionContext, menu: GameContextMenu): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!context.canControlPlayer(menu.playerId)) {
      context.setError('You can only change your own cards.');
      context.closeContextMenu();
      return;
    }

    await context.command('card.tapped', {
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      tapped: !menu.card.tapped,
    });
    context.closeContextMenu();
  }

  async faceDown(context: GameTableCardActionContext, menu: GameContextMenu): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!context.canControlPlayer(menu.playerId)) {
      context.setError('You can only change your own cards.');
      context.closeContextMenu();
      return;
    }

    await context.command('card.face_down.changed', {
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      faceDown: !menu.card.faceDown,
    });
    context.closeContextMenu();
  }

  async flipCardFace(context: GameTableCardActionContext, menu: GameContextMenu): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!context.canControlPlayer(menu.playerId)) {
      context.setError('You can only change your own cards.');
      context.closeContextMenu();
      return;
    }

    const faceCount = menu.card.cardFaces?.length ?? 0;
    if (faceCount < 2) {
      context.closeContextMenu();
      return;
    }

    const currentIndex = Number.isInteger(menu.card.activeFaceIndex) ? Number(menu.card.activeFaceIndex) : 0;
    await context.command('card.face.changed', {
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      faceIndex: (currentIndex + 1) % faceCount,
    });
    context.closeContextMenu();
  }

  async revealCard(context: GameTableCardActionContext, menu: GameContextMenu, target: string = 'all'): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!context.canControlPlayer(menu.playerId)) {
      context.setError('You can only reveal your own cards.');
      context.closeContextMenu();
      return;
    }

    await context.command('card.revealed', {
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      to: target,
    });
    context.closeContextMenu();
  }

  async tokenCopy(context: GameTableCardActionContext, menu: GameContextMenu): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!context.canControlPlayer(menu.playerId)) {
      context.setError('You can only copy your own cards.');
      context.closeContextMenu();
      return;
    }

    await context.command('card.token_copy.created', {
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      targetPlayerId: menu.playerId,
    });
    context.closeContextMenu();
  }

  private removeMovedLibraryCardFromFixedModal(
    context: GameTableCardActionContext,
    menu: GameContextMenu,
    toZone: GameZoneName,
    position: 'top' | 'bottom' | undefined,
  ): void {
    const modal = context.zoneModal();
    if (
      menu.zone !== 'library'
      || toZone !== 'library'
      || position !== 'bottom'
      || !menu.card
      || !modal
      || modal.zone !== 'library'
      || modal.playerId !== menu.playerId
      || modal.showFilters
    ) {
      return;
    }

    const movedInstanceId = menu.card.instanceId;
    context.replaceZoneModalCards(modal.cards.filter((card) => card.instanceId !== movedInstanceId));
  }

  async createToken(context: GameTableCardActionContext, playerId: string, card: Card | null = null): Promise<void> {
    if (!context.canControlPlayer(playerId)) {
      context.setError('You can only create tokens on your own battlefield.');
      context.closeContextMenu();
      return;
    }

    await context.command('card.token.created', {
      playerId,
      ...(card ? { card: this.tokenCardPayload(card) } : {}),
    });
    context.closeContextMenu();
  }

  private tokenCardPayload(card: Card): Record<string, unknown> {
    return {
      scryfallId: card.scryfallId,
      name: card.name,
      imageUris: card.imageUris,
      cardFaces: card.cardFaces ?? [],
      typeLine: card.typeLine,
      manaCost: card.manaCost,
      oracleText: card.oracleText,
      colorIdentity: card.colorIdentity,
      power: card.power ?? null,
      toughness: card.toughness ?? null,
      loyalty: card.loyalty ?? null,
    };
  }

  async setPowerToughness(context: GameTableCardActionContext, menu: GameContextMenu, power: number, toughness: number): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!context.canControlPlayer(menu.playerId)) {
      context.setError('You can only change your own cards.');
      context.closeContextMenu();
      return;
    }

    await context.command('card.power_toughness.changed', {
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      power,
      toughness,
    });
    context.closeContextMenu();
  }

  async changeCardCounter(context: GameTableCardActionContext, menu: GameContextMenu, key = '+1/+1', delta = 1): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!context.canControlPlayer(menu.playerId)) {
      context.setError('You can only change your own cards.');
      context.closeContextMenu();
      return;
    }

    await context.command('card.counter.changed', {
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      key,
      delta,
    });
    context.closeContextMenu();
  }

  async setCardCounter(context: GameTableCardActionContext, menu: GameContextMenu, key: string, value: number): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!context.canControlPlayer(menu.playerId)) {
      context.setError('You can only change your own cards.');
      context.closeContextMenu();
      return;
    }

    await context.command('card.counter.changed', {
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      key,
      value,
    });
    context.closeContextMenu();
  }

  async addToStack(context: GameTableCardActionContext, menu: GameContextMenu): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!context.canControlPlayer(menu.playerId)) {
      context.setError('You can only add your own cards to stack.');
      context.closeContextMenu();
      return;
    }

    await context.command('stack.card_added', { playerId: menu.playerId, zone: menu.zone, instanceId: menu.card.instanceId });
    context.closeContextMenu();
  }

  async toggleTapped(context: GameTableCardActionContext, playerId: string, zone: GameZoneName, card: GameCardInstance): Promise<void> {
    if (!context.canControlPlayer(playerId)) {
      context.setError('You can only change your own cards.');
      return;
    }

    await context.command('card.tapped', {
      playerId,
      zone,
      instanceId: card.instanceId,
      tapped: !card.tapped,
    });
  }

  async moveZoneCard(context: GameTableCardActionContext, card: GameCardInstance, toZone: GameZoneName): Promise<void> {
    const modal = context.zoneModal();
    if (!modal || !context.canControlPlayer(modal.playerId)) {
      context.setError('You can only move your own cards.');
      return;
    }

    await context.command('card.moved', {
      playerId: modal.playerId,
      fromZone: modal.zone,
      toZone,
      instanceId: card.instanceId,
    });
    await context.recordCommanderCastIfNeeded(modal.playerId, modal.zone, toZone);
    await context.loadZone();
  }

  async revealZoneCard(context: GameTableCardActionContext, card: GameCardInstance): Promise<void> {
    const modal = context.zoneModal();
    if (!modal || !context.canControlPlayer(modal.playerId)) {
      context.setError('You can only reveal your own cards.');
      return;
    }

    await context.command('card.revealed', {
      playerId: modal.playerId,
      zone: modal.zone,
      instanceId: card.instanceId,
      to: 'all',
    });
    await context.loadZone();
  }
}
