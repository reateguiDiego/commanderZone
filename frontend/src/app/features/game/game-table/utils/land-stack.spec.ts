import { GameCardInstance } from '../../../../core/models/game.model';
import {
  buildLandStackGroups,
  createLandStackMoves,
  detachLandStackMoves,
  fullLandStackDropTarget,
  landStackDetachSource,
  landStackDropTarget,
  removeLandStackMoves,
} from './land-stack';

describe('land stack utilities', () => {
  it('detects compact two and three card land stacks', () => {
    const two = buildLandStackGroups([
      land('top', 100, 200),
      land('under', 110, 182),
    ], positionFor);
    const three = buildLandStackGroups([
      land('top', 100, 200),
      land('under', 110, 182),
      land('bottom', 120, 164),
    ], positionFor);

    expect(two[0]?.members.map((member) => member.card.instanceId)).toEqual(['top', 'under']);
    expect(three[0]?.members.map((member) => member.card.instanceId)).toEqual(['top', 'under', 'bottom']);
  });

  it('keeps detecting stacks persisted with previous offsets', () => {
    const previous = buildLandStackGroups([
      land('top', 100, 200),
      land('under', 100, 172),
      land('bottom', 100, 144),
    ], positionFor);
    const groups = buildLandStackGroups([
      land('top', 100, 200),
      land('under', 100, 180),
      land('bottom', 100, 160),
    ], positionFor);

    expect(previous[0]?.members.map((member) => member.card.instanceId)).toEqual(['top', 'under', 'bottom']);
    expect(groups[0]?.members.map((member) => member.card.instanceId)).toEqual(['top', 'under', 'bottom']);
  });

  it('detects a stack whose cards were bottom-clamped to the same row during zoom reflow', () => {
    const groups = buildLandStackGroups([
      land('top', 100, 200),
      land('under', 110, 200),
      land('bottom', 120, 200),
    ], positionFor);

    expect(groups[0]?.members.map((member) => member.card.instanceId)).toEqual(['top', 'under', 'bottom']);
  });

  it('does not detect stacks from non lands or loose positions', () => {
    expect(buildLandStackGroups([
      card('artifact', 'Artifact', 100, 200),
      land('under', 100, 180),
    ], positionFor)).toEqual([]);

    expect(buildLandStackGroups([
      land('top', 100, 200),
      land('loose', 150, 180),
    ], positionFor)).toEqual([]);
  });

  it('keeps the destination land on top when creating a stack', () => {
    const battlefield = [
      land('dragged', 120, 200),
      land('target', 100, 200),
    ];
    const target = landStackDropTarget(battlefield, 'dragged', { x: 100, y: 200 }, positionFor);
    const moves = target ? createLandStackMoves(target, battlefield[0]!) : [];

    expect(target?.targetCard.instanceId).toBe('target');
    expect(target?.nextSize).toBe(2);
    expect(moves).toEqual([{ card: battlefield[0], position: { x: 110, y: 182 } }]);
  });

  it('adds the third land to the bottom of an existing two card stack', () => {
    const battlefield = [
      land('dragged', 140, 220),
      land('top', 100, 200),
      land('under', 100, 182),
    ];
    const target = landStackDropTarget(battlefield, 'dragged', { x: 100, y: 200 }, positionFor);
    const moves = target ? createLandStackMoves(target, battlefield[0]!) : [];

    expect(target?.targetCard.instanceId).toBe('top');
    expect(target?.nextSize).toBe(3);
    expect(moves).toEqual([{ card: battlefield[0], position: { x: 120, y: 164 } }]);
  });

  it('targets the top land when hovering mainly over the second card of a two-card stack', () => {
    const battlefield = [
      land('dragged', 140, 220),
      land('top', 100, 200),
      land('under', 110, 182),
    ];

    const target = landStackDropTarget(battlefield, 'dragged', { x: 110, y: 182 }, positionFor);

    expect(target?.targetCard.instanceId).toBe('top');
    expect(target?.nextSize).toBe(3);
  });

  it('keeps the existing stack top as the only relation target from the exposed second card edge', () => {
    const battlefield = [
      land('dragged', 140, 220),
      land('top', 100, 200),
      land('under', 110, 182),
    ];

    const target = landStackDropTarget(battlefield, 'dragged', { x: 108, y: 196 }, positionFor);

    expect(target?.targetCard.instanceId).toBe('top');
    expect(target?.targetStack?.topCard.instanceId).toBe('top');
  });

  it('targets the top land when hovering over a legacy-offset under card', () => {
    const battlefield = [
      land('dragged', 140, 220),
      land('top', 100, 200),
      land('under', 100, 180),
    ];

    const target = landStackDropTarget(battlefield, 'dragged', { x: 100, y: 180 }, positionFor);

    expect(target?.targetCard.instanceId).toBe('top');
    expect(fullLandStackDropTarget(battlefield, 'dragged', { x: 100, y: 180 }, positionFor)).toBeNull();
  });

  it('ignores the dragged land transient position when detecting the destination stack', () => {
    const battlefield = [
      land('dragged', 100, 200),
      land('top', 100, 200),
      land('under', 100, 182),
    ];
    const target = landStackDropTarget(battlefield, 'dragged', { x: 100, y: 200 }, positionFor);
    const moves = target ? createLandStackMoves(target, battlefield[0]!) : [];

    expect(target?.targetCard.instanceId).toBe('top');
    expect(target?.nextSize).toBe(3);
    expect(moves).toEqual([{ card: battlefield[0], position: { x: 120, y: 164 } }]);
  });

  it('reanchors an existing two card stack when adding the third land with a new top position', () => {
    const battlefield = [
      land('dragged', 140, 220),
      land('top', 100, 200),
      land('under', 100, 182),
    ];
    const target = landStackDropTarget(battlefield, 'dragged', { x: 100, y: 200 }, positionFor);
    const moves = target ? createLandStackMoves(target, battlefield[0]!, { x: 100, y: 296 }) : [];

    expect(moves.map((move) => ({ id: move.card.instanceId, position: move.position }))).toEqual([
      { id: 'top', position: { x: 100, y: 296 } },
      { id: 'under', position: { x: 110, y: 278 } },
      { id: 'dragged', position: { x: 120, y: 260 } },
    ]);
  });

  it('rejects drops onto full stacks', () => {
    const battlefield = [
      land('dragged', 140, 220),
      land('top', 100, 200),
      land('under', 100, 182),
      land('bottom', 100, 164),
    ];

    expect(landStackDropTarget(battlefield, 'dragged', { x: 100, y: 200 }, positionFor)).toBeNull();
    expect(fullLandStackDropTarget(battlefield, 'dragged', { x: 100, y: 200 }, positionFor)?.topCard.instanceId).toBe('top');
  });

  it('rejects land stack drops when either card is blocked by an attachment relation', () => {
    const battlefield = [
      land('dragged', 120, 200),
      land('target', 100, 200),
    ];

    expect(landStackDropTarget(
      battlefield,
      'dragged',
      { x: 100, y: 200 },
      positionFor,
      new Set(['dragged']),
    )).toBeNull();
    expect(landStackDropTarget(
      battlefield,
      'dragged',
      { x: 100, y: 200 },
      positionFor,
      new Set(['target']),
    )).toBeNull();
  });

  it('separates a stack around its current top position', () => {
    const group = buildLandStackGroups([
      land('top', 100, 200),
      land('under', 100, 182),
      land('bottom', 100, 164),
    ], positionFor)[0]!;

    expect(removeLandStackMoves(group).map((move) => ({ id: move.card.instanceId, position: move.position }))).toEqual([
      { id: 'top', position: { x: 100, y: 200 } },
      { id: 'under', position: { x: 230, y: 200 } },
      { id: 'bottom', position: { x: 360, y: 200 } },
    ]);
  });

  it('separates a stack toward the left when the top card is close to the right edge', () => {
    const group = buildLandStackGroups([
      land('top', 400, 200),
      land('under', 400, 182),
      land('bottom', 400, 164),
    ], positionFor)[0]!;

    expect(removeLandStackMoves(group).map((move) => ({ id: move.card.instanceId, position: move.position }))).toEqual([
      { id: 'top', position: { x: 400, y: 200 } },
      { id: 'under', position: { x: 270, y: 200 } },
      { id: 'bottom', position: { x: 140, y: 200 } },
    ]);
  });

  it('recompacts a three card stack after extracting the middle land', () => {
    const group = buildLandStackGroups([
      land('top', 100, 200),
      land('middle', 100, 182),
      land('bottom', 100, 164),
    ], positionFor)[0]!;
    const source = landStackDetachSource('player-1', group, 'middle')!;

    expect(detachLandStackMoves(source)).toEqual([
      { instanceId: 'top', position: { x: 100, y: 200 } },
      { instanceId: 'bottom', position: { x: 110, y: 182 } },
    ]);
  });

  it('keeps the two upper lands compact after extracting the bottom land', () => {
    const group = buildLandStackGroups([
      land('top', 100, 200),
      land('middle', 100, 182),
      land('bottom', 100, 164),
    ], positionFor)[0]!;
    const source = landStackDetachSource('player-1', group, 'bottom')!;

    expect(detachLandStackMoves(source)).toEqual([
      { instanceId: 'top', position: { x: 100, y: 200 } },
      { instanceId: 'middle', position: { x: 110, y: 182 } },
    ]);
  });
});

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
