import { GameSnapshot } from '../../../../core/models/game.model';
import { PlayerView } from '../state/core/game-table-snapshot-selectors';
import { GameTableTurnActionsService } from './game-table-turn-actions.service';

describe('GameTableTurnActionsService', () => {
  it('passes directly to the next player without increasing the round number', async () => {
    const command = vi.fn().mockResolvedValue(undefined);
    const service = new GameTableTurnActionsService();

    await service.passTurn({
      snapshot: () => snapshot({ activePlayerId: 'player-1', phase: 'combat', number: 4 }),
      players: () => [player('player-1'), player('player-2')],
      phases: () => ['untap', 'upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end'],
      command,
    });

    expect(command).toHaveBeenCalledWith('turn.changed', {
      activePlayerId: 'player-2',
      phase: 'untap',
      number: 4,
    });
  });

  it('increases the round number only after the last active player passes turn', async () => {
    const command = vi.fn().mockResolvedValue(undefined);
    const service = new GameTableTurnActionsService();

    await service.passTurn({
      snapshot: () => snapshot({ activePlayerId: 'player-2', phase: 'combat', number: 4 }),
      players: () => [player('player-1'), player('player-2')],
      phases: () => ['untap', 'upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end'],
      command,
    });

    expect(command).toHaveBeenCalledWith('turn.changed', {
      activePlayerId: 'player-1',
      phase: 'untap',
      number: 5,
    });
  });

  it('skips defeated players without increasing the round number mid-round', async () => {
    const command = vi.fn().mockResolvedValue(undefined);
    const service = new GameTableTurnActionsService();

    await service.passTurn({
      snapshot: () => snapshot({ activePlayerId: 'player-1', phase: 'combat', number: 4 }),
      players: () => [player('player-1', 12), player('player-2', 0), player('player-3', 8)],
      phases: () => ['untap', 'upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end'],
      command,
    });

    expect(command).toHaveBeenCalledWith('turn.changed', {
      activePlayerId: 'player-3',
      phase: 'untap',
      number: 4,
    });
  });

  it('skips players with lethal commander damage', async () => {
    const command = vi.fn().mockResolvedValue(undefined);
    const service = new GameTableTurnActionsService();

    await service.passTurn({
      snapshot: () => snapshot({ activePlayerId: 'player-1', phase: 'combat', number: 4 }),
      players: () => [
        player('player-1', 12),
        player('player-2', 40, { 'player-1': 21 }),
        player('player-3', 8),
      ],
      phases: () => ['untap', 'upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end'],
      command,
    });

    expect(command).toHaveBeenCalledWith('turn.changed', {
      activePlayerId: 'player-3',
      phase: 'untap',
      number: 4,
    });
  });

  it('increases the round number after wrapping around defeated players', async () => {
    const command = vi.fn().mockResolvedValue(undefined);
    const service = new GameTableTurnActionsService();

    await service.passTurn({
      snapshot: () => snapshot({ activePlayerId: 'player-3', phase: 'combat', number: 4 }),
      players: () => [player('player-1', 12), player('player-2', 0), player('player-3', 8)],
      phases: () => ['untap', 'upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end'],
      command,
    });

    expect(command).toHaveBeenCalledWith('turn.changed', {
      activePlayerId: 'player-1',
      phase: 'untap',
      number: 5,
    });
  });

  it('keeps the two-player endgame behavior when only one player is alive', async () => {
    const command = vi.fn().mockResolvedValue(undefined);
    const service = new GameTableTurnActionsService();

    await service.passTurn({
      snapshot: () => snapshot({ activePlayerId: 'player-1', phase: 'combat', number: 4 }),
      players: () => [player('player-1', 12), player('player-2', 0)],
      phases: () => ['untap', 'upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end'],
      command,
    });

    expect(command).toHaveBeenCalledWith('turn.changed', {
      activePlayerId: 'player-2',
      phase: 'untap',
      number: 4,
    });
  });
});

function snapshot(turn: GameSnapshot['turn']): GameSnapshot {
  return {
    version: 1,
    players: {},
    turn,
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-05-13T00:00:00Z',
  };
}

function player(id: string, life = 40, commanderDamage: Record<string, number> = {}): PlayerView {
  return {
    id,
    state: {
      user: { id, displayName: id },
      status: 'active',
      life,
      commanderDamage,
      counters: {},
      zones: {
        library: [],
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        command: [],
      },
    },
  } as unknown as PlayerView;
}
