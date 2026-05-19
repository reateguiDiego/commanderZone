import { GameSnapshot, GameZoneName } from '../../../../../core/models/game.model';
import { GameTablePendingTransferState } from './game-table-pending-transfer.state';

describe('GameTablePendingTransferState', () => {
  let state: GameTablePendingTransferState;

  beforeEach(() => {
    state = new GameTablePendingTransferState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks registered source cards and zones as pending', () => {
    state.register({ playerId: 'player-1', fromZone: 'hand', instanceIds: ['card-1'], sourceVersion: 1 });

    expect(state.isCardPending('player-1', 'hand', 'card-1')).toBe(true);
    expect(state.isZonePending('player-1', 'hand')).toBe(true);
  });

  it('keeps a pending transfer while the card is still in the source zone', () => {
    state.register({ playerId: 'player-1', fromZone: 'battlefield', instanceIds: ['card-1'], sourceVersion: 1 });

    state.reconcileSnapshot(snapshot(2, {
      battlefield: [{ instanceId: 'card-1', name: 'Arcane Signet', tapped: false }],
    }));

    expect(state.isCardPending('player-1', 'battlefield', 'card-1')).toBe(true);
  });

  it('clears a pending transfer when the card leaves the source zone', () => {
    state.register({ playerId: 'player-1', fromZone: 'battlefield', instanceIds: ['card-1'], sourceVersion: 1 });

    state.reconcileSnapshot(snapshot(2, {
      hand: [{ instanceId: 'card-1', name: 'Arcane Signet', tapped: false }],
    }));

    expect(state.isCardPending('player-1', 'battlefield', 'card-1')).toBe(false);
    expect(state.isZonePending('player-1', 'battlefield')).toBe(false);
  });

  it('supports multi-card transfers', () => {
    state.register({ playerId: 'player-1', fromZone: 'hand', instanceIds: ['card-1', 'card-2'], sourceVersion: 1 });

    state.reconcileSnapshot(snapshot(2, {
      hand: [{ instanceId: 'card-2', name: 'Sol Ring', tapped: false }],
      battlefield: [{ instanceId: 'card-1', name: 'Arcane Signet', tapped: false }],
    }));

    expect(state.isCardPending('player-1', 'hand', 'card-1')).toBe(true);
    expect(state.isCardPending('player-1', 'hand', 'card-2')).toBe(true);
    expect(state.isZonePending('player-1', 'hand')).toBe(true);

    state.reconcileSnapshot(snapshot(3, {
      battlefield: [
        { instanceId: 'card-1', name: 'Arcane Signet', tapped: false },
        { instanceId: 'card-2', name: 'Sol Ring', tapped: false },
      ],
    }));

    expect(state.isCardPending('player-1', 'hand', 'card-1')).toBe(false);
    expect(state.isCardPending('player-1', 'hand', 'card-2')).toBe(false);
    expect(state.isZonePending('player-1', 'hand')).toBe(false);
  });

  it('clears zone-only transfers on the next newer snapshot', () => {
    state.register({ playerId: 'player-1', fromZone: 'library', sourceVersion: 1 });

    state.reconcileSnapshot(snapshot(1, { library: [{ instanceId: 'card-1', name: 'Top Card', tapped: false }] }));
    expect(state.isZonePending('player-1', 'library')).toBe(true);

    state.reconcileSnapshot(snapshot(2, { library: [{ instanceId: 'card-2', name: 'Next Card', tapped: false }] }));
    expect(state.isZonePending('player-1', 'library')).toBe(false);
  });

  it('clears zone-only transfers without a source version on the next snapshot', () => {
    state.register({ playerId: 'player-1', fromZone: 'library' });

    state.reconcileSnapshot(snapshot(1, { library: [{ instanceId: 'card-1', name: 'Top Card', tapped: false }] }));

    expect(state.isZonePending('player-1', 'library')).toBe(false);
  });

  it('clears manually', () => {
    state.register({ playerId: 'player-1', fromZone: 'exile', instanceIds: ['card-1'], sourceVersion: 1 });

    state.clear();

    expect(state.isCardPending('player-1', 'exile', 'card-1')).toBe(false);
    expect(state.isZonePending('player-1', 'exile')).toBe(false);
  });

  it('expires a stale pending transfer after the timeout and reports it once', () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    state.setExpirationHandler(expired);

    state.register({ playerId: 'player-1', fromZone: 'battlefield', instanceIds: ['card-1'], sourceVersion: 1 });

    vi.advanceTimersByTime(999);
    expect(state.isCardPending('player-1', 'battlefield', 'card-1')).toBe(true);
    expect(expired).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(state.isCardPending('player-1', 'battlefield', 'card-1')).toBe(false);
    expect(state.isZonePending('player-1', 'battlefield')).toBe(false);
    expect(expired).toHaveBeenCalledOnce();
    expect(expired).toHaveBeenCalledWith({
      playerId: 'player-1',
      fromZone: 'battlefield',
      instanceIds: ['card-1'],
    });
  });

  it('keeps a non-expiring transfer pending until snapshot reconciliation or manual cleanup', () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    state.setExpirationHandler(expired);

    state.register({
      playerId: 'player-1',
      fromZone: 'battlefield',
      instanceIds: ['card-1'],
      sourceVersion: 1,
      expires: false,
    });

    vi.advanceTimersByTime(5000);

    expect(state.isCardPending('player-1', 'battlefield', 'card-1')).toBe(true);
    expect(expired).not.toHaveBeenCalled();

    state.reconcileSnapshot(snapshot(2, {
      hand: [{ instanceId: 'card-1', name: 'Arcane Signet', tapped: false }],
    }));

    expect(state.isCardPending('player-1', 'battlefield', 'card-1')).toBe(false);
  });

  it('does not expire a transfer that was reconciled first', () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    state.setExpirationHandler(expired);

    state.register({ playerId: 'player-1', fromZone: 'battlefield', instanceIds: ['card-1'], sourceVersion: 1 });
    state.reconcileSnapshot(snapshot(2, {
      hand: [{ instanceId: 'card-1', name: 'Arcane Signet', tapped: false }],
    }));
    vi.advanceTimersByTime(1000);

    expect(expired).not.toHaveBeenCalled();
  });

  it('replaces duplicate pending transfers so repeated registration has one timeout', () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    state.setExpirationHandler(expired);

    state.register({ playerId: 'player-1', fromZone: 'hand', instanceIds: ['card-1', 'card-2'], sourceVersion: 1 });
    vi.advanceTimersByTime(600);
    state.register({ playerId: 'player-1', fromZone: 'hand', instanceIds: ['card-2', 'card-1'], sourceVersion: 1 });
    vi.advanceTimersByTime(999);

    expect(expired).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(expired).toHaveBeenCalledOnce();
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
