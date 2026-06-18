import { Injectable } from '@angular/core';
import { GameCardInstance, GameCardStatValue, GameCommandType, GameZoneName } from '../../../../core/models/game.model';

interface PendingPowerToughnessChange {
  playerId: string;
  zone: GameZoneName;
  instanceId: string;
  power: number;
  toughness: number;
}

interface PendingLoyaltyChange {
  playerId: string;
  zone: GameZoneName;
  instanceId: string;
  loyalty: number;
}

interface PendingBattleChange {
  playerId: string;
  zone: GameZoneName;
  instanceId: string;
  defense: number;
}

interface PendingSagaChange {
  playerId: string;
  zone: GameZoneName;
  instanceId: string;
  saga: number;
}

export interface GameTableCardStatsContext {
  canControlOwnedCard(playerId: string, card: GameCardInstance): boolean;
  findCard(playerId: string, zone: GameZoneName, instanceId: string): GameCardInstance | null;
  updateLocalCardPowerToughness(playerId: string, zone: GameZoneName, instanceId: string, power: number, toughness: number): void;
  updateLocalCardBattleValue(playerId: string, zone: GameZoneName, instanceId: string, defense: number): void;
  updateLocalCardSagaValue(playerId: string, zone: GameZoneName, instanceId: string, saga: number): void;
  updateLocalCardLoyalty(playerId: string, zone: GameZoneName, instanceId: string, loyalty: number): void;
  setError(message: string): void;
  command(type: GameCommandType, payload: Record<string, unknown>, force?: boolean): Promise<void>;
}

@Injectable()
export class GameTableCardStatsService {
  private readonly debounceMs = 450;
  private readonly timers = new Map<string, number>();
  private readonly pendingChanges = new Map<string, PendingPowerToughnessChange>();
  private readonly pendingBattleChanges = new Map<string, PendingBattleChange>();
  private readonly pendingSagaChanges = new Map<string, PendingSagaChange>();
  private readonly pendingLoyaltyChanges = new Map<string, PendingLoyaltyChange>();

  async changePower(context: GameTableCardStatsContext, playerId: string, zone: GameZoneName, card: GameCardInstance, delta: number): Promise<void> {
    await this.changePowerToughness(context, playerId, zone, card, 'power', delta);
  }

  async changeToughness(context: GameTableCardStatsContext, playerId: string, zone: GameZoneName, card: GameCardInstance, delta: number): Promise<void> {
    await this.changePowerToughness(context, playerId, zone, card, 'toughness', delta);
  }

  async changeBattle(context: GameTableCardStatsContext, playerId: string, zone: GameZoneName, card: GameCardInstance, delta: number): Promise<void> {
    if (!context.canControlOwnedCard(playerId, card)) {
      context.setError('You can only change your own cards.');
      return;
    }

    const key = this.battleKey(playerId, zone, card.instanceId);
    const pendingChange = this.pendingBattleChanges.get(key);
    const currentCard = context.findCard(playerId, zone, card.instanceId) ?? card;
    const currentDefense = pendingChange?.defense ?? this.numericStat(currentCard.defense) ?? this.numericStat(currentCard.defaultDefense) ?? 0;
    const nextDefense = Math.max(-1, Math.min(99, currentDefense + delta));

    context.updateLocalCardBattleValue(playerId, zone, card.instanceId, nextDefense);
    this.pendingBattleChanges.set(key, {
      playerId,
      zone,
      instanceId: card.instanceId,
      defense: nextDefense,
    });
    this.scheduleFlush(key, () => void this.flushBattleChange(context, key));
  }

  async changeSaga(context: GameTableCardStatsContext, playerId: string, zone: GameZoneName, card: GameCardInstance, delta: number): Promise<void> {
    if (!context.canControlOwnedCard(playerId, card)) {
      context.setError('You can only change your own cards.');
      return;
    }

    const key = this.sagaKey(playerId, zone, card.instanceId);
    const pendingChange = this.pendingSagaChanges.get(key);
    const currentCard = context.findCard(playerId, zone, card.instanceId) ?? card;
    const currentSaga = pendingChange?.saga ?? currentCard.saga ?? 1;
    const nextSaga = Math.max(1, Math.min(9, currentSaga + delta));

    context.updateLocalCardSagaValue(playerId, zone, card.instanceId, nextSaga);
    this.pendingSagaChanges.set(key, {
      playerId,
      zone,
      instanceId: card.instanceId,
      saga: nextSaga,
    });
    this.scheduleFlush(key, () => void this.flushSagaChange(context, key));
  }

  async changeLoyalty(context: GameTableCardStatsContext, playerId: string, zone: GameZoneName, card: GameCardInstance, delta: number): Promise<void> {
    if (!context.canControlOwnedCard(playerId, card)) {
      context.setError('You can only change your own cards.');
      return;
    }

    const key = this.loyaltyKey(playerId, zone, card.instanceId);
    const currentCard = context.findCard(playerId, zone, card.instanceId) ?? card;
    const currentLoyalty = this.pendingLoyaltyChanges.get(key)?.loyalty ?? this.numericStat(currentCard.loyalty) ?? this.numericStat(currentCard.defaultLoyalty) ?? 0;
    const nextLoyalty = currentLoyalty + delta;

    context.updateLocalCardLoyalty(playerId, zone, card.instanceId, nextLoyalty);
    this.pendingLoyaltyChanges.set(key, {
      playerId,
      zone,
      instanceId: card.instanceId,
      loyalty: nextLoyalty,
    });
    this.scheduleFlush(key, () => void this.flushLoyaltyChange(context, key));
  }

