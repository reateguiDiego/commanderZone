import { Injectable, computed, effect, linkedSignal, signal } from '@angular/core';
import type { PlayerView } from '../game-table.store';
import {
  buildGridSeats,
  type BattlefieldLayoutRect,
  type BattlefieldViewLayout,
  type PlayerBattlefieldSize,
} from './game-table-grid-seat.model';

interface LayoutPlayers {
  readonly players: () => readonly PlayerView[];
  readonly currentPlayer: () => PlayerView | null;
}

@Injectable()
export class GameTableLayoutState {
  private readonly source = signal<LayoutPlayers | null>(null);
  readonly seats = computed(() => {
    const source = this.source();
    return source ? buildGridSeats(source.players(), source.currentPlayer()) : [];
  });
  readonly gridAvailable = computed(() => this.seats().length > 0);
  private readonly selectedMode = linkedSignal<boolean, BattlefieldViewLayout>({
    source: this.gridAvailable,
    computation: (available, previous) => (available ? (previous?.value ?? 'square') : 'square'),
  });
  readonly mode = this.selectedMode.asReadonly();
  private readonly rectangles = signal<ReadonlyMap<string, BattlefieldLayoutRect>>(new Map());

  constructor() {
    // Measurements belong to mounted players and must not survive a room change.
    effect(() => {
      const ids = new Set(this.seats().map((seat) => seat.player.id));
      this.rectangles.update(
        (rectangles) => new Map([...rectangles].filter(([id]) => ids.has(id))),
      );
    });
  }

  connect(source: LayoutPlayers): void {
    this.source.set(source);
  }

  select(mode: BattlefieldViewLayout): void {
    this.selectedMode.set(mode === 'grid' && !this.gridAvailable() ? 'square' : mode);
  }

  rectangle(playerId: string): BattlefieldLayoutRect | null {
    return this.mode() === 'grid' ? (this.rectangles().get(playerId) ?? null) : null;
  }

  recordSize({ playerId, rect }: PlayerBattlefieldSize): void {
    if (!this.seats().some((seat) => seat.player.id === playerId)) {
      return;
    }
    const previous = this.rectangles().get(playerId);
    if (
      previous?.width === rect.width &&
      previous.height === rect.height &&
      previous.left === rect.left &&
      previous.top === rect.top &&
      previous.right === rect.right &&
      previous.bottom === rect.bottom
    ) {
      return;
    }
    this.rectangles.update((rectangles) => new Map(rectangles).set(playerId, rect));
  }
}
