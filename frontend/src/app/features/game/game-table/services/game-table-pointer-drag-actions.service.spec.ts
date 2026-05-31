import { TestBed } from '@angular/core/testing';
import { GameCardInstance, GameCommandType, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';
import { GameTableBattlefieldDragCoordinatorService } from './game-table-battlefield-drag-coordinator.service';
import { GameTableDragService } from './game-table-drag.service';
import { GameTableMotionService } from './game-table-motion.service';
import { GameTablePointerDragActionContext, GameTablePointerDragActionsService } from './game-table-pointer-drag-actions.service';

describe('GameTablePointerDragActionsService', () => {
  let service: GameTablePointerDragActionsService;
  let dragService: {
    endCardPointerDrag: ReturnType<typeof vi.fn>;
    pointerPosition: ReturnType<typeof vi.fn>;
  };
  let battlefieldDragService: {
    playerDropTargetAt: ReturnType<typeof vi.fn>;
    isPointerInsidePlayerBattlefield: ReturnType<typeof vi.fn>;
    positionWithAlignmentGuide: ReturnType<typeof vi.fn>;
    positionWithManaLane: ReturnType<typeof vi.fn>;
    positionWithManaLaneBottom: ReturnType<typeof vi.fn>;
    isManaLanePosition: ReturnType<typeof vi.fn>;
  };
  let pulseLandStack: ReturnType<typeof vi.fn>;
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);

      return 0;
    });
    pulseLandStack = vi.fn();
    dragService = {
      endCardPointerDrag: vi.fn(() => ({
        playerId: 'player-1',
        instanceId: 'moved',
        moved: true,
        position: { x: 0, y: 0 },
        dropZone: 'hand',
        battlefield: document.createElement('div'),
      })),
      pointerPosition: vi.fn(() => ({ x: 0, y: 0 })),
    };
    battlefieldDragService = {
      playerDropTargetAt: vi.fn(() => null),
      isPointerInsidePlayerBattlefield: vi.fn(() => false),
      positionWithAlignmentGuide: vi.fn((_context, _playerId, _instanceId, position) => position),
      positionWithManaLane: vi.fn((_playerId, position) => ({ ...position, y: 208 })),
      positionWithManaLaneBottom: vi.fn((_playerId, position) => ({ ...position, y: 296 })),
      isManaLanePosition: vi.fn(() => false),
    };

    TestBed.configureTestingModule({
      providers: [
        GameTablePointerDragActionsService,
        { provide: GameTableDragService, useValue: dragService },
        {
          provide: GameTableBattlefieldDragCoordinatorService,
          useValue: battlefieldDragService,
        },
        {
          provide: GameTableMotionService,
          useValue: { pulseLandStack },
        },
      ],
    });

    service = TestBed.inject(GameTablePointerDragActionsService);
  });

  afterEach(() => {
    requestAnimationFrameSpy.mockRestore();
  });

  it('applies the previewed hand position when a battlefield pointer drag drops into hand', async () => {
    let snapshot = snapshotWith({
      hand: [card('hand-1', 'Sol Ring', 'hand'), card('hand-2', 'Arcane Signet', 'hand')],
      battlefield: [card('moved', 'Cultivate', 'battlefield')],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag(context(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
        if (type === 'card.moved') {
          snapshot = moveCardToHand(snapshot, payload['instanceId'] as string);
        }
        if (type === 'zone.changed') {
          snapshot = {
            ...snapshot,
            players: {
              ...snapshot.players,
              'player-1': {
                ...snapshot.players['player-1']!,
                zones: {
                  ...snapshot.players['player-1']!.zones,
                  hand: payload['cards'] as GameCardInstance[],
                },
              },
            },
          };
        }
      },
      [],
    ), { clientX: 120, clientY: 90 } as PointerEvent);

    expect(commands[0]).toEqual({
      type: 'card.moved',
      payload: {
        playerId: 'player-1',
        fromZone: 'battlefield',
        toZone: 'hand',
        instanceId: 'moved',
      },
    });
    expect(commands[1]?.type).toBe('zone.changed');
    expect((commands[1]?.payload['cards'] as GameCardInstance[]).map((candidate) => candidate.instanceId))
      .toEqual(['hand-1', 'moved', 'hand-2']);
  });

  it('moves every selected battlefield card when a selected card is dragged to hand', async () => {
    let snapshot = snapshotWith({
      hand: [card('hand-1', 'Sol Ring', 'hand'), card('hand-2', 'Arcane Signet', 'hand')],
      battlefield: [
        card('moved', 'Cultivate', 'battlefield'),
        card('selected-2', 'Kodama Reach', 'battlefield'),
      ],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];
    const markPendingTransfer = vi.fn();

    await service.endCardPointerDrag(context(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
        if (type === 'cards.moved') {
          snapshot = moveCardsToHand(snapshot, payload['instanceIds'] as string[]);
        }
        if (type === 'zone.changed') {
          snapshot = {
            ...snapshot,
            players: {
              ...snapshot.players,
              'player-1': {
                ...snapshot.players['player-1']!,
                zones: {
                  ...snapshot.players['player-1']!.zones,
                  hand: payload['cards'] as GameCardInstance[],
                },
              },
            },
          };
        }
      },
      [
        { playerId: 'player-1', zone: 'battlefield', card: snapshot.players['player-1']!.zones.battlefield[0]! },
        { playerId: 'player-1', zone: 'battlefield', card: snapshot.players['player-1']!.zones.battlefield[1]! },
      ],
      undefined,
      markPendingTransfer,
    ), { clientX: 120, clientY: 90 } as PointerEvent);

    expect(markPendingTransfer).toHaveBeenCalledWith('player-1', 'battlefield', ['moved', 'selected-2']);
    expect(commands[0]).toEqual({
      type: 'cards.moved',
      payload: {
        playerId: 'player-1',
        fromZone: 'battlefield',
        toZone: 'hand',
        instanceIds: ['moved', 'selected-2'],
      },
    });
    expect((commands[1]?.payload['cards'] as GameCardInstance[]).map((candidate) => candidate.instanceId))
      .toEqual(['hand-1', 'moved', 'selected-2', 'hand-2']);
  });

  it('notifies the controller when a pointer-dragged borrowed card returns to its owner zone', async () => {
    const snapshot = snapshotWith({
      battlefield: [
        { ...card('moved', 'Borrowed Bear', 'battlefield'), ownerId: 'owner-1', controllerId: 'player-1' },
      ],
    });
    const setError = vi.fn();

    await service.endCardPointerDrag({
      ...context(
        () => snapshot,
        vi.fn(async () => undefined),
      ),
      playerName: (playerId) => playerId === 'owner-1' ? 'Owner' : playerId,
      setError,
    }, { clientX: 120, clientY: 90 } as PointerEvent);

    expect(setError).toHaveBeenCalledWith("This borrowed card will return to Owner's hand.");
  });

  it('anchors a battlefield card to the mana row bottom when the mana lane is highlighted', async () => {
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'moved',
      moved: true,
      position: { x: 44, y: 320 },
      dropZone: 'battlefield',
      battlefield: document.createElement('div'),
    });
    const snapshot = snapshotWith({
      battlefield: [{ ...card('moved', 'Cultivate', 'battlefield'), position: { x: 10, y: 110 } }],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag(context(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
      },
      [],
      () => true,
    ), { clientX: 120, clientY: 280 } as PointerEvent);

    expect(battlefieldDragService.positionWithManaLaneBottom).toHaveBeenCalledWith('player-1', { x: 44, y: 320 }, 162);
    expect(battlefieldDragService.positionWithManaLane).not.toHaveBeenCalled();
    expect(battlefieldDragService.positionWithAlignmentGuide).not.toHaveBeenCalled();
    expect(commands).toEqual([{
      type: 'card.position.changed',
      payload: {
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'moved',
        position: { x: 44, y: 296, unit: 'ratio' },
      },
    }]);
  });

  it('creates a two-card land stack when a land is dropped over another land', async () => {
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'dragged',
      moved: true,
      position: { x: 100, y: 200 },
      dropZone: 'battlefield',
      battlefield: document.createElement('div'),
    });
    const snapshot = snapshotWith({
      battlefield: [
        land('target', 100, 200),
        land('dragged', 260, 200),
      ],
    });
    const updateLocalCardPosition = vi.fn();
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag(context(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
      },
      [],
      undefined,
      undefined,
      updateLocalCardPosition,
    ), { clientX: 120, clientY: 220 } as PointerEvent);

    expect(updateLocalCardPosition).toHaveBeenCalledWith('player-1', 'dragged', { x: 110, y: 182 });
    expect(pulseLandStack).toHaveBeenCalledWith(['target', 'dragged'], 'stack');
    expect(commands).toEqual([{
      type: 'cards.position.changed',
      payload: {
        playerId: 'player-1',
        zone: 'battlefield',
        positions: [
          { instanceId: 'dragged', position: { x: 110, y: 182, unit: 'ratio' } },
        ],
      },
    }]);
  });

  it('adds a third land to the bottom of an existing stack', async () => {
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'dragged',
      moved: true,
      position: { x: 100, y: 200 },
      dropZone: 'battlefield',
      battlefield: document.createElement('div'),
    });
    const snapshot = snapshotWith({
      battlefield: [
        land('top', 100, 200),
        land('under', 100, 182),
        land('dragged', 260, 200),
      ],
    });
    const updateLocalCardPosition = vi.fn();
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag(context(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
      },
      [],
      undefined,
      undefined,
      updateLocalCardPosition,
    ), { clientX: 120, clientY: 220 } as PointerEvent);

    expect(updateLocalCardPosition).toHaveBeenCalledWith('player-1', 'dragged', { x: 120, y: 164 });
    expect(pulseLandStack).toHaveBeenCalledWith(['top', 'under', 'dragged'], 'stack');
    expect(commands[0]).toEqual({
      type: 'cards.position.changed',
      payload: {
        playerId: 'player-1',
        zone: 'battlefield',
        positions: [
          { instanceId: 'dragged', position: { x: 120, y: 164, unit: 'ratio' } },
        ],
      },
    });
  });

  it('anchors a three-card land stack to the mana row bottom when adding the third land there', async () => {
    battlefieldDragService.isManaLanePosition.mockReturnValue(true);
    battlefieldDragService.positionWithManaLaneBottom.mockReturnValue({ x: 100, y: 296 });
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'dragged',
      moved: true,
      position: { x: 100, y: 200 },
      dropZone: 'battlefield',
      battlefield: document.createElement('div'),
    });
    const snapshot = snapshotWith({
      battlefield: [
        land('top', 100, 200),
        land('under', 100, 182),
        land('dragged', 260, 200),
      ],
    });
    const updateLocalCardPosition = vi.fn();
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag(context(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
      },
      [],
      undefined,
      undefined,
      updateLocalCardPosition,
    ), { clientX: 120, clientY: 220 } as PointerEvent);

    expect(battlefieldDragService.positionWithManaLaneBottom).toHaveBeenCalledWith('player-1', { x: 100, y: 200 }, 162);
    expect(updateLocalCardPosition).toHaveBeenCalledWith('player-1', 'top', { x: 100, y: 296 });
    expect(updateLocalCardPosition).toHaveBeenCalledWith('player-1', 'under', { x: 110, y: 278 });
    expect(updateLocalCardPosition).toHaveBeenCalledWith('player-1', 'dragged', { x: 120, y: 260 });
    expect(commands[0]).toEqual({
      type: 'cards.position.changed',
      payload: {
        playerId: 'player-1',
        zone: 'battlefield',
        positions: [
          { instanceId: 'top', position: { x: 100, y: 296, unit: 'ratio' } },
          { instanceId: 'under', position: { x: 110, y: 278, unit: 'ratio' } },
          { instanceId: 'dragged', position: { x: 120, y: 260, unit: 'ratio' } },
        ],
      },
    });
  });

  it('ignores a land drop over a full three-card stack', async () => {
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'dragged',
      moved: true,
      position: { x: 100, y: 200 },
      dropZone: 'battlefield',
      battlefield: document.createElement('div'),
    });
    const snapshot = snapshotWith({
      battlefield: [
        land('top', 100, 200),
        land('under', 100, 182),
        land('bottom', 100, 164),
        land('dragged', 260, 200),
      ],
    });
    const command = vi.fn(async () => undefined);
    const updateLocalCardPosition = vi.fn();
    const refetch = vi.fn(async () => undefined);

    await service.endCardPointerDrag(context(
      () => snapshot,
      command,
      [],
      undefined,
      undefined,
      updateLocalCardPosition,
      refetch,
    ), { clientX: 120, clientY: 220 } as PointerEvent);

    expect(command).not.toHaveBeenCalled();
    expect(updateLocalCardPosition).not.toHaveBeenCalled();
    expect(refetch).toHaveBeenCalledWith(true);
  });

  it('creates an attachment stack when a non-land permanent is dropped over another permanent', async () => {
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'equipment',
      moved: true,
      position: { x: 100, y: 200 },
      dropZone: 'battlefield',
      battlefield: document.createElement('div'),
    });
    const snapshot = snapshotWith({
      battlefield: [
        { ...card('target', 'Bear', 'battlefield'), position: { x: 100, y: 200 }, typeLine: 'Creature - Bear' },
        { ...card('equipment', 'Sword', 'battlefield'), position: { x: 260, y: 200 }, typeLine: 'Artifact' },
      ],
    });
    const updateLocalCardPosition = vi.fn();
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag(context(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
      },
      [],
      undefined,
      undefined,
      updateLocalCardPosition,
    ), { clientX: 120, clientY: 220 } as PointerEvent);

    expect(updateLocalCardPosition).toHaveBeenCalledWith('player-1', 'equipment', { x: 110, y: 182 });
    expect(commands).toEqual([
      {
        type: 'cards.position.changed',
        payload: {
          playerId: 'player-1',
          zone: 'battlefield',
          positions: [
            { instanceId: 'equipment', position: { x: 110, y: 182, unit: 'ratio' } },
          ],
        },
      },
      {
        type: 'attachment.created',
        payload: {
          equipmentInstanceId: 'equipment',
          attachedToInstanceId: 'target',
        },
      },
    ]);
  });

  it('does not attach a permanent that already has attached cards', async () => {
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'source-target',
      moved: true,
      position: { x: 100, y: 200 },
      dropZone: 'battlefield',
      battlefield: document.createElement('div'),
    });
    const snapshot = {
      ...snapshotWith({
        battlefield: [
          { ...card('new-target', 'Bear', 'battlefield'), position: { x: 100, y: 200 }, typeLine: 'Creature - Bear' },
          { ...card('source-target', 'Relic', 'battlefield'), position: { x: 260, y: 200 }, typeLine: 'Artifact' },
          { ...card('attached-card', 'Sword', 'battlefield'), position: { x: 260, y: 182 }, typeLine: 'Artifact' },
        ],
      }),
      attachments: [{
        id: 'attachment-1',
        equipmentInstanceId: 'attached-card',
        attachedToInstanceId: 'source-target',
        createdAt: '',
      }],
    };
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag(context(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
      },
    ), { clientX: 120, clientY: 220 } as PointerEvent);

    expect(commands).toEqual([{
      type: 'card.position.changed',
      payload: {
        playerId: 'player-1',
        zone: 'battlefield',
        instanceId: 'source-target',
        position: { x: 100, y: 200, unit: 'ratio' },
      },
    }]);
  });

  it('updates every selected battlefield card locally before ending a multi-position drag', async () => {
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'moved',
      moved: true,
      position: { x: 50, y: 120 },
      dropZone: 'battlefield',
      battlefield: document.createElement('div'),
    });
    const snapshot = snapshotWith({
      battlefield: [
        { ...card('moved', 'Cultivate', 'battlefield'), position: { x: 10, y: 20 } },
        { ...card('selected-2', 'Kodama Reach', 'battlefield'), position: { x: 40, y: 50 } },
      ],
    });
    const callOrder: string[] = [];
    const updateLocalCardPosition = vi.fn(() => callOrder.push('local'));
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag(context(
      () => snapshot,
      async (type, payload) => {
        callOrder.push('command');
        commands.push({ type, payload });
      },
      [
        { playerId: 'player-1', zone: 'battlefield', card: snapshot.players['player-1']!.zones.battlefield[0]! },
        { playerId: 'player-1', zone: 'battlefield', card: snapshot.players['player-1']!.zones.battlefield[1]! },
      ],
      undefined,
      undefined,
      updateLocalCardPosition,
    ), { clientX: 120, clientY: 280 } as PointerEvent);

    expect(callOrder.slice(0, 2)).toEqual(['local', 'local']);
    expect(updateLocalCardPosition).toHaveBeenCalledWith('player-1', 'moved', { x: 50, y: 120 });
    expect(updateLocalCardPosition).toHaveBeenCalledWith('player-1', 'selected-2', { x: 80, y: 150 });
    expect(commands).toEqual([{
      type: 'cards.position.changed',
      payload: {
        playerId: 'player-1',
        zone: 'battlefield',
        positions: [
          { instanceId: 'moved', position: { x: 50, y: 120, unit: 'ratio' } },
          { instanceId: 'selected-2', position: { x: 80, y: 150, unit: 'ratio' } },
        ],
      },
    }]);
  });

  it('anchors a moved three-card land stack to the mana row bottom', async () => {
    battlefieldDragService.positionWithManaLaneBottom.mockReturnValue({ x: 120, y: 296 });
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'top',
      moved: true,
      position: { x: 120, y: 320 },
      dropZone: 'battlefield',
      battlefield: document.createElement('div'),
    });
    const snapshot = snapshotWith({
      battlefield: [
        land('top', 100, 200),
        land('under', 100, 182),
        land('bottom', 100, 164),
      ],
    });
    const updateLocalCardPosition = vi.fn();
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag(context(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
      },
      [
        { playerId: 'player-1', zone: 'battlefield', card: snapshot.players['player-1']!.zones.battlefield[0]! },
        { playerId: 'player-1', zone: 'battlefield', card: snapshot.players['player-1']!.zones.battlefield[1]! },
        { playerId: 'player-1', zone: 'battlefield', card: snapshot.players['player-1']!.zones.battlefield[2]! },
      ],
      () => true,
      undefined,
      updateLocalCardPosition,
    ), { clientX: 120, clientY: 280 } as PointerEvent);

    expect(battlefieldDragService.positionWithManaLaneBottom).toHaveBeenCalledWith('player-1', { x: 120, y: 320 }, 162);
    expect(updateLocalCardPosition).toHaveBeenCalledWith('player-1', 'top', { x: 120, y: 296 });
    expect(updateLocalCardPosition).toHaveBeenCalledWith('player-1', 'under', { x: 130, y: 278 });
    expect(updateLocalCardPosition).toHaveBeenCalledWith('player-1', 'bottom', { x: 140, y: 260 });
    expect(commands).toEqual([{
      type: 'cards.position.changed',
      payload: {
        playerId: 'player-1',
        zone: 'battlefield',
        positions: [
          { instanceId: 'top', position: { x: 120, y: 296, unit: 'ratio' } },
          { instanceId: 'under', position: { x: 130, y: 278, unit: 'ratio' } },
          { instanceId: 'bottom', position: { x: 140, y: 260, unit: 'ratio' } },
        ],
      },
    }]);
  });

  it('does not send an empty stack recompact command after extracting from a two-card stack', async () => {
    dragService.pointerPosition.mockReturnValue({ x: 260, y: 200 });
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'under',
      moved: true,
      position: { x: 260, y: 200 },
      dropZone: 'battlefield',
      battlefield: document.createElement('div'),
    });
    const snapshot = snapshotWith({
      battlefield: [
        land('top', 100, 200),
        land('under', 100, 182),
      ],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag({
      ...context(
        () => snapshot,
        async (type, payload) => {
          commands.push({ type, payload });
        },
      ),
      landStackDetachSource: () => ({
        playerId: 'player-1',
        detachedInstanceId: 'under',
        members: [
          { instanceId: 'top', x: 100, y: 200, layer: 0 },
          { instanceId: 'under', x: 100, y: 182, layer: 1 },
        ],
      }),
    }, { clientX: 120, clientY: 280 } as PointerEvent);

    expect(battlefieldDragService.positionWithAlignmentGuide).toHaveBeenCalledWith(
      expect.anything(),
      'player-1',
      'under',
      { x: 260, y: 200 },
      null,
    );
    expect(commands).toEqual([{
      type: 'cards.position.changed',
      payload: {
        playerId: 'player-1',
        zone: 'battlefield',
        positions: [
          { instanceId: 'under', position: { x: 260, y: 200, unit: 'ratio' } },
        ],
      },
    }]);
  });

  it('moves every card from a whole land stack to hand when dropped over hand', async () => {
    const top = land('top', 100, 200);
    const under = land('under', 100, 182);
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'top',
      moved: true,
      position: { x: 320, y: 240 },
      dropZone: 'hand',
      battlefield: document.createElement('div'),
    });
    const snapshot = snapshotWith({
      battlefield: [top, under],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];
    const markPendingTransfer = vi.fn();

    await service.endCardPointerDrag(context(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
      },
      [
        { playerId: 'player-1', zone: 'battlefield', card: top },
        { playerId: 'player-1', zone: 'battlefield', card: under },
      ],
      undefined,
      markPendingTransfer,
    ), { clientX: 360, clientY: 280 } as PointerEvent);

    expect(markPendingTransfer).toHaveBeenCalledWith('player-1', 'battlefield', ['top', 'under']);
    expect(commands).toEqual([{
      type: 'cards.moved',
      payload: {
        playerId: 'player-1',
        fromZone: 'battlefield',
        toZone: 'hand',
        instanceIds: ['top', 'under'],
      },
    }]);
  });

  it('moves every card from a whole land stack to a zone pile when dropped over one', async () => {
    const top = land('top', 100, 200);
    const under = land('under', 100, 182);
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'top',
      moved: true,
      position: { x: 320, y: 240 },
      dropZone: 'graveyard',
      battlefield: document.createElement('div'),
    });
    const snapshot = snapshotWith({
      battlefield: [top, under],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag(context(
      () => snapshot,
      async (type, payload) => {
        commands.push({ type, payload });
      },
      [
        { playerId: 'player-1', zone: 'battlefield', card: top },
        { playerId: 'player-1', zone: 'battlefield', card: under },
      ],
    ), { clientX: 360, clientY: 280 } as PointerEvent);

    expect(commands).toEqual([{
      type: 'cards.moved',
      payload: {
        playerId: 'player-1',
        fromZone: 'battlefield',
        toZone: 'graveyard',
        instanceIds: ['top', 'under'],
      },
    }]);
  });

  it('clamps extracted stack cards to an active alignment guide', async () => {
    dragService.pointerPosition.mockReturnValue({ x: 260, y: 206 });
    battlefieldDragService.positionWithAlignmentGuide.mockReturnValue({ x: 260, y: 210 });
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'middle',
      moved: true,
      position: { x: 100, y: 182 },
      previewPosition: { x: 260, y: 206 },
      dropZone: 'battlefield',
      battlefield: document.createElement('div'),
    });
    const snapshot = snapshotWith({
      battlefield: [
        land('top', 100, 200),
        land('middle', 100, 182),
        land('bottom', 100, 164),
      ],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag({
      ...context(
        () => snapshot,
        async (type, payload) => {
          commands.push({ type, payload });
        },
        [],
        () => false,
        undefined,
        undefined,
        undefined,
        undefined,
        () => 210,
      ),
      landStackDetachSource: () => ({
        playerId: 'player-1',
        detachedInstanceId: 'middle',
        members: [
          { instanceId: 'top', x: 100, y: 200, layer: 0 },
          { instanceId: 'middle', x: 100, y: 182, layer: 1 },
          { instanceId: 'bottom', x: 100, y: 164, layer: 2 },
        ],
      }),
    }, { clientX: 120, clientY: 280 } as PointerEvent);

    expect(commands[0]).toEqual({
      type: 'cards.position.changed',
      payload: {
        playerId: 'player-1',
        zone: 'battlefield',
        positions: [
          { instanceId: 'middle', position: { x: 260, y: 210, unit: 'ratio' } },
          { instanceId: 'top', position: { x: 100, y: 200, unit: 'ratio' } },
          { instanceId: 'bottom', position: { x: 110, y: 182, unit: 'ratio' } },
        ],
      },
    });
  });

  it('moves an extracted stack card into another land stack target', async () => {
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'middle',
      moved: true,
      position: { x: 420, y: 200 },
      previewPosition: { x: 420, y: 200 },
      dropZone: 'battlefield',
      battlefield: document.createElement('div'),
    });
    const snapshot = snapshotWith({
      battlefield: [
        land('top', 100, 200),
        land('middle', 100, 182),
        land('bottom', 100, 164),
        land('target', 420, 200),
      ],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag({
      ...context(
        () => snapshot,
        async (type, payload) => {
          commands.push({ type, payload });
        },
      ),
      landStackDetachSource: () => ({
        playerId: 'player-1',
        detachedInstanceId: 'middle',
        members: [
          { instanceId: 'top', x: 100, y: 200, layer: 0 },
          { instanceId: 'middle', x: 100, y: 182, layer: 1 },
          { instanceId: 'bottom', x: 100, y: 164, layer: 2 },
        ],
      }),
    }, { clientX: 420, clientY: 200 } as PointerEvent);

    expect(commands[0]).toEqual({
      type: 'cards.position.changed',
      payload: {
        playerId: 'player-1',
        zone: 'battlefield',
        positions: [
          { instanceId: 'middle', position: { x: 430, y: 182, unit: 'ratio' } },
          { instanceId: 'top', position: { x: 100, y: 200, unit: 'ratio' } },
          { instanceId: 'bottom', position: { x: 110, y: 182, unit: 'ratio' } },
        ],
      },
    });
  });

  it('recompacts the bottom land into the middle slot after extracting the middle stack card', async () => {
    dragService.pointerPosition.mockReturnValue({ x: 260, y: 200 });
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'middle',
      moved: true,
      position: { x: 260, y: 200 },
      dropZone: 'battlefield',
      battlefield: document.createElement('div'),
    });
    const snapshot = snapshotWith({
      battlefield: [
        land('top', 100, 200),
        land('middle', 100, 182),
        land('bottom', 100, 164),
      ],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag({
      ...context(
        () => snapshot,
        async (type, payload) => {
          commands.push({ type, payload });
        },
      ),
      landStackDetachSource: () => ({
        playerId: 'player-1',
        detachedInstanceId: 'middle',
        members: [
          { instanceId: 'top', x: 100, y: 200, layer: 0 },
          { instanceId: 'middle', x: 100, y: 182, layer: 1 },
          { instanceId: 'bottom', x: 100, y: 164, layer: 2 },
        ],
      }),
    }, { clientX: 120, clientY: 280 } as PointerEvent);

    expect(commands).toEqual([{
      type: 'cards.position.changed',
      payload: {
        playerId: 'player-1',
        zone: 'battlefield',
        positions: [
          { instanceId: 'middle', position: { x: 260, y: 200, unit: 'ratio' } },
          { instanceId: 'top', position: { x: 100, y: 200, unit: 'ratio' } },
          { instanceId: 'bottom', position: { x: 110, y: 182, unit: 'ratio' } },
        ],
      },
    }]);
  });

  it('extracts the bottom stack card without moving it back into the stack', async () => {
    dragService.pointerPosition.mockReturnValue({ x: 260, y: 214 });
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'bottom',
      moved: true,
      position: { x: 260, y: 214 },
      dropZone: 'battlefield',
      battlefield: document.createElement('div'),
    });
    const snapshot = snapshotWith({
      battlefield: [
        land('top', 100, 200),
        land('middle', 100, 182),
        land('bottom', 100, 164),
      ],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag({
      ...context(
        () => snapshot,
        async (type, payload) => {
          commands.push({ type, payload });
        },
      ),
      landStackDetachSource: () => ({
        playerId: 'player-1',
        detachedInstanceId: 'bottom',
        members: [
          { instanceId: 'top', x: 100, y: 200, layer: 0 },
          { instanceId: 'middle', x: 100, y: 182, layer: 1 },
          { instanceId: 'bottom', x: 100, y: 164, layer: 2 },
        ],
      }),
    }, { clientX: 120, clientY: 280 } as PointerEvent);

    expect(commands).toEqual([{
      type: 'cards.position.changed',
      payload: {
        playerId: 'player-1',
        zone: 'battlefield',
        positions: [
          { instanceId: 'bottom', position: { x: 260, y: 214, unit: 'ratio' } },
          { instanceId: 'top', position: { x: 100, y: 200, unit: 'ratio' } },
          { instanceId: 'middle', position: { x: 110, y: 182, unit: 'ratio' } },
        ],
      },
    }]);
  });

  it('clamps extracted stack cards to the mana row when the preview is in mana row', async () => {
    dragService.pointerPosition.mockReturnValue({ x: 260, y: 212 });
    battlefieldDragService.positionWithManaLaneBottom.mockReturnValue({ x: 260, y: 296 });
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'middle',
      moved: true,
      position: { x: 100, y: 182 },
      previewPosition: { x: 260, y: 212 },
      dropZone: 'battlefield',
      battlefield: document.createElement('div'),
    });
    const snapshot = snapshotWith({
      battlefield: [
        land('top', 100, 200),
        land('middle', 100, 182),
        land('bottom', 100, 164),
      ],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];
    const markPendingManaDrop = vi.fn();

    await service.endCardPointerDrag({
      ...context(
        () => snapshot,
        async (type, payload) => {
          commands.push({ type, payload });
        },
        [],
        () => true,
        undefined,
        undefined,
        undefined,
        markPendingManaDrop,
      ),
      landStackDetachSource: () => ({
        playerId: 'player-1',
        detachedInstanceId: 'middle',
        members: [
          { instanceId: 'top', x: 100, y: 200, layer: 0 },
          { instanceId: 'middle', x: 100, y: 182, layer: 1 },
          { instanceId: 'bottom', x: 100, y: 164, layer: 2 },
        ],
      }),
    }, { clientX: 120, clientY: 280 } as PointerEvent);

    expect(markPendingManaDrop).not.toHaveBeenCalled();
    expect(battlefieldDragService.positionWithManaLaneBottom).toHaveBeenCalledWith('player-1', { x: 260, y: 212 }, 162);
    expect(commands[0]).toEqual({
      type: 'cards.position.changed',
      payload: {
        playerId: 'player-1',
        zone: 'battlefield',
        positions: [
          { instanceId: 'middle', position: { x: 260, y: 296, unit: 'ratio' } },
          { instanceId: 'top', position: { x: 100, y: 200, unit: 'ratio' } },
          { instanceId: 'bottom', position: { x: 110, y: 182, unit: 'ratio' } },
        ],
      },
    });
  });

  it('falls back to the final pointer position when an extracted stack card keeps its compact origin as preview', async () => {
    dragService.pointerPosition.mockReturnValue({ x: 330, y: 240 });
    dragService.endCardPointerDrag.mockReturnValue({
      playerId: 'player-1',
      instanceId: 'middle',
      moved: true,
      position: { x: 100, y: 182 },
      previewPosition: { x: 100, y: 182 },
      dropZone: 'battlefield',
      battlefield: document.createElement('div'),
    });
    const snapshot = snapshotWith({
      battlefield: [
        land('top', 100, 200),
        land('middle', 100, 182),
        land('bottom', 100, 164),
      ],
    });
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];

    await service.endCardPointerDrag({
      ...context(
        () => snapshot,
        async (type, payload) => {
          commands.push({ type, payload });
        },
      ),
      landStackDetachSource: () => ({
        playerId: 'player-1',
        detachedInstanceId: 'middle',
        members: [
          { instanceId: 'top', x: 100, y: 200, layer: 0 },
          { instanceId: 'middle', x: 100, y: 182, layer: 1 },
          { instanceId: 'bottom', x: 100, y: 164, layer: 2 },
        ],
      }),
    }, { clientX: 360, clientY: 280 } as PointerEvent);

    expect(dragService.pointerPosition).toHaveBeenCalled();
    expect(commands[0]).toEqual({
      type: 'cards.position.changed',
      payload: {
        playerId: 'player-1',
        zone: 'battlefield',
        positions: [
          { instanceId: 'middle', position: { x: 330, y: 240, unit: 'ratio' } },
          { instanceId: 'top', position: { x: 100, y: 200, unit: 'ratio' } },
          { instanceId: 'bottom', position: { x: 110, y: 182, unit: 'ratio' } },
        ],
      },
    });
  });
});

