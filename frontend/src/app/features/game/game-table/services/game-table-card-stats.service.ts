import { Injectable } from '@angular/core';
import { GameCardInstance, GameCommandType, GameZoneName } from '../../../../core/models/game.model';

interface PendingPowerToughnessChange {
  playerId: string;
  zone: GameZoneName;
  instanceId: string;
  power: number;
  toughness: number;
}

export interface GameTableCardStatsContext {
  canControlOwnedCard(playerId: string, card: GameCardInstance): boolean;
  findCard(playerId: string, zone: GameZoneName, instanceId: string): GameCardInstance | null;
  updateLocalCardPowerToughness(playerId: string, zone: GameZoneName, instanceId: string, power: number, toughness: number): void;
  setError(message: string): void;
  command(type: GameCommandType, payload: Record<string, unknown>, force?: boolean): Promise<void>;
}

@Injectable()
export class GameTableCardStatsService {
  private readonly debounceMs = 450;
  private readonly timers = new Map<string, number>();
  private readonly pendingChanges = new Map<string, PendingPowerToughnessChange>();

  async changePower(context: GameTableCardStatsContext, playerId: string, zone: GameZoneName, card: GameCardInstance, delta: number): Promise<void> {
    await this.changePowerToughness(context, playerId, zone, card, 'power', delta);
  }

  async changeToughness(context: GameTableCardStatsContext, playerId: string, zone: GameZoneName, card: GameCardInstance, delta: number): Promise<void> {
    await this.changePowerToughness(context, playerId, zone, card, 'toughness', delta);
  }

  clear(): void {
    for (const timer of this.timers.values()) {
      window.clearTimeout(timer);
    }
    this.timers.clear();
    this.pendingChanges.clear();
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

    const currentCard = context.findCard(playerId, zone, card.instanceId) ?? card;
    const currentPower = currentCard.power ?? 0;
    const currentToughness = currentCard.toughness ?? 0;
    const nextPower = stat === 'power' ? currentPower + delta : currentPower;
    const nextToughness = stat === 'toughness' ? currentToughness + delta : currentToughness;
    const key = this.powerToughnessKey(playerId, zone, card.instanceId);

    context.updateLocalCardPowerToughness(playerId, zone, card.instanceId, nextPower, nextToughness);
    this.pendingChanges.set(key, {
      playerId,
      zone,
      instanceId: card.instanceId,
      power: nextPower,
      toughness: nextToughness,
    });
    const currentTimer = this.timers.get(key);
    if (currentTimer !== undefined) {
      window.clearTimeout(currentTimer);
    }
    this.timers.set(key, window.setTimeout(() => void this.flushPowerToughnessChange(context, key), this.debounceMs));
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

  private powerToughnessKey(playerId: string, zone: GameZoneName, instanceId: string): string {
    return `${playerId}:${zone}:${instanceId}`;
  }
}
