import { GameSnapshot, GameZoneName } from '../../../../../core/models/game.model';
import { GameTableDropFeedbackState } from './game-table-drop-feedback.state';

describe('GameTableDropFeedbackState', () => {
  let state: GameTableDropFeedbackState;

  beforeEach(() => {
    vi.useFakeTimers();
    state = new GameTableDropFeedbackState();
  });

  afterEach(() => {
    state.ngOnDestroy();
    vi.useRealTimers();
  });

  it('does not emit feedback for the initial snapshot', () => {
    state.trackSnapshot(snapshot(1, {
      hand: [{ instanceId: 'hand-1', name: 'Arcane Signet', tapped: false }],
    }));

    expect(state.isCardDropSettling('player-1', 'hand', 'hand-1')).toBe(false);
  });

  it.each<GameZoneName>(['hand', 'battlefield', 'graveyard', 'exile', 'command', 'library'])(
    'emits feedback when a card enters %s',
    (zone) => {
      state.trackSnapshot(snapshot(1));
      state.trackSnapshot(snapshot(2, {
        [zone]: [{ instanceId: 'card-1', name: 'Arcane Signet', tapped: false }],
      }));

      if (zone === 'hand' || zone === 'battlefield') {
        expect(state.isCardDropSettling('player-1', zone, 'card-1')).toBe(true);
      } else {
        expect(state.isZoneDropSettling('player-1', zone)).toBe(true);
      }
    },
  );

  it('emits battlefield feedback when a card position changes', () => {
    state.trackSnapshot(snapshot(1, {
      battlefield: [{ instanceId: 'card-1', name: 'Arcane Signet', tapped: false, position: { x: 10, y: 20 } }],
    }));
    state.trackSnapshot(snapshot(2, {
      battlefield: [{ instanceId: 'card-1', name: 'Arcane Signet', tapped: false, position: { x: 30, y: 40 } }],
    }));

    expect(state.isCardDropSettling('player-1', 'battlefield', 'card-1')).toBe(true);
    expect(state.isBattlefieldEntrySettling('player-1', 'card-1')).toBe(false);
  });

  it('emits stat feedback only when a card enters battlefield from another zone', () => {
    state.trackSnapshot(snapshot(1, {
      hand: [{ instanceId: 'card-1', name: 'Llanowar Elves', tapped: false }],
    }));
    state.trackSnapshot(snapshot(2, {
      battlefield: [{ instanceId: 'card-1', name: 'Llanowar Elves', tapped: false, position: { x: 100, y: 120 } }],
    }));

    expect(state.isCardDropSettling('player-1', 'battlefield', 'card-1')).toBe(true);
    expect(state.isBattlefieldEntrySettling('player-1', 'card-1')).toBe(true);
    expect(state.isCommanderEntrySettling('player-1', 'card-1')).toBe(false);
  });

  it('emits commander feedback when a command zone card enters battlefield', () => {
    state.trackSnapshot(snapshot(1, {
      command: [{ instanceId: 'commander-1', name: 'Smeagol', tapped: false }],
    }));
    state.trackSnapshot(snapshot(2, {
      battlefield: [{ instanceId: 'commander-1', name: 'Smeagol', tapped: false, position: { x: 100, y: 120 } }],
    }));

    expect(state.isBattlefieldEntrySettling('player-1', 'commander-1')).toBe(true);
    expect(state.isCommanderEntrySettling('player-1', 'commander-1')).toBe(true);
  });

  it('uses pending commander entries when a local snapshot places the commander before the real version changes', () => {
    state.trackSnapshot(snapshot(1));
    state.markPendingBattlefieldEntry('player-1', ['commander-1']);
    state.markPendingCommanderBattlefieldEntry('player-1', ['commander-1']);
    state.trackSnapshot(snapshot(1, {
      battlefield: [{ instanceId: 'commander-1', name: 'Smeagol', tapped: false, position: { x: 100, y: 120 } }],
    }));

    expect(state.isBattlefieldEntrySettling('player-1', 'commander-1')).toBe(true);
    expect(state.isCommanderEntrySettling('player-1', 'commander-1')).toBe(true);
  });

  it('does not emit stat feedback for battlefield to battlefield moves', () => {
    state.trackSnapshot(snapshot(1, {
      battlefield: [{ instanceId: 'card-1', name: 'Llanowar Elves', tapped: false, position: { x: 100, y: 120 } }],
    }));
    state.trackSnapshot(snapshot(2, {
      battlefield: [{ instanceId: 'card-1', name: 'Llanowar Elves', tapped: false, position: { x: 140, y: 120 } }],
    }));

    expect(state.isCardDropSettling('player-1', 'battlefield', 'card-1')).toBe(true);
    expect(state.isBattlefieldEntrySettling('player-1', 'card-1')).toBe(false);
  });

  it('uses pending mana drops to add mana feedback after the real snapshot changes', () => {
    state.trackSnapshot(snapshot(1));
    state.markPendingManaDrop('player-1', ['card-1']);
    state.trackSnapshot(snapshot(2, {
      battlefield: [{ instanceId: 'card-1', name: 'Llanowar Elves', tapped: false, position: { x: 100, y: 220 } }],
    }));

    expect(state.isCardDropSettling('player-1', 'battlefield', 'card-1')).toBe(true);
    expect(state.isManaDropSettling('player-1', 'card-1')).toBe(true);
  });

  it('uses pending battlefield entries when a local snapshot places the card before the real version changes', () => {
    state.trackSnapshot(snapshot(1));
    state.markPendingBattlefieldEntry('player-1', ['card-1']);
    state.trackSnapshot(snapshot(1, {
      battlefield: [{ instanceId: 'card-1', name: 'Llanowar Elves', tapped: false, position: { x: 100, y: 120 } }],
    }));

    expect(state.isCardDropSettling('player-1', 'battlefield', 'card-1')).toBe(true);
    expect(state.isBattlefieldEntrySettling('player-1', 'card-1')).toBe(true);
  });

  it('can clear pending battlefield entries before they activate', () => {
    state.trackSnapshot(snapshot(1));
    state.markPendingBattlefieldEntry('player-1', ['card-1']);
    state.clearPendingBattlefieldEntries();
    state.trackSnapshot(snapshot(1, {
      battlefield: [{ instanceId: 'card-1', name: 'Llanowar Elves', tapped: false, position: { x: 100, y: 120 } }],
    }));

    expect(state.isCardDropSettling('player-1', 'battlefield', 'card-1')).toBe(false);
    expect(state.isBattlefieldEntrySettling('player-1', 'card-1')).toBe(false);
  });

  it('does not duplicate feedback when the snapshot version does not change', () => {
    state.trackSnapshot(snapshot(1));
    state.trackSnapshot(snapshot(2, {
      hand: [{ instanceId: 'card-1', name: 'Arcane Signet', tapped: false }],
    }));
    vi.advanceTimersByTime(300);
    state.trackSnapshot(snapshot(2, {
      hand: [{ instanceId: 'card-1', name: 'Arcane Signet', tapped: false }],
    }));
    vi.advanceTimersByTime(221);

    expect(state.isCardDropSettling('player-1', 'hand', 'card-1')).toBe(false);
  });

  it('cleans feedback after the feedback ttl', () => {
    state.trackSnapshot(snapshot(1));
    state.trackSnapshot(snapshot(2, {
      command: [{ instanceId: 'commander-1', name: 'Smeagol', tapped: false }],
    }));

    expect(state.isZoneDropSettling('player-1', 'command')).toBe(true);

    vi.advanceTimersByTime(2399);

    expect(state.isZoneDropSettling('player-1', 'command')).toBe(true);

    vi.advanceTimersByTime(1);

    expect(state.isZoneDropSettling('player-1', 'command')).toBe(false);
  });
});

function snapshot(version: number, zones: Partial<GameSnapshot['players'][string]['zones']> = {}): GameSnapshot {
  return {
    version,
    ownerId: 'player-1',
    players: {
      'player-1': {
        user: {
          id: 'user-1',
          email: 'player@example.com',
          displayName: 'Player',
          roles: [],
        },
        life: 40,
        zones: {
          library: [],
          hand: [],
          battlefield: [],
          graveyard: [],
          exile: [],
          command: [],
          ...zones,
        },
        zoneCounts: {
          library: zones.library?.length ?? 0,
          hand: zones.hand?.length ?? 0,
          battlefield: zones.battlefield?.length ?? 0,
          graveyard: zones.graveyard?.length ?? 0,
          exile: zones.exile?.length ?? 0,
          command: zones.command?.length ?? 0,
        },
        commanderDamage: {},
        counters: {},
      },
    },
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}
