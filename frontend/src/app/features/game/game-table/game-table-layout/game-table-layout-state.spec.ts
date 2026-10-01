import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PlayerView } from '../game-table.store';
import { GRID_RENDER_MEMO_STORAGE_KEY } from './game-table-grid-render-memo';
import {
  GameTableLayoutState,
  pruneInactiveBattlefieldLayoutRectangles,
} from './game-table-layout-state';

describe('GameTableLayoutState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('keeps the rectangle map reference when every measured player remains mounted', () => {
    const localRect = rect(0);
    const opponentRect = rect(320);
    const rectangles = new Map([
      ['local', localRect],
      ['opponent', opponentRect],
    ]);

    const retained = pruneInactiveBattlefieldLayoutRectangles(
      rectangles,
      new Set(['local', 'opponent']),
    );
    const pruned = pruneInactiveBattlefieldLayoutRectangles(rectangles, new Set(['local']));

    expect(retained).toBe(rectangles);
    expect(pruned).not.toBe(rectangles);
    expect([...pruned.entries()]).toEqual([['local', localRect]]);
  });

  it('retains untouched GridSeat references only when the experiment is enabled', () => {
    localStorage.setItem(GRID_RENDER_MEMO_STORAGE_KEY, '1');
    TestBed.configureTestingModule({ providers: [GameTableLayoutState] });
    const layout = TestBed.inject(GameTableLayoutState);
    const local = player('local');
    const opponent = player('opponent');
    const players = signal<readonly PlayerView[]>([local, opponent]);
    layout.connect({
      gameId: () => 'game-1',
      players,
      currentPlayer: () => players()[0] ?? null,
    });
    const previousSeats = layout.seats();

    players.set([withLife(local, 39), opponent]);
    const nextSeats = layout.seats();

    expect(nextSeats.find((seat) => seat.player.id === 'local')).not.toBe(
      previousSeats.find((seat) => seat.player.id === 'local'),
    );
    expect(nextSeats.find((seat) => seat.player.id === 'opponent')).toBe(
      previousSeats.find((seat) => seat.player.id === 'opponent'),
    );
  });

  it('keeps the original fresh GridSeat allocation while the experiment is disabled', () => {
    TestBed.configureTestingModule({ providers: [GameTableLayoutState] });
    const layout = TestBed.inject(GameTableLayoutState);
    const local = player('local');
    const opponent = player('opponent');
    const players = signal<readonly PlayerView[]>([local, opponent]);
    layout.connect({
      gameId: () => 'game-1',
      players,
      currentPlayer: () => players()[0] ?? null,
    });
    const previousSeats = layout.seats();

    players.set([withLife(local, 39), opponent]);
    const nextSeats = layout.seats();

    expect(nextSeats.find((seat) => seat.player.id === 'opponent')).not.toBe(
      previousSeats.find((seat) => seat.player.id === 'opponent'),
    );
  });
});

function player(id: string): PlayerView {
  return {
    id,
    state: {
      user: { id, displayName: id, email: `${id}@example.test`, roles: [] },
      status: 'active',
      life: 40,
      commanderDamage: {},
      counters: {},
      zones: { library: [], hand: [], battlefield: [], command: [], exile: [], graveyard: [] },
    },
  };
}

function withLife(source: PlayerView, life: number): PlayerView {
  return {
    ...source,
    state: { ...source.state, life },
  };
}

function rect(left: number): {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
} {
  return { width: 300, height: 200, left, top: 0, right: left + 300, bottom: 200 };
}
