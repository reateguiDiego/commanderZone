import { TestBed } from '@angular/core/testing';
import { GameAttachment, GameBattlefieldStack, GameCardInstance, GameSnapshot, GameZoneName } from '../../../../../core/models/game.model';
import { SelectedCard } from '../../models/game-table-card.model';
import { GameTableBattlefieldDragCoordinatorService } from '../../services/game-table-battlefield-drag-coordinator.service';
import { GameTableDragService } from '../../services/game-table-drag.service';
import { GameTableDropActionsService } from '../../services/game-table-drop-actions.service';
import { GameTablePointerDragActionsService } from '../../services/game-table-pointer-drag-actions.service';
import { PointerDropTarget } from '../../services/game-table-pointer-drag.service';
import { GameTableBattlefieldDragState } from './game-table-battlefield-drag.state';
import { PlayerView } from '../../game-table.store';
import {
  GameTableDragDropContext,
  GameTableDragDropStore,
  LAND_STACK_DROP_PREVIEW_DELAY_MS,
} from './game-table-drag-drop.store';
import { GameTableDropFeedbackState } from './game-table-drop-feedback.state';
import { GameTablePendingTransferState } from '../core/game-table-pending-transfer.state';

const SKIP_DRAG_DROP_FEEDBACK_STORAGE_KEY = 'cz_perf_skip_drag_drop_feedback';
const DRAG_RAF_STORAGE_KEY = 'cz_perf_drag_raf';
const SHARED_HIT_TEST_STORAGE_KEY = 'cz_perf_shared_hit_test';

