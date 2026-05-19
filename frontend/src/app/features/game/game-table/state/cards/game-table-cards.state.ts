import { inject, Injectable } from '@angular/core';
import { GameCardInstance, GameSnapshot, GameZoneName } from '../../../../../core/models/game.model';
import { PendingCardCounterCommand } from '../../models/game-table-card.model';
import { GameTableCommandService } from '../../services/game-table-command.service';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTableSnapshotSelectors, PlayerView } from '../core/game-table-snapshot-selectors';

export interface GameTableCardCounterContext {
  readonly setSnapshot: (snapshot: GameSnapshot | null) => void;
  readonly errorMessage: (error: unknown) => string;
  readonly refetch: (force: boolean) => Promise<void>;
}

@Injectable()
export class GameTableCardsState {
  private readonly maxDistinctCardCounters = 5;
  private readonly cardCounterFlushDelayMs = 450;
  private readonly counterFlushRetryMs = 80;
  private readonly commands = inject(GameTableCommandService);
  private readonly optimisticCardCounters = new Map<string, PendingCardCounterCommand>();
  private readonly cardCounterFlushTimers = new Map<string, number>();

  constructor(
    private readonly core: GameTableCoreState,
    private readonly selectors: GameTableSnapshotSelectors,
  ) {}

  cardImage(card: GameCardInstance): string | null {
    return this.selectors.cardImage(card, this.core.snapshot());
  }

  publicCardImage(card: GameCardInstance): string | null {
    return this.selectors.publicCardImage(card);
  }

  cardBackImage(player?: PlayerView | null): string {
    return this.selectors.cardBackImage(player?.state.sleevesName);
  }

  shouldShowCardBack(card: GameCardInstance): boolean {
    return this.selectors.shouldShowCardBack(card);
  }

  firstCounter(card: GameCardInstance): { key: string; value: number } | null {
    return this.selectors.firstCounter(card);
  }

  hasPowerToughness(card: GameCardInstance): boolean {
    return this.selectors.hasPowerToughness(card);
  }

  shouldShowPowerToughness(card: GameCardInstance): boolean {
    return this.selectors.shouldShowPowerToughness(card);
  }

  cardPowerValue(card: GameCardInstance): number | null {
    return this.selectors.cardPowerValue(card);
  }

  cardToughnessValue(card: GameCardInstance): number | null {
    return this.selectors.cardToughnessValue(card);
  }

  countItems(count: number): number[] {
    return this.selectors.countItems(count);
  }

  canAddCardCounter(card: GameCardInstance, key: string): boolean {
    return this.hasCardCounter(card, key) || this.countCardCounters(card) < this.maxDistinctCardCounters;
  }

  cardCounterValue(playerId: string, zone: GameZoneName, card: GameCardInstance, key: string): number {
    const command = this.optimisticCardCounters.get(this.cardCounterCommandKey(playerId, zone, card.instanceId, key));
    if (command) {
      return Math.max(0, Number(command.value ?? 0));
    }

    return Math.max(0, Number(card.counters?.[key] ?? 0));
  }

  queueCardCounter(context: GameTableCardCounterContext, command: PendingCardCounterCommand): void {
    const key = this.cardCounterCommandKey(command.playerId, command.zone, command.instanceId, command.key);
    this.optimisticCardCounters.set(key, command);
    this.updateLocalCardCounter(context, command);
    this.scheduleCardCounterFlush(context, key, this.cardCounterFlushDelayMs);
  }

  applyOptimisticCardCounters(snapshot: GameSnapshot | null): GameSnapshot | null {
    if (!snapshot || this.optimisticCardCounters.size === 0) {
      return snapshot;
    }

    const next = structuredClone(snapshot);
    let applied = false;
    for (const command of this.optimisticCardCounters.values()) {
      const card = next.players[command.playerId]?.zones[command.zone]?.find((candidate) => candidate.instanceId === command.instanceId);
      if (!card) {
        continue;
      }

      this.applyCardCounterValue(card, command.key, command.value);
      applied = true;
    }

    return applied ? next : snapshot;
  }

