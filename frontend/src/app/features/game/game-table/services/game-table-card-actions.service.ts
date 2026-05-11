import { Injectable } from '@angular/core';
import { GameCardInstance, GameCommandType, GameZoneName } from '../../../../core/models/game.model';
import { GameContextMenu } from '../state/game-table-ui.state';
import { ZoneModalState } from '../state/game-table-zone-modal.state';

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
  loadZone(): Promise<void>;
  setError(message: string): void;
  closeContextMenu(): void;
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

  async moveCard(context: GameTableCardActionContext, menu: GameContextMenu, toZone: GameZoneName): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!context.canControlPlayer(menu.playerId)) {
      context.setError('You can only move your own cards.');
      context.closeContextMenu();
      return;
    }

    await context.command('card.moved', {
      playerId: menu.playerId,
      fromZone: menu.zone,
      toZone,
      instanceId: menu.card.instanceId,
    });
    await context.recordCommanderCastIfNeeded(menu.playerId, menu.zone, toZone);
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

    await context.command('cards.moved', {
      playerId: first.playerId,
      fromZone: first.zone,
      toZone,
      instanceIds: selected.map((item) => item.card.instanceId),
    });
    context.clearSelectedCards();
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

  async revealCard(context: GameTableCardActionContext, menu: GameContextMenu): Promise<void> {
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
      to: 'all',
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
