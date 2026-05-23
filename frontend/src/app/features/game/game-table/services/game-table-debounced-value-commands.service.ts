import { Injectable } from '@angular/core';
import { GameCommandType, GameSnapshot } from '../../../../core/models/game.model';

export const GAME_TABLE_VALUE_COMMAND_DEBOUNCE_MS = 450;

interface PendingLifeCommand {
  playerId: string;
  life: number;
}

interface PendingCommanderDamageCommand {
  targetPlayerId: string;
  sourcePlayerId: string;
  damage: number;
}

interface PendingCounterCommand {
  scope: string;
  key: string;
  value: number;
}

export interface GameTableDebouncedValueCommandContext {
  gameId: () => string;
  pending: () => boolean;
  setPending: (pending: boolean) => void;
  setError: (message: string | null) => void;
  send: (type: GameCommandType, payload: Record<string, unknown>) => Promise<boolean>;
  snapshot: () => GameSnapshot | null;
  setSnapshot: (snapshot: GameSnapshot | null) => void;
  refetch: () => Promise<void>;
  errorMessage: (error: unknown) => string;
}

@Injectable()
export class GameTableDebouncedValueCommandsService {
  private readonly flushDelayMs = GAME_TABLE_VALUE_COMMAND_DEBOUNCE_MS;
  private readonly retryDelayMs = 80;
  private readonly optimisticLifeCommands = new Map<string, PendingLifeCommand>();
  private readonly optimisticCommanderDamageCommands = new Map<string, PendingCommanderDamageCommand>();
  private readonly optimisticCounterCommands = new Map<string, PendingCounterCommand>();
  private readonly flushTimers = new Map<string, number>();

  lifeValue(snapshot: GameSnapshot | null, playerId: string): number {
    return Number(this.optimisticLifeCommands.get(playerId)?.life ?? snapshot?.players[playerId]?.life ?? 0);
  }

  commanderDamageValue(snapshot: GameSnapshot | null, targetPlayerId: string, sourcePlayerId: string): number {
    const key = this.commanderDamageCommandKey(targetPlayerId, sourcePlayerId);
    const command = this.optimisticCommanderDamageCommands.get(key);
    if (command) {
      return command.damage;
    }

    return Math.max(0, Number(snapshot?.players[targetPlayerId]?.commanderDamage?.[sourcePlayerId] ?? 0));
  }

  counterValue(scope: string, key: string, fallbackValue: number): number {
    const command = this.optimisticCounterCommands.get(this.counterCommandKey(scope, key));
    if (command) {
      return command.value;
    }

    return fallbackValue;
  }

  queueLife(context: GameTableDebouncedValueCommandContext, command: PendingLifeCommand): void {
    this.optimisticLifeCommands.set(command.playerId, command);
    this.updateLocalLife(context, command);
    this.scheduleFlush(this.lifeTimerKey(command.playerId), this.flushDelayMs, () => this.flushLife(context, command.playerId));
  }

  queueCommanderDamage(context: GameTableDebouncedValueCommandContext, command: PendingCommanderDamageCommand): void {
    const key = this.commanderDamageCommandKey(command.targetPlayerId, command.sourcePlayerId);
    this.optimisticCommanderDamageCommands.set(key, command);
    this.updateLocalCommanderDamage(context, command);
    this.scheduleFlush(this.commanderDamageTimerKey(key), this.flushDelayMs, () => this.flushCommanderDamage(context, key));
  }

  queueCounter(context: GameTableDebouncedValueCommandContext, command: PendingCounterCommand): void {
    const key = this.counterCommandKey(command.scope, command.key);
    this.optimisticCounterCommands.set(key, command);
    this.updateLocalCounter(context, command);
    this.scheduleFlush(this.counterTimerKey(key), this.flushDelayMs, () => this.flushCounter(context, key));
  }

  applyOptimisticValues(snapshot: GameSnapshot | null): GameSnapshot | null {
    const lifeSnapshot = this.applyOptimisticLifeCommands(snapshot);
    const commanderDamageSnapshot = this.applyOptimisticCommanderDamageCommands(lifeSnapshot);
    return this.applyOptimisticCounterCommands(commanderDamageSnapshot);
  }

