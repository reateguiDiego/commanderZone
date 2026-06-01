import { TestBed } from '@angular/core/testing';
import { GameTableManaPoolState } from './game-table-mana-pool.state';

describe('GameTableManaPoolState', () => {
  let state: GameTableManaPoolState;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [GameTableManaPoolState],
    });
    state = TestBed.inject(GameTableManaPoolState);
  });

  it('starts every player with an empty pool', () => {
    expect(state.pool('player-1')).toEqual({ ANY: 0, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
  });

  it('adds and removes mana without going below zero', () => {
    state.increment('player-1', 'G');
    state.add('player-1', [{ color: 'C', amount: 2 }]);
    state.decrement('player-1', 'G');
    state.decrement('player-1', 'G');

    expect(state.pool('player-1')).toEqual({ ANY: 0, W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 });
  });

  it('caps mana amounts at 99', () => {
    state.add('player-1', [{ color: 'G', amount: 120 }]);
    state.add('player-1', [{ color: 'C', amount: 98 }]);
    state.increment('player-1', 'C');
    state.increment('player-1', 'C');
    Array.from({ length: 120 }).forEach(() => state.incrementAny('player-1'));

    expect(state.pool('player-1').G).toBe(99);
    expect(state.pool('player-1').C).toBe(99);
    expect(state.pool('player-1').ANY).toBe(99);
  });

  it('adds and removes any color without going below zero', () => {
    state.incrementAny('player-1');
    state.decrementAny('player-1');
    state.decrementAny('player-1');

    expect(state.pool('player-1').ANY).toBe(0);
  });

  it('resets a single color, any color, and the whole pool', () => {
    state.add('player-1', [{ color: 'U', amount: 1 }, { color: 'R', amount: 3 }]);
    state.incrementAny('player-1');
    state.resetColor('player-1', 'R');
    state.resetAny('player-1');

    expect(state.pool('player-1').R).toBe(0);
    expect(state.pool('player-1').U).toBe(1);
    expect(state.pool('player-1').ANY).toBe(0);

    state.reset('player-1');

    expect(state.pool('player-1')).toEqual({ ANY: 0, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
  });

  it('keeps player pools isolated', () => {
    state.add('player-1', [{ color: 'B', amount: 2 }]);
    state.incrementAny('player-1');
    state.add('player-2', [{ color: 'W', amount: 1 }]);

    expect(state.pool('player-1').B).toBe(2);
    expect(state.pool('player-1').W).toBe(0);
    expect(state.pool('player-1').ANY).toBe(1);
    expect(state.pool('player-2').B).toBe(0);
    expect(state.pool('player-2').W).toBe(1);
    expect(state.pool('player-2').ANY).toBe(0);
  });
});
