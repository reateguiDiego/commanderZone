import { GameCardInstance, GameSnapshot } from '../../../../../core/models/game.model';
import { User } from '../../../../../core/models/user.model';
import { GameTableZoneModalState } from './game-table-zone-modal.state';

describe('GameTableZoneModalState View X lifecycle', () => {
  let state: GameTableZoneModalState;

  beforeEach(() => {
    state = new GameTableZoneModalState();
  });

  it('opens a transient local-selection view with a unique revision', () => {
    state.openFixed('owner', 'library', 'Top 3', cards('top', 'second', 'third'), 'top', false, {
      viewTopCount: 3,
      localMultiSelect: true,
    });
    const firstRevision = state.zoneModal()?.selectionRevision;

    state.close();
    state.openFixed('owner', 'library', 'Top 1', cards('top'), 'top', false, {
      viewTopCount: 1,
      localMultiSelect: true,
    });

    expect(state.zoneModal()).toMatchObject({ lifecycle: 'ready', localMultiSelect: true });
    expect(state.zoneModal()?.selectionRevision).not.toBe(firstRevision);
  });

  it('reconciles authorized cards without changing their top-first order', () => {
    state.openFixed('owner', 'library', 'Top 2', cards('top', 'second'), 'top', false, {
      viewTopCount: 2,
      localMultiSelect: true,
    });

    state.reconcileLibraryView(snapshot(cards('top', 'second', 'third')));

    expect(state.zoneModal()?.cards.map((card) => card.instanceId)).toEqual(['top', 'second']);
    expect(state.zoneModal()?.lifecycle).toBe('ready');
  });

  it.each([
    ['a moved card', cards('top', 'third')],
    ['reordered cards', cards('second', 'top', 'third')],
    ['a concealed card', [card('top'), { ...card('second'), hidden: true }, card('third')]],
  ])('fails closed for %s and removes all private card data', (_caseName, library) => {
    state.openFixed('owner', 'library', 'Top 2', cards('top', 'second'), 'top', false, {
      viewTopCount: 2,
      localMultiSelect: true,
    });

    state.reconcileLibraryView(snapshot(library));

    expect(state.zoneModal()).toMatchObject({
      lifecycle: 'stale',
      cards: [],
      selectedCardId: null,
      selectedCard: null,
      total: 0,
      statusMessageKey: 'game.zoneModal.viewStale',
    });
  });

  it('fails closed when realtime loses the authoritative snapshot', () => {
    state.openFixed('owner', 'library', 'Library', cards('top', 'second'), 'top', false, {
      viewTopCount: null,
      localMultiSelect: true,
    });

    state.reconcileLibraryView(null);

    expect(state.zoneModal()?.lifecycle).toBe('stale');
    expect(state.zoneModal()?.cards).toEqual([]);
  });

  it('fails closed when another tab replaces the authoritative window without changing card order', () => {
    state.openFixed('owner', 'library', 'Top 2', cards('top', 'second'), 'top', false, {
      viewTopCount: 2,
      localMultiSelect: true,
    });
    state.bindLibraryWindow({ windowId: 'lw-first', expectedEpoch: 7, openedAtVersion: 10, status: 'active' });
    const next = snapshot(cards('top', 'second', 'third'));
    next.players['owner'].libraryVisibilityEpoch = 7;
    next.players['owner'].libraryWindow = { windowId: 'lw-second', expectedEpoch: 7, openedAtVersion: 11, status: 'active' };

    state.reconcileLibraryView(next);

    expect(state.zoneModal()).toMatchObject({ lifecycle: 'stale', cards: [], mutationPending: false });
  });

  it('fails closed when opening the private view is rejected', () => {
    state.openFixed('owner', 'library', 'Top 2', cards('top', 'second'), 'top', false, {
      viewTopCount: 2,
      localMultiSelect: true,
    });
    state.setLoading();

    state.markLibraryViewError();

    expect(state.zoneModal()).toMatchObject({
      lifecycle: 'error',
      loading: false,
      cards: [],
      selectedCard: null,
      statusMessageKey: 'game.zoneModal.viewError',
    });
  });

  it('keeps ordinary public-zone modals compatible with partial card removal', () => {
    state.openFixed('owner', 'graveyard', 'Graveyard', cards('one', 'two'), 'one');

    state.removeCards(['one']);

    expect(state.zoneModal()?.lifecycle).toBe('ready');
    expect(state.zoneModal()?.cards.map((entry) => entry.instanceId)).toEqual(['two']);
  });
});

function cards(...instanceIds: string[]): GameCardInstance[] {
  return instanceIds.map(card);
}

function card(instanceId: string): GameCardInstance {
  return { instanceId, name: instanceId, tapped: false };
}

function snapshot(library: GameCardInstance[]): GameSnapshot {
  const user: User = { id: 'owner', email: 'owner@test.local', displayName: 'Owner', roles: [] };
  return {
    version: 10,
    ownerId: 'owner',
    players: {
      owner: {
        user,
        life: 40,
        zones: { library, hand: [], battlefield: [], graveyard: [], exile: [], command: [] },
        commanderDamage: {},
        counters: {},
      },
    },
    turn: { activePlayerId: 'owner', phase: 'main', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-07-16T00:00:00Z',
  };
}
