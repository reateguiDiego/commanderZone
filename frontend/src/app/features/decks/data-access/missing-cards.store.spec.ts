import { TestBed } from '@angular/core/testing';
import { MissingCardsStore } from './missing-cards.store';

describe('MissingCardsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('stores and ignores missing card watchlist entries', () => {
    const store = TestBed.inject(MissingCardsStore);

    store.add('Unknown Card', 'deck-1');
    store.ignoreForSession('Ignored Card');

    expect(store.isWatched('unknown card')).toBe(true);
    expect(store.isIgnored('ignored card')).toBe(true);
    expect(store.watchlist()[0].name).toBe('Unknown Card');
  });
});
