import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameCardInstance, GamePlayerState, GameSnapshot } from '../../../../../core/models/game.model';
import { User } from '../../../../../core/models/user.model';
import { GameTablePermanentRelationService } from '../../services/game-table-permanent-relation.service';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTableAttachmentInteractionContext, GameTableAttachmentsState } from './game-table-attachments.state';

describe('GameTableAttachmentsState', () => {
  let state: GameTableAttachmentsState;
  let snapshotSignal: ReturnType<typeof signal<GameSnapshot | null>>;

  beforeEach(() => {
    snapshotSignal = signal<GameSnapshot | null>(snapshot());

    TestBed.configureTestingModule({
      providers: [
        GameTableAttachmentsState,
        GameTablePermanentRelationService,
        {
          provide: GameTableCoreState,
          useValue: { snapshot: snapshotSignal } satisfies Pick<GameTableCoreState, 'snapshot'>,
        },
      ],
    });

    state = TestBed.inject(GameTableAttachmentsState);
  });

  it('starts attachment targeting from a controllable battlefield card', () => {
    const context = attachmentContext();

    state.startAttachmentFrom(context, { kind: 'card', playerId: 'player-1', zone: 'battlefield', card: card('equipment-card'), x: 0, y: 0 });

    expect(state.pendingAttachmentSource()).toEqual({
      instanceId: 'equipment-card',
      cardName: 'equipment-card',
    });
    expect(context.showTargetToast).toHaveBeenCalledWith('Choose a permanent to attach equipment-card to.');
    expect(context.closeContextMenu).toHaveBeenCalled();
  });

  it('creates an attachment when a target battlefield card is clicked', async () => {
    const context = attachmentContext();
    state.pendingAttachmentSource.set({ instanceId: 'equipment-card', cardName: 'equipment-card' });

    const handled = state.handleBattlefieldCardClick(context, mouseEvent(), card('target-card'));
    await Promise.resolve();

    expect(handled).toBe(true);
    expect(state.pendingAttachmentSource()).toBeNull();
    expect(context.command).toHaveBeenCalledWith('attachment.created', {
      equipmentInstanceId: 'equipment-card',
      attachedToInstanceId: 'target-card',
    });
    expect(context.clearTargetToast).toHaveBeenCalled();
  });

  it('does not start attachment targeting from a land', () => {
    const context = attachmentContext();

    state.startAttachmentFrom(context, {
      kind: 'card',
      playerId: 'player-1',
      zone: 'battlefield',
      card: card('land-card', 'Basic Land - Forest'),
      x: 0,
      y: 0,
    });

    expect(state.pendingAttachmentSource()).toBeNull();
    expect(context.setError).toHaveBeenCalledWith('Lands cannot be attached to another permanent.');
    expect(context.closeContextMenu).toHaveBeenCalled();
  });

  it('does not start attachment targeting from an emblem', () => {
    const context = attachmentContext();

    state.startAttachmentFrom(context, {
      kind: 'card',
      playerId: 'player-1',
      zone: 'battlefield',
      card: { ...card('emblem-card', 'Emblem'), layout: 'emblem' },
      x: 0,
      y: 0,
    });

    expect(state.pendingAttachmentSource()).toBeNull();
    expect(context.setError).toHaveBeenCalledWith('Emblems cannot be attached to another permanent.');
    expect(context.closeContextMenu).toHaveBeenCalled();
  });

  it('does not start attachment targeting from a dungeon', () => {
    const context = attachmentContext();

    state.startAttachmentFrom(context, {
      kind: 'card',
      playerId: 'player-1',
      zone: 'battlefield',
      card: { ...card('dungeon-card', 'Dungeon'), layout: 'dungeon' },
      x: 0,
      y: 0,
    });

    expect(state.pendingAttachmentSource()).toBeNull();
    expect(context.setError).toHaveBeenCalledWith('Dungeons cannot be attached to another permanent.');
    expect(context.closeContextMenu).toHaveBeenCalled();
  });

  it('does not start attachment targeting from a permanent with attached cards', () => {
    const context = attachmentContext();
    snapshotSignal.set({
      ...snapshot(),
      attachments: [{
        id: 'attachment-1',
        equipmentInstanceId: 'target-card',
        attachedToInstanceId: 'equipment-card',
        createdAt: '2026-05-21T00:00:00+00:00',
      }],
    });

    state.startAttachmentFrom(context, {
      kind: 'card',
      playerId: 'player-1',
      zone: 'battlefield',
      card: card('equipment-card'),
      x: 0,
      y: 0,
    });

    expect(state.pendingAttachmentSource()).toBeNull();
    expect(context.setError).toHaveBeenCalledWith('Cards with attached permanents cannot be attached to another permanent.');
    expect(context.closeContextMenu).toHaveBeenCalled();
  });

  it('does not attach across player battlefields', async () => {
    const context = attachmentContext();
    snapshotSignal.set({
      ...snapshot(),
      players: {
        'player-1': player('player-1', [card('equipment-card')]),
        'player-2': player('player-2', [card('target-card')]),
      },
    });
    state.pendingAttachmentSource.set({ instanceId: 'equipment-card', cardName: 'equipment-card' });

    const handled = state.handleBattlefieldCardClick(context, mouseEvent(), card('target-card'));
    await Promise.resolve();

    expect(handled).toBe(true);
    expect(context.setError).toHaveBeenCalledWith('Attachments must stay on the same battlefield.');
    expect(context.command).not.toHaveBeenCalled();
  });

  it('allows a land as attachment target', async () => {
    const context = attachmentContext();
    state.pendingAttachmentSource.set({ instanceId: 'equipment-card', cardName: 'equipment-card' });
    snapshotSignal.set({
      ...snapshot(),
      players: {
        'player-1': player('player-1', [card('equipment-card'), card('land-card', 'Basic Land - Forest')]),
      },
    });

    const handled = state.handleBattlefieldCardClick(context, mouseEvent(), card('land-card', 'Basic Land - Forest'));
    await Promise.resolve();

    expect(handled).toBe(true);
    expect(context.command).toHaveBeenCalledWith('attachment.created', {
      equipmentInstanceId: 'equipment-card',
      attachedToInstanceId: 'land-card',
    });
  });

  it('does not attach to an emblem target', async () => {
    const context = attachmentContext();
    state.pendingAttachmentSource.set({ instanceId: 'equipment-card', cardName: 'equipment-card' });
    snapshotSignal.set({
      ...snapshot(),
      players: {
        'player-1': player('player-1', [card('equipment-card'), { ...card('emblem-card', 'Emblem'), layout: 'emblem' }]),
      },
    });

    const handled = state.handleBattlefieldCardClick(context, mouseEvent(), { ...card('emblem-card', 'Emblem'), layout: 'emblem' });
    await Promise.resolve();

    expect(handled).toBe(true);
    expect(context.setError).toHaveBeenCalledWith('Emblems cannot be attachment targets.');
    expect(context.command).not.toHaveBeenCalled();
  });

  it('does not attach to a dungeon target', async () => {
    const context = attachmentContext();
    state.pendingAttachmentSource.set({ instanceId: 'equipment-card', cardName: 'equipment-card' });
    snapshotSignal.set({
      ...snapshot(),
      players: {
        'player-1': player('player-1', [card('equipment-card'), { ...card('dungeon-card', 'Dungeon'), layout: 'dungeon' }]),
      },
    });

    const handled = state.handleBattlefieldCardClick(context, mouseEvent(), { ...card('dungeon-card', 'Dungeon'), layout: 'dungeon' });
    await Promise.resolve();

    expect(handled).toBe(true);
    expect(context.setError).toHaveBeenCalledWith('Dungeons cannot be attachment targets.');
    expect(context.command).not.toHaveBeenCalled();
  });

  it('positions equipment under the target before creating the attachment', async () => {
    const context = attachmentContext({
      battlefieldCards: () => [
        card('equipment-card', 'Artifact', { x: 10, y: 10 }),
        card('first-equipment', 'Artifact', { x: 40, y: 10 }),
        card('target-card', 'Creature', { x: 100, y: 80 }),
      ],
      cardPosition: (target) => target.position && target.position.unit !== 'ratio'
        ? { x: target.position.x, y: target.position.y }
        : null,
    });
    snapshotSignal.set({
      ...snapshot(),
      players: {
        'player-1': player('player-1', [
          card('equipment-card', 'Artifact', { x: 10, y: 10 }),
          card('first-equipment', 'Artifact', { x: 40, y: 10 }),
          card('target-card', 'Creature', { x: 100, y: 80 }),
        ]),
      },
      attachments: [{
        id: 'attachment-1',
        equipmentInstanceId: 'first-equipment',
        attachedToInstanceId: 'target-card',
        createdAt: '2026-05-21T00:00:00+00:00',
      }],
    });
    state.pendingAttachmentSource.set({ instanceId: 'equipment-card', cardName: 'equipment-card' });

    state.handleBattlefieldCardClick(context, mouseEvent(), card('target-card'));
    await Promise.resolve();
    await Promise.resolve();

    expect(context.command).toHaveBeenNthCalledWith(1, 'cards.position.changed', {
      playerId: 'player-1',
      zone: 'battlefield',
      positions: [
        { instanceId: 'first-equipment', position: { x: 110, y: 62, unit: 'ratio' } },
        { instanceId: 'equipment-card', position: { x: 120, y: 44, unit: 'ratio' } },
      ],
    });
    expect(context.command).toHaveBeenNthCalledWith(2, 'attachment.created', {
      equipmentInstanceId: 'equipment-card',
      attachedToInstanceId: 'target-card',
    });
  });

  it('reports equipped cards from snapshot attachments', () => {
    snapshotSignal.set({
      ...snapshot(),
      attachments: [{
        id: 'attachment-1',
        equipmentInstanceId: 'equipment-card',
        attachedToInstanceId: 'target-card',
        createdAt: '2026-05-21T00:00:00+00:00',
      }],
    });

    expect(state.isAttachedEquipment('equipment-card')).toBe(true);
    expect(state.isAttachedEquipment('target-card')).toBe(false);
  });
});

