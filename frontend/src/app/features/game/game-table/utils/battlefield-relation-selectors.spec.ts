import { GameAttachment, GameBattlefieldStack, GameCardInstance } from '../../../../core/models/game.model';
import {
  attachmentBySource,
  attachmentsForTarget,
  battlefieldStackForInstance,
  battlefieldStackMembers,
  isRelationEditableByViewer,
  visualPositionForRelatedCard,
} from './battlefield-relation-selectors';

describe('battlefield relation selectors', () => {
  const attachments: GameAttachment[] = [
    { id: 'a2', equipmentInstanceId: 'e2', attachedToInstanceId: 'root', order: 2, createdAt: '' },
    { id: 'a1', equipmentInstanceId: 'e1', attachedToInstanceId: 'root', order: 1, createdAt: '' },
  ];
  const stack: GameBattlefieldStack = {
    id: 's1', relationType: 'battlefield_stack', rootInstanceId: 'root',
    orderedMemberIds: ['root', 'e1', 'e2'], stackKind: 'land', effectVersion: 1,
  };

  it('selects explicit attachment and stack relations without proximity discovery', () => {
    expect(attachmentBySource(attachments, 'e1')?.id).toBe('a1');
    expect(attachmentsForTarget(attachments, 'root').map((item) => item.id)).toEqual(['a1', 'a2']);
    expect(battlefieldStackForInstance([stack], 'e2')?.id).toBe('s1');
    expect(battlefieldStackForInstance([], 'e2')).toBeNull();
  });

  it('preserves order, derives proportional geometry and authority from controllers', () => {
    const cards = new Map<string, GameCardInstance>(stack.orderedMemberIds.map((id) => [id, {
      instanceId: id, name: id, ownerId: 'p1', controllerId: 'p1', zone: 'battlefield', tapped: false,
    } as GameCardInstance]));
    expect(battlefieldStackMembers(stack, cards).map((card) => card.instanceId)).toEqual(stack.orderedMemberIds);
    expect(visualPositionForRelatedCard({ instanceId: 'e1', rootPosition: { x: 20, y: 40 }, relationType: 'battlefield_stack', orderedIndex: 1, cardSize: { width: 200, height: 300 } }))
      .toEqual({ x: 37, y: 7 });
    expect(isRelationEditableByViewer(stack.orderedMemberIds, cards, 'p1')).toBe(true);
    expect(isRelationEditableByViewer(stack.orderedMemberIds, cards, 'p2')).toBe(false);
  });
});
