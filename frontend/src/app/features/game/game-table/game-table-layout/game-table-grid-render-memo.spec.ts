import { signal } from '@angular/core';
import type { GameCardInstance, GameSpecialEntity } from '../../../../core/models/game.model';
import type { PlayerView } from '../game-table.store';
import {
  GridPlayerSummaryBindingsMemo,
  reuseGridSeatReferences,
} from './game-table-grid-render-memo';
import { buildGridSeats, type GridPlayerSummaryBindings } from './game-table-grid-seat.model';

describe('Grid render memo', () => {
  it('retains untouched GridSeat references when one player card only moves', () => {
    const local = player('local', 0.2);
    const opponent = player('opponent', 0.4);
    const previousSeats = buildGridSeats([local, opponent], local);
    const movedLocal = withBattlefieldPosition(local, 0.6);
    const nextSeats = buildGridSeats([movedLocal, opponent], movedLocal);

    const memoizedSeats = reuseGridSeatReferences(previousSeats, nextSeats);

    expect(memoizedSeats.find((seat) => seat.player.id === 'local')).toBe(
      nextSeats.find((seat) => seat.player.id === 'local'),
    );
    expect(memoizedSeats.find((seat) => seat.player.id === 'opponent')).toBe(
      previousSeats.find((seat) => seat.player.id === 'opponent'),
    );
  });

  it('retains summary bindings and summary player references for a position-only update', () => {
    const local = player('local', 0.2);
    const opponent = player('opponent', 0.4);
    const memo = new GridPlayerSummaryBindingsMemo();
    const functions = summaryBindingFunctions();
    const initial = memo.memoize(summaryBindings([local, opponent], functions));
    const movedLocal = withBattlefieldPosition(local, 0.6);

    const updated = memo.memoize(summaryBindings([movedLocal, opponent], functions));

    expect(updated).toBe(initial);
    expect(updated.players).toBe(initial.players);
    expect(updated.players.find((player) => player.id === 'local')).toBe(local);
    expect(updated.players.find((player) => player.id === 'opponent')).toBe(opponent);
  });

  it('does not inspect PlayerViews that retain their original reference', () => {
    const source = player('local', 0.2);
    const guarded = new Proxy(source, {
      get(target, property, receiver) {
        if (property === 'state') {
          throw new Error('An unchanged PlayerView should not be compared.');
        }

        return Reflect.get(target, property, receiver);
      },
    }) as PlayerView;
    const memo = new GridPlayerSummaryBindingsMemo();
    const functions = summaryBindingFunctions();

    memo.memoize(summaryBindings([guarded], functions));

    expect(() => memo.memoize(summaryBindings([guarded], functions))).not.toThrow();
  });

  it('does not inspect unchanged battlefield cards while comparing a moved card', () => {
    const firstCard = new Proxy(battlefieldCard(0.2), {
      ownKeys() {
        throw new Error('An unchanged card should not be compared.');
      },
    }) as GameCardInstance;
    const secondCard = battlefieldCard(0.4);
    const baseLocal = player('local', 0.1);
    const local = withPlayerState(baseLocal, {
      zones: {
        ...baseLocal.state.zones,
        battlefield: [firstCard, secondCard],
      },
    });
    const opponent = player('opponent', 0.8);
    const movedLocal = withPlayerState(local, {
      zones: {
        ...local.state.zones,
        battlefield: [firstCard, { ...secondCard, position: { x: 0.6, y: 0.3, unit: 'ratio' } }],
      },
    });
    const memo = new GridPlayerSummaryBindingsMemo();
    const functions = summaryBindingFunctions();

    memo.memoize(summaryBindings([local, opponent], functions));

    expect(() => memo.memoize(summaryBindings([movedLocal, opponent], functions))).not.toThrow();
  });

  it('refreshes summaries for semantic player changes', () => {
    const local = player('local', 0.2);
    const opponent = player('opponent', 0.4);
    const functions = summaryBindingFunctions();
    const updates: readonly [string, (source: PlayerView) => PlayerView][] = [
      ['life', (source) => withPlayerState(source, { life: 39 })],
      ['counters', (source) => withPlayerState(source, { counters: { poison: 1 } })],
      [
        'command zone',
        (source) =>
          withPlayerState(source, {
            zones: {
              ...source.state.zones,
              command: [
                {
                  ...source.state.zones.battlefield[0]!,
                  instanceId: 'commander-1',
                  isCommander: true,
                },
              ],
            },
          }),
      ],
      [
        'display name',
        (source) =>
          withPlayerState(source, {
            user: { ...source.state.user, displayName: 'Renamed player' },
          }),
      ],
      [
        'commander damage',
        (source) =>
          withPlayerState(source, {
            commanderDamage: { 'commander-1': 7 },
          }),
      ],
    ];

    for (const [change, update] of updates) {
      const memo = new GridPlayerSummaryBindingsMemo();
      const initial = memo.memoize(summaryBindings([local, opponent], functions));
      const updatedLocal = update(local);
      const updated = memo.memoize(summaryBindings([updatedLocal, opponent], functions));

      expect(updated, change).not.toBe(initial);
      expect(
        updated.players.find((player) => player.id === 'local'),
        change,
      ).toBe(updatedLocal);
    }
  });

  it('keeps special entities reactive without replacing stable summary bindings', () => {
    const local = player('local', 0.2);
    const opponent = player('opponent', 0.4);
    const entities = signal<readonly GameSpecialEntity[]>([specialEntity('monarch-1')]);
    const functions = {
      ...summaryBindingFunctions(),
      specialEntities: () => entities(),
    };
    const memo = new GridPlayerSummaryBindingsMemo();
    const bindings = memo.memoize(summaryBindings([local, opponent], functions));
    const first = bindings.specialEntities('local');

    entities.set([...first]);
    expect(bindings.specialEntities('local')).toBe(first);

    entities.set([specialEntity('monarch-2')]);
    expect(bindings.specialEntities('local')).toEqual([specialEntity('monarch-2')]);

    const movedLocal = withBattlefieldPosition(local, 0.6);
    expect(memo.memoize(summaryBindings([movedLocal, opponent], functions))).toBe(bindings);
  });
});

