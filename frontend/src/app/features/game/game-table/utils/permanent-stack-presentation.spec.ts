import { GameCardInstance } from '../../../../core/models/game.model';
import { buildPermanentStackPresentationGroups } from './permanent-stack-presentation';

describe('permanent stack presentation', () => {
  it('builds the shared target-and-layer layout for three related cards', () => {
    const groups = buildPermanentStackPresentationGroups(
      [card('target', 100, 200), card('first', 110, 182), card('second', 120, 164)],
      [
        { targetInstanceId: 'target', layeredInstanceId: 'first' },
        { targetInstanceId: 'target', layeredInstanceId: 'second' },
      ],
      positionFor,
    );

    expect(groups).toEqual([
      expect.objectContaining({
        id: 'target:first:second',
        members: [
          expect.objectContaining({ card: expect.objectContaining({ instanceId: 'target' }), layer: 0, role: 'target' }),
          expect.objectContaining({ card: expect.objectContaining({ instanceId: 'first' }), layer: 1, role: 'layer' }),
          expect.objectContaining({ card: expect.objectContaining({ instanceId: 'second' }), layer: 2, role: 'layer' }),
        ],
      }),
    ]);
  });

  it('caps only the visual layers requested by the domain caller', () => {
    const groups = buildPermanentStackPresentationGroups(
      [card('target', 100, 200), card('first', 110, 182), card('second', 120, 164), card('third', 130, 146)],
      [
        { targetInstanceId: 'target', layeredInstanceId: 'first' },
        { targetInstanceId: 'target', layeredInstanceId: 'second' },
        { targetInstanceId: 'target', layeredInstanceId: 'third' },
      ],
      positionFor,
      2,
    );

    expect(groups[0]?.members.map((member) => member.card.instanceId)).toEqual(['target', 'first', 'second']);
  });
});

function card(instanceId: string, x: number, y: number): GameCardInstance {
  return {
    instanceId,
    name: instanceId,
    typeLine: 'Artifact',
    tapped: false,
    position: { x, y },
  };
}

function positionFor(card: GameCardInstance): { x: number; y: number } | null {
  return card.position && card.position.unit !== 'ratio' ? card.position : null;
}
