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
  syncOpenZoneModalAfterMove(playerId: string, fromZone: GameZoneName, instanceIds: readonly string[]): Promise<void>;
  recordCommanderCastIfNeeded(playerId: string, fromZone: GameZoneName, toZone?: GameZoneName): Promise<void>;
  command(type: GameCommandType, payload: Record<string, unknown>): Promise<void>;
}

type LibraryTopViewSourceContext = {
  readonly type: 'libraryTopView';
  readonly count: number;
};

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

    for (const item of this.actionTargets(context, menu, 'hand')) {
      await context.command('card.moved', {
        playerId: item.playerId,
        fromZone: 'hand',
        toZone: 'battlefield',
        instanceId: item.card.instanceId,
        faceDown: true,
      });
    }
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
    const targets = this.actionTargets(context, menu);
    if (targets.length > 1) {
      const first = targets[0]!;
      const payload: Record<string, unknown> = {
        playerId: first.playerId,
        fromZone: first.zone,
        toZone,
        instanceIds: targets.map((item) => item.card.instanceId),
        ...(options.position ? { position: options.position } : {}),
      };

      if (toZone === 'library' && !options.position) {
        context.setPendingLibraryMove({
          cardName: `${targets.length} cards`,
          commandType: 'cards.moved',
          payload,
        });
        context.closeContextMenu();
        return;
      }

      await context.command('cards.moved', payload);
      await context.syncOpenZoneModalAfterMove(first.playerId, first.zone, targets.map((item) => item.card.instanceId));
      context.clearSelectedCards();
      context.closeContextMenu();
      return;
    }

    const target = targets[0] ?? { playerId: menu.playerId, zone: menu.zone, card: menu.card };
    const payload: Record<string, unknown> = {
      playerId: target.playerId,
      fromZone: target.zone,
      toZone,
      instanceId: target.card.instanceId,
      ...this.viewedLibrarySourcePayload(context, target.playerId, target.card),
      ...(options.position ? { position: options.position } : {}),
    };

    if (toZone === 'library' && !options.position) {
      context.setPendingLibraryMove({
        cardName: target.card.name,
        commandType: 'card.moved',
        payload,
      });
      context.closeContextMenu();
      return;
    }

    await context.command('card.moved', payload);
    await context.recordCommanderCastIfNeeded(target.playerId, target.zone, toZone);
    await context.syncOpenZoneModalAfterMove(target.playerId, target.zone, [target.card.instanceId]);
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
      ...this.viewedLibrarySourcePayload(context, menu.playerId, menu.card),
    });
    await context.syncOpenZoneModalAfterMove(menu.playerId, 'library', [menu.card.instanceId]);
    context.clearSelectedCards();
    context.closeContextMenu();
  }

  async giveCardToPlayer(
    context: GameTableCardActionContext,
    menu: GameContextMenu,
    targetPlayerId: string,
    toZone: 'battlefield' | 'hand' = 'battlefield',
  ): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!context.canControlPlayer(menu.playerId)) {
      context.setError('You can only give your own cards.');
      context.closeContextMenu();
      return;
    }
    if (targetPlayerId === menu.playerId) {
      context.closeContextMenu();
      return;
    }

    const targets = this.actionTargets(context, menu);
    if (toZone === 'battlefield' && menu.zone === 'battlefield') {
      if (targets.length > 1) {
        context.setPendingBattlefieldMove({
          cardName: `${targets.length} cards`,
          targetPlayerName: context.playerName(targetPlayerId),
          commandType: 'cards.moved',
          payload: {
            playerId: menu.playerId,
            fromZone: 'battlefield',
            toZone: 'battlefield',
            instanceIds: targets.map((item) => item.card.instanceId),
            targetPlayerId,
          },
        });
      } else {
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
      }
      context.closeContextMenu();
      return;
    }

    const firstTarget = targets[0] ?? { playerId: menu.playerId, zone: menu.zone, card: menu.card };
    const instanceIds = targets.map((item) => item.card.instanceId);
    const isMultiMove = instanceIds.length > 1;
    const payload: Record<string, unknown> = {
      playerId: firstTarget.playerId,
      fromZone: firstTarget.zone,
      toZone,
      targetPlayerId,
      ...(isMultiMove ? { instanceIds } : { instanceId: firstTarget.card.instanceId }),
      ...(!isMultiMove ? this.viewedLibrarySourcePayload(context, firstTarget.playerId, firstTarget.card) : {}),
    };

    if (toZone === 'battlefield') {
      context.setPendingBattlefieldMove({
        cardName: isMultiMove ? `${targets.length} cards` : firstTarget.card.name,
        targetPlayerName: context.playerName(targetPlayerId),
        payload: {
          ...payload,
        },
        commandType: isMultiMove ? 'cards.moved' : 'card.moved',
      });
      context.closeContextMenu();
      return;
    }

    await context.command(isMultiMove ? 'cards.moved' : 'card.moved', payload);
    await context.recordCommanderCastIfNeeded(firstTarget.playerId, firstTarget.zone, toZone);
    await context.syncOpenZoneModalAfterMove(firstTarget.playerId, firstTarget.zone, instanceIds);
    context.clearSelectedCards();
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

    const tapped = !menu.card.tapped;
    for (const item of this.actionTargets(context, menu)) {
      await context.command('card.tapped', {
        playerId: item.playerId,
        zone: item.zone,
        instanceId: item.card.instanceId,
        tapped,
      });
    }
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

    const faceDown = !menu.card.faceDown;
    for (const item of this.actionTargets(context, menu)) {
      await context.command('card.face_down.changed', {
        playerId: item.playerId,
        zone: item.zone,
        instanceId: item.card.instanceId,
        faceDown,
      });
    }
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

    for (const item of this.actionTargets(context, menu)) {
      const faceCount = item.card.cardFaces?.length ?? 0;
      if (faceCount < 2) {
        continue;
      }

      const currentIndex = Number.isInteger(item.card.activeFaceIndex) ? Number(item.card.activeFaceIndex) : 0;
      await context.command('card.face.changed', {
        playerId: item.playerId,
        zone: item.zone,
        instanceId: item.card.instanceId,
        faceIndex: (currentIndex + 1) % faceCount,
      });
    }
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

    for (const item of this.actionTargets(context, menu)) {
      await context.command('card.revealed', {
        playerId: item.playerId,
        zone: item.zone,
        instanceId: item.card.instanceId,
        to: target,
      });
    }
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

    for (const item of this.actionTargets(context, menu)) {
      await context.command('card.token_copy.created', {
        playerId: item.playerId,
        zone: item.zone,
        instanceId: item.card.instanceId,
        targetPlayerId: item.playerId,
      });
    }
    context.closeContextMenu();
  }

  private viewedLibrarySourcePayload(
    context: GameTableCardActionContext,
    playerId: string,
    card: GameCardInstance,
  ): { readonly sourceContext?: LibraryTopViewSourceContext } {
    const modal = context.zoneModal();
    if (
      !this.isFixedViewedLibraryCard(modal, playerId, card.instanceId)
    ) {
      return {};
    }

    return {
      sourceContext: {
        type: 'libraryTopView',
        count: Math.max(1, Math.floor(modal.viewTopCount ?? modal.total)),
      },
    };
  }

  private isFixedViewedLibraryCard(modal: ZoneModalState | null, playerId: string, instanceId: string): modal is ZoneModalState {
    return !!modal
      && modal.zone === 'library'
      && modal.playerId === playerId
      && !modal.showFilters
      && modal.cards.some((card) => card.instanceId === instanceId);
  }

  async createToken(context: GameTableCardActionContext, playerId: string, card: Card | null = null, quantity = 1): Promise<void> {
    if (!context.canControlPlayer(playerId)) {
      context.setError('You can only create tokens on your own battlefield.');
      context.closeContextMenu();
      return;
    }

    await context.command('card.token.created', {
      playerId,
      quantity,
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

  private actionTargets(
    context: Pick<GameTableCardActionContext, 'selectedCards'>,
    menu: GameContextMenu,
    zone?: GameZoneName,
  ): GameTableCardSelection[] {
    if (!menu.card) {
      return [];
    }

    const selected = context.selectedCards();
    const selectedHasMenuCard = selected.some((item) => item.card.instanceId === menu.card?.instanceId);
    const validSelection = selected.length > 1
      && selectedHasMenuCard
      && selected.every((item) => item.playerId === menu.playerId && item.zone === menu.zone && (!zone || item.zone === zone));

    return validSelection ? selected : [{ playerId: menu.playerId, zone: menu.zone, card: menu.card }];
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
      ...this.viewedLibrarySourcePayload(context, modal.playerId, card),
    });
    await context.recordCommanderCastIfNeeded(modal.playerId, modal.zone, toZone);
    await context.syncOpenZoneModalAfterMove(modal.playerId, modal.zone, [card.instanceId]);
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
