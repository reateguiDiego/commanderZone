import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { GameSnapshot, GameZoneName } from '../../../../core/models/game.model';
import { GameTableZoneModalState } from '../state/game-table-zone-modal.state';
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

  it('opens public pile modal when the zone contains cards', async () => {
    const { service, state, gamesApi } = setup(snapshotWithZoneCount('exile', 1));

    await service.openZone(context(), 'player-1', 'exile');

    expect(gamesApi.zone).toHaveBeenCalledWith('game-1', 'player-1', 'exile', { type: '', search: '', limit: 200 });
    expect(state.zoneModal()?.zone).toBe('exile');
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
    zoneTitle: (zone: GameZoneName) => zone === 'graveyard' ? 'Graveyard' : 'Exile',
    setError: options.setError ?? vi.fn(),
  };
}

function snapshotWithZoneCount(zone: Extract<GameZoneName, 'graveyard' | 'exile'>, count: number): GameSnapshot {
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
          [zone]: Array.from({ length: count }, (_, index) => ({
            instanceId: `card-${index}`,
            name: `Card ${index}`,
            zone,
            tapped: false,
          })),
        },
        zoneCounts: {
          library: 0,
          hand: 0,
          battlefield: 0,
          graveyard: zone === 'graveyard' ? count : 0,
          exile: zone === 'exile' ? count : 0,
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
