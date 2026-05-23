import { TestBed } from '@angular/core/testing';
import { GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { SelectedCard } from '../../models/game-table-card.model';
import { GameTableBattlefieldDragCoordinatorService } from '../../services/game-table-battlefield-drag-coordinator.service';
import { GameTableDragService } from '../../services/game-table-drag.service';
import { GameTableDropActionsService } from '../../services/game-table-drop-actions.service';
import { GameTablePointerDragActionsService } from '../../services/game-table-pointer-drag-actions.service';
import { GameTableBattlefieldDragState } from './game-table-battlefield-drag.state';
import { PlayerView } from '../../game-table.store';
import {
  GameTableDragDropContext,
  GameTableDragDropStore,
  LAND_STACK_DROP_PREVIEW_DELAY_MS,
} from './game-table-drag-drop.store';
import { GameTableDropFeedbackState } from './game-table-drop-feedback.state';
import { GameTablePendingTransferState } from '../core/game-table-pending-transfer.state';

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
    dragPayload: ReturnType<typeof vi.fn>;
    dropPosition: ReturnType<typeof vi.fn>;
    moveCardPointerDrag: ReturnType<typeof vi.fn>;
    hasActivePointerDrag: ReturnType<typeof vi.fn>;
    cancelCardPointerDrag: ReturnType<typeof vi.fn>;
    pointerDragPreview: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    dropOnZone = vi.fn().mockResolvedValue(undefined);
    updateActiveDropTarget = vi.fn();
    updateBattlefieldDragAid = vi.fn();
    updatePointerDropTarget = vi.fn();
    updateExternalBattlefieldAlignmentGuide = vi.fn();
    endCardPointerDrag = vi.fn();
    dragService = {
      allowDrop: vi.fn().mockReturnValue(true),
      dragPayload: vi.fn().mockReturnValue(null),
      dropPosition: vi.fn().mockReturnValue(null),
      moveCardPointerDrag: vi.fn(),
      hasActivePointerDrag: vi.fn().mockReturnValue(false),
      cancelCardPointerDrag: vi.fn(),
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
            dragStart: vi.fn(),
            dragPayload: dragService.dragPayload,
            dropPosition: dragService.dropPosition,
            moveCardPointerDrag: dragService.moveCardPointerDrag,
            hasActivePointerDrag: dragService.hasActivePointerDrag,
            cancelCardPointerDrag: dragService.cancelCardPointerDrag,
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
    expect(updateExternalBattlefieldAlignmentGuide).toHaveBeenCalledWith(
      expect.objectContaining({ zones: ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'] }),
      'player-2',
      'card-1',
      { x: 10, y: 20 },
    );
  });

  it('does not select the whole land stack when the top card only starts a battlefield pointer drag', () => {
    const top = land('top', 100, 200);
    const under = land('under', 100, 180);
    const ctx = context([playerView([top, under])]);

    store.startBattlefieldPointerDrag(ctx, { detail: 1, shiftKey: false } as PointerEvent, 'player-1', top);

    expect(selectedCards).toEqual([]);
  });

  it('selects the whole land stack once the top card drag actually moves', () => {
    const top = land('top', 100, 200);
    const under = land('under', 100, 180);
    const ctx = context([playerView([top, under])]);
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
    const under = land('under', 100, 186);
    const ctx = context([playerView([dragged, top, under])]);
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
    const under = land('under', 100, 186);
    const ctx = context([playerView([top, under])]);
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

  it('marks an under land as a detach source when it starts a battlefield pointer drag', () => {
    const top = land('top', 100, 200);
    const under = land('under', 100, 180);
    const ctx = context([playerView([top, under])]);

    store.startBattlefieldPointerDrag(ctx, { detail: 1, shiftKey: false } as PointerEvent, 'player-1', under);

    expect(selectedCards.map((item) => item.card.instanceId)).toEqual(['under']);
    expect(dragState.landStackDetachSource()).toEqual(expect.objectContaining({
      playerId: 'player-1',
      detachedInstanceId: 'under',
    }));
  });

  it('marks the bottom land as a detach source when it starts a battlefield pointer drag', () => {
    const top = land('top', 100, 200);
    const middle = land('middle', 100, 186);
    const bottom = land('bottom', 100, 172);
    const ctx = context([playerView([top, middle, bottom])]);

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
    const under = land('under', 100, 186);
    const battlefield = document.createElement('div');
    battlefield.dataset['gameDropZone'] = 'battlefield';
    battlefield.dataset['playerId'] = 'player-1';
    const ctx = context([playerView([top, under], [dragged])]);
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
    const under = land('under', 100, 186);
    const ctx = context([playerView([dragged, top, under])]);
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
    const under = land('under', 100, 186);
    const ctx = context([playerView([top, under], [dragged])]);

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
    const under = land('under', 100, 186);
    const ctx = context([playerView([top, under], [dragged])]);

    store.updatePointerDropTarget(ctx, {
      kind: 'zone',
      targetPlayerId: 'player-1',
      toZone: 'battlefield',
      rawZone: 'mana',
      draggedInstanceId: 'dragged',
      position: { x: 100, y: 186 },
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
    const under = land('under', 100, 186);
    const ctx = context([playerView([top, under])]);
    dragService.moveCardPointerDrag.mockReturnValue('under');
    dragService.pointerDragPreview.mockReturnValue({ x: 100, y: 186, width: 103, height: 144 });

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

  function context(players: PlayerView[] = []): GameTableDragDropContext {
    return {
      zones: ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'],
      snapshot: () => null,
      players: () => players,
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
