import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { GameCardInstance, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';
import { GameTableZoneModalState } from '../state/zones/game-table-zone-modal.state';
import { GameTableZoneActionsService } from './game-table-zone-actions.service';

describe('GameTableZoneActionsService', () => {
  it('shows a toast and keeps the modal closed for empty graveyard or exile zones', async () => {
    const { service, state, gamesApi } = setup();
    const setError = vi.fn();

    await service.openZone(context({ setError }), 'player-1', 'graveyard');

    expect(setError).toHaveBeenCalledWith('No cards in graveyard.');
    expect(state.zoneModal()).toBeNull();
    expect(gamesApi.zone).not.toHaveBeenCalled();
  });

  it('opens public pile modal from the local snapshot when the zone contains cards', async () => {
    const { service, state, gamesApi } = setup(snapshotWithZoneCount('exile', 1));

    await service.openZone(context(), 'player-1', 'exile');

    expect(gamesApi.zone).not.toHaveBeenCalled();
    expect(state.zoneModal()?.zone).toBe('exile');
    expect(state.zoneModal()?.loading).toBe(false);
    expect(state.zoneModal()?.cards.map((entry) => entry.instanceId)).toEqual(['card-0']);
  });

  it('filters local graveyard and exile modals without calling the zone endpoint', async () => {
    const { service, state, gamesApi } = setup(snapshotWithCards('graveyard', [
      card('creature-1', { name: 'Silver Knight', typeLine: 'Creature - Knight' }),
      card('instant-1', { name: 'Lightning Bolt', typeLine: 'Instant' }),
      card('creature-2', { name: 'Llanowar Elves', typeLine: 'Creature - Elf' }),
    ]));

    await service.openZone(context(), 'player-1', 'graveyard');
    service.updateZoneFilter(context(), { type: 'creature', search: 'llanowar' });

    expect(gamesApi.zone).not.toHaveBeenCalled();
    expect(state.zoneModal()?.cards.map((entry) => entry.instanceId)).toEqual(['creature-2']);
    expect(state.zoneModal()?.total).toBe(1);
  });

  it('can allow give destinations for a view-all library modal', async () => {
    const { service, state, gamesApi } = setup(snapshotWithZoneCount('graveyard', 0));

    await service.openZone(context(), 'player-1', 'library', null, false, { allowGiveDestination: true });

    expect(gamesApi.zone).toHaveBeenCalledWith('game-1', 'player-1', 'library', { limit: 200 });
    expect(state.zoneModal()?.zone).toBe('library');
    expect(state.zoneModal()?.allowGiveDestination).toBe(true);
  });

  it('filters a complete library response locally after the initial backend load', async () => {
    const libraryCards = [
      card('creature-1', { name: 'Silver Knight', typeLine: 'Creature - Knight', zone: 'library' }),
      card('instant-1', { name: 'Lightning Bolt', typeLine: 'Instant', zone: 'library' }),
      card('creature-2', { name: 'Llanowar Elves', typeLine: 'Creature - Elf', zone: 'library' }),
    ];
    const { service, state, gamesApi } = setup();
    gamesApi.zone.mockReturnValue(of({ data: libraryCards, total: libraryCards.length }));

    await service.openZone(context(), 'player-1', 'library');
    service.updateZoneFilter(context(), { type: 'creature' });
    service.updateZoneFilter(context(), { search: 'llanowar' });

    expect(gamesApi.zone).toHaveBeenCalledTimes(1);
    expect(gamesApi.zone).toHaveBeenCalledWith('game-1', 'player-1', 'library', { limit: 200 });
    expect(state.zoneModal()?.cards.map((entry) => entry.instanceId)).toEqual(['creature-2']);
    expect(state.zoneModal()?.total).toBe(1);
  });

  it('keeps backend filtering for library when the loaded response is incomplete', async () => {
    const { service, state, gamesApi } = setup();
    gamesApi.zone.mockReturnValueOnce(of({ data: [card('card-1', { zone: 'library' })], total: 250 }));

    await service.openZone(context(), 'player-1', 'library');

    gamesApi.zone.mockClear();
    gamesApi.zone.mockReturnValueOnce(of({ data: [card('creature-1', { typeLine: 'Creature', zone: 'library' })], total: 80 }));
    service.updateZoneFilter(context(), { type: 'creature' });

    await vi.waitFor(() => expect(gamesApi.zone).toHaveBeenCalledWith('game-1', 'player-1', 'library', {
      type: 'creature',
      search: '',
      limit: 200,
    }));
    expect(state.zoneModal()?.cards.map((entry) => entry.instanceId)).toEqual(['creature-1']);
    expect(state.zoneModal()?.total).toBe(80);
  });

  it('invalidates the local library filter source when modal cards are removed', async () => {
    const libraryCards = [
      card('card-1', { zone: 'library' }),
      card('card-2', { zone: 'library' }),
    ];
    const { service, state, gamesApi } = setup();
    gamesApi.zone.mockReturnValue(of({ data: libraryCards, total: libraryCards.length }));

    await service.openZone(context(), 'player-1', 'library');
    service.removeZoneModalCards(['card-1']);

    expect(state.zoneModal()?.filterSourceCards).toBeNull();
    expect(state.zoneModal()?.cards.map((entry) => entry.instanceId)).toEqual(['card-2']);
  });

  it('preserves fixed reorder slots when replacing top-library modal cards', () => {
    const { service, state } = setup();
    const cards = [card('card-1'), card('card-2'), card('card-3')];
    service.openFixedZone('player-1', 'library', 'Top 3', cards, 'card-1', false, {
      allowReorder: true,
      drawOrderLabels: ['PROXIMO ROBO', 'SEGUNDO ROBO', 'TERCER ROBO'],
    });

    service.replaceZoneModalCards([cards[1]!, cards[2]!]);

    expect(state.zoneModal()?.cards.map((entry) => entry.instanceId)).toEqual(['card-2', 'card-3']);
    expect(state.zoneModal()?.total).toBe(3);
    expect(state.zoneModal()?.drawOrderLabels).toEqual(['PROXIMO ROBO', 'SEGUNDO ROBO', 'TERCER ROBO']);
  });

  it('filters a fixed revealed library locally without another zone request', () => {
    const cards = [
      card('card-1', { name: 'Arcane Signet', typeLine: 'Artifact', zone: 'library' }),
      card('card-2', { name: 'Llanowar Elves', typeLine: 'Creature', zone: 'library' }),
    ];
    const { service, state, gamesApi } = setup();
    service.openFixedZone('player-1', 'library', 'Revealed library', cards, null, false, {
      readOnly: true,
      showFilters: true,
    });

    service.updateZoneFilter(context(), { type: 'creature', search: 'llanowar' });

    expect(gamesApi.zone).not.toHaveBeenCalled();
    expect(state.zoneModal()).toMatchObject({ showFilters: true, total: 1 });
    expect(state.zoneModal()?.cards.map((entry) => entry.instanceId)).toEqual(['card-2']);
  });

  it('removes cards from a loaded modal without switching it to loading', () => {
    const { service, state } = setup();
    const cards = [card('card-1'), card('card-2'), card('card-3')];
    state.open('player-1', 'library', 'Library');
    state.setLoaded(cards, 3);

    service.removeZoneModalCards(['card-2']);

    expect(state.zoneModal()?.loading).toBe(false);
    expect(state.zoneModal()?.total).toBe(2);
    expect(state.zoneModal()?.cards.map((entry) => entry.instanceId)).toEqual(['card-1', 'card-3']);
  });
});

function setup(snapshot = snapshotWithZoneCount('graveyard', 0)): {
  service: GameTableZoneActionsService;
  state: GameTableZoneModalState;
  gamesApi: { zone: ReturnType<typeof vi.fn> };
} {
  const gamesApi = {
    zone: vi.fn().mockReturnValue(of({ data: [], total: 0 })),
  };

  TestBed.configureTestingModule({
    providers: [
      GameTableZoneActionsService,
      GameTableZoneModalState,
      { provide: GamesApi, useValue: gamesApi },
    ],
  });

  currentSnapshot = snapshot;

  return {
    service: TestBed.inject(GameTableZoneActionsService),
    state: TestBed.inject(GameTableZoneModalState),
    gamesApi,
  };
}

let currentSnapshot: GameSnapshot;

function context(options: { setError?: (message: string) => void } = {}) {
  return {
    gameId: () => 'game-1',
    snapshot: () => currentSnapshot,
    playerName: () => 'Player One',
    zoneTitle: (zone: GameZoneName) => zone === 'graveyard' ? 'Graveyard' : zone === 'library' ? 'Library' : 'Exile',
    setError: options.setError ?? vi.fn(),
  };
}

function snapshotWithZoneCount(zone: Extract<GameZoneName, 'graveyard' | 'exile'>, count: number): GameSnapshot {
  return snapshotWithCards(zone, Array.from({ length: count }, (_, index) => card(`card-${index}`, {
    name: `Card ${index}`,
    zone,
  })));
}

function snapshotWithCards(zone: Extract<GameZoneName, 'graveyard' | 'exile'>, cards: GameCardInstance[]): GameSnapshot {
  return {
    version: 1,
    players: {
      'player-1': {
        user: { id: 'player-1', email: 'player-1@example.test', displayName: 'Player One', roles: [] },
        life: 40,
        commanderDamage: {},
        counters: {},
        zones: {
          library: [],
          hand: [],
          battlefield: [],
          graveyard: [],
          exile: [],
          command: [],
          [zone]: cards,
        },
        zoneCounts: {
          library: 0,
          hand: 0,
          battlefield: 0,
          graveyard: zone === 'graveyard' ? cards.length : 0,
          exile: zone === 'exile' ? cards.length : 0,
          command: 0,
        },
      },
    },
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-05-14T00:00:00Z',
  };
}

function card(instanceId: string, overrides: Partial<GameCardInstance> = {}): GameCardInstance {
  return {
    instanceId,
    name: instanceId,
    zone: 'library',
    tapped: false,
    ...overrides,
  };
}