  clearCardCounterFlushTimers(): void {
    for (const timer of this.cardCounterFlushTimers.values()) {
      window.clearTimeout(timer);
    }
    this.cardCounterFlushTimers.clear();
    this.optimisticCardCounters.clear();
  }

  private hasCardCounter(card: GameCardInstance, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(card.counters ?? {}, key);
  }

  private countCardCounters(card: GameCardInstance): number {
    return Object.keys(card.counters ?? {}).filter((key) => Number(card.counters?.[key] ?? 0) >= 0).length;
  }

  private scheduleCardCounterFlush(context: GameTableCardCounterContext, key: string, delayMs: number): void {
    const existing = this.cardCounterFlushTimers.get(key);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }

    const timer = window.setTimeout(() => {
      this.cardCounterFlushTimers.delete(key);
      void this.flushCardCounter(context, key);
    }, delayMs);
    this.cardCounterFlushTimers.set(key, timer);
  }

  private async flushCardCounter(context: GameTableCardCounterContext, key: string): Promise<void> {
    const command = this.optimisticCardCounters.get(key);
    const gameId = this.core.gameId();
    if (!command || !gameId) {
      return;
    }

    if (this.core.pending()) {
      this.scheduleCardCounterFlush(context, key, this.counterFlushRetryMs);
      return;
    }

    this.core.pending.set(true);
    this.core.error.set(null);
    try {
      const snapshot = await this.commands.send(gameId, 'card.counter.changed', {
        playerId: command.playerId,
        zone: command.zone,
        instanceId: command.instanceId,
        key: command.key,
        ...(command.value === null ? { remove: true } : { value: command.value }),
      });
      if (this.optimisticCardCounters.get(key) === command) {
        this.optimisticCardCounters.delete(key);
      }
      context.setSnapshot(snapshot);
    } catch (error) {
      if (this.optimisticCardCounters.get(key) === command) {
        this.optimisticCardCounters.delete(key);
      }
      this.core.error.set(context.errorMessage(error));
      await context.refetch(true);
    } finally {
      this.core.pending.set(false);
      if (this.optimisticCardCounters.has(key)) {
        this.scheduleCardCounterFlush(context, key, this.counterFlushRetryMs);
      }
    }
  }

  private updateLocalCardCounter(context: GameTableCardCounterContext, command: PendingCardCounterCommand): void {
    const snapshot = this.core.snapshot();
    if (!snapshot) {
      return;
    }

    const next = structuredClone(snapshot);
    const card = next.players[command.playerId]?.zones[command.zone]?.find((candidate) => candidate.instanceId === command.instanceId);
    if (!card) {
      return;
    }

    this.applyCardCounterValue(card, command.key, command.value);
    context.setSnapshot(next);
  }

  private cardCounterCommandKey(playerId: string, zone: GameZoneName, instanceId: string, key: string): string {
    return `${playerId}:${zone}:${instanceId}:${key}`;
  }

  private applyCardCounterValue(card: GameCardInstance, key: string, value: number | null): void {
    const nextValue = Math.max(0, Number(value ?? 0));
    const counters = { ...(card.counters ?? {}) };
    const previousValue = Number(counters[key] ?? 0);
    if (nextValue <= 0) {
      delete counters[key];
    } else {
      counters[key] = nextValue;
    }

    card.counters = counters;
    this.applyStatCounterDelta(card, key, nextValue - previousValue);
  }

  private applyStatCounterDelta(card: GameCardInstance, key: string, delta: number): void {
    if (delta === 0 || key !== '+1/+1' && key !== '-1/-1') {
      return;
    }

    const modifier = key === '+1/+1' ? 1 : -1;
    const powerBase = Number.isFinite(Number(card.power)) ? Number(card.power) : Number(card.defaultPower ?? 0);
    const toughnessBase = Number.isFinite(Number(card.toughness)) ? Number(card.toughness) : Number(card.defaultToughness ?? 0);
    card.power = powerBase + (delta * modifier);
    card.toughness = toughnessBase + (delta * modifier);
  }
}
