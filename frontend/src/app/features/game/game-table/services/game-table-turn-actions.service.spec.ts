import { GameSnapshot } from '../../../../core/models/game.model';
import { PlayerView } from '../state/game-table-snapshot-selectors';
import { GameTableTurnActionsService } from './game-table-turn-actions.service';

describe('GameTableTurnActionsService', () => {
  it('passes directly to the next player and resets to the first phase', async () => {
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
      number: 5,
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

function player(id: string): PlayerView {
  return {
    id,
    state: {
      user: { id, displayName: id },
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
      },
    },
  } as unknown as PlayerView;
}
