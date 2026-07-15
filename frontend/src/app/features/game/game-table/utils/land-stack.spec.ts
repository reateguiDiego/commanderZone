import { GameBattlefieldStack, GameCardInstance } from '../../../../core/models/game.model';
import {
  buildLandStackGroups,
  fullLandStackDropTarget,
  landStackDetachSource,
  landStackDropTarget,
  landStackOffsetX,
  landStackOffsetY,
  removeLandStackMoves,
} from './land-stack';

describe('explicit battlefield stack utilities', () => {
  it('never infers a stack from nearby or legacy pixel positions', () => {
    const cards = [land('root', 100, 200), land('member', 110, 182)];

    expect(buildLandStackGroups(cards, [], positionFor)).toEqual([]);
  });

  it('projects an explicit ordered stack from the root position with proportional offsets', () => {
    const cards = [land('root', 100, 200), land('middle', 900, 700), land('bottom', 0, 0)];
    const group = buildLandStackGroups(cards, [stack('s1', ['root', 'middle', 'bottom'])], positionFor)[0]!;

    expect(group.id).toBe('s1');
    expect(group.members.map((member) => member.card.instanceId)).toEqual(['root', 'middle', 'bottom']);
    expect(group.members[1]?.position.x).toBeCloseTo(100 + landStackOffsetX());
    expect(group.members[1]?.position.y).toBeCloseTo(200 - landStackOffsetY());
    expect(group.members[2]?.position.x).toBeCloseTo(100 + landStackOffsetX() * 2);
    expect(group.members[2]?.position.y).toBeCloseTo(200 - landStackOffsetY() * 2);
  });

  it('ignores malformed relations instead of guessing missing membership', () => {
    const cards = [land('root', 100, 200), land('member', 110, 182)];

    expect(buildLandStackGroups(cards, [stack('duplicate', ['root', 'member', 'member'])], positionFor)).toEqual([]);
    expect(buildLandStackGroups(cards, [stack('missing', ['root', 'missing'])], positionFor)).toEqual([]);
    expect(buildLandStackGroups(cards, [stack('one', ['root'])], positionFor)).toEqual([]);
  });

  it('uses proximity only as a UI suggestion and targets an explicit stack root', () => {
    const cards = [land('dragged', 400, 200), land('root', 100, 200), land('member', 900, 700)];
    const stacks = [stack('s1', ['root', 'member'])];
    const target = landStackDropTarget(cards, stacks, 'dragged', { x: 110, y: 182 }, positionFor);

    expect(target?.targetCard.instanceId).toBe('root');
    expect(target?.targetStack?.id).toBe('s1');
    expect(target?.nextSize).toBe(3);
  });

  it('rejects blocked, non-land and full-stack suggestions', () => {
    const fullIds = ['root', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
    const cards = [land('dragged', 400, 200), ...fullIds.map((id, index) => land(id, 100 + index, 200))];
    const stacks = [stack('full', fullIds)];

    expect(landStackDropTarget(cards, stacks, 'dragged', { x: 100, y: 200 }, positionFor)).toBeNull();
    expect(fullLandStackDropTarget(cards, stacks, 'dragged', { x: 100, y: 200 }, positionFor)?.id).toBe('full');
    expect(landStackDropTarget(
      [land('dragged', 400, 200), land('target', 100, 200)],
      [],
      'dragged',
      { x: 100, y: 200 },
      positionFor,
      new Set(['target']),
    )).toBeNull();
    expect(landStackDropTarget(
      [card('artifact', 'Artifact', 400, 200), land('target', 100, 200)],
      [],
      'artifact',
      { x: 100, y: 200 },
      positionFor,
    )).toBeNull();
  });

  it('carries the authoritative stack id when detaching a member', () => {
    const cards = [land('root', 100, 200), land('middle', 110, 182), land('bottom', 120, 164)];
    const group = buildLandStackGroups(cards, [stack('s1', ['root', 'middle', 'bottom'])], positionFor)[0]!;
    const source = landStackDetachSource('p1', group, 'middle');

    expect(source?.stackId).toBe('s1');
    expect(source?.detachedInstanceId).toBe('middle');
    expect(landStackDetachSource('p1', group, 'root')).toBeNull();
  });

  it('derives dissolve positions locally without mutating relation authority', () => {
    const cards = [land('root', 400, 200), land('middle', 410, 182), land('bottom', 420, 164)];
    const group = buildLandStackGroups(cards, [stack('s1', ['root', 'middle', 'bottom'])], positionFor)[0]!;

    expect(removeLandStackMoves(group).map((move) => ({ id: move.card.instanceId, position: move.position }))).toEqual([
      { id: 'root', position: { x: 400, y: 200 } },
      { id: 'middle', position: { x: 270, y: 200 } },
      { id: 'bottom', position: { x: 140, y: 200 } },
    ]);
  });
});

function stack(id: string, orderedMemberIds: string[]): GameBattlefieldStack {
  return {
    id,
    relationType: 'battlefield_stack',
    rootInstanceId: orderedMemberIds[0]!,
    orderedMemberIds,
    stackKind: 'land',
    effectVersion: 1,
  };
}

function land(instanceId: string, x: number, y: number): GameCardInstance {
  return card(instanceId, 'Basic Land - Forest', x, y);
}

function card(instanceId: string, typeLine: string, x: number, y: number): GameCardInstance {
  return {
    instanceId,
    name: instanceId,
    typeLine,
    tapped: false,
    position: { x, y },
  };
}

function positionFor(card: GameCardInstance): { x: number; y: number } | null {
  return card.position ? { x: card.position.x, y: card.position.y } : null;
}
