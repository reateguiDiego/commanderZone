import { Injectable, signal } from '@angular/core';
import { ManaAddition, ManaPoolColor } from '../../utils/mana-source-detector';

export type ManaPool = Readonly<Record<ManaPoolColor, number> & { ANY: number }>;

const MAX_MANA_POOL_AMOUNT = 99;
const EMPTY_POOL: ManaPool = {
  ANY: 0,
  W: 0,
  U: 0,
  B: 0,
  R: 0,
  G: 0,
  C: 0,
};

@Injectable()
export class GameTableManaPoolState {
  private readonly pools = signal<Record<string, ManaPool>>({});

  pool(playerId: string): ManaPool {
    return this.pools()[playerId] ?? EMPTY_POOL;
  }

  add(playerId: string, additions: readonly ManaAddition[]): void {
    this.updatePool(playerId, (pool) => {
      const next = { ...pool };
      for (const addition of additions) {
        next[addition.color] = this.clampAmount(next[addition.color] + addition.amount);
      }

      return next;
    });
  }

  increment(playerId: string, color: ManaPoolColor): void {
    this.change(playerId, color, 1);
  }

  decrement(playerId: string, color: ManaPoolColor): void {
    this.change(playerId, color, -1);
  }

  incrementAny(playerId: string): void {
    this.changeAny(playerId, 1);
  }

  decrementAny(playerId: string): void {
    this.changeAny(playerId, -1);
  }

  resetColor(playerId: string, color: ManaPoolColor): void {
    this.updatePool(playerId, (pool) => ({ ...pool, [color]: 0 }));
  }

  resetAny(playerId: string): void {
    this.updatePool(playerId, (pool) => ({ ...pool, ANY: 0 }));
  }

  reset(playerId: string): void {
    this.pools.update((current) => ({ ...current, [playerId]: EMPTY_POOL }));
  }

  private change(playerId: string, color: ManaPoolColor, delta: number): void {
    this.updatePool(playerId, (pool) => ({ ...pool, [color]: this.clampAmount(pool[color] + delta) }));
  }

  private changeAny(playerId: string, delta: number): void {
    this.updatePool(playerId, (pool) => ({ ...pool, ANY: this.clampAmount(pool.ANY + delta) }));
  }

  private updatePool(playerId: string, update: (pool: ManaPool) => ManaPool): void {
    this.pools.update((current) => ({
      ...current,
      [playerId]: update(current[playerId] ?? EMPTY_POOL),
    }));
  }

  private clampAmount(value: number): number {
    return Math.max(0, Math.min(MAX_MANA_POOL_AMOUNT, Math.trunc(value)));
  }
}
