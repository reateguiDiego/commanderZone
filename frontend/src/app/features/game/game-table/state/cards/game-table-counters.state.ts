import { Injectable } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { GameTableDebouncedValueCommandsService } from '../../services/game-table-debounced-value-commands.service';
import { GameTableContextStore } from '../core/game-table-context.store';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTablePlayersStore } from '../players/game-table-players.store';
import { GameContextMenu, GameTableUiState } from '../core/game-table-ui.state';
import { GameTableCardsState } from './game-table-cards.state';

@Injectable()
export class GameTableCountersState {
  constructor(
    private readonly cardsState: GameTableCardsState,
    private readonly contextStore: GameTableContextStore,
    private readonly core: GameTableCoreState,
    private readonly debouncedValueCommands: GameTableDebouncedValueCommandsService,
    private readonly playersStore: GameTablePlayersStore,
    private readonly uiState: GameTableUiState,
  ) {}

  playerCounterValue(playerId: string, key: string): number {
    return this.debouncedValueCommands.counterValue(
      `player:${playerId}`,
      key,
      Math.max(0, Number(this.core.snapshot()?.players[playerId]?.counters?.[key] ?? 0)),
    );
  }

  async changePlayerCounter(playerId: string, key: string, delta: number): Promise<void> {
    if (!this.canControlPlayer(playerId)) {
      this.core.error.set('You can only change your own player counters.');
      return;
    }

    if (this.playerCounterValue(playerId, key) === 0 && delta < 0) {
      return;
    }

    const currentValue = this.playerCounterValue(playerId, key);
    const nextValue = Math.max(0, currentValue + delta);
    this.debouncedValueCommands.queueCounter(this.contextStore.debouncedValueCommand(), {
      scope: `player:${playerId}`,
      key,
      value: nextValue,
    });
  }

  async changeCommanderCastCount(playerId: string, delta: number): Promise<void> {
    const player = this.playersStore.players().find((candidate) => candidate.id === playerId);
    if (!player || !this.canControlPlayer(playerId)) {
      this.core.error.set('You can only change your own commander cast count.');
      return;
    }

    const currentCount = this.playersStore.commanderCastCount(player);
    const nextCount = Math.max(0, currentCount + delta);
    if (nextCount === currentCount) {
      return;
    }

    this.debouncedValueCommands.queueCounter(this.contextStore.debouncedValueCommand(), {
      scope: `commander:${playerId}`,
      key: 'casts',
      value: nextCount,
    });
  }

  async changeCardCounter(menu: GameContextMenu, key = '+1/+1', delta = 1): Promise<void> {
    if (!menu.card) {
      return;
    }

    await this.changeCardCounterForCard(menu.playerId, menu.zone, menu.card, key, delta);
    this.uiState.closeContextMenu();
  }

  async setCardCounter(menu: GameContextMenu, key: string, value: number): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!this.canControlPlayer(menu.playerId)) {
      this.core.error.set('You can only change your own cards.');
      this.uiState.closeContextMenu();
      return;
    }
    if (!this.cardsState.canAddCardCounter(menu.card, key)) {
      this.core.error.set('Maximum 5 different counters per card.');
      this.uiState.closeContextMenu();
      return;
    }

    this.cardsState.queueCardCounter(this.contextStore.cardCounter(), {
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      key,
      value: Math.max(0, value),
    });
    this.uiState.closeContextMenu();
  }

  async deleteCardCounter(menu: GameContextMenu): Promise<void> {
    if (menu.kind !== 'counter' || !menu.card || !menu.counterKey) {
      return;
    }
    await this.deleteCardCounterByKey(menu, menu.counterKey);
  }

  async deleteCardCounterByKey(menu: GameContextMenu, key: string): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!this.canControlPlayer(menu.playerId)) {
      this.core.error.set('You can only change your own cards.');
      this.uiState.closeContextMenu();
      return;
    }

    this.cardsState.queueCardCounter(this.contextStore.cardCounter(), {
      playerId: menu.playerId,
      zone: menu.zone,
      instanceId: menu.card.instanceId,
      key,
      value: null,
    });
    this.uiState.closeContextMenu();
  }

  async deleteAllCardCounters(menu: GameContextMenu): Promise<void> {
    if (!menu.card) {
      return;
    }
    if (!this.canControlPlayer(menu.playerId)) {
      this.core.error.set('You can only change your own cards.');
      this.uiState.closeContextMenu();
      return;
    }

    for (const key of Object.keys(menu.card.counters ?? {})) {
      this.cardsState.queueCardCounter(this.contextStore.cardCounter(), {
        playerId: menu.playerId,
        zone: menu.zone,
        instanceId: menu.card.instanceId,
        key,
        value: null,
      });
    }
    this.uiState.closeContextMenu();
  }

  async changeCardCounterForCard(
    playerId: string,
    zone: GameZoneName,
    card: GameCardInstance,
    key = '+1/+1',
    delta = 1,
  ): Promise<void> {
    if (!this.canControlPlayer(playerId)) {
      this.core.error.set('You can only change your own cards.');
      return;
    }
    if (!this.cardsState.canAddCardCounter(card, key)) {
      this.core.error.set('Maximum 5 different counters per card.');
      return;
    }

    const currentValue = this.cardsState.cardCounterValue(playerId, zone, card, key);
    const nextValue = Math.max(0, currentValue + delta);
    if (nextValue === currentValue) {
      return;
    }

    this.cardsState.queueCardCounter(this.contextStore.cardCounter(), {
      playerId,
      zone,
      instanceId: card.instanceId,
      key,
      value: nextValue,
    });
  }

  private canControlPlayer(playerId: string): boolean {
    return this.playersStore.canControlPlayer(playerId, this.contextStore.interaction());
  }
}