  clear(): void {
    for (const timer of this.flushTimers.values()) {
      window.clearTimeout(timer);
    }
    this.flushTimers.clear();
    this.optimisticLifeCommands.clear();
    this.optimisticCommanderDamageCommands.clear();
    this.optimisticCounterCommands.clear();
  }

  private async flushLife(context: GameTableDebouncedValueCommandContext, playerId: string): Promise<void> {
    const command = this.optimisticLifeCommands.get(playerId);
    const gameId = context.gameId();
    if (!command || !gameId) {
      return;
    }
    if (context.pending()) {
      this.scheduleFlush(this.lifeTimerKey(playerId), this.retryDelayMs, () => this.flushLife(context, playerId));
      return;
    }

    context.setPending(true);
    context.setError(null);
    try {
      if (!await context.send('life.changed', {
        playerId: command.playerId,
        life: command.life,
      })) {
        throw new Error('WebSocket gameplay connection is not available.');
      }
      if (this.optimisticLifeCommands.get(playerId) === command) {
        this.optimisticLifeCommands.delete(playerId);
      }
    } catch (error) {
      if (this.optimisticLifeCommands.get(playerId) === command) {
        this.optimisticLifeCommands.delete(playerId);
      }
      context.setError(context.errorMessage(error));
      await context.refetch();
    } finally {
      context.setPending(false);
      if (this.optimisticLifeCommands.has(playerId)) {
        this.scheduleFlush(this.lifeTimerKey(playerId), this.retryDelayMs, () => this.flushLife(context, playerId));
      }
    }
  }

  private async flushCommanderDamage(context: GameTableDebouncedValueCommandContext, key: string): Promise<void> {
    const command = this.optimisticCommanderDamageCommands.get(key);
    const gameId = context.gameId();
    if (!command || !gameId) {
      return;
    }
    if (context.pending()) {
      this.scheduleFlush(this.commanderDamageTimerKey(key), this.retryDelayMs, () => this.flushCommanderDamage(context, key));
      return;
    }

    context.setPending(true);
    context.setError(null);
    try {
      if (!await context.send('commander.damage.changed', {
        targetPlayerId: command.targetPlayerId,
        sourcePlayerId: command.sourcePlayerId,
        damage: command.damage,
      })) {
        throw new Error('WebSocket gameplay connection is not available.');
      }
      if (this.optimisticCommanderDamageCommands.get(key) === command) {
        this.optimisticCommanderDamageCommands.delete(key);
      }
    } catch (error) {
      if (this.optimisticCommanderDamageCommands.get(key) === command) {
        this.optimisticCommanderDamageCommands.delete(key);
      }
      context.setError(context.errorMessage(error));
      await context.refetch();
    } finally {
      context.setPending(false);
      if (this.optimisticCommanderDamageCommands.has(key)) {
        this.scheduleFlush(this.commanderDamageTimerKey(key), this.retryDelayMs, () => this.flushCommanderDamage(context, key));
      }
    }
  }

  private async flushCounter(context: GameTableDebouncedValueCommandContext, key: string): Promise<void> {
    const command = this.optimisticCounterCommands.get(key);
    const gameId = context.gameId();
    if (!command || !gameId) {
      return;
    }
    if (context.pending()) {
      this.scheduleFlush(this.counterTimerKey(key), this.retryDelayMs, () => this.flushCounter(context, key));
      return;
    }

    context.setPending(true);
    context.setError(null);
    try {
      if (!await context.send('counter.changed', {
        scope: command.scope,
        key: command.key,
        value: command.value,
      })) {
        throw new Error('WebSocket gameplay connection is not available.');
      }
      if (this.optimisticCounterCommands.get(key) === command) {
        this.optimisticCounterCommands.delete(key);
      }
    } catch (error) {
      if (this.optimisticCounterCommands.get(key) === command) {
        this.optimisticCounterCommands.delete(key);
      }
      context.setError(context.errorMessage(error));
      await context.refetch();
    } finally {
      context.setPending(false);
      if (this.optimisticCounterCommands.has(key)) {
        this.scheduleFlush(this.counterTimerKey(key), this.retryDelayMs, () => this.flushCounter(context, key));
      }
    }
  }