describe('GameTableDragDropStore', () => {
  let store: GameTableDragDropStore;
  let dragState: GameTableBattlefieldDragState;
  let pendingTransferState: GameTablePendingTransferState;
  let selectedCards: SelectedCard[];
  let dropOnZone: ReturnType<typeof vi.fn>;
  let updateActiveDropTarget: ReturnType<typeof vi.fn>;
  let updateBattlefieldDragAid: ReturnType<typeof vi.fn>;
  let updatePointerDropTarget: ReturnType<typeof vi.fn>;
  let updateExternalBattlefieldAlignmentGuide: ReturnType<typeof vi.fn>;
  let endCardPointerDrag: ReturnType<typeof vi.fn>;
  let dragService: {
    allowDrop: ReturnType<typeof vi.fn>;
    dragStart: ReturnType<typeof vi.fn>;
    dragPayload: ReturnType<typeof vi.fn>;
    dropPosition: ReturnType<typeof vi.fn>;
    dropGeometry: ReturnType<typeof vi.fn>;
    moveCardPointerDrag: ReturnType<typeof vi.fn>;
    hasActivePointerDrag: ReturnType<typeof vi.fn>;
    cancelCardPointerDrag: ReturnType<typeof vi.fn>;
    clearNativeDragPayload: ReturnType<typeof vi.fn>;
    pointerDragPreview: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    window.localStorage.removeItem(SKIP_DRAG_DROP_FEEDBACK_STORAGE_KEY);
    window.localStorage.removeItem(DRAG_RAF_STORAGE_KEY);
    window.localStorage.removeItem(SHARED_HIT_TEST_STORAGE_KEY);
    dropOnZone = vi.fn().mockResolvedValue(undefined);
    updateActiveDropTarget = vi.fn();
    updateBattlefieldDragAid = vi.fn();
    updatePointerDropTarget = vi.fn();
    updateExternalBattlefieldAlignmentGuide = vi.fn();
    endCardPointerDrag = vi.fn();
    dragService = {
      allowDrop: vi.fn().mockReturnValue(true),
      dragStart: vi.fn(),
      dragPayload: vi.fn().mockReturnValue(null),
      dropPosition: vi.fn().mockReturnValue(null),
      dropGeometry: vi.fn().mockReturnValue({
        position: { x: 100, y: 200 },
        cardSize: { width: 103, height: 144 },
      }),
      moveCardPointerDrag: vi.fn(),
      hasActivePointerDrag: vi.fn().mockReturnValue(false),
      cancelCardPointerDrag: vi.fn(),
      clearNativeDragPayload: vi.fn(),
      pointerDragPreview: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        GameTableDragDropStore,
        GameTableBattlefieldDragState,
        GameTableDropFeedbackState,
        GameTablePendingTransferState,
        {
          provide: GameTableBattlefieldDragCoordinatorService,
          useValue: {
            updateActiveDropTarget,
            updateHandDropPreview: vi.fn(),
            updateBattlefieldDragAid,
            updatePointerDropTarget,
            updateExternalBattlefieldAlignmentGuide,
          },
        },
        {
          provide: GameTableDragService,
          useValue: {
            allowDrop: dragService.allowDrop,
            dragStart: dragService.dragStart,
            dragPayload: dragService.dragPayload,
            dropPosition: dragService.dropPosition,
            dropGeometry: dragService.dropGeometry,
            moveCardPointerDrag: dragService.moveCardPointerDrag,
            hasActivePointerDrag: dragService.hasActivePointerDrag,
            cancelCardPointerDrag: dragService.cancelCardPointerDrag,
            clearNativeDragPayload: dragService.clearNativeDragPayload,
            pointerDragPreview: dragService.pointerDragPreview,
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
          useValue: { endCardPointerDrag },
        },
      ],
    });

    store = TestBed.inject(GameTableDragDropStore);
    dragState = TestBed.inject(GameTableBattlefieldDragState);
    pendingTransferState = TestBed.inject(GameTablePendingTransferState);
    selectedCards = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.localStorage.removeItem(SKIP_DRAG_DROP_FEEDBACK_STORAGE_KEY);
    window.localStorage.removeItem(DRAG_RAF_STORAGE_KEY);
    window.localStorage.removeItem(SHARED_HIT_TEST_STORAGE_KEY);
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

  it('uses explicit instance ids when starting a native drag', () => {
    selectedCards = [
      selected('player-1', 'graveyard', 'commander-1'),
      selected('player-1', 'graveyard', 'normal-1'),
    ];
    const commander = { ...card('commander-1'), isCommander: true };
    const event = { preventDefault: vi.fn() } as unknown as DragEvent;

    store.dragStart(context(), event, 'player-1', 'graveyard', commander, ['commander-1']);

    expect(dragService.dragStart).toHaveBeenCalledWith(event, 'player-1', 'graveyard', commander, ['commander-1']);
    expect(dragState.draggingCardInstanceId()).toBe('commander-1');
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

  it('prioritizes hand drop target over mana row when both overlap', () => {
    dragState.setManaLaneDropPlayer('player-1');
    dragState.setLandStackDropPreview({ playerId: 'player-1', targetInstanceId: 'target', kind: 'land', nextSize: 2 });

    store.updatePointerDropTarget(context(), {
      kind: 'zone',
      targetPlayerId: 'player-1',
      toZone: 'hand',
      rawZone: 'mana',
      draggedInstanceId: 'card-1',
      position: { x: 10, y: 20 },
    });

    expect(dragState.activeDropTarget()).toEqual({ playerId: 'player-1', zone: 'hand' });
    expect(dragState.manaLaneDropPlayerId()).toBeNull();
    expect(dragState.alignmentGuide()).toBeNull();
    expect(dragState.landStackDropPreview()).toBeNull();
  });

  it('shows a relation preview instead of alignment for a hand card pointer-dragged over a battlefield target', () => {
    vi.useFakeTimers();
    const dragged = permanent('dragged', 0, 0);
    const target = permanent('target', 100, 200);
    const ctx = context([playerView([target], [dragged])]);

    store.updatePointerDropTarget(ctx, {
      kind: 'zone',
      targetPlayerId: 'player-1',
      toZone: 'battlefield',
      rawZone: 'battlefield',
      draggedInstanceId: 'dragged',
      position: { x: 100, y: 200 },
    });
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(updateExternalBattlefieldAlignmentGuide).not.toHaveBeenCalled();
    expect(dragState.activeDropTarget()).toBeNull();
    expect(dragState.landStackDropPreview()).toEqual({
      playerId: 'player-1',
      targetInstanceId: 'target',
      kind: 'attachment',
    });
  });

  it('shows a land stack preview for a hand land pointer-dragged over a mana row land', () => {
    vi.useFakeTimers();
    const dragged = land('dragged', 0, 0);
    const target = land('target', 100, 200);
    const ctx = context([playerView([target], [dragged])]);

    store.updatePointerDropTarget(ctx, {
      kind: 'zone',
      targetPlayerId: 'player-1',
      toZone: 'battlefield',
      rawZone: 'mana',
      draggedInstanceId: 'dragged',
      position: { x: 100, y: 200 },
    });
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(dragState.manaLaneDropPlayerId()).toBeNull();
    expect(dragState.landStackDropPreview()).toEqual({
      playerId: 'player-1',
      targetInstanceId: 'target',
      kind: 'land',
      nextSize: 2,
    });
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
    expect(store.isPlayerDropHighlighted('player-2')).toBe(true);
    expect(store.isPlayerDropHighlighted('player-1')).toBe(false);
    expect(store.isDropZoneHighlighted('player-2', 'battlefield')).toBe(true);
    expect(store.isDropZoneHighlighted('player-1', 'battlefield')).toBe(false);
    expect(updateExternalBattlefieldAlignmentGuide).toHaveBeenCalledWith(
      expect.objectContaining({ zones: ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'] }),
      'player-2',
      'card-1',
      { x: 10, y: 20 },
    );
  });

  it('highlights only an opponent battlefield when the player is the drop target', () => {
    dragState.setActivePlayerDropTarget('player-2');

    expect(store.isDropZoneHighlighted('player-2', 'battlefield')).toBe(true);
    expect(store.isDropZoneHighlighted('player-2', 'graveyard')).toBe(false);
    expect(store.isDropZoneHighlighted('player-1', 'battlefield')).toBe(false);
  });

  it('does not select the whole land stack when the top card only starts a battlefield pointer drag', () => {
    const top = land('top', 100, 200);
    const under = land('under', 100, 180);
    const ctx = context([playerView([top, under])], null, [stack('stack-under', 'under', 'top')]);

    store.startBattlefieldPointerDrag(ctx, { detail: 1, shiftKey: false } as PointerEvent, 'player-1', top);

    expect(selectedCards).toEqual([]);
  });

  it('selects the whole land stack once the top card drag actually moves', () => {
    const top = land('top', 100, 200);
    const under = land('under', 100, 180);
    const ctx = context([playerView([top, under])], null, [stack('stack-under', 'under', 'top')]);
    dragService.moveCardPointerDrag.mockReturnValue('top');
    dragService.pointerDragPreview.mockReturnValue({ x: 100, y: 200, width: 103, height: 144 });
    dragState.setActiveDropTarget({ playerId: 'player-1', zone: 'graveyard' });
    dragState.setLandStackDropPreview({ playerId: 'player-1', targetInstanceId: 'old-target', kind: 'land', nextSize: 2 });

    store.startBattlefieldPointerDrag(ctx, { detail: 1, shiftKey: false } as PointerEvent, 'player-1', top);
    top.position = { x: 360, y: 200 };
    store.moveCardPointerDrag(ctx, {} as PointerEvent);

    expect(selectedCards.map((item) => item.card.instanceId)).toEqual(['top', 'under']);
    expect(dragState.activeDropTarget()).toEqual({ playerId: 'player-1', zone: 'graveyard' });
    expect(dragState.landStackDropPreview()).toBeNull();
  });

  it('does not promote a loose dragged land into a whole stack when its transient position overlaps a stack', () => {
    const dragged = land('dragged', 340, 200);
    const top = land('top', 100, 200);
    const under = land('under', 100, 182);
    const ctx = context([playerView([dragged, top, under])], null, [stack('stack-under', 'under', 'top')]);
    dragService.moveCardPointerDrag.mockReturnValue('dragged');
    dragService.pointerDragPreview.mockReturnValue({ x: 100, y: 214, width: 103, height: 144 });

    store.startBattlefieldPointerDrag(ctx, { detail: 1, shiftKey: false } as PointerEvent, 'player-1', dragged);
    dragged.position = { x: 100, y: 214 };
    store.moveCardPointerDrag(ctx, {} as PointerEvent);

    expect(selectedCards.map((item) => item.card.instanceId)).toEqual(['dragged']);
    expect(updateBattlefieldDragAid).not.toHaveBeenCalled();
    expect(dragState.manaLaneDropPlayerId()).toBeNull();
    expect(dragState.alignmentGuide()).toBeNull();
  });

  it('keeps mana lane targeting while dragging a whole land stack over mana row', () => {
    const top = land('top', 100, 200);
    const under = land('under', 100, 182);
    const ctx = context([playerView([top, under])], null, [stack('stack-under', 'under', 'top')]);
    dragService.moveCardPointerDrag.mockReturnValue('top');
    dragService.pointerDragPreview.mockReturnValue({ x: 100, y: 200, width: 103, height: 144 });
    updateBattlefieldDragAid.mockImplementation(() => {
      dragState.setManaLaneDropPlayer('player-1');
    });
    updatePointerDropTarget.mockImplementation(() => dragState.setActiveDropTarget({ playerId: 'player-1', zone: 'battlefield' }));

    store.startBattlefieldPointerDrag(ctx, { detail: 1, shiftKey: false } as PointerEvent, 'player-1', top);
    top.position = { x: 360, y: 200 };
    store.moveCardPointerDrag(ctx, {} as PointerEvent);

    expect(selectedCards.map((item) => item.card.instanceId)).toEqual(['top', 'under']);
    expect(updateBattlefieldDragAid).toHaveBeenCalled();
    expect(updatePointerDropTarget).toHaveBeenCalled();
    expect(dragState.manaLaneDropPlayerId()).toBe('player-1');
    expect(dragState.activeDropTarget()).toBeNull();
    expect(dragState.landStackDropPreview()).toBeNull();
  });

  it('keeps pointermove local and does not finish persistent drag commands before drop', () => {
    const dragged = land('dragged', 340, 200);
    const target = land('target', 100, 200);
    const ctx = context([playerView([dragged, target])]);
    dragService.moveCardPointerDrag.mockReturnValue('dragged');
    dragService.pointerDragPreview.mockReturnValue({ x: 180, y: 220, width: 103, height: 144 });

    store.moveCardPointerDrag(ctx, { clientX: 200, clientY: 240 } as PointerEvent);

    expect(dragService.moveCardPointerDrag).toHaveBeenCalled();
    expect(endCardPointerDrag).not.toHaveBeenCalled();
    expect(dropOnZone).not.toHaveBeenCalled();
  });

  it('keeps transient pointer movement on the existing snapshot path when the feedback flag is disabled', () => {
    const updateLocalCardPosition = vi.fn();
    dragService.moveCardPointerDrag.mockImplementation(
      (_event: PointerEvent, updateLocalPosition: (playerId: string, instanceId: string, position: { x: number; y: number }) => void) => {
        updateLocalPosition('player-1', 'dragged', { x: 180, y: 220 });
        return null;
      },
    );
    window.localStorage.setItem(SKIP_DRAG_DROP_FEEDBACK_STORAGE_KEY, '1');

    store.moveCardPointerDrag({ ...context(), updateLocalCardPosition }, {} as PointerEvent);

    expect(updateLocalCardPosition).toHaveBeenCalledOnce();
    expect(updateLocalCardPosition).toHaveBeenCalledWith('player-1', 'dragged', { x: 180, y: 220 });
  });

  it('marks only transient pointer movement to skip drop feedback when the flag is enabled', () => {
    const enabledStore = createStoreWithSkipDragDropFeedback(true);
    const updateLocalCardPosition = vi.fn();
    dragService.moveCardPointerDrag.mockImplementation(
      (_event: PointerEvent, updateLocalPosition: (playerId: string, instanceId: string, position: { x: number; y: number }) => void) => {
        updateLocalPosition('player-1', 'dragged', { x: 180, y: 220 });
        return null;
      },
    );

    enabledStore.moveCardPointerDrag({ ...context(), updateLocalCardPosition }, {} as PointerEvent);

    expect(updateLocalCardPosition).toHaveBeenCalledOnce();
    expect(updateLocalCardPosition).toHaveBeenCalledWith(
      'player-1',
      'dragged',
      { x: 180, y: 220 },
      { transientPointerDrag: true },
    );
  });

  it('does not enable skipped feedback when drag RAF is enabled on its own', () => {
    window.localStorage.setItem(DRAG_RAF_STORAGE_KEY, '1');
    const rafOnlyStore = createStoreWithSkipDragDropFeedback(false);
    const updateLocalCardPosition = vi.fn();
    dragService.moveCardPointerDrag.mockImplementation(
      (_event: PointerEvent, updateLocalPosition: (playerId: string, instanceId: string, position: { x: number; y: number }) => void) => {
        updateLocalPosition('player-1', 'dragged', { x: 180, y: 220 });
        return null;
      },
    );

    rafOnlyStore.moveCardPointerDrag({ ...context(), updateLocalCardPosition }, {} as PointerEvent);

    expect(updateLocalCardPosition).toHaveBeenCalledOnce();
    expect(updateLocalCardPosition).toHaveBeenCalledWith('player-1', 'dragged', { x: 180, y: 220 });
  });

  it('keeps transient feedback skipping active when drag RAF and feedback flags are both enabled', () => {
    window.localStorage.setItem(DRAG_RAF_STORAGE_KEY, '1');
    const enabledStore = createStoreWithSkipDragDropFeedback(true);
    const updateLocalCardPosition = vi.fn();
    dragService.moveCardPointerDrag.mockImplementation(
      (_event: PointerEvent, updateLocalPosition: (playerId: string, instanceId: string, position: { x: number; y: number }) => void) => {
        updateLocalPosition('player-1', 'dragged', { x: 180, y: 220 });
        return null;
      },
    );

    enabledStore.moveCardPointerDrag({ ...context(), updateLocalCardPosition }, {} as PointerEvent);

    expect(updateLocalCardPosition).toHaveBeenCalledWith(
      'player-1',
      'dragged',
      { x: 180, y: 220 },
      { transientPointerDrag: true },
    );
  });

  it('shares one ordered hit test across pointer drop target and battlefield aid when enabled', () => {
    const enabledStore = createStoreWithSharedHitTest(true);
    const dragged = permanent('dragged', 100, 200);
    const ctx = context([playerView([dragged])]);
    const event = { clientX: 180, clientY: 220 } as PointerEvent;
    const hitTestElements = [document.createElement('div')];
    const originalElementsFromPoint = document.elementsFromPoint;
    const elementsFromPoint = vi.fn(() => hitTestElements);
    dragService.moveCardPointerDrag.mockReturnValue('dragged');
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: elementsFromPoint,
    });

    try {
      enabledStore.moveCardPointerDrag(ctx, event);

      expect(elementsFromPoint).toHaveBeenCalledOnce();
      expect(elementsFromPoint).toHaveBeenCalledWith(180, 220);
      expect(updatePointerDropTarget.mock.calls[0]?.[2]).toBe(hitTestElements);
      expect(updateBattlefieldDragAid.mock.calls[0]?.[3]).toBe(hitTestElements);
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
    }
  });

  it('refreshes the shared hit test for each processed pointer move', () => {
    const enabledStore = createStoreWithSharedHitTest(true);
    const dragged = permanent('dragged', 100, 200);
    const ctx = context([playerView([dragged])]);
    const firstHitTestElements = [document.createElement('div')];
    const secondHitTestElements = [document.createElement('div')];
    const originalElementsFromPoint = document.elementsFromPoint;
    const elementsFromPoint = vi
      .fn()
      .mockReturnValueOnce(firstHitTestElements)
      .mockReturnValueOnce(secondHitTestElements);
    dragService.moveCardPointerDrag.mockReturnValue('dragged');
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: elementsFromPoint,
    });

    try {
      enabledStore.moveCardPointerDrag(ctx, { clientX: 180, clientY: 220 } as PointerEvent);
      enabledStore.moveCardPointerDrag(ctx, { clientX: 240, clientY: 280 } as PointerEvent);

      expect(elementsFromPoint).toHaveBeenCalledTimes(2);
      expect(updatePointerDropTarget.mock.calls[0]?.[2]).toBe(firstHitTestElements);
      expect(updatePointerDropTarget.mock.calls[1]?.[2]).toBe(secondHitTestElements);
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
    }
  });

  it('keeps the existing coordinator calls without a shared hit test when disabled', () => {
    const dragged = permanent('dragged', 100, 200);
    const ctx = context([playerView([dragged])]);
    const event = { clientX: 180, clientY: 220 } as PointerEvent;
    const originalElementsFromPoint = document.elementsFromPoint;
    const elementsFromPoint = vi.fn(() => []);
    dragService.moveCardPointerDrag.mockReturnValue('dragged');
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: elementsFromPoint,
    });

    try {
      store.moveCardPointerDrag(ctx, event);

      expect(elementsFromPoint).not.toHaveBeenCalled();
      expect(updatePointerDropTarget.mock.calls[0]).toHaveLength(2);
      expect(updateBattlefieldDragAid.mock.calls[0]).toHaveLength(3);
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
    }
  });

  it('does not read a snapshot for feedback reconciliation while the flag is disabled', async () => {
    const snapshot = vi.fn(() => null);
    endCardPointerDrag.mockResolvedValue(undefined);
    const ctx = { ...context(), snapshot };

    await store.endCardPointerDrag(ctx, {} as PointerEvent);
    store.cancelCardPointerDrag(ctx, {} as PointerEvent);
    store.dragEnd(ctx);

    expect(snapshot).not.toHaveBeenCalled();
  });

  it('reconciles skipped drop feedback once when pointerup does not publish a final snapshot', async () => {
    const enabledStore = createStoreWithSkipDragDropFeedback(true);
    let currentSnapshot = gameSnapshot(1);
    const updateLocalCardPosition = vi.fn(() => {
      currentSnapshot = { ...currentSnapshot };
    });
    const trackSnapshot = vi
      .spyOn(TestBed.inject(GameTableDropFeedbackState), 'trackSnapshot')
      .mockImplementation(() => undefined);
    let resolvePointerDragAction: () => void = () => {
      throw new Error('Pointer drag action completion was not initialized.');
    };
    endCardPointerDrag.mockImplementation(() => new Promise<void>((resolve) => {
      resolvePointerDragAction = resolve;
    }));
    dragService.moveCardPointerDrag.mockImplementation(
      (_event: PointerEvent, updateLocalPosition: (playerId: string, instanceId: string, position: { x: number; y: number }) => void) => {
        updateLocalPosition('player-1', 'dragged', { x: 180, y: 220 });
        return null;
      },
    );
    const ctx = {
      ...context([], currentSnapshot),
      snapshot: () => currentSnapshot,
      updateLocalCardPosition,
    };

    enabledStore.moveCardPointerDrag(ctx, {} as PointerEvent);
    const completion = enabledStore.endCardPointerDrag(ctx, {} as PointerEvent);

    expect(trackSnapshot).toHaveBeenCalledOnce();
    expect(trackSnapshot).toHaveBeenCalledWith(currentSnapshot);
    resolvePointerDragAction();
    await completion;
  });

  it('reconciles skipped feedback once on pointer cancellation', () => {
    const enabledStore = createStoreWithSkipDragDropFeedback(true);
    let currentSnapshot = gameSnapshot(1);
    const updateLocalCardPosition = vi.fn(() => {
      currentSnapshot = { ...currentSnapshot };
    });
    const trackSnapshot = vi
      .spyOn(TestBed.inject(GameTableDropFeedbackState), 'trackSnapshot')
      .mockImplementation(() => undefined);
    dragService.moveCardPointerDrag.mockImplementation(
      (_event: PointerEvent, updateLocalPosition: (playerId: string, instanceId: string, position: { x: number; y: number }) => void) => {
        updateLocalPosition('player-1', 'dragged', { x: 180, y: 220 });
        return null;
      },
    );
    const ctx = {
      ...context([], currentSnapshot),
      snapshot: () => currentSnapshot,
      updateLocalCardPosition,
    };

    enabledStore.moveCardPointerDrag(ctx, {} as PointerEvent);
    enabledStore.cancelCardPointerDrag(ctx, {} as PointerEvent);

    expect(trackSnapshot).toHaveBeenCalledOnce();
    expect(trackSnapshot).toHaveBeenCalledWith(currentSnapshot);
  });

  it('reconciles skipped feedback once when the drag ends through the native cleanup path', () => {
    const enabledStore = createStoreWithSkipDragDropFeedback(true);
    let currentSnapshot = gameSnapshot(1);
    const updateLocalCardPosition = vi.fn(() => {
      currentSnapshot = { ...currentSnapshot };
    });
    const trackSnapshot = vi
      .spyOn(TestBed.inject(GameTableDropFeedbackState), 'trackSnapshot')
      .mockImplementation(() => undefined);
    dragService.moveCardPointerDrag.mockImplementation(
      (_event: PointerEvent, updateLocalPosition: (playerId: string, instanceId: string, position: { x: number; y: number }) => void) => {
        updateLocalPosition('player-1', 'dragged', { x: 180, y: 220 });
        return null;
      },
    );
    const ctx = {
      ...context([], currentSnapshot),
      snapshot: () => currentSnapshot,
      updateLocalCardPosition,
    };

    enabledStore.moveCardPointerDrag(ctx, {} as PointerEvent);
    enabledStore.dragEnd(ctx);

    expect(trackSnapshot).toHaveBeenCalledOnce();
    expect(trackSnapshot).toHaveBeenCalledWith(currentSnapshot);
  });

  it('does not add a reconciliation when final pointerup already publishes a normal snapshot', async () => {
    const enabledStore = createStoreWithSkipDragDropFeedback(true);
    let currentSnapshot = gameSnapshot(1);
    const updateLocalCardPosition = vi.fn(() => {
      currentSnapshot = { ...currentSnapshot };
    });
    const trackSnapshot = vi
      .spyOn(TestBed.inject(GameTableDropFeedbackState), 'trackSnapshot')
      .mockImplementation(() => undefined);
    endCardPointerDrag.mockImplementation(async () => {
      currentSnapshot = { ...currentSnapshot };
      trackSnapshot(currentSnapshot);
    });
    dragService.moveCardPointerDrag.mockImplementation(
      (_event: PointerEvent, updateLocalPosition: (playerId: string, instanceId: string, position: { x: number; y: number }) => void) => {
        updateLocalPosition('player-1', 'dragged', { x: 180, y: 220 });
        return null;
      },
    );
    const ctx = {
      ...context([], currentSnapshot),
      snapshot: () => currentSnapshot,
      updateLocalCardPosition,
    };

    enabledStore.moveCardPointerDrag(ctx, {} as PointerEvent);
    await enabledStore.endCardPointerDrag(ctx, {} as PointerEvent);

    expect(trackSnapshot).toHaveBeenCalledOnce();
    expect(trackSnapshot).toHaveBeenCalledWith(currentSnapshot);
  });

  it('marks an under land as a detach source when it starts a battlefield pointer drag', () => {
    const top = land('top', 100, 200);
    const under = land('under', 100, 180);
    const ctx = context([playerView([top, under])], null, [stack('stack-under', 'under', 'top')]);

    store.startBattlefieldPointerDrag(ctx, { detail: 1, shiftKey: false } as PointerEvent, 'player-1', under);

    expect(selectedCards.map((item) => item.card.instanceId)).toEqual(['under']);
    expect(dragState.landStackDetachSource()).toEqual(expect.objectContaining({
      playerId: 'player-1',
      detachedInstanceId: 'under',
    }));
  });

  it('marks the bottom land as a detach source when it starts a battlefield pointer drag', () => {
    const top = land('top', 100, 200);
    const middle = land('middle', 100, 182);
    const bottom = land('bottom', 100, 164);
    const ctx = context([playerView([top, middle, bottom])], null, [
      stack('stack-middle', 'middle', 'top'),
      stack('stack-bottom', 'bottom', 'top'),
    ]);

    store.startBattlefieldPointerDrag(ctx, { detail: 1, shiftKey: false } as PointerEvent, 'player-1', bottom);

    expect(selectedCards.map((item) => item.card.instanceId)).toEqual(['bottom']);
    expect(dragState.landStackDetachSource()).toEqual(expect.objectContaining({
      playerId: 'player-1',
      detachedInstanceId: 'bottom',
    }));
  });

  it('debounces land stack drop preview while hovering a stack target', () => {
    vi.useFakeTimers();
    const dragged = land('dragged', 100, 200);
    const target = land('target', 100, 200);
    const ctx = context([playerView([dragged, target])]);
    dragService.moveCardPointerDrag.mockReturnValue('dragged');
    dragService.pointerDragPreview.mockReturnValue({ x: 100, y: 200, width: 103, height: 144 });

    store.moveCardPointerDrag(ctx, {} as PointerEvent);

    expect(dragState.landStackDropPreview()).toBeNull();

    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS - 1);
    expect(dragState.landStackDropPreview()).toBeNull();

    vi.advanceTimersByTime(1);
    expect(dragState.landStackDropPreview()).toEqual({
      playerId: 'player-1',
      targetInstanceId: 'target',
      kind: 'land',
      nextSize: 2,
    });
  });

  it('does not apply battlefield alignment snap while hovering a valid land stack target', () => {
    vi.useFakeTimers();
    const dragged = land('dragged', 100, 200);
    const target = land('target', 100, 200);
    const ctx = context([playerView([dragged, target])]);
    dragService.moveCardPointerDrag.mockReturnValue('dragged');
    dragService.pointerDragPreview.mockReturnValue({ x: 100, y: 200, width: 103, height: 144 });
    dragState.setAlignmentGuide({ playerId: 'player-1', y: 200, referenceInstanceIds: ['previous'] });
    dragState.setManaLaneDropPlayer('player-1');

    store.moveCardPointerDrag(ctx, {} as PointerEvent);
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(updatePointerDropTarget).toHaveBeenCalled();
    expect(updateBattlefieldDragAid).not.toHaveBeenCalled();
    expect(dragState.alignmentGuide()).toBeNull();
    expect(dragState.manaLaneDropPlayerId()).toBeNull();
    expect(dragState.landStackDropPreview()).toEqual({
      playerId: 'player-1',
      targetInstanceId: 'target',
      kind: 'land',
      nextSize: 2,
    });
  });

  it('shows the stack top as native land preview target when dragging over the under card of a two-card stack', () => {
    vi.useFakeTimers();
    const dragged = land('dragged', 0, 0);
    const top = land('top', 100, 200);
    const under = land('under', 100, 182);
    const battlefield = document.createElement('div');
    battlefield.dataset['gameDropZone'] = 'battlefield';
    battlefield.dataset['playerId'] = 'player-1';
    const ctx = context([playerView([top, under], [dragged])], null, [stack('stack-under', 'under', 'top')]);
    dragService.dragPayload.mockReturnValue({
      playerId: 'player-1',
      zone: 'hand',
      instanceId: 'dragged',
      instanceIds: ['dragged'],
    });
    dragService.dropPosition.mockReturnValue({ x: 100, y: 200 });
    store.beginCardDrag(ctx, 'dragged');

    const underCardElement = document.createElement('button');
    underCardElement.setAttribute('data-testid', 'game-card');
    underCardElement.setAttribute('data-zone', 'battlefield');
    underCardElement.setAttribute('data-card-instance-id', 'under');
    underCardElement.setAttribute('data-owner-player-id', 'player-1');
    underCardElement.classList.add('land-stack-under');
    underCardElement.getBoundingClientRect = () => ({
      x: 200,
      y: 200,
      left: 200,
      top: 200,
      right: 260,
      bottom: 260,
      width: 60,
      height: 60,
      toJSON: () => ({}),
    }) as DOMRect;
    document.body.appendChild(underCardElement);

    store.allowDrop(ctx, { currentTarget: battlefield, clientX: 220, clientY: 220 } as unknown as DragEvent);
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(dragState.landStackDropPreview()).toEqual({
      playerId: 'player-1',
      targetInstanceId: 'top',
      kind: 'land',
      nextSize: 3,
    });
    underCardElement.remove();
  });

  it('uses the nested battlefield as the native Grid dragover geometry target', () => {
    vi.useFakeTimers();
    const dragged = permanent('dragged', 0, 0);
    const target = permanent('target', 100, 200);
    const playerCell = document.createElement('section');
    playerCell.classList.add('player-cell');
    const battlefield = battlefieldDropTarget();
    playerCell.appendChild(battlefield);
    const ctx = context([playerView([target], [dragged])]);
    dragService.dragPayload.mockReturnValue({
      playerId: 'player-1',
      zone: 'hand',
      instanceId: 'dragged',
      instanceIds: ['dragged'],
    });
    dragService.dropGeometry.mockImplementation((_event: DragEvent, _zone, target) => target === battlefield
      ? { position: { x: 100, y: 200 }, cardSize: { width: 103, height: 144 } }
      : null,
    );

    store.allowDrop(ctx, {
      currentTarget: playerCell,
      target: battlefield,
      clientX: 220,
      clientY: 220,
    } as unknown as DragEvent);
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(dragService.dropGeometry).toHaveBeenCalledWith(
      expect.objectContaining({ currentTarget: playerCell }),
      'battlefield',
      battlefield,
    );
    expect(dragState.landStackDropPreview()).toEqual({
      playerId: 'player-1',
      targetInstanceId: 'target',
      kind: 'attachment',
    });
  });

  it('does not preview a native Grid land stack relation below the 70% overlap threshold', () => {
    vi.useFakeTimers();
    const dragged = land('dragged', 0, 0);
    const target = land('target', 0, 0);
    const battlefield = battlefieldDropTarget();
    const ctx: GameTableDragDropContext = {
      ...context([playerView([target], [dragged])]),
      stackDropOverlapRatio: () => 0.7,
    };
    dragService.dragPayload.mockReturnValue({
      playerId: 'player-1',
      zone: 'hand',
      instanceId: 'dragged',
      instanceIds: ['dragged'],
    });
    dragService.dropGeometry.mockReturnValue({
      position: { x: 40, y: 0 },
      cardSize: { width: 100, height: 100 },
    });

    store.allowDrop(ctx, { currentTarget: battlefield, target: battlefield } as unknown as DragEvent);
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(dragState.landStackDropPreview()).toBeNull();
  });

  it('does not preview a native Grid attachment relation below the 70% overlap threshold', () => {
    vi.useFakeTimers();
    const dragged = permanent('dragged', 0, 0);
    const target = permanent('target', 0, 0);
    const battlefield = battlefieldDropTarget();
    const ctx: GameTableDragDropContext = {
      ...context([playerView([target], [dragged])]),
      stackDropOverlapRatio: () => 0.7,
    };
    dragService.dragPayload.mockReturnValue({
      playerId: 'player-1',
      zone: 'hand',
      instanceId: 'dragged',
      instanceIds: ['dragged'],
    });
    dragService.dropGeometry.mockReturnValue({
      position: { x: 40, y: 0 },
      cardSize: { width: 100, height: 100 },
    });

    store.allowDrop(ctx, { currentTarget: battlefield, target: battlefield } as unknown as DragEvent);
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(dragState.landStackDropPreview()).toBeNull();
  });

  it('previews a deliberate Grid land stack but not a land dropped far from the battlefield cards', () => {
    vi.useFakeTimers();
    const dragged = land('dragged', 0, 0);
    const target = land('target', 100, 200);
    const ctx = gridContext([playerView([target], [dragged])]);

    store.updatePointerDropTarget(ctx, battlefieldPointerTarget('dragged', { x: 100, y: 200 }));
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(dragState.landStackDropPreview()).toEqual({
      playerId: 'player-1',
      targetInstanceId: 'target',
      kind: 'land',
      nextSize: 2,
    });

    store.updatePointerDropTarget(ctx, battlefieldPointerTarget('dragged', { x: 480, y: 480 }));
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(dragState.landStackDropPreview()).toBeNull();
  });

  it('previews a deliberate Grid attachment but not an attachment dropped far from the battlefield cards', () => {
    vi.useFakeTimers();
    const dragged = permanent('dragged', 0, 0);
    const target = permanent('target', 100, 200);
    const ctx = gridContext([playerView([target], [dragged])]);

    store.updatePointerDropTarget(ctx, battlefieldPointerTarget('dragged', { x: 100, y: 200 }));
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(dragState.landStackDropPreview()).toEqual({
      playerId: 'player-1',
      targetInstanceId: 'target',
      kind: 'attachment',
    });

    store.updatePointerDropTarget(ctx, battlefieldPointerTarget('dragged', { x: 480, y: 480 }));
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(dragState.landStackDropPreview()).toBeNull();
  });

  it('keeps a Grid land detach source while a land being unstacked moves far from its original stack', () => {
    vi.useFakeTimers();
    const top = land('top', 100, 200);
    const under = land('under', 110, 182);
    const ctx = gridContext([playerView([top, under])], null, [stack('stack-under', 'under', 'top')]);
    dragService.moveCardPointerDrag.mockReturnValue('under');
    dragService.pointerDragPreview.mockReturnValue({ x: 480, y: 480, width: 120, height: 168 });

    store.startBattlefieldPointerDrag(ctx, { detail: 1, shiftKey: false } as PointerEvent, 'player-1', under);
    under.position = { x: 480, y: 480 };
    store.moveCardPointerDrag(ctx, { clientX: 540, clientY: 540 } as PointerEvent);
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(dragState.landStackDetachSource()).toEqual(expect.objectContaining({
      playerId: 'player-1',
      detachedInstanceId: 'under',
    }));
    expect(dragState.landStackDropPreview()).toBeNull();
  });

  it('keeps a Grid attachment detach source while equipment being detached moves far from its original target', () => {
    vi.useFakeTimers();
    const target = permanent('target', 100, 200);
    const equipment = permanent('equipment', 110, 182);
    const ctx = gridContext(
      [playerView([target, equipment])],
      { attachments: [attachment('attachment-equipment', 'equipment', 'target')] } as GameSnapshot,
    );
    dragService.moveCardPointerDrag.mockReturnValue('equipment');
    dragService.pointerDragPreview.mockReturnValue({ x: 480, y: 480, width: 120, height: 168 });

    store.startBattlefieldPointerDrag(ctx, { detail: 1, shiftKey: false } as PointerEvent, 'player-1', equipment);
    equipment.position = { x: 480, y: 480 };
    store.moveCardPointerDrag(ctx, { clientX: 540, clientY: 540 } as PointerEvent);
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(dragState.attachmentStackDetachSource()).toEqual(expect.objectContaining({
      playerId: 'player-1',
      detachedInstanceId: 'equipment',
      attachmentId: 'attachment-equipment',
    }));
    expect(dragState.landStackDropPreview()).toBeNull();
  });

  it('suppresses mana row relation previews while the active pointer target is hand', () => {
    vi.useFakeTimers();
    const dragged = land('dragged', 100, 200);
    const target = land('target', 100, 200);
    const ctx = context([playerView([dragged, target])]);
    dragService.moveCardPointerDrag.mockReturnValue('dragged');
    dragService.pointerDragPreview.mockReturnValue({ x: 100, y: 200, width: 103, height: 144 });
    updatePointerDropTarget.mockImplementation(() => {
      dragState.setActiveDropTarget({ playerId: 'player-1', zone: 'hand' });
    });

    store.moveCardPointerDrag(ctx, {} as PointerEvent);
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(updatePointerDropTarget).toHaveBeenCalled();
    expect(updateBattlefieldDragAid).not.toHaveBeenCalled();
    expect(dragState.manaLaneDropPlayerId()).toBeNull();
    expect(dragState.alignmentGuide()).toBeNull();
    expect(dragState.landStackDropPreview()).toBeNull();
  });

  it('debounces attachment drop preview while hovering a valid permanent target', () => {
    vi.useFakeTimers();
    const dragged = permanent('dragged', 100, 200);
    const target = permanent('target', 100, 200);
    const ctx = context([playerView([dragged, target])]);
    dragService.moveCardPointerDrag.mockReturnValue('dragged');
    dragService.pointerDragPreview.mockReturnValue({ x: 100, y: 200, width: 103, height: 144 });

    store.moveCardPointerDrag(ctx, {} as PointerEvent);

    expect(dragState.landStackDropPreview()).toBeNull();

    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS - 1);
    expect(dragState.landStackDropPreview()).toBeNull();

    vi.advanceTimersByTime(1);
    expect(dragState.landStackDropPreview()).toEqual({
      playerId: 'player-1',
      targetInstanceId: 'target',
      kind: 'attachment',
    });
  });

  it('does not restart the attachment preview debounce on repeated pointer moves over the same target', () => {
    vi.useFakeTimers();
    const dragged = permanent('dragged', 100, 200);
    const target = permanent('target', 100, 200);
    const ctx = context([playerView([dragged, target])]);
    dragService.moveCardPointerDrag.mockReturnValue('dragged');
    dragService.pointerDragPreview.mockReturnValue({ x: 100, y: 200, width: 103, height: 144 });

    store.moveCardPointerDrag(ctx, {} as PointerEvent);
    vi.advanceTimersByTime(Math.floor(LAND_STACK_DROP_PREVIEW_DELAY_MS / 2));
    store.moveCardPointerDrag(ctx, {} as PointerEvent);
    vi.advanceTimersByTime(Math.ceil(LAND_STACK_DROP_PREVIEW_DELAY_MS / 2));

    expect(dragState.landStackDropPreview()).toEqual({
      playerId: 'player-1',
      targetInstanceId: 'target',
      kind: 'attachment',
    });
  });

  it('does not apply battlefield alignment snap while hovering a valid attachment target', () => {
    vi.useFakeTimers();
    const dragged = permanent('dragged', 100, 200);
    const target = permanent('target', 100, 200);
    const ctx = context([playerView([dragged, target])]);
    dragService.moveCardPointerDrag.mockReturnValue('dragged');
    dragService.pointerDragPreview.mockReturnValue({ x: 100, y: 200, width: 103, height: 144 });
    dragState.setAlignmentGuide({ playerId: 'player-1', y: 200, referenceInstanceIds: ['previous'] });
    dragState.setManaLaneDropPlayer('player-1');

    store.moveCardPointerDrag(ctx, {} as PointerEvent);
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(updatePointerDropTarget).toHaveBeenCalled();
    expect(updateBattlefieldDragAid).not.toHaveBeenCalled();
    expect(dragState.alignmentGuide()).toBeNull();
    expect(dragState.manaLaneDropPlayerId()).toBeNull();
    expect(dragState.landStackDropPreview()).toEqual({
      playerId: 'player-1',
      targetInstanceId: 'target',
      kind: 'attachment',
    });
  });

  it('debounces attachment drop preview for a single hand card dragged over a battlefield target', () => {
    vi.useFakeTimers();
    const dragged = permanent('dragged', 0, 0);
    const target = permanent('target', 100, 200);
    const battlefield = document.createElement('div');
    battlefield.dataset['gameDropZone'] = 'battlefield';
    battlefield.dataset['playerId'] = 'player-1';
    const ctx = context([playerView([target], [dragged])]);
    dragService.dragPayload.mockReturnValue({
      playerId: 'player-1',
      zone: 'hand',
      instanceId: 'dragged',
      instanceIds: ['dragged'],
    });
    dragService.dropPosition.mockReturnValue({ x: 100, y: 200 });
    store.beginCardDrag(ctx, 'dragged');

    store.allowDrop(ctx, { currentTarget: battlefield } as unknown as DragEvent);

    expect(dragState.landStackDropPreview()).toBeNull();

    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);
    expect(dragState.landStackDropPreview()).toEqual({
      playerId: 'player-1',
      targetInstanceId: 'target',
      kind: 'attachment',
    });
  });

  it('debounces attachment drop preview for a single zone pile card dragged over a battlefield target', () => {
    vi.useFakeTimers();
    const dragged = permanent('dragged', 0, 0);
    const target = permanent('target', 100, 200);
    const battlefield = document.createElement('div');
    battlefield.dataset['gameDropZone'] = 'battlefield';
    battlefield.dataset['playerId'] = 'player-1';
    const ctx = context([playerView([target], [], { graveyard: [dragged] })]);
    dragService.dragPayload.mockReturnValue({
      playerId: 'player-1',
      zone: 'graveyard',
      instanceId: 'dragged',
      instanceIds: ['dragged'],
    });
    dragService.dropPosition.mockReturnValue({ x: 100, y: 200 });
    dragState.setAlignmentGuide({ playerId: 'player-1', y: 200, referenceInstanceIds: ['previous'] });
    store.beginCardDrag(ctx, 'dragged');

    store.allowDrop(ctx, { currentTarget: battlefield } as unknown as DragEvent);
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(dragState.alignmentGuide()).toBeNull();
    expect(dragState.landStackDropPreview()).toEqual({
      playerId: 'player-1',
      targetInstanceId: 'target',
      kind: 'attachment',
    });
  });

  it('does not show attachment drop preview for multi-card hand drags', () => {
    vi.useFakeTimers();
    const dragged = permanent('dragged', 0, 0);
    const otherDragged = permanent('other-dragged', 0, 0);
    const target = permanent('target', 100, 200);
    const battlefield = document.createElement('div');
    battlefield.dataset['gameDropZone'] = 'battlefield';
    battlefield.dataset['playerId'] = 'player-1';
    const ctx = context([playerView([target], [dragged, otherDragged])]);
    dragService.dragPayload.mockReturnValue({
      playerId: 'player-1',
      zone: 'hand',
      instanceId: 'dragged',
      instanceIds: ['dragged', 'other-dragged'],
    });
    dragService.dropPosition.mockReturnValue({ x: 100, y: 200 });
    store.beginCardDrag(ctx, 'dragged');

    store.allowDrop(ctx, { currentTarget: battlefield } as unknown as DragEvent);
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(dragState.landStackDropPreview()).toBeNull();
  });

  it('does not show land stack drop preview after a quick pass over a target', () => {
    vi.useFakeTimers();
    const dragged = land('dragged', 100, 200);
    const target = land('target', 100, 200);
    const ctx = context([playerView([dragged, target])]);
    dragService.moveCardPointerDrag.mockReturnValueOnce('dragged').mockReturnValueOnce('dragged');
    dragService.pointerDragPreview.mockReturnValue({ x: 100, y: 200, width: 103, height: 144 });

    store.moveCardPointerDrag(ctx, {} as PointerEvent);
    dragged.position = { x: 360, y: 200 };
    store.moveCardPointerDrag(ctx, {} as PointerEvent);
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(dragState.landStackDropPreview()).toBeNull();
  });

  it('shows the stack top as land preview target when the pointer is hovering the second card of a two-card stack', () => {
    vi.useFakeTimers();
    const dragged = land('dragged', 340, 200);
    const top = land('top', 100, 200);
    const under = land('under', 100, 182);
    const ctx = context([playerView([dragged, top, under])], null, [stack('stack-under', 'under', 'top')]);
    dragService.moveCardPointerDrag.mockReturnValue('dragged');
    dragService.pointerDragPreview.mockReturnValue({ x: 100, y: 200, width: 103, height: 144 });

    const underCardElement = document.createElement('button');
    underCardElement.setAttribute('data-testid', 'game-card');
    underCardElement.setAttribute('data-zone', 'battlefield');
    underCardElement.setAttribute('data-card-instance-id', 'under');
    underCardElement.setAttribute('data-owner-player-id', 'player-1');
    underCardElement.classList.add('land-stack-under');
    underCardElement.getBoundingClientRect = () => ({
      x: 200,
      y: 200,
      left: 200,
      top: 200,
      right: 260,
      bottom: 260,
      width: 60,
      height: 60,
      toJSON: () => ({}),
    }) as DOMRect;
    document.body.appendChild(underCardElement);

    dragged.position = { x: 100, y: 200 };
    store.moveCardPointerDrag(ctx, { clientX: 220, clientY: 220 } as PointerEvent);
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(dragState.landStackDropPreview()).toEqual({
      playerId: 'player-1',
      targetInstanceId: 'top',
      kind: 'land',
      nextSize: 3,
    });
    expect(updateBattlefieldDragAid).not.toHaveBeenCalled();
    underCardElement.remove();
  });

  it('shows the stack top as external land preview target when the pointer is hovering the second card of a two-card stack', () => {
    vi.useFakeTimers();
    const dragged = land('dragged', 0, 0);
    const top = land('top', 100, 200);
    const under = land('under', 100, 182);
    const ctx = context([playerView([top, under], [dragged])], null, [stack('stack-under', 'under', 'top')]);

    const underCardElement = document.createElement('button');
    underCardElement.setAttribute('data-testid', 'game-card');
    underCardElement.setAttribute('data-zone', 'battlefield');
    underCardElement.setAttribute('data-card-instance-id', 'under');
    underCardElement.setAttribute('data-owner-player-id', 'player-1');
    underCardElement.classList.add('land-stack-under');
    underCardElement.getBoundingClientRect = () => ({
      x: 200,
      y: 200,
      left: 200,
      top: 200,
      right: 260,
      bottom: 260,
      width: 60,
      height: 60,
      toJSON: () => ({}),
    }) as DOMRect;
    document.body.appendChild(underCardElement);

    store.updatePointerDropTarget(ctx, {
      kind: 'zone',
      targetPlayerId: 'player-1',
      toZone: 'battlefield',
      rawZone: 'mana',
      draggedInstanceId: 'dragged',
      position: { x: 100, y: 200 },
      pointerClient: { x: 220, y: 220 },
    });
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(dragState.landStackDropPreview()).toEqual({
      playerId: 'player-1',
      targetInstanceId: 'top',
      kind: 'land',
      nextSize: 3,
    });
    expect(dragState.manaLaneDropPlayerId()).toBeNull();
    underCardElement.remove();
  });

  it('shows the stack top as external land preview target when under overlap dominates even without pointer coordinates', () => {
    vi.useFakeTimers();
    const dragged = land('dragged', 0, 0);
    const top = land('top', 100, 200);
    const under = land('under', 100, 182);
    const ctx = context([playerView([top, under], [dragged])], null, [stack('stack-under', 'under', 'top')]);

    store.updatePointerDropTarget(ctx, {
      kind: 'zone',
      targetPlayerId: 'player-1',
      toZone: 'battlefield',
      rawZone: 'mana',
      draggedInstanceId: 'dragged',
      position: { x: 100, y: 182 },
    });
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(dragState.landStackDropPreview()).toEqual({
      playerId: 'player-1',
      targetInstanceId: 'top',
      kind: 'land',
      nextSize: 3,
    });
  });

  it('clears drop targets when the native drag payload is invalid', () => {
    const battlefield = document.createElement('div');
    battlefield.dataset['gameDropZone'] = 'battlefield';
    battlefield.dataset['playerId'] = 'player-1';
    dragService.allowDrop.mockReturnValue(false);
    dragState.setActiveDropTarget({ playerId: 'player-1', zone: 'battlefield' });
    dragState.setActivePlayerDropTarget('player-2');
    dragState.setManaLaneDropPlayer('player-1');
    dragState.setAlignmentGuide({ playerId: 'player-1', y: 240, referenceInstanceIds: ['card-1'] });
    dragState.setLandStackDropPreview({ playerId: 'player-1', targetInstanceId: 'card-2', kind: 'land' });

    store.allowDrop(context(), { currentTarget: battlefield } as unknown as DragEvent);

    expect(dragState.activeDropTarget()).toBeNull();
    expect(dragState.activePlayerDropTarget()).toBeNull();
    expect(dragState.manaLaneDropPlayerId()).toBeNull();
    expect(dragState.alignmentGuide()).toBeNull();
    expect(dragState.landStackDropPreview()).toBeNull();
  });

  it('does not allow native dragover on command for non-commanders', () => {
    const command = document.createElement('button');
    command.dataset['gameDropZone'] = 'command';
    command.dataset['zone'] = 'command';
    command.dataset['playerId'] = 'player-1';
    const normalCard = card('card-1');
    dragService.dragPayload.mockReturnValue({
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      instanceIds: ['card-1'],
    });

    store.allowDrop(context([playerView([normalCard])]), { currentTarget: command } as unknown as DragEvent);

    expect(dragService.allowDrop).not.toHaveBeenCalled();
    expect(updateActiveDropTarget).not.toHaveBeenCalled();
  });

  it('allows native dragover on command for commanders', () => {
    const command = document.createElement('button');
    command.dataset['gameDropZone'] = 'command';
    command.dataset['zone'] = 'command';
    command.dataset['playerId'] = 'player-1';
    const commander = { ...card('commander-1'), isCommander: true };
    dragService.dragPayload.mockReturnValue({
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'commander-1',
      instanceIds: ['commander-1'],
    });

    store.allowDrop(context([playerView([commander])]), { currentTarget: command } as unknown as DragEvent);

    expect(dragService.allowDrop).toHaveBeenCalled();
    expect(updateActiveDropTarget).toHaveBeenCalled();
  });

  it('does not allow native dragover on command for an active non-commander when the native payload is unavailable', () => {
    const command = document.createElement('button');
    command.dataset['gameDropZone'] = 'command';
    command.dataset['zone'] = 'command';
    command.dataset['playerId'] = 'player-1';
    const normalCard = card('card-1');
    const ctx = context([playerView([], [], { graveyard: [normalCard] })]);
    dragService.dragPayload.mockReturnValue(null);
    store.beginCardDrag(ctx, 'card-1');

    store.allowDrop(ctx, { currentTarget: command } as unknown as DragEvent);

    expect(dragService.allowDrop).not.toHaveBeenCalled();
    expect(updateActiveDropTarget).not.toHaveBeenCalled();
  });

  it('keeps internal dragover flow alive when there is an active internal drag without native payload types', () => {
    const battlefield = document.createElement('div');
    battlefield.dataset['gameDropZone'] = 'battlefield';
    battlefield.dataset['playerId'] = 'player-1';
    const ctx = context();
    dragService.allowDrop.mockReturnValue(false);
    store.beginCardDrag(ctx, 'card-1');
    const event = {
      currentTarget: battlefield,
      dataTransfer: { dropEffect: 'none' },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;

    store.allowDrop(ctx, event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.dataTransfer!.dropEffect).toBe('move');
    expect(updateActiveDropTarget).toHaveBeenCalled();
  });

  it('does not show land stack drop preview for the original stack while detaching a card', () => {
    vi.useFakeTimers();
    const top = land('top', 100, 200);
    const under = land('under', 100, 182);
    const ctx = context([playerView([top, under])], null, [stack('stack-under', 'under', 'top')]);
    dragService.moveCardPointerDrag.mockReturnValue('under');
    dragService.pointerDragPreview.mockReturnValue({ x: 100, y: 182, width: 103, height: 144 });

    store.startBattlefieldPointerDrag(ctx, { detail: 1, shiftKey: false } as PointerEvent, 'player-1', under);
    under.position = { x: 100, y: 200 };
    store.moveCardPointerDrag(ctx, {} as PointerEvent);
    vi.advanceTimersByTime(LAND_STACK_DROP_PREVIEW_DELAY_MS);

    expect(dragState.landStackDropPreview()).toBeNull();
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

  function context(
    players: PlayerView[] = [],
    snapshot: GameSnapshot | null = null,
    battlefieldStacks: readonly GameBattlefieldStack[] = [],
  ): GameTableDragDropContext {
    const snapshotWithStacks = snapshot ?? (battlefieldStacks.length > 0
      ? ({ battlefieldStacks } as GameSnapshot)
      : null);

    return {
      zones: ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'],
      snapshot: () => snapshotWithStacks,
      players: () => players,
      selectedCards: () => selectedCards,
      setSelectedCards: (cards) => {
        selectedCards = cards;
      },
      canControlOwnedCard: () => true,
      battlefieldCardSize: () => ({ width: 120, height: 168 }),
      battlefieldDragContext: () => ({
        zones: ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'],
        snapshot: () => null,
        selectedCards: () => selectedCards,
        findCard: () => null,
        cardPosition: () => null,
        battlefieldCardSize: () => ({ width: 120, height: 168 }),
        updateLocalCardPosition: () => undefined,
      }),
      pointerDragActionContext: () => ({} as never),
      cardPosition: (card) => card.position ? { x: card.position.x, y: card.position.y } : null,
      updateLocalCardPosition: () => undefined,
      hideCardPreview: () => undefined,
      clearCardPreview: () => undefined,
      closeContextMenuForCardDrag: () => undefined,
      suppressCardPreview: () => undefined,
      clearHandDropPreview: () => undefined,
      setError: () => undefined,
      applyDeferredRemoteSnapshot: () => undefined,
    };
  }

  function gridContext(
    players: PlayerView[] = [],
    snapshot: GameSnapshot | null = null,
    battlefieldStacks: readonly GameBattlefieldStack[] = [],
  ): GameTableDragDropContext {
    return {
      ...context(players, snapshot, battlefieldStacks),
      stackDropOverlapRatio: () => 0.7,
    };
  }

  function createStoreWithSkipDragDropFeedback(enabled: boolean): GameTableDragDropStore {
    if (enabled) {
      window.localStorage.setItem(SKIP_DRAG_DROP_FEEDBACK_STORAGE_KEY, '1');
    } else {
      window.localStorage.removeItem(SKIP_DRAG_DROP_FEEDBACK_STORAGE_KEY);
    }

    return TestBed.runInInjectionContext(() => new GameTableDragDropStore());
  }

  function createStoreWithSharedHitTest(enabled: boolean): GameTableDragDropStore {
    if (enabled) {
      window.localStorage.setItem(SHARED_HIT_TEST_STORAGE_KEY, '1');
    } else {
      window.localStorage.removeItem(SHARED_HIT_TEST_STORAGE_KEY);
    }

    return TestBed.runInInjectionContext(() => new GameTableDragDropStore());
  }

  function gameSnapshot(version: number): GameSnapshot {
    return {
      version,
      ownerId: 'player-1',
      players: {},
      turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
      stack: [],
      arrows: [],
      chat: [],
      eventLog: [],
      createdAt: '2026-09-30T00:00:00+00:00',
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

function land(instanceId: string, x: number, y: number): GameCardInstance {
  return {
    ...card(instanceId),
    typeLine: 'Basic Land - Forest',
    position: { x, y },
  };
}

function stack(id: string, stackedInstanceId: string, stackTopInstanceId: string): GameBattlefieldStack {
  return {
    id,
    stackedInstanceId,
    stackTopInstanceId,
    createdAt: '2026-09-08T10:00:00+00:00',
  };
}

function attachment(id: string, equipmentInstanceId: string, attachedToInstanceId: string): GameAttachment {
  return {
    id,
    equipmentInstanceId,
    attachedToInstanceId,
    createdAt: '2026-09-29T10:00:00+00:00',
  };
}

function permanent(instanceId: string, x: number, y: number): GameCardInstance {
  return {
    ...card(instanceId),
    typeLine: 'Artifact',
    position: { x, y },
  };
}

function playerView(
  battlefield: readonly GameCardInstance[],
  hand: readonly GameCardInstance[] = [],
  zones: Partial<Record<GameZoneName, readonly GameCardInstance[]>> = {},
): PlayerView {
  return {
    id: 'player-1',
    state: {
      user: { id: 'player-1', email: 'player@test', displayName: 'Player', roles: [] },
      status: 'active',
      life: 40,
      zones: {
        library: [...(zones.library ?? [])],
        hand: [...hand],
        battlefield: [...battlefield],
        graveyard: [...(zones.graveyard ?? [])],
        exile: [...(zones.exile ?? [])],
        command: [...(zones.command ?? [])],
      },
      zoneCounts: {
        library: zones.library?.length ?? 0,
        hand: hand.length,
        battlefield: battlefield.length,
        graveyard: zones.graveyard?.length ?? 0,
        exile: zones.exile?.length ?? 0,
        command: zones.command?.length ?? 0,
      },
      commanderDamage: {},
      counters: {},
    },
  };
}

function battlefieldDropTarget(playerId = 'player-1'): HTMLDivElement {
  const battlefield = document.createElement('div');
  battlefield.classList.add('battlefield');
  battlefield.dataset['gameDropZone'] = 'battlefield';
  battlefield.dataset['playerId'] = playerId;

  return battlefield;
}

function battlefieldPointerTarget(
  draggedInstanceId: string,
  position: { x: number; y: number },
): PointerDropTarget {
  return {
    kind: 'zone',
    targetPlayerId: 'player-1',
    toZone: 'battlefield',
    rawZone: 'battlefield',
    draggedInstanceId,
    position,
  };
}