function summaryBindingFunctions(): Omit<GridPlayerSummaryBindings, 'players'> {
  return {
    colorAccent: () => '',
    deckLabel: () => '',
    manaSymbols: () => [],
    playerCounterValue: () => 0,
    canEditCounters: () => false,
    autoApplyCommanderDamageToLife: true,
    specialEntities: () => [],
    showHelperPreview: () => undefined,
    hideHelperPreview: () => undefined,
    openHelperContext: () => undefined,
    changeLife: () => undefined,
    changeCommanderDamage: () => undefined,
    changePlayerCounter: () => undefined,
  };
}

function summaryBindings(
  players: readonly PlayerView[],
  functions: Omit<GridPlayerSummaryBindings, 'players'>,
): GridPlayerSummaryBindings {
  return { players, ...functions };
}

function player(id: string, x: number): PlayerView {
  return {
    id,
    state: {
      user: { id, displayName: id, email: `${id}@example.test`, roles: [] },
      status: 'active',
      life: 40,
      commanderDamage: {},
      counters: {},
      zones: {
        library: [],
        hand: [],
        battlefield: [battlefieldCard(x)],
        command: [],
        exile: [],
        graveyard: [],
      },
    },
  };
}

function withBattlefieldPosition(source: PlayerView, x: number): PlayerView {
  return withPlayerState(source, {
    zones: {
      ...source.state.zones,
      battlefield: [
        { ...source.state.zones.battlefield[0]!, position: { x, y: 0.3, unit: 'ratio' } },
      ],
    },
  });
}

function withPlayerState(source: PlayerView, update: Partial<PlayerView['state']>): PlayerView {
  return {
    ...source,
    state: {
      ...source.state,
      ...update,
    },
  };
}

function battlefieldCard(x: number): GameCardInstance {
  return {
    instanceId: 'battlefield-card',
    name: 'Battlefield card',
    tapped: false,
    zone: 'battlefield',
    position: { x, y: 0.3, unit: 'ratio' },
  };
}

function specialEntity(id: string): GameSpecialEntity {
  return {
    id,
    template: 'monarch',
    scope: 'global',
    ownerPlayerId: 'local',
    card: null,
    state: {},
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}
