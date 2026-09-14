import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PlayerView } from '../game-table.store';
import { GameTableGridLayoutComponent } from './game-table-grid-layout.component';
import { buildGridSeats } from './game-table-grid-seat.model';
import { GameTableLayoutState } from './game-table-layout-state';

@Component({
  imports: [GameTableGridLayoutComponent],
  template: `
    <ng-template #region let-player>{{ player.id }}</ng-template>
    <app-game-table-grid-layout
      [seats]="seats()"
      [activePlayerId]="'local'"
      [regions]="{ battlefield: region, hand: region, zones: region }"
    />
  `,
})
class GridHost {
  readonly seats = signal(buildGridSeats([player('local')], player('local')));
}

describe('GameTable grid layout', () => {
  it('assigns stable areas for one to four players and rejects incompatible tables', async () => {
    await TestBed.configureTestingModule({ imports: [GridHost] }).compileComponents();
    const fixture = TestBed.createComponent(GridHost);
    for (const count of [1, 2, 3, 4]) {
      const players = [
        player('local'),
        ...Array.from({ length: count - 1 }, (_, i) => player(`opponent-${i + 1}`)),
      ];
      const seats = buildGridSeats(players, players[0]);
      fixture.componentInstance.seats.set(seats);
      fixture.detectChanges();
      const cells = [...(fixture.nativeElement as HTMLElement).querySelectorAll('[data-seat]')];
      expect(cells.map((cell) => cell.getAttribute('data-seat'))).toEqual([
        ...players.slice(1).map((p) => p.id),
        'current',
      ]);
      expect(
        cells
          .filter((cell) => cell.classList.contains('is-top-row'))
          .map((cell) => cell.getAttribute('data-seat')),
      ).toEqual(count === 1 ? [] : count === 2 ? ['opponent-1'] : ['opponent-1', 'opponent-2']);
      expect(cells.at(-1)?.getAttribute('data-player-id')).toBe('local');
      expect(fixture.nativeElement.querySelector(`.grid--${count}-players`)).not.toBeNull();
      players[0].state.status = 'conceded';
      expect(buildGridSeats(players, players[0]).map((seat) => seat.player.id)).toEqual(
        seats.map((seat) => seat.player.id),
      );
    }
    const five = ['local', 'a', 'b', 'c', 'd'].map(player);
    expect(buildGridSeats(five, five[0])).toEqual([]);
    expect(buildGridSeats(five.slice(0, 2), null)).toEqual([]);
    expect(buildGridSeats(five.slice(0, 2), player('missing'))).toEqual([]);
    fixture.componentInstance.seats.set(buildGridSeats(five, five[0]));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="game-table-grid"]')).toBeNull();
  });

  it('falls back to Square and removes departed players’ measurements without restoring Grid automatically', () => {
    TestBed.configureTestingModule({ providers: [GameTableLayoutState] });
    const layout = TestBed.inject(GameTableLayoutState);
    const players = signal(['local', 'opponent'].map(player));
    layout.connect({ players, currentPlayer: () => players()[0] });
    layout.select('grid');
    TestBed.tick();
    const rect = { width: 400, height: 200, left: 0, right: 400, top: 0, bottom: 200 };
    layout.recordSize({ playerId: 'opponent', rect });
    expect(layout.rectangle('opponent')).toEqual(rect);
    players.set(['local', 'a', 'b', 'c', 'd'].map(player));
    expect(layout.mode()).toBe('square');
    TestBed.tick();
    players.set(['local', 'opponent'].map(player));
    expect(layout.mode()).toBe('square');
    layout.select('grid');
    expect(layout.rectangle('opponent')).toBeNull();
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
