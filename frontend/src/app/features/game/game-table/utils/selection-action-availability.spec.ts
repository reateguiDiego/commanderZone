import { GameCardInstance, GameSnapshot } from '../../../../core/models/game.model';
import { BattlefieldStackSelectionRef, SelectedCardState } from '../services/game-table-selection.service';
import { resolveSelectionActions } from './selection-action-availability';

describe('resolveSelectionActions', () => {
  it('resolves one pure authority/lifecycle matrix for battlefield actions', () => {
    const cases = [
      { name: 'active controller', snapshot: snapshot(), expected: true, reason: null },
      { name: 'owner without control', snapshot: snapshot({ controllerId: 'p2' }), expected: false, reason: 'game.selectionBatch.disabled.notControlled' },
      { name: 'defeated actor', snapshot: snapshot({}, 'defeated'), expected: false, reason: 'game.selectionBatch.disabled.playerInactive' },
      { name: 'closed game', snapshot: snapshot({}, 'active', 'FINISHED'), expected: false, reason: 'game.selectionBatch.disabled.gameClosed' },
    ];

    for (const test of cases) {
      const selected = selectedCards(test.snapshot, ['a', 'b']);
      const result = resolveSelectionActions({ actorPlayerId: 'p1', snapshot: test.snapshot, selectedCards: selected, selectedGroupRefs: [] });
      const tap = result.actions.find((action) => action.actionId === 'tap')!;
      expect(tap.enabled, test.name).toBe(test.expected);
      expect(tap.reasonDisabled, test.name).toBe(test.reason);
    }
  });

  it('derives exact movement, face state and stack availability', () => {
    const game = snapshot();
    const result = resolveSelectionActions({
      actorPlayerId: 'p1', snapshot: game, selectedCards: selectedCards(game, ['a', 'b']), selectedGroupRefs: [],
    });

    expect(result.resolvedInstanceIds).toEqual(['a', 'b']);
    expect(result.actions.find((action) => action.actionId === 'move:graveyard')).toEqual(expect.objectContaining({ enabled: true, commandType: 'cards.moved', affectedCount: 2 }));
    expect(result.actions.find((action) => action.actionId === 'tap')?.enabled).toBe(true);
    expect(result.actions.find((action) => action.actionId === 'untap')?.enabled).toBe(true);
    expect(result.actions.find((action) => action.actionId === 'faceDown')?.enabled).toBe(true);
    expect(result.actions.find((action) => action.actionId === 'faceUp')?.visible).toBe(true);
    expect(result.actions.find((action) => action.actionId === 'createStack')?.enabled).toBe(true);
  });

  it('resolves a collapsed stack exactly once and exposes dissolve without duplicating hidden members', () => {
    const game = snapshot();
    game.battlefieldStacks = [{
      id: 'stack-1', relationType: 'battlefield_stack', rootInstanceId: 'a', orderedMemberIds: ['a', 'b'], stackKind: 'generic', effectVersion: 1,
    }];
    const ref: BattlefieldStackSelectionRef = {
      kind: 'battlefield-stack', stackId: 'stack-1', rootInstanceId: 'a', playerId: 'p1', zone: 'battlefield', memberCount: 2,
    };
    const result = resolveSelectionActions({
      actorPlayerId: 'p1', snapshot: game, selectedCards: selectedCards(game, ['a']), selectedGroupRefs: [ref],
    });

    expect(result.resolvedInstanceIds).toEqual(['a', 'b']);
    expect(result.actions.find((action) => action.actionId === 'dissolveStack')).toEqual(expect.objectContaining({ enabled: true, affectedCount: 2 }));
    expect(result.actions.find((action) => action.actionId === 'createStack')?.enabled).toBe(false);
  });

  it('offers detach only for one explicitly selected attachment source', () => {
    const game = snapshot();
    game.attachments = [{ id: 'attachment-1', equipmentInstanceId: 'a', attachedToInstanceId: 'b', createdAt: '' }];
    const one = resolveSelectionActions({ actorPlayerId: 'p1', snapshot: game, selectedCards: selectedCards(game, ['a']), selectedGroupRefs: [] });
    const many = resolveSelectionActions({ actorPlayerId: 'p1', snapshot: game, selectedCards: selectedCards(game, ['a', 'b']), selectedGroupRefs: [] });
    expect(one.actions.find((action) => action.actionId === 'detach')?.enabled).toBe(true);
    expect(many.actions.find((action) => action.actionId === 'detach')?.enabled).toBe(false);
  });

  it('keeps battlefield-only actions hidden for a hand selection', () => {
    const game = snapshot();
    const hand = game.players['p1']!.zones.hand[0]!;
    const result = resolveSelectionActions({
      actorPlayerId: 'p1', snapshot: game, selectedCards: [{ playerId: 'p1', zone: 'hand', card: hand }], selectedGroupRefs: [],
    });
    expect(result.actions.find((action) => action.actionId === 'tap')?.visible).toBe(false);
    expect(result.actions.find((action) => action.actionId === 'move:battlefield')?.enabled).toBe(true);
  });
});

function snapshot(overrides: Partial<GameCardInstance> = {}, status: 'active' | 'defeated' | 'conceded' = 'active', phase: 'PLAYING' | 'FINISHED' = 'PLAYING'): GameSnapshot {
  const card = (instanceId: string, extra: Partial<GameCardInstance> = {}): GameCardInstance => ({
    instanceId, name: instanceId, ownerId: 'p1', controllerId: 'p1', zone: 'battlefield', tapped: false, faceDown: false,
    position: { x: instanceId === 'a' ? 0.1 : 0.3, y: 0.2, unit: 'ratio' }, ...extra,
  });
  const a = card('a', overrides);
  const b = card('b', { tapped: true, faceDown: true });
  const hand = card('h1', { zone: 'hand' });
  return {
    version: 1, ownerId: 'p1', gamePhase: phase,
    players: {
      p1: { user: { id: 'u1', displayName: 'A' } as never, status, life: 40, zones: { library: [], hand: [hand], battlefield: [a, b], graveyard: [], exile: [], command: [] }, commanderDamage: {}, counters: {} },
      p2: { user: { id: 'u2', displayName: 'B' } as never, status: 'active', life: 40, zones: { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [] }, commanderDamage: {}, counters: {} },
    },
    turn: { activePlayerId: 'p1', phase: 'main-1', number: 1 }, stack: [], arrows: [], attachments: [], battlefieldStacks: [], chat: [], eventLog: [], createdAt: '',
  };
}

function selectedCards(game: GameSnapshot, instanceIds: readonly string[]): SelectedCardState[] {
  return instanceIds.map((instanceId) => ({
    playerId: 'p1', zone: 'battlefield', card: game.players['p1']!.zones.battlefield.find((candidate) => candidate.instanceId === instanceId)!,
  }));
}
