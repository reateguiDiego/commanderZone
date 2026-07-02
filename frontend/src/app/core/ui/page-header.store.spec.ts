import { TestBed } from '@angular/core/testing';
import { PageHeaderStore } from './page-header.store';

describe('PageHeaderStore', () => {
  let store: PageHeaderStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(PageHeaderStore);
  });

  it('keeps the active header when an inactive owner clears late', () => {
    const roomsOwner = {};
    const cardsOwner = {};

    store.set({ title: 'Rooms' }, roomsOwner);
    store.set({ title: 'Cards' }, cardsOwner);

    store.clear(roomsOwner);

    expect(store.state()?.title).toBe('Cards');
  });

  it('ignores header writes after an owner has been destroyed', () => {
    const roomsOwner = {};
    const cardsOwner = {};

    store.set({ title: 'Rooms' }, roomsOwner);
    store.clear(roomsOwner);
    store.set({ title: 'Cards' }, cardsOwner);
    store.set({ title: 'Late rooms response' }, roomsOwner);

    expect(store.state()?.title).toBe('Cards');
  });
});