  clear(): void {
    for (const timer of this.timers.values()) {
      window.clearTimeout(timer);
    }
    this.timers.clear();
    this.pendingChanges.clear();
    this.pendingBattleChanges.clear();
    this.pendingSagaChanges.clear();
    this.pendingLoyaltyChanges.clear();
  }

  private async changePowerToughness(
    context: GameTableCardStatsContext,
    playerId: string,
    zone: GameZoneName,
    card: GameCardInstance,
    stat: 'power' | 'toughness',
    delta: number,
  ): Promise<void> {
    if (!context.canControlOwnedCard(playerId, card)) {
      context.setError('You can only change your own cards.');
      return;
    }

    const key = this.powerToughnessKey(playerId, zone, card.instanceId);
    const pendingChange = this.pendingChanges.get(key);
    const currentCard = context.findCard(playerId, zone, card.instanceId) ?? card;
    const currentPower = pendingChange?.power ?? this.numericStat(currentCard.power) ?? this.numericStat(currentCard.defaultPower) ?? 0;
    const currentToughness = pendingChange?.toughness ?? this.numericStat(currentCard.toughness) ?? this.numericStat(currentCard.defaultToughness) ?? 0;
    const nextPower = stat === 'power' ? currentPower + delta : currentPower;
    const nextToughness = stat === 'toughness' ? currentToughness + delta : currentToughness;

    context.updateLocalCardPowerToughness(playerId, zone, card.instanceId, nextPower, nextToughness);
    this.pendingChanges.set(key, {
      playerId,
      zone,
      instanceId: card.instanceId,
      power: nextPower,
      toughness: nextToughness,
    });
    this.scheduleFlush(key, () => void this.flushPowerToughnessChange(context, key));
  }

  private async flushPowerToughnessChange(context: GameTableCardStatsContext, key: string): Promise<void> {
    const change = this.pendingChanges.get(key);
    this.pendingChanges.delete(key);
    this.timers.delete(key);
    if (!change) {
      return;
    }

    await context.command('card.power_toughness.changed', {
      playerId: change.playerId,
      zone: change.zone,
      instanceId: change.instanceId,
      power: change.power,
      toughness: change.toughness,
    }, true);
  }

  private async flushBattleChange(context: GameTableCardStatsContext, key: string): Promise<void> {
    const change = this.pendingBattleChanges.get(key);
    this.pendingBattleChanges.delete(key);
    this.timers.delete(key);
    if (!change) {
      return;
    }

    await context.command('card.power_toughness.changed', {
      playerId: change.playerId,
      zone: change.zone,
      instanceId: change.instanceId,
      defense: change.defense,
    }, true);
  }

  private async flushSagaChange(context: GameTableCardStatsContext, key: string): Promise<void> {
    const change = this.pendingSagaChanges.get(key);
    this.pendingSagaChanges.delete(key);
    this.timers.delete(key);
    if (!change) {
      return;
    }

    await context.command('card.power_toughness.changed', {
      playerId: change.playerId,
      zone: change.zone,
      instanceId: change.instanceId,
      saga: change.saga,
    }, true);
  }

  private async flushLoyaltyChange(context: GameTableCardStatsContext, key: string): Promise<void> {
    const change = this.pendingLoyaltyChanges.get(key);
    this.pendingLoyaltyChanges.delete(key);
    this.timers.delete(key);
    if (!change) {
      return;
    }

    await context.command('card.power_toughness.changed', {
      playerId: change.playerId,
      zone: change.zone,
      instanceId: change.instanceId,
      loyalty: change.loyalty,
    }, true);
  }

  private scheduleFlush(key: string, flush: () => void): void {
    const currentTimer = this.timers.get(key);
    if (currentTimer !== undefined) {
      window.clearTimeout(currentTimer);
    }
    this.timers.set(key, window.setTimeout(flush, this.debounceMs));
  }

  private numericStat(value: GameCardStatValue | undefined): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  private powerToughnessKey(playerId: string, zone: GameZoneName, instanceId: string): string {
    return `pt:${playerId}:${zone}:${instanceId}`;
  }

  private loyaltyKey(playerId: string, zone: GameZoneName, instanceId: string): string {
    return `loyalty:${playerId}:${zone}:${instanceId}`;
  }

  private battleKey(playerId: string, zone: GameZoneName, instanceId: string): string {
    return `battle:${playerId}:${zone}:${instanceId}`;
  }

  private sagaKey(playerId: string, zone: GameZoneName, instanceId: string): string {
    return `saga:${playerId}:${zone}:${instanceId}`;
  }
}