function context(
  snapshot: () => GameSnapshot,
  command: (type: GameCommandType, payload: Record<string, unknown>) => Promise<void>,
  selectedCards: readonly { playerId: string; zone: GameZoneName; card: GameCardInstance }[] = [],
  isManaLaneHighlighted: (playerId: string) => boolean = () => false,
  markPendingTransfer: (playerId: string, fromZone: GameZoneName, instanceIds: readonly string[]) => void = vi.fn(),
  updateLocalCardPosition: (playerId: string, instanceId: string, position: { x: number; y: number }) => void = vi.fn(),
  refetch: (force?: boolean) => Promise<void> = vi.fn(async () => undefined),
  markPendingManaDrop: (playerId: string, instanceIds: readonly string[]) => void = vi.fn(),
  alignmentGuideY: (playerId: string) => number | null = () => null,
): GameTablePointerDragActionContext {
  return {
    zones: ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'],
    snapshot,
    handDropPreview: () => ({ playerId: 'player-1', targetInstanceId: 'hand-2', placement: 'before' }),
    selectedCards: () => selectedCards,
    battlefieldDragContext: () => ({
      zones: ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'],
      snapshot,
      selectedCards: () => [],
      findCard: (playerId, zone, instanceId) =>
        snapshot().players[playerId]?.zones[zone].find((candidate) => candidate.instanceId === instanceId) ?? null,
      cardPosition: (card) => card.position ?? null,
      updateLocalCardPosition: vi.fn(),
    }),
    alignmentGuideY,
    isManaLaneHighlighted,
    findCard: (playerId, zone, instanceId) =>
      snapshot().players[playerId]?.zones[zone].find((candidate) => candidate.instanceId === instanceId) ?? null,
    canControlPlayer: () => true,
    canControlOwnedCard: () => true,
    playerName: (playerId) => playerId,
    cardPosition: (card) => card.position ?? null,
    landStackDetachSource: () => null,
    attachmentStackDetachSource: () => null,
    battlefieldPosition: (_playerId, _instanceId, position) => ({ ...position, unit: 'ratio' }),
    updateLocalCardPosition,
    setPendingBattlefieldMove: vi.fn(),
    setPendingLibraryMove: vi.fn(),
    endCardDrag: vi.fn(),
    clearSelectedCards: vi.fn(),
    suppressCardPreview: vi.fn(),
    setError: vi.fn(),
    applyDeferredRemoteSnapshot: vi.fn(),
    refetch,
    markPendingManaDrop,
    markPendingTransfer,
    command,
  };
}

