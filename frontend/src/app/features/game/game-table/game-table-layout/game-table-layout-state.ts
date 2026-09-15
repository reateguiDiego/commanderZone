import { DestroyRef, Injectable, computed, effect, inject, linkedSignal, signal } from '@angular/core';
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

interface GridViewport {
  readonly width: number;
  readonly height: number;
}

const GRID_MINIMUM_VIEWPORT_FOR_TWO_PLAYERS: GridViewport = {
  width: 1024,
  height: 720,
};
const GRID_MINIMUM_VIEWPORT_FOR_MULTIPLAYER: GridViewport = {
  width: 1280,
  height: 800,
};

@Injectable()
export class GameTableLayoutState {
  private readonly destroyRef = inject(DestroyRef);
  private readonly source = signal<LayoutPlayers | null>(null);
  private readonly viewport = signal<GridViewport | null>(null);
  private viewportObserver: ResizeObserver | null = null;
  private observedViewport: HTMLElement | null = null;
  private viewportResizeListener: (() => void) | null = null;
  readonly seats = computed(() => {
    const source = this.source();
    return source ? buildGridSeats(source.players(), source.currentPlayer()) : [];
  });
  readonly gridAvailable = computed(() => {
    const seats = this.seats();
    const viewport = this.viewport();
    if (seats.length === 0 || viewport === null) {
      return seats.length > 0;
    }

    const minimumViewport = seats.length <= 2
      ? GRID_MINIMUM_VIEWPORT_FOR_TWO_PLAYERS
      : GRID_MINIMUM_VIEWPORT_FOR_MULTIPLAYER;

    return viewport.width >= minimumViewport.width && viewport.height >= minimumViewport.height;
  });
  private readonly selectedMode = linkedSignal<boolean, BattlefieldViewLayout>({
    source: this.gridAvailable,
    computation: (available, previous) => (available ? (previous?.value ?? 'square') : 'square'),
  });
  readonly mode = this.selectedMode.asReadonly();
  private readonly rectangles = signal<ReadonlyMap<string, BattlefieldLayoutRect>>(new Map());

  constructor() {
    this.destroyRef.onDestroy(() => this.disconnectViewport());

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

  observeViewport(element: HTMLElement): void {
    if (this.observedViewport === element) {
      return;
    }

    this.disconnectViewport();
    this.observedViewport = element;
    this.syncViewportFrom(element);

    if (typeof window !== 'undefined') {
      this.viewportResizeListener = () => this.syncViewportFrom(element);
      window.addEventListener('resize', this.viewportResizeListener, { passive: true });
    }

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    this.viewportObserver = new ResizeObserver(() => this.syncViewportFrom(element));
    this.viewportObserver.observe(element);
  }

  updateViewport(width: number, height: number): void {
    const viewport = {
      width: Math.max(0, Math.floor(width)),
      height: Math.max(0, Math.floor(height)),
    };
    const previous = this.viewport();
    if (previous?.width === viewport.width && previous.height === viewport.height) {
      return;
    }

    this.viewport.set(viewport);
  }

  private syncViewportFrom(element: HTMLElement): void {
    if (typeof window !== 'undefined') {
      this.updateViewport(window.innerWidth, window.innerHeight);
      return;
    }

    const rect = element.getBoundingClientRect();
    this.updateViewport(rect.width, rect.height);
  }

  private disconnectViewport(): void {
    this.viewportObserver?.disconnect();
    this.viewportObserver = null;
    if (this.viewportResizeListener !== null && typeof window !== 'undefined') {
      window.removeEventListener('resize', this.viewportResizeListener);
    }
    this.viewportResizeListener = null;
    this.observedViewport = null;
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
