import { TestBed } from '@angular/core/testing';
import { GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { SelectedCard } from '../../models/game-table-card.model';
import { GameTableBattlefieldDragCoordinatorService } from '../../services/game-table-battlefield-drag-coordinator.service';
import { GameTableDragService } from '../../services/game-table-drag.service';
import { GameTableDropActionsService } from '../../services/game-table-drop-actions.service';
import { GameTablePointerDragActionsService } from '../../services/game-table-pointer-drag-actions.service';
import { GameTableBattlefieldDragState } from './game-table-battlefield-drag.state';
import { GameTableDragDropContext, GameTableDragDropStore } from './game-table-drag-drop.store';
import { GameTableDropFeedbackState } from './game-table-drop-feedback.state';
import { GameTablePendingTransferState } from '../core/game-table-pending-transfer.state';

describe('GameTableDragDropStore', () => {
  let store: GameTableDragDropStore;
  let dragState: GameTableBattlefieldDragState;
  let pendingTransferState: GameTablePendingTransferState;
  let selectedCards: SelectedCard[];
  let dropOnZone: ReturnType<typeof vi.fn>;
  let updateExternalBattlefieldAlignmentGuide: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dropOnZone = vi.fn().mockResolvedValue(undefined);
    updateExternalBattlefieldAlignmentGuide = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        GameTableDragDropStore,
        GameTableBattlefieldDragState,
        GameTableDropFeedbackState,
        GameTablePendingTransferState,
        {
          provide: GameTableBattlefieldDragCoordinatorService,
          useValue: {
            updateActiveDropTarget: vi.fn(),
            updateHandDropPreview: vi.fn(),
            updateBattlefieldDragAid: vi.fn(),
            updatePointerDropTarget: vi.fn(),
            updateExternalBattlefieldAlignmentGuide,
          },
        },
        {
          provide: GameTableDragService,
          useValue: {
            allowDrop: vi.fn(),
            dragStart: vi.fn(),
            moveCardPointerDrag: vi.fn(),
            cancelCardPointerDrag: vi.fn(),
            pointerDragPreview: vi.fn(),
            startBattlefieldPointerDrag: vi.fn(),
          },
        },
        {
          provide: GameTableDropActionsService,
          useValue: {
            dropOnZone,
            dropOnHand: vi.fn(),
            dropOnHandCard: vi.fn(),
            dropOnPlayer: vi.fn(),
            confirmPendingBattlefieldMove: vi.fn(),
            confirmPendingLibraryMove: vi.fn(),
          },
        },
        {
          provide: GameTablePointerDragActionsService,
          useValue: { endCardPointerDrag: vi.fn() },
        },
      ],
    });

    store = TestBed.inject(GameTableDragDropStore);
    dragState = TestBed.inject(GameTableBattlefieldDragState);
    pendingTransferState = TestBed.inject(GameTablePendingTransferState);
    selectedCards = [];
  });

  it('uses the selected group when the dragged card is part of a same-zone selection', () => {
    selectedCards = [
      selected('player-1', 'hand', 'card-1'),
      selected('player-1', 'hand', 'card-2'),
    ];

    expect(store.selectedDragInstanceIds(context(), 'player-1', 'hand', 'card-2')).toEqual(['card-1', 'card-2']);
  });

  it('falls back to the dragged card when selected cards belong to another zone', () => {
    selectedCards = [
      selected('player-1', 'hand', 'card-1'),
      selected('player-1', 'hand', 'card-2'),
    ];

    expect(store.selectedDragInstanceIds(context(), 'player-1', 'battlefield', 'card-2')).toEqual(['card-2']);
  });

  it('marks mana lane drop targets without leaving stale zone targets', () => {
    dragState.setActiveDropTarget({ playerId: 'player-1', zone: 'graveyard' });

    store.updatePointerDropTarget(context(), {
      kind: 'zone',
      targetPlayerId: 'player-1',
      toZone: 'battlefield',
      rawZone: 'mana',
      draggedInstanceId: 'card-1',
      position: { x: 10, y: 20 },
    });

    expect(dragState.manaLaneDropPlayerId()).toBe('player-1');
    expect(dragState.activeDropTarget()).toBeNull();
    expect(dragState.activePlayerDropTarget()).toBeNull();
    expect(dragState.alignmentGuide()).toBeNull();
  });

  it('updates external battlefield alignment when the pointer target is battlefield', () => {
    store.updatePointerDropTarget(context(), {
      kind: 'zone',
      targetPlayerId: 'player-2',
      toZone: 'battlefield',
      rawZone: 'battlefield',
      draggedInstanceId: 'card-1',
      position: { x: 10, y: 20 },
    });

    expect(dragState.activeDropTarget()).toEqual({ playerId: 'player-2', zone: 'battlefield' });
    expect(updateExternalBattlefieldAlignmentGuide).toHaveBeenCalledWith(
      expect.objectContaining({ zones: ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'] }),
      'player-2',
      'card-1',
      { x: 10, y: 20 },
    );
  });

  it('forwards zone drops through the drag-drop domain', async () => {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as DragEvent;
    const dropContext = {} as never;

    await store.dropOnZone(dropContext, event, 'player-1', 'graveyard');

    expect(dropOnZone).toHaveBeenCalledWith(dropContext, event, 'player-1', 'graveyard');
  });

  it('clears pending transfers when cancelling a pending battlefield move', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    const setPendingBattlefieldMove = vi.fn();
    pendingTransferState.register({
      playerId: 'player-1',
      fromZone: 'hand',
      instanceIds: ['card-1'],
      sourceVersion: 1,
    });

    await store.cancelPendingBattlefieldMove({
      refetch,
      setPendingBattlefieldMove,
      setPendingLibraryMove: vi.fn(),
    });

    expect(pendingTransferState.isCardPending('player-1', 'hand', 'card-1')).toBe(false);
    expect(refetch).toHaveBeenCalledWith(true);
    expect(setPendingBattlefieldMove).toHaveBeenCalledWith(null);
  });

  function context(): GameTableDragDropContext {
    return {
      zones: ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'],
      players: () => [],
      selectedCards: () => selectedCards,
      setSelectedCards: (cards) => {
        selectedCards = cards;
      },
      canControlOwnedCard: () => true,
      battlefieldDragContext: () => ({
        zones: ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'],
        snapshot: () => null,
        selectedCards: () => selectedCards,
        findCard: () => null,
        cardPosition: () => null,
        updateLocalCardPosition: () => undefined,
      }),
      pointerDragActionContext: () => ({} as never),
      updateLocalCardPosition: () => undefined,
      hideCardPreview: () => undefined,
      suppressCardPreview: () => undefined,
      clearHandDropPreview: () => undefined,
      setError: () => undefined,
      applyDeferredRemoteSnapshot: () => undefined,
    };
  }
});

function selected(playerId: string, zone: GameZoneName, instanceId: string): SelectedCard {
  return {
    playerId,
    zone,
    card: card(instanceId),
  };
}

function card(instanceId: string): GameCardInstance {
  return {
    instanceId,
    name: instanceId,
    tapped: false,
  };
}
