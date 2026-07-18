import { GameCardInstance } from '../../../../core/models/game.model';
import { GameTableSelectionService } from './game-table-selection.service';

describe('GameTableSelectionService', () => {
  let service: GameTableSelectionService;

  beforeEach(() => {
    service = new GameTableSelectionService();
  });

  it('keeps stable Set membership and visual order without duplicate IDs', () => {
    service.selectMany('player-1', 'battlefield', [card('card-1'), card('card-2'), card('card-1')]);

    expect([...service.selectedIds()]).toEqual(['card-1', 'card-2']);
    expect(service.orderedSelectedIds()).toEqual(['card-1', 'card-2']);
    expect(service.state()).toMatchObject({
      ownerPlayerId: 'player-1',
      zone: 'battlefield',
      regionId: 'player-1:battlefield',
      anchorId: 'card-1',
      lastInteractionType: 'selectAll',
    });
  });

  it('replaces on normal click but preserves a compatible multi-selection when clicking one selected card', () => {
    const first = card('card-1');
    const second = card('card-2');
    const third = card('card-3');
    service.selectMany('player-1', 'battlefield', [first, second]);

    service.toggleSelection(mouseEvent(), 'player-1', 'battlefield', second);
    expect(service.orderedSelectedIds()).toEqual(['card-1', 'card-2']);

    service.toggleSelection(mouseEvent(), 'player-1', 'battlefield', third);
    expect(service.orderedSelectedIds()).toEqual(['card-3']);
  });

  it.each([
    { name: 'Control', modifiers: { ctrlKey: true } },
    { name: 'Meta', modifiers: { metaKey: true } },
    { name: 'Shift', modifiers: { shiftKey: true } },
    { name: 'Control+Shift', modifiers: { ctrlKey: true, shiftKey: true } },
  ])('toggles individual membership with $name', ({ modifiers }) => {
    const first = card('card-1');
    const second = card('card-2');
    service.selectSingle('player-1', 'battlefield', first);

    service.toggleSelection(mouseEvent(modifiers), 'player-1', 'battlefield', second);
    expect(service.orderedSelectedIds()).toEqual(['card-1', 'card-2']);

    service.toggleSelection(mouseEvent(modifiers), 'player-1', 'battlefield', first);
    expect(service.orderedSelectedIds()).toEqual(['card-2']);
  });

  it('replaces the source when a modifier click crosses player or zone boundaries', () => {
    service.selectSingle('player-1', 'battlefield', card('battlefield-card'));

    const result = service.toggleSelection(mouseEvent({ ctrlKey: true }), 'player-1', 'hand', card('hand-card'));

    expect(result).toBe('replacedSource');
    expect(service.selectedCards()).toEqual([{ playerId: 'player-1', zone: 'hand', card: card('hand-card') }]);
  });

  it('keeps Alt reserved and applies normal click semantics', () => {
    service.selectMany('player-1', 'battlefield', [card('card-1'), card('card-2')]);

    service.toggleSelection(mouseEvent({ altKey: true }), 'player-1', 'battlefield', card('card-3'));

    expect(service.orderedSelectedIds()).toEqual(['card-3']);
  });

  it('supports replace, Shift-add and Ctrl-toggle marquee modes against the stable base selection', () => {
    service.selectMany('player-1', 'battlefield', [card('base'), card('toggle-out')]);

    service.applyMarqueeSelection('player-1', 'battlefield', [card('toggle-out'), card('added')], 'add');
    expect(service.orderedSelectedIds()).toEqual(['base', 'toggle-out', 'added']);

    service.applyMarqueeSelection('player-1', 'battlefield', [card('toggle-out'), card('new')], 'toggle');
    expect(service.orderedSelectedIds()).toEqual(['base', 'added', 'new']);

    service.applyMarqueeSelection('player-1', 'battlefield', [card('replacement')], 'replace');
    expect(service.orderedSelectedIds()).toEqual(['replacement']);
  });

  it('toggles the focused card from Space semantics', () => {
    const focused = card('focused');

    service.toggleKeyboardSelection('player-1', 'hand', focused);
    expect(service.orderedSelectedIds()).toEqual(['focused']);
    expect(service.state().lastInteractionType).toBe('keyboard');

    service.toggleKeyboardSelection('player-1', 'hand', focused);
    expect(service.orderedSelectedIds()).toEqual([]);
  });

  it('keeps a collapsed stack as one visible root plus a local group reference', () => {
    const root = card('root');
    const ref = {
      kind: 'battlefield-stack' as const,
      stackId: 'stack-1',
      rootInstanceId: 'root',
      playerId: 'player-1',
      zone: 'battlefield' as const,
      memberCount: 4,
    };

    service.selectStackGroup(mouseEvent(), ref, root);

    expect(service.orderedSelectedIds()).toEqual(['root']);
    expect([...service.state().selectedGroupRefs]).toEqual([ref]);

    service.selectStackGroup(mouseEvent({ ctrlKey: true }), ref, root);
    expect(service.orderedSelectedIds()).toEqual([]);
    expect([...service.state().selectedGroupRefs]).toEqual([]);
  });

  it('updates a selected stack root on promotion and removes a dissolved group without exposing members', () => {
    const oldRoot = card('old-root');
    const ref = {
      kind: 'battlefield-stack' as const,
      stackId: 'stack-1',
      rootInstanceId: 'old-root',
      playerId: 'player-1',
      zone: 'battlefield' as const,
      memberCount: 4,
    };
    service.selectStackGroup(mouseEvent(), ref, oldRoot);

    const promotedRef = { ...ref, rootInstanceId: 'new-root', memberCount: 3 };
    service.reconcileGroupReferences([{ ref: promotedRef, rootCard: card('new-root') }]);

    expect(service.orderedSelectedIds()).toEqual(['new-root']);
    expect([...service.state().selectedGroupRefs]).toEqual([promotedRef]);

    service.reconcileGroupReferences([]);
    expect(service.orderedSelectedIds()).toEqual([]);
    expect([...service.state().selectedGroupRefs]).toEqual([]);
  });

  it('selects an inclusive hand range in either direction and supports additive Ctrl/Meta+Shift', () => {
    const cards = ['one', 'two', 'three', 'four'].map((id) => card(id));
    service.selectSingle('player-1', 'hand', cards[1]!);

    service.selectHandRange('player-1', cards, cards[3]!, false);
    expect(service.orderedSelectedIds()).toEqual(['two', 'three', 'four']);

    service.selectSingle('player-1', 'hand', cards[3]!);
    service.selectHandRange('player-1', cards, cards[1]!, false);
    expect(service.orderedSelectedIds()).toEqual(['two', 'three', 'four']);

    service.selectSingle('player-1', 'hand', cards[0]!);
    service.selectHandRange('player-1', cards, cards[2]!, true);
    expect(service.orderedSelectedIds()).toEqual(['one', 'two', 'three']);
  });

  it('drops a stale hand range anchor during pruning', () => {
    const cards = ['one', 'two', 'three'].map((id) => card(id));
    service.selectSingle('player-1', 'hand', cards[1]!);
    service.reconcileSelectedCards([]);

    expect(service.state().anchorId).toBeNull();
    service.selectHandRange('player-1', [cards[0]!, cards[2]!], cards[2]!, false);
    expect(service.orderedSelectedIds()).toEqual(['three']);
  });

  it.each([0, 1, 3])('selects all 0/1/N cards safely while preserving input order (%i)', (count) => {
    const cards = Array.from({ length: count }, (_, index) => card(`card-${index}`));

    service.selectMany('player-1', 'hand', cards);

    expect(service.orderedSelectedIds()).toEqual(cards.map((item) => item.instanceId));
  });

  it('reconciles refreshed card references without changing selection metadata', () => {
    service.selectMany('player-1', 'battlefield', [card('card-1'), card('card-2')]);
    const revision = service.state().interactionRevision;
    const refreshed = [card('card-1', { tapped: true })];

    service.reconcileSelectedCards([{ playerId: 'player-1', zone: 'battlefield', card: refreshed[0]! }]);

    expect(service.selectedCards()).toEqual([{ playerId: 'player-1', zone: 'battlefield', card: refreshed[0] }]);
    expect(service.state().interactionRevision).toBe(revision);
  });

  it('clears all identity and region metadata deterministically', () => {
    service.selectSingle('player-1', 'battlefield', card('card-1'));

    service.clearSelection();

    expect(service.selectedCards()).toEqual([]);
    expect(service.state()).toMatchObject({
      ownerPlayerId: null,
      zone: null,
      regionId: null,
      focusedId: null,
      anchorId: null,
      lastInteractionType: 'clear',
    });
  });
});

function mouseEvent(
  modifiers: Partial<Pick<MouseEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>> = {},
): MouseEvent {
  return {
    altKey: modifiers.altKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
  } as MouseEvent;
}

function card(instanceId: string, overrides: Partial<GameCardInstance> = {}): GameCardInstance {
  return {
    instanceId,
    name: instanceId,
    tapped: false,
    ...overrides,
  };
}
