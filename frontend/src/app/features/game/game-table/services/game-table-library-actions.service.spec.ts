import { GameCommandType } from '../../../../core/models/game.model';
import { GameTableLibraryActionContext, GameTableLibraryActionsService } from './game-table-library-actions.service';

describe('GameTableLibraryActionsService private batches', () => {
  const service = new GameTableLibraryActionsService();

  it('sends selected X with the server window, epoch and explicit selection order', async () => {
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];
    const context = commandContext(commands);

    await service.moveSelection(context, 'owner', 'lw-1', 7, ['card-c', 'card-a'], 'battlefield', { faceDown: true });

    expect(commands).toEqual([{
      type: 'library.selection.move',
      payload: {
        playerId: 'owner',
        windowId: 'lw-1',
        expectedEpoch: 7,
        orderedInstanceIds: ['card-c', 'card-a'],
        toZone: 'battlefield',
        faceDown: true,
      },
    }]);
  });

  it('keeps top X distinct and never sends selected instance IDs', async () => {
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.playTopFaceDown(commandContext(commands), 'owner', 'lw-2', 3, 9);

    expect(commands).toEqual([{
      type: 'library.top.play_face_down',
      payload: { playerId: 'owner', windowId: 'lw-2', count: 3, expectedEpoch: 9 },
    }]);
    expect(commands[0]?.payload['orderedInstanceIds']).toBeUndefined();
  });

  it('does not send a private batch for another player', async () => {
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];
    const context = commandContext(commands, false);

    await service.moveSelection(context, 'opponent', 'lw-private', 2, ['private-id'], 'hand');

    expect(commands).toEqual([]);
    expect(context.setError).toHaveBeenCalled();
  });
});

function commandContext(
  commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }>,
  canControl = true,
): GameTableLibraryActionContext {
  return {
    isCurrentPlayer: () => canControl,
    currentPlayer: () => null,
    focusedPlayer: () => null,
    focusPlayer: vi.fn(),
    setError: vi.fn(),
    command: async (type, payload) => {
      commands.push({ type, payload });
    },
  };
}
