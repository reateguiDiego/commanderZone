import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { GameTableCommandService } from '../../services/game-table-command.service';
import { GameTableDropFeedbackState } from '../drag-drop/game-table-drop-feedback.state';
import { GameTableCommandContext, GameTableCommandStore } from './game-table-command.store';
import { GameTableCoreState } from './game-table-core.state';
import { GameTablePendingTransferState } from './game-table-pending-transfer.state';
import { GameTablePendingTransferRegistrarState } from './game-table-pending-transfer-registrar.state';

describe('GameTableCommandStore', () => {
  let store: GameTableCommandStore;
  let core: GameTableCoreState;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    send = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        GameTableCommandStore,
        GameTableCoreState,
        GameTableDropFeedbackState,
        GameTablePendingTransferState,
        GameTablePendingTransferRegistrarState,
        { provide: GameTableCommandService, useValue: { send } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'game-1' } } } },
      ],
    });

    store = TestBed.inject(GameTableCommandStore);
    core = TestBed.inject(GameTableCoreState);
  });

  it('suppresses the empty batch position error toast', async () => {
    const payload = { playerId: 'player-1', zone: 'battlefield', positions: [] };
    send.mockRejectedValue(new Error('Rejected'));

    await store.command(
      commandContext('positions must contain at least one card position.'),
      'cards.position.changed',
      payload,
    );

    expect(send).toHaveBeenCalledWith('game-1', 'cards.position.changed', payload);
    expect(core.error()).toBeNull();
    expect(core.pending()).toBe(false);
  });

  it('keeps surfacing other command errors', async () => {
    send.mockRejectedValue(new Error('Rejected'));

    await store.command(
      commandContext('Could not apply game action.'),
      'cards.position.changed',
      { playerId: 'player-1', zone: 'battlefield', positions: [] },
    );

    expect(core.error()).toBe('Could not apply game action.');
  });
});

function commandContext(message: string): GameTableCommandContext {
  return {
    setSnapshot: vi.fn(),
    queueBattlefieldPositionCommand: (_gameId: string, _payload: Record<string, unknown>) => false,
    errorMessage: (_error: unknown) => message,
  };
}
