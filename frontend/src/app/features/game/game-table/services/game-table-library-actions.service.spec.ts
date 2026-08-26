import { TestBed } from '@angular/core/testing';
import { GameCardInstance, GameCommandType } from '../../../../core/models/game.model';
import { PlayerView } from '../state/core/game-table-snapshot-selectors';
import { GameTableLibraryActionContext, GameTableLibraryActionsService } from './game-table-library-actions.service';

describe('GameTableLibraryActionsService', () => {
  let service: GameTableLibraryActionsService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [GameTableLibraryActionsService] });
    service = TestBed.inject(GameTableLibraryActionsService);
  });

  it('includes the single top card name for the runtime private log entry', async () => {
    const command = vi.fn(async () => undefined);
    const context = libraryContext([libraryCard('top-card', 'Mystic Remora')], command);

    await service.revealTop(context, 'player-1', 'player-2');

    expect(command).toHaveBeenCalledWith('library.reveal_top', {
      playerId: 'player-1',
      count: 1,
      to: 'player-2',
      revealedCardName: 'Mystic Remora',
    });
  });

  it('does not include a card name when revealing multiple top cards', async () => {
    const command = vi.fn(async () => undefined);
    const context = libraryContext([libraryCard('first', 'First'), libraryCard('top-card', 'Second')], command);

    await service.revealTop(context, 'player-1', 'player-2', 2);

    expect(command).toHaveBeenCalledWith('library.reveal_top', {
      playerId: 'player-1',
      count: 2,
      to: 'player-2',
    });
  });
});

function libraryContext(
  library: GameCardInstance[],
  command: (type: GameCommandType, payload: Record<string, unknown>) => Promise<void>,
): GameTableLibraryActionContext {
  const player: PlayerView = {
    id: 'player-1',
    state: {
      user: { id: 'player-1', email: 'player@example.test', displayName: 'Player 1', roles: [] },
      life: 40,
      commanderDamage: {},
      counters: {},
      zones: { library, hand: [], battlefield: [], graveyard: [], exile: [], command: [] },
    },
  };

  return {
    isCurrentPlayer: () => true,
    currentPlayer: () => player,
    focusedPlayer: () => player,
    focusPlayer: vi.fn(),
    setError: vi.fn(),
    command,
  };
}

function libraryCard(instanceId: string, name: string): GameCardInstance {
  return { instanceId, name, tapped: false, zone: 'library' };
}
