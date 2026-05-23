import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { GameTableCommandService } from '../../services/game-table-command.service';
import { GameTableDropFeedbackState } from '../drag-drop/game-table-drop-feedback.state';
import { GameTableWebsocketGameplayService } from '../../services/game-table-websocket-gameplay.service';
import { GameTableCommandContext, GameTableCommandStore } from './game-table-command.store';
import { GameTableCoreState } from './game-table-core.state';
import { GameTablePendingTransferState } from './game-table-pending-transfer.state';
import { GameTablePendingTransferRegistrarState } from './game-table-pending-transfer-registrar.state';

describe('GameTableCommandStore', () => {
  let store: GameTableCommandStore;
  let core: GameTableCoreState;
  let send: ReturnType<typeof vi.fn>;
  let websocketSendCommand: ReturnType<typeof vi.fn>;
  let isMigratedCommand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    send = vi.fn();
    websocketSendCommand = vi.fn();
    isMigratedCommand = vi.fn(() => false);

    TestBed.configureTestingModule({
      providers: [
        GameTableCommandStore,
        GameTableCoreState,
        GameTableDropFeedbackState,
        GameTablePendingTransferState,
        GameTablePendingTransferRegistrarState,
        { provide: GameTableCommandService, useValue: { send } },
        { provide: GameTableWebsocketGameplayService, useValue: { isMigratedCommand, sendCommand: websocketSendCommand } },
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

  it('sends migrated commands over websocket without calling the HTTP command endpoint', async () => {
    isMigratedCommand.mockReturnValue(true);
    websocketSendCommand.mockResolvedValue(true);

    await store.command(
      commandContext('Action failed.'),
      'life.changed',
      { playerId: 'player-1', delta: -1 },
    );

    expect(websocketSendCommand).toHaveBeenCalledWith(expect.any(Object), 'life.changed', { playerId: 'player-1', delta: -1 });
    expect(send).not.toHaveBeenCalled();
    expect(core.pending()).toBe(false);
  });

  it('blocks migrated commands without falling back to HTTP when websocket is not connected before sending', async () => {
    isMigratedCommand.mockReturnValue(true);
    websocketSendCommand.mockResolvedValue(false);
    send.mockResolvedValue({ version: 2 });
    const context = commandContext('Action failed.');

    await store.command(context, 'life.changed', { playerId: 'player-1', delta: -1 });

    expect(websocketSendCommand).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(context.setSnapshot).not.toHaveBeenCalled();
    expect(core.error()).toBe('Action failed.');
  });

  it('queues final battlefield position commands and persists them through the websocket path', async () => {
    isMigratedCommand.mockReturnValue(true);
    websocketSendCommand.mockResolvedValue(true);
    const payload = {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      position: { x: 0.25, y: 0.5, unit: 'ratio' },
    };
    const persisted: Promise<void>[] = [];
    const queueBattlefieldPositionCommand = vi.fn((_gameId: string, _payload: Record<string, unknown>, persist: () => Promise<void>) => {
      persisted.push(persist());
      return true;
    });

    await store.command(commandContext('Action failed.', queueBattlefieldPositionCommand), 'card.position.changed', payload);
    await persisted[0]!;

    expect(queueBattlefieldPositionCommand).toHaveBeenCalledWith('game-1', payload, expect.any(Function));
    expect(websocketSendCommand).toHaveBeenCalledWith(expect.any(Object), 'card.position.changed', payload);
    expect(send).not.toHaveBeenCalled();
    expect(core.pending()).toBe(false);
  });
});

function commandContext(
  message: string,
  queueBattlefieldPositionCommand = vi.fn((_gameId: string, _payload: Record<string, unknown>, _persist: () => Promise<void>) => false),
): GameTableCommandContext {
  return {
    setSnapshot: vi.fn(),
    websocket: () => ({
      gameId: () => 'game-1',
      snapshot: () => ({ version: 1 } as never),
      setSnapshot: vi.fn(),
      refetch: vi.fn(),
      setError: vi.fn(),
    }),
    queueBattlefieldPositionCommand,
    errorMessage: (_error: unknown) => message,
  };
}
