import {
  GameAttachment,
  GameBattlefieldStack,
  GameCardInstance,
} from '../../../../core/models/game.model';
import { resolveAttachmentOffset, resolveAttachmentZIndex } from './attachment-stack';
import { landStackOffsetX, landStackOffsetY } from './land-stack';

export function attachmentBySource(
  attachments: readonly GameAttachment[],
  sourceInstanceId: string,
): GameAttachment | null {
  return attachments.find((attachment) => attachment.equipmentInstanceId === sourceInstanceId) ?? null;
}

export function attachmentsForTarget(
  attachments: readonly GameAttachment[],
  targetInstanceId: string,
): GameAttachment[] {
  return attachments
    .filter((attachment) => attachment.attachedToInstanceId === targetInstanceId)
    .sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id));
}

export function attachmentOrder(attachments: readonly GameAttachment[], relationId: string): number | null {
  const attachment = attachments.find((candidate) => candidate.id === relationId);
  return attachment?.order ?? null;
}

export function battlefieldStackById(
  stacks: readonly GameBattlefieldStack[],
  stackId: string,
): GameBattlefieldStack | null {
  return stacks.find((stack) => stack.id === stackId) ?? null;
}

export function battlefieldStackForInstance(
  stacks: readonly GameBattlefieldStack[],
  instanceId: string,
): GameBattlefieldStack | null {
  return stacks.find((stack) => stack.orderedMemberIds.includes(instanceId)) ?? null;
}

export function battlefieldStackRoot(
  stack: GameBattlefieldStack,
  cardsById: ReadonlyMap<string, GameCardInstance>,
): GameCardInstance | null {
  return cardsById.get(stack.rootInstanceId) ?? null;
}

export function battlefieldStackMembers(
  stack: GameBattlefieldStack,
  cardsById: ReadonlyMap<string, GameCardInstance>,
): GameCardInstance[] {
  return stack.orderedMemberIds.map((id) => cardsById.get(id)).filter((card): card is GameCardInstance => Boolean(card));
}

export function battlefieldStackOrder(stack: GameBattlefieldStack, instanceId: string): number | null {
  const index = stack.orderedMemberIds.indexOf(instanceId);
  return index >= 0 ? index : null;
}

export function visualPositionForRelatedCard(args: {
  instanceId: string;
  rootPosition: { x: number; y: number };
  relationType: 'attachment' | 'battlefield_stack';
  orderedIndex: number;
  cardSize: { width: number; height: number };
}): { x: number; y: number } {
  const offset = args.relationType === 'attachment'
    ? resolveAttachmentOffset(args.orderedIndex, args.cardSize)
    : {
        x: landStackOffsetX(args.cardSize.width) * args.orderedIndex,
        y: -landStackOffsetY(args.cardSize.height) * args.orderedIndex,
      };
  return { x: args.rootPosition.x + offset.x, y: args.rootPosition.y + offset.y };
}

export function relationZIndex(relationType: 'attachment' | 'battlefield_stack', orderedIndex: number, active = false): number {
  return relationType === 'attachment'
    ? resolveAttachmentZIndex(orderedIndex, active ? 'hover' : 'idle')
    : 50 + orderedIndex + (active ? 200 : 0);
}

export function relationHitTarget(instanceId: string, visibleInstanceIds: ReadonlySet<string>): string | null {
  return visibleInstanceIds.has(instanceId) ? instanceId : null;
}

export function isRelationEditableByViewer(
  memberInstanceIds: readonly string[],
  cardsById: ReadonlyMap<string, GameCardInstance>,
  viewerId: string,
): boolean {
  return memberInstanceIds.every((id) => cardsById.get(id)?.controllerId === viewerId);
}