  private updateLocalLife(context: GameTableDebouncedValueCommandContext, command: PendingLifeCommand): void {
    const snapshot = context.snapshot();
    if (!snapshot || !snapshot.players[command.playerId]) {
      return;
    }

    const next = structuredClone(snapshot);
    next.players[command.playerId]!.life = command.life;
    context.setSnapshot(next);
  }

  private updateLocalCommanderDamage(context: GameTableDebouncedValueCommandContext, command: PendingCommanderDamageCommand): void {
    const snapshot = context.snapshot();
    if (!snapshot || !snapshot.players[command.targetPlayerId]) {
      return;
    }

    const next = structuredClone(snapshot);
    const player = next.players[command.targetPlayerId]!;
    player.commanderDamage = { ...player.commanderDamage, [command.sourcePlayerId]: command.damage };
    context.setSnapshot(next);
  }

  private updateLocalCounter(context: GameTableDebouncedValueCommandContext, command: PendingCounterCommand): void {
    const snapshot = context.snapshot();
    if (!snapshot) {
      return;
    }

    const next = structuredClone(snapshot);
    if (this.applyCounterCommand(next, command)) {
      context.setSnapshot(next);
    }
  }

  private applyOptimisticLifeCommands(snapshot: GameSnapshot | null): GameSnapshot | null {
    if (!snapshot || this.optimisticLifeCommands.size === 0) {
      return snapshot;
    }

    const next = structuredClone(snapshot);
    let applied = false;
    for (const command of this.optimisticLifeCommands.values()) {
      const player = next.players[command.playerId];
      if (!player) {
        continue;
      }

      player.life = command.life;
      applied = true;
    }

    return applied ? next : snapshot;
  }

  private applyOptimisticCommanderDamageCommands(snapshot: GameSnapshot | null): GameSnapshot | null {
    if (!snapshot || this.optimisticCommanderDamageCommands.size === 0) {
      return snapshot;
    }

    const next = structuredClone(snapshot);
    let applied = false;
    for (const command of this.optimisticCommanderDamageCommands.values()) {
      const player = next.players[command.targetPlayerId];
      if (!player) {
        continue;
      }

      player.commanderDamage = { ...player.commanderDamage, [command.sourcePlayerId]: command.damage };
      applied = true;
    }

    return applied ? next : snapshot;
  }

  private applyOptimisticCounterCommands(snapshot: GameSnapshot | null): GameSnapshot | null {
    if (!snapshot || this.optimisticCounterCommands.size === 0) {
      return snapshot;
    }

    const next = structuredClone(snapshot);
    let applied = false;
    for (const command of this.optimisticCounterCommands.values()) {
      applied = this.applyCounterCommand(next, command) || applied;
    }

    return applied ? next : snapshot;
  }

  private applyCounterCommand(snapshot: GameSnapshot, command: PendingCounterCommand): boolean {
    const playerScopePrefix = 'player:';
    if (command.scope.startsWith(playerScopePrefix)) {
      const playerId = command.scope.slice(playerScopePrefix.length);
      const player = snapshot.players[playerId];
      if (!player) {
        return false;
      }

      player.counters = { ...player.counters, [command.key]: command.value };
      return true;
    }

    snapshot.counters = { ...(snapshot.counters ?? {}) };
    snapshot.counters[command.scope] = {
      ...(snapshot.counters[command.scope] ?? {}),
      [command.key]: command.value,
    };
    return true;
  }

  private scheduleFlush(key: string, delayMs: number, flush: () => Promise<void>): void {
    const existingTimer = this.flushTimers.get(key);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      this.flushTimers.delete(key);
      void flush();
    }, delayMs);
    this.flushTimers.set(key, timer);
  }

  private lifeTimerKey(playerId: string): string {
    return `life:${playerId}`;
  }

  private commanderDamageCommandKey(targetPlayerId: string, sourcePlayerId: string): string {
    return `${targetPlayerId}:${sourcePlayerId}`;
  }

  private commanderDamageTimerKey(key: string): string {
    return `commander-damage:${key}`;
  }

  private counterCommandKey(scope: string, key: string): string {
    return `${scope}:${key}`;
  }

  private counterTimerKey(key: string): string {
    return `counter:${key}`;
  }
}