function snapshot(): GameSnapshot {
  return {
    version: 1,
    ownerId: 'player-1',
    players: {
      'player-1': player('player-1', [card('equipment-card'), card('target-card')]),
    },
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: [],
    attachments: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-05-21T00:00:00+00:00',
  };
}

function player(id: string, battlefield: GameCardInstance[]): GamePlayerState {
  return {
    user: user(id),
    life: 40,
    zones: {
      library: [],
      hand: [],
      battlefield,
      graveyard: [],
      exile: [],
      command: [],
    },
    commanderDamage: {},
    counters: {},
  };
}

function card(instanceId: string, typeLine = 'Artifact', position?: { x: number; y: number }): GameCardInstance {
  return {
    instanceId,
    name: instanceId,
    typeLine,
    position,
    tapped: false,
  };
}

function user(id: string): User {
  return {
    id,
    email: `${id}@test.local`,
    displayName: id,
    roles: [],
  };
}

function attachmentContext(overrides: Partial<GameTableAttachmentInteractionContext> = {}): GameTableAttachmentInteractionContext {
  return {
    snapshot: () => snapshotSignalForContext(),
    canControlOwnedCard: vi.fn(() => true),
    battlefieldCards: () => [],
    cardPosition: () => null,
    battlefieldPosition: (_playerId, _instanceId, position) => ({ ...position, unit: 'ratio' }),
    updateLocalCardPosition: vi.fn(),
    setError: vi.fn(),
    closeContextMenu: vi.fn(),
    showTargetToast: vi.fn(),
    clearTargetToast: vi.fn(),
    command: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function snapshotSignalForContext(): GameSnapshot | null {
  return TestBed.inject(GameTableCoreState).snapshot();
}

function mouseEvent(): MouseEvent {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as MouseEvent;
}
