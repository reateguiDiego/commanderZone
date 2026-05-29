import { GameAttachment, GameCardInstance } from '../../../../core/models/game.model';
import {
  attachmentDropTarget,
  attachmentStackDetachSource,
  buildAttachmentStackGroups,
  createAttachmentStackMoves,
  detachAttachmentStackMoves,
  removeAttachmentStackMoves,
} from './attachment-stack';

describe('attachment stack layout', () => {
  it('places equipment under its target with the land-stack offset', () => {
    const moves = createAttachmentStackMoves(
      [card('equipment', 40, 20), card('target', 100, 80)],
      [],
      'equipment',
      'target',
      positionFor,
    );

    expect(moves).toEqual([
      { instanceId: 'equipment', position: { x: 110, y: 62 } },
    ]);
  });

  it('appends unlimited equipment below the same target', () => {
    const moves = createAttachmentStackMoves(
      [card('equipment-a', 40, 20), card('equipment-b', 80, 20), card('equipment-c', 120, 20), card('target', 100, 80)],
      [
        attachment('attachment-a', 'equipment-a', 'target'),
        attachment('attachment-b', 'equipment-b', 'target'),
      ],
      'equipment-c',
      'target',
      positionFor,
    );

    expect(moves).toEqual([
      { instanceId: 'equipment-a', position: { x: 110, y: 62 } },
      { instanceId: 'equipment-b', position: { x: 120, y: 44 } },
      { instanceId: 'equipment-c', position: { x: 130, y: 26 } },
    ]);
  });

  it('compacts the previous target when re-equipping', () => {
    const moves = createAttachmentStackMoves(
      [
        card('equipment-a', 40, 20),
        card('equipment-b', 80, 20),
        card('equipment-c', 120, 20),
        card('old-target', 100, 80),
        card('new-target', 300, 80),
      ],
      [
        attachment('attachment-a', 'equipment-a', 'old-target'),
        attachment('attachment-b', 'equipment-b', 'old-target'),
        attachment('attachment-c', 'equipment-c', 'new-target'),
      ],
      'equipment-a',
      'new-target',
      positionFor,
    );

    expect(moves).toEqual([
      { instanceId: 'equipment-b', position: { x: 110, y: 62 } },
      { instanceId: 'equipment-c', position: { x: 310, y: 62 } },
      { instanceId: 'equipment-a', position: { x: 320, y: 44 } },
    ]);
  });

  it('compacts equipment when detaching from the middle of the stack', () => {
    const cards = [
      card('target', 100, 80),
      card('equipment-a', 100, 62),
      card('equipment-b', 100, 44),
      card('equipment-c', 100, 26),
    ];
    const attachments = [
      attachment('attachment-a', 'equipment-a', 'target'),
      attachment('attachment-b', 'equipment-b', 'target'),
      attachment('attachment-c', 'equipment-c', 'target'),
    ];
    const group = buildAttachmentStackGroups(cards, attachments, positionFor)[0]!;
    const source = attachmentStackDetachSource('player-1', attachments, group, 'equipment-b')!;

    expect(detachAttachmentStackMoves(source)).toEqual([
      { instanceId: 'equipment-a', position: { x: 110, y: 62 } },
      { instanceId: 'equipment-c', position: { x: 120, y: 44 } },
    ]);
  });

  it('spreads all equipment beside the target when removing a stack', () => {
    const group = buildAttachmentStackGroups(
      [card('target', 300, 80), card('equipment-a', 300, 62), card('equipment-b', 300, 44)],
      [attachment('attachment-a', 'equipment-a', 'target'), attachment('attachment-b', 'equipment-b', 'target')],
      positionFor,
    )[0]!;

    expect(removeAttachmentStackMoves(group)).toEqual([
      { instanceId: 'equipment-a', position: { x: 170, y: 80 } },
      { instanceId: 'equipment-b', position: { x: 40, y: 80 } },
    ]);
  });

  it('detects an attachment drop target like land stacks do', () => {
    const target = attachmentDropTarget(
      [card('equipment', 90, 78), card('target', 100, 80)],
      [],
      'equipment',
      { x: 90, y: 78 },
      positionFor,
    );

    expect(target?.targetCard.instanceId).toBe('target');
    expect(target?.targetPosition).toEqual({ x: 100, y: 80 });
  });

  it('uses the same deliberate overlap threshold as land stacks', () => {
    const lightEdgeTarget = attachmentDropTarget(
      [card('equipment', 193, 80), card('target', 100, 80)],
      [],
      'equipment',
      { x: 193, y: 80 },
      positionFor,
    );
    const deliberateTarget = attachmentDropTarget(
      [card('equipment', 169, 80), card('target', 100, 80)],
      [],
      'equipment',
      { x: 169, y: 80 },
      positionFor,
    );

    expect(lightEdgeTarget).toBeNull();
    expect(deliberateTarget?.targetCard.instanceId).toBe('target');
  });

  it('uses the attachment stack target when dropping over attached equipment', () => {
    const target = attachmentDropTarget(
      [card('equipment-new', 90, 50), card('target', 100, 80), card('equipment-a', 100, 62)],
      [attachment('attachment-a', 'equipment-a', 'target')],
      'equipment-new',
      { x: 90, y: 50 },
      positionFor,
    );

    expect(target?.targetCard.instanceId).toBe('target');
  });

  it('rejects lands and permanents that already have attached cards as attachment sources', () => {
    const land = card('land-source', 90, 78, 'Basic Land - Island');
    const sourceTarget = card('source-target', 90, 78);
    const target = card('target', 100, 80);

    expect(attachmentDropTarget([land, target], [], land.instanceId, { x: 90, y: 78 }, positionFor)).toBeNull();
    expect(attachmentDropTarget(
      [sourceTarget, target, card('attached-card', 90, 64)],
      [attachment('attachment-a', 'attached-card', 'source-target')],
      sourceTarget.instanceId,
      { x: 90, y: 78 },
      positionFor,
    )).toBeNull();
  });

  it('rejects attachment drops when the target belongs to a land stack', () => {
    const targetStack = [
      card('equipment', 100, 80),
      card('target', 300, 80, 'Basic Land - Island'),
      card('target-under', 310, 62, 'Basic Land - Island'),
    ];

    expect(attachmentDropTarget(
      targetStack,
      [],
      'equipment',
      { x: 300, y: 80 },
      positionFor,
    )).toBeNull();
  });
});

function card(instanceId: string, x: number, y: number, typeLine = 'Artifact'): GameCardInstance {
  return {
    instanceId,
    name: instanceId,
    typeLine,
    tapped: false,
    position: { x, y },
  };
}

function attachment(id: string, equipmentInstanceId: string, attachedToInstanceId: string): GameAttachment {
  return {
    id,
    equipmentInstanceId,
    attachedToInstanceId,
    createdAt: '2026-05-21T00:00:00+00:00',
  };
}

function positionFor(target: GameCardInstance): { x: number; y: number } | null {
  return target.position && target.position.unit !== 'ratio'
    ? { x: target.position.x, y: target.position.y }
    : null;
}
