import { GameBattlefieldStack, GameCardInstance } from '../../../../core/models/game.model';
import {
  buildLandStackGroups,
  createLandStackMoves,
  detachLandStackMoves,
  fullLandStackDropTarget,
  landStackDetachSource,
  landStackDropTarget,
} from './land-stack';

describe('land stack utilities', () => {
  it('rebuilds a three-card stack from persisted relations regardless of card geometry', () => {
    const cards = [
      land('top', 100, 200),
      land('middle', 340, 500),
      land('bottom', 24, 8),
    ];

    const groups = buildLandStackGroups(cards, [
      stack('stack-middle', 'middle', 'top', '2026-01-01T00:00:00.000Z'),
      stack('stack-bottom', 'bottom', 'top', '2026-01-01T00:00:01.000Z'),
    ], positionFor);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.members.map((member) => member.card.instanceId)).toEqual(['top', 'middle', 'bottom']);
    expect(groups[0]?.members.map((member) => member.layer)).toEqual([0, 1, 2]);
  });

  it('rebuilds a persisted relation before optional static card metadata is available', () => {
    const top = land('top', 100, 200);
    const unresolvedCard: GameCardInstance = {
      ...card('unresolved', '', 110, 182),
      typeLine: null,
    };

    expect(buildLandStackGroups([top, unresolvedCard], [stack('stack', 'unresolved', 'top')], positionFor))
      .toEqual([expect.objectContaining({
        topCard: expect.objectContaining({ instanceId: 'top' }),
        members: expect.arrayContaining([
          expect.objectContaining({ card: expect.objectContaining({ instanceId: 'unresolved' }) }),
        ]),
      })]);

    expect(landStackDropTarget([top, unresolvedCard], [], 'unresolved', { x: 110, y: 182 }, positionFor)).toBeNull();
  });

  it('adds to a persisted stack until the three-card maximum', () => {
    const battlefield = [
      land('dragged', 100, 200),
      land('top', 100, 200),
      land('under', 110, 182),
    ];
    const target = landStackDropTarget(
      battlefield,
      [stack('stack-under', 'under', 'top')],
      'dragged',
      { x: 100, y: 200 },
      positionFor,
    );

    expect(target?.targetCard.instanceId).toBe('top');
    expect(target?.nextSize).toBe(3);
    expect(createLandStackMoves(target!, battlefield[0]!)).toEqual([
      { card: battlefield[0], position: { x: 120, y: 164 } },
    ]);
  });

  it('rejects a fourth member and attachment endpoints', () => {
    const battlefield = [
      land('dragged', 100, 200),
      land('top', 100, 200),
      land('middle', 110, 182),
      land('bottom', 120, 164),
    ];
    const stacks = [
      stack('stack-middle', 'middle', 'top'),
      stack('stack-bottom', 'bottom', 'top'),
    ];

    expect(landStackDropTarget(battlefield, stacks, 'dragged', { x: 100, y: 200 }, positionFor)).toBeNull();
    expect(fullLandStackDropTarget(battlefield, stacks, 'dragged', { x: 100, y: 200 }, positionFor)?.topCard.instanceId).toBe('top');
    expect(landStackDropTarget(battlefield, [], 'dragged', { x: 100, y: 200 }, positionFor, new Set(['top']))).toBeNull();
  });

  it('detaches one relation and recompacts the remaining members', () => {
    const cards = [land('top', 100, 200), land('middle', 110, 182), land('bottom', 120, 164)];
    const stacks = [
      stack('stack-middle', 'middle', 'top', '2026-01-01T00:00:00.000Z'),
      stack('stack-bottom', 'bottom', 'top', '2026-01-01T00:00:01.000Z'),
    ];
    const group = buildLandStackGroups(cards, stacks, positionFor)[0]!;
    const source = landStackDetachSource('player-1', stacks, group, 'middle')!;

    expect(source.stackId).toBe('stack-middle');
    expect(detachLandStackMoves(source)).toEqual([
      { instanceId: 'top', position: { x: 100, y: 200 } },
      { instanceId: 'bottom', position: { x: 110, y: 182 } },
    ]);
  });
});

function land(instanceId: string, x: number, y: number): GameCardInstance {
  return card(instanceId, 'Land', x, y);
}

function card(instanceId: string, typeLine: string, x: number, y: number, isToken = false): GameCardInstance {
  return {
    instanceId,
    name: instanceId,
    typeLine,
    position: { x, y },
    tapped: false,
    isToken,
  };
}

function stack(
  id: string,
  stackedInstanceId: string,
  stackTopInstanceId: string,
  createdAt = '2026-01-01T00:00:00.000Z',
): GameBattlefieldStack {
  return { id, stackedInstanceId, stackTopInstanceId, createdAt };
}

function positionFor(card: GameCardInstance): { x: number; y: number } | null {
  const position = card.position;

  return position && position.unit !== 'ratio' ? position : null;
}