function snapshotWith(zones: Partial<Record<GameZoneName, GameCardInstance[]>>): GameSnapshot {
  return {
    version: 1,
    players: {
      'player-1': {
        user: { id: 'player-1', email: 'player@test', displayName: 'Player', roles: [] },
        life: 40,
        zones: {
          library: [],
          hand: zones.hand ?? [],
          battlefield: zones.battlefield ?? [],
          graveyard: [],
          exile: [],
          command: [],
        },
        commanderDamage: {},
        counters: {},
      },
    },
    turn: { activePlayerId: 'player-1', phase: 'main', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    createdAt: '',
  };
}

function moveCardToHand(snapshot: GameSnapshot, instanceId: string): GameSnapshot {
  const player = snapshot.players['player-1']!;
  const moved = player.zones.battlefield.find((candidate) => candidate.instanceId === instanceId)!;

  return {
    ...snapshot,
    players: {
      ...snapshot.players,
      'player-1': {
        ...player,
        zones: {
          ...player.zones,
          battlefield: player.zones.battlefield.filter((candidate) => candidate.instanceId !== instanceId),
          hand: [...player.zones.hand, { ...moved, zone: 'hand' }],
        },
      },
    },
  };
}

function moveCardsToHand(snapshot: GameSnapshot, instanceIds: readonly string[]): GameSnapshot {
  let next = snapshot;
  for (const instanceId of instanceIds) {
    next = moveCardToHand(next, instanceId);
  }

  return next;
}

function card(instanceId: string, name: string, zone: GameZoneName): GameCardInstance {
  return {
    instanceId,
    name,
    tapped: false,
    zone,
  };
}

function land(instanceId: string, x: number, y: number): GameCardInstance {
  return {
    ...card(instanceId, instanceId, 'battlefield'),
    typeLine: 'Basic Land - Forest',
    position: { x, y },
  };
}
