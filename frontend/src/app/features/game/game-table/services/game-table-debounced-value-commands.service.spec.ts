import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameSnapshot } from '../../../../core/models/game.model';
import {
  GAME_TABLE_VALUE_COMMAND_DEBOUNCE_MS,
  GameTableDebouncedValueCommandsService,
  type GameTableDebouncedValueCommandContext,
} from './game-table-debounced-value-commands.service';

describe('GameTableDebouncedValueCommandsService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps life commands debounced by default', async () => {
    vi.useFakeTimers();
    const service = new GameTableDebouncedValueCommandsService();
    const { context, send, snapshot } = createContext();

    service.queueLife(context, { playerId: 'player-1', life: 39 });

    expect(snapshot().players['player-1']?.life).toBe(39);
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(GAME_TABLE_VALUE_COMMAND_DEBOUNCE_MS);

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith('life.changed', { playerId: 'player-1', life: 39 });
  });

  it('flushes life commands immediately when the caller already debounced the interaction', async () => {
    vi.useFakeTimers();
    const service = new GameTableDebouncedValueCommandsService();
    const { context, send, snapshot } = createContext();

    service.queueLife(context, { playerId: 'player-1', life: 39 }, { flushDelayMs: 0 });
    await Promise.resolve();

    expect(snapshot().players['player-1']?.life).toBe(39);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith('life.changed', { playerId: 'player-1', life: 39 });

    await vi.advanceTimersByTimeAsync(GAME_TABLE_VALUE_COMMAND_DEBOUNCE_MS);

    expect(send).toHaveBeenCalledOnce();
  });
});

function createContext(): {
  context: GameTableDebouncedValueCommandContext;
  send: ReturnType<typeof vi.fn>;
  snapshot: () => GameSnapshot;
} {
  let pending = false;
  let currentSnapshot = gameSnapshot(40);
  const send = vi.fn().mockResolvedValue(true);

  return {
    context: {
      gameId: () => 'game-1',
      pending: () => pending,
      setPending: (value) => {
        pending = value;
      },
      setError: vi.fn(),
      send,
      snapshot: () => currentSnapshot,
      setSnapshot: (value) => {
        currentSnapshot = value ?? currentSnapshot;
      },
      refetch: vi.fn().mockResolvedValue(undefined),
      errorMessage: (error) => String(error),
    },
    send,
    snapshot: () => currentSnapshot,
  };
}

function gameSnapshot(life: number): GameSnapshot {
  return {
    version: 1,
    players: {
      'player-1': {
        user: { id: 'player-1', email: 'player@example.test', displayName: 'Player', roles: [] },
        life,
        status: 'active',
        zones: { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [] },
        zoneCounts: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
        handCount: 0,
        commanderDamage: {},
        counters: {},
      },
    },
    counters: {},
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: [],
    attachments: [],
    specialEntities: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  } as GameSnapshot;
}
