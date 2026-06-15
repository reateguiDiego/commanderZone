import { GameCardInstance } from '../../../../core/models/game.model';
import { GameTableDropActionContext, PendingBattlefieldMove, PendingLibraryMove } from './game-table-drop-actions.service';
import { GameTableZonePointerMoveActionsService } from './game-table-zone-pointer-move-actions.service';

describe('GameTableZonePointerMoveActionsService', () => {
  let service: GameTableZonePointerMoveActionsService;

  beforeEach(() => {
    service = new GameTableZonePointerMoveActionsService();
  });

  it('moves a zone card to battlefield with a snapped pointer position', async () => {
    const ctx = context();

    await service.moveZoneCardByPointer(ctx, {
      playerId: 'player-1',
      targetPlayerId: 'player-1',
      fromZone: 'graveyard',
      toZone: 'battlefield',
      instanceId: 'graveyard-1',
      rawZone: 'battlefield',
      position: { x: 100, y: 120 },
    });

    expect(ctx.command).toHaveBeenCalledWith('card.moved', {
      playerId: 'player-1',
      fromZone: 'graveyard',
      toZone: 'battlefield',
      targetPlayerId: 'player-1',
      instanceId: 'graveyard-1',
      position: { x: 100, y: 120, unit: 'ratio' },
    });
  });

  it('moves a public pile commander to command zone through the pointer move path', async () => {
    const commander = { ...card('commander-1', 'Commander', 'graveyard'), isCommander: true };
    const ctx = context({ sourceCard: commander });

    await service.moveZoneCardByPointer(ctx, {
      playerId: 'player-1',
      targetPlayerId: 'player-1',
      fromZone: 'graveyard',
      toZone: 'command',
      instanceId: 'commander-1',
      rawZone: 'command',
    });

    expect(ctx.markPendingTransfer).toHaveBeenCalledWith('player-1', 'graveyard', ['commander-1']);
    expect(ctx.command).toHaveBeenCalledWith('card.moved', {
      playerId: 'player-1',
      fromZone: 'graveyard',
      toZone: 'command',
      targetPlayerId: 'player-1',
      instanceId: 'commander-1',
    });
  });

  it('draws from library when a library pointer drag drops on own hand', async () => {
    const ctx = context({ sourceZone: 'library', sourceCard: card('library-1', 'Top Library Card', 'library') });

    await service.moveZoneCardByPointer(ctx, {
      playerId: 'player-1',
      targetPlayerId: 'player-1',
      fromZone: 'library',
      toZone: 'hand',
      instanceId: 'library-1',
      rawZone: 'hand',
    });

    expect(ctx.command).toHaveBeenCalledWith('library.draw', { playerId: 'player-1', count: 1 });
    expect(ctx.markPendingTransfer).toHaveBeenCalledWith('player-1', 'library', ['library-1']);
  });

  it('preserves the library top-or-bottom confirmation when dropping to library', async () => {
    const pendingLibraryMove = vi.fn();
    const ctx = context({ setPendingLibraryMove: pendingLibraryMove });

    await service.moveZoneCardByPointer(ctx, {
      playerId: 'player-1',
      targetPlayerId: 'player-1',
      fromZone: 'graveyard',
      toZone: 'library',
      instanceId: 'graveyard-1',
      rawZone: 'library',
    });

    expect(pendingLibraryMove).toHaveBeenCalledWith({
      cardName: 'Top Graveyard Card',
      commandType: 'card.moved',
      payload: {
        playerId: 'player-1',
        fromZone: 'graveyard',
        toZone: 'library',
        targetPlayerId: 'player-1',
        instanceId: 'graveyard-1',
      },
    } satisfies PendingLibraryMove);
    expect(ctx.command).not.toHaveBeenCalled();
  });

  it('prepares the existing pending battlefield confirmation when dropping on another player', async () => {
    const pendingBattlefieldMove = vi.fn();
    const ctx = context({ setPendingBattlefieldMove: pendingBattlefieldMove });

    await service.moveZoneCardByPointer(ctx, {
      playerId: 'player-1',
      targetPlayerId: 'player-2',
      fromZone: 'graveyard',
      toZone: 'battlefield',
      instanceId: 'graveyard-1',
    });

    expect(pendingBattlefieldMove).toHaveBeenCalledWith({
      cardName: 'Top Graveyard Card',
      targetPlayerName: 'Player Two',
      payload: {
        playerId: 'player-1',
        fromZone: 'graveyard',
        toZone: 'battlefield',
        targetPlayerId: 'player-2',
        instanceId: 'graveyard-1',
      },
    } satisfies PendingBattlefieldMove);
    expect(ctx.command).not.toHaveBeenCalled();
  });

});

interface ContextOptions {
  sourceZone?: 'library' | 'graveyard';
  sourceCard?: GameCardInstance;
  setPendingBattlefieldMove?: (move: PendingBattlefieldMove | null) => void;
  setPendingLibraryMove?: (move: PendingLibraryMove | null) => void;
}

function context(options: ContextOptions = {}): GameTableDropActionContext {
  const sourceZone = options.sourceZone ?? 'graveyard';
  const sourceCard = options.sourceCard ?? card('graveyard-1', 'Top Graveyard Card', 'graveyard');

  return {
    zones: ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'],
    snapshot: vi.fn(() => null),
    handDropPreview: vi.fn(() => null),
    findCard: vi.fn((_playerId, zone, instanceId) => zone === sourceZone && instanceId === sourceCard.instanceId ? sourceCard : null),
    canControlPlayer: vi.fn(() => true),
    canControlOwnedCard: vi.fn(() => true),
    playerName: vi.fn((playerId) => playerId === 'player-2' ? 'Player Two' : 'Player One'),
    setPendingBattlefieldMove: vi.fn(options.setPendingBattlefieldMove ?? (() => undefined)),
    setPendingLibraryMove: vi.fn(options.setPendingLibraryMove ?? (() => undefined)),
    endCardDrag: vi.fn(),
    clearHandDropPreview: vi.fn(),
    clearSelectedCards: vi.fn(),
    suppressCardPreview: vi.fn(),
    setError: vi.fn(),
    cardPosition: vi.fn(() => null),
    snapBattlefieldPosition: vi.fn((_playerId, _instanceId, position) => ({ ...position, unit: 'ratio' as const })),
    markPendingManaDrop: vi.fn(),
    markPendingTransfer: vi.fn(),
    syncOpenZoneModalAfterMove: vi.fn(async () => undefined),
    command: vi.fn(async () => undefined),
    recordCommanderCastIfNeeded: vi.fn(async () => undefined),
  };
}

function card(instanceId: string, name: string, zone: 'library' | 'graveyard'): GameCardInstance {
  return {
    instanceId,
    name,
    zone,
    tapped: false,
  };
}
