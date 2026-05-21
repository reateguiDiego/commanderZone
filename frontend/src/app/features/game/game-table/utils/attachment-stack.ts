import { GameAttachment, GameCardInstance } from '../../../../core/models/game.model';
import { DEFAULT_BATTLEFIELD_CARD_SIZE } from './battlefield-position';
import { buildLandStackGroups, landStackGroupContaining, landStackOffsetX, landStackOffsetY } from './land-stack';

export interface AttachmentStackMove {
  readonly instanceId: string;
  readonly position: { x: number; y: number };
}

export interface AttachmentDropTarget {
  readonly targetCard: GameCardInstance;
  readonly targetPosition: { x: number; y: number };
  readonly targetStack: AttachmentStackGroup | null;
}

export type AttachmentStackRole = 'target' | 'equipment';

export interface AttachmentStackMember {
  readonly card: GameCardInstance;
  readonly position: { x: number; y: number };
  readonly layer: number;
  readonly role: AttachmentStackRole;
}

export interface AttachmentStackGroup {
  readonly id: string;
  readonly targetCard: GameCardInstance;
  readonly members: readonly AttachmentStackMember[];
}

export interface AttachmentStackView {
  readonly stackId: string;
  readonly layer: number;
  readonly role: AttachmentStackRole;
}

export interface AttachmentStackDetachSource {
  readonly playerId: string;
  readonly detachedInstanceId: string;
  readonly attachmentId: string;
  readonly members: readonly {
    readonly instanceId: string;
    readonly x: number;
    readonly y: number;
    readonly layer: number;
  }[];
}

const REMOVE_ATTACHMENT_STACK_GAP = 14;
const DROP_OVERLAP_RATIO = 0.32;

export function attachmentDropTarget(
  cards: readonly GameCardInstance[],
  attachments: readonly GameAttachment[],
  equipmentInstanceId: string,
  equipmentPosition: { x: number; y: number },
  positionFor: (card: GameCardInstance) => { x: number; y: number } | null,
): AttachmentDropTarget | null {
  const equipment = cards.find((card) => card.instanceId === equipmentInstanceId);
  const landGroups = buildLandStackGroups(cards, positionFor);
  if (
    !equipment
    || isLandPermanent(equipment)
    || landStackGroupContaining(landGroups, equipmentInstanceId)
    || attachments.some((attachment) => attachment.attachedToInstanceId === equipmentInstanceId)
  ) {
    return null;
  }

  const targetCards = cards.filter((card) => card.instanceId !== equipmentInstanceId);
  const groups = buildAttachmentStackGroups(targetCards, attachments, positionFor);
  const target = bestDropTarget(targetCards, equipmentInstanceId, equipmentPosition, positionFor);
  if (!target || target.instanceId === equipmentInstanceId || attachments.some((attachment) =>
    attachment.equipmentInstanceId === equipmentInstanceId && attachment.attachedToInstanceId === target.instanceId,
  )) {
    return null;
  }

  const targetStack = attachmentStackGroupContaining(groups, target.instanceId);
  const targetMember = targetStack?.members.find((member) => member.card.instanceId === target.instanceId) ?? null;
  if (targetStack) {
    if (
      targetStack.members.some((member) => member.card.instanceId === equipmentInstanceId)
      || targetStack.targetCard.instanceId === equipmentInstanceId
      || targetStack.members.some((member) => landStackGroupContaining(landGroups, member.card.instanceId))
      || attachments.some((attachment) =>
        attachment.equipmentInstanceId === equipmentInstanceId
        && attachment.attachedToInstanceId === targetStack.targetCard.instanceId,
      )
    ) {
      return null;
    }

    return {
      targetCard: targetStack.targetCard,
      targetPosition: targetStack.members[0]?.position ?? positionFor(targetStack.targetCard) ?? targetMember?.position ?? equipmentPosition,
      targetStack,
    };
  }

  const targetPosition = positionFor(target);
  return targetPosition && !landStackGroupContaining(landGroups, target.instanceId)
    ? { targetCard: target, targetPosition, targetStack: null }
    : null;
}

export function attachmentRelationInstanceIds(attachments: readonly GameAttachment[]): ReadonlySet<string> {
  const instanceIds = new Set<string>();
  for (const attachment of attachments) {
    instanceIds.add(attachment.equipmentInstanceId);
    instanceIds.add(attachment.attachedToInstanceId);
  }

  return instanceIds;
}

export function createAttachmentStackMoves(
  cards: readonly GameCardInstance[],
  attachments: readonly GameAttachment[],
  equipmentInstanceId: string,
  attachedToInstanceId: string,
  positionFor: (card: GameCardInstance) => { x: number; y: number } | null,
): readonly AttachmentStackMove[] {
  const cardsById = new Map(cards.map((card) => [card.instanceId, card]));
  if (!cardsById.has(equipmentInstanceId) || !cardsById.has(attachedToInstanceId)) {
    return [];
  }

  const currentAttachment = attachments.find((attachment) => attachment.equipmentInstanceId === equipmentInstanceId) ?? null;
  const attachmentsWithoutEquipment = attachments.filter((attachment) => attachment.equipmentInstanceId !== equipmentInstanceId);
  const moves: AttachmentStackMove[] = [];

  if (currentAttachment && currentAttachment.attachedToInstanceId !== attachedToInstanceId) {
    moves.push(...stackMovesForTarget(
      cardsById,
      attachmentsWithoutEquipment
        .filter((attachment) => attachment.attachedToInstanceId === currentAttachment.attachedToInstanceId)
        .map((attachment) => attachment.equipmentInstanceId),
      currentAttachment.attachedToInstanceId,
      positionFor,
    ));
  }

  moves.push(...stackMovesForTarget(
    cardsById,
    [
      ...attachmentsWithoutEquipment
        .filter((attachment) => attachment.attachedToInstanceId === attachedToInstanceId)
        .map((attachment) => attachment.equipmentInstanceId),
      equipmentInstanceId,
    ],
    attachedToInstanceId,
    positionFor,
  ));

  return uniqueMoves(moves);
}

export function buildAttachmentStackGroups(
  cards: readonly GameCardInstance[],
  attachments: readonly GameAttachment[],
  positionFor: (card: GameCardInstance) => { x: number; y: number } | null,
): AttachmentStackGroup[] {
  const cardsById = new Map(cards.map((card) => [card.instanceId, card]));
  const attachmentsByTarget = new Map<string, GameAttachment[]>();

  for (const attachment of attachments) {
    if (!cardsById.has(attachment.attachedToInstanceId) || !cardsById.has(attachment.equipmentInstanceId)) {
      continue;
    }
    attachmentsByTarget.set(attachment.attachedToInstanceId, [
      ...(attachmentsByTarget.get(attachment.attachedToInstanceId) ?? []),
      attachment,
    ]);
  }

  return [...attachmentsByTarget.entries()]
    .map(([targetInstanceId, targetAttachments]): AttachmentStackGroup | null => {
      const targetCard = cardsById.get(targetInstanceId);
      const targetPosition = targetCard ? positionFor(targetCard) : null;
      if (!targetCard || !targetPosition || targetAttachments.length === 0) {
        return null;
      }

      const members: AttachmentStackMember[] = [
        { card: targetCard, position: targetPosition, layer: 0, role: 'target' },
        ...targetAttachments
          .map((attachment, index): AttachmentStackMember | null => {
            const card = cardsById.get(attachment.equipmentInstanceId);
            const position = card ? positionFor(card) : null;

            return card && position
              ? { card, position, layer: index + 1, role: 'equipment' }
              : null;
          })
          .filter((member): member is AttachmentStackMember => member !== null),
      ];

      return {
        id: members.map((member) => member.card.instanceId).join(':'),
        targetCard,
        members,
      };
    })
    .filter((group): group is AttachmentStackGroup => group !== null && group.members.length > 1);
}

export function attachmentStackViewFor(groups: readonly AttachmentStackGroup[], instanceId: string): AttachmentStackView | null {
  const group = attachmentStackGroupContaining(groups, instanceId);
  const member = group?.members.find((candidate) => candidate.card.instanceId === instanceId);
  if (!group || !member) {
    return null;
  }

  return {
    stackId: group.id,
    layer: member.layer,
    role: member.role,
  };
}

export function attachmentStackGroupContaining(groups: readonly AttachmentStackGroup[], instanceId: string): AttachmentStackGroup | null {
  return groups.find((group) => group.members.some((member) => member.card.instanceId === instanceId)) ?? null;
}

export function attachmentStackDetachSource(
  playerId: string,
  attachments: readonly GameAttachment[],
  group: AttachmentStackGroup,
  detachedInstanceId: string,
): AttachmentStackDetachSource | null {
  const detached = group.members.find((member) => member.card.instanceId === detachedInstanceId);
  const attachment = attachments.find((candidate) => candidate.equipmentInstanceId === detachedInstanceId) ?? null;
  if (!detached || detached.role !== 'equipment' || !attachment) {
    return null;
  }

  return {
    playerId,
    detachedInstanceId,
    attachmentId: attachment.id,
    members: group.members.map((member) => ({
      instanceId: member.card.instanceId,
      x: member.position.x,
      y: member.position.y,
      layer: member.layer,
    })),
  };
}

export function detachAttachmentStackMoves(source: AttachmentStackDetachSource): readonly AttachmentStackMove[] {
  const target = source.members.find((member) => member.layer === 0);
  if (!target) {
    return [];
  }

  return source.members
    .filter((member) => member.layer > 0 && member.instanceId !== source.detachedInstanceId)
    .sort((left, right) => left.layer - right.layer)
    .map((member, index) => ({
      instanceId: member.instanceId,
      position: {
        x: target.x + landStackOffsetX() * (index + 1),
        y: target.y - landStackOffsetY() * (index + 1),
      },
    }));
}

export function removeAttachmentStackMoves(group: AttachmentStackGroup): readonly AttachmentStackMove[] {
  const target = group.members[0];
  if (!target) {
    return [];
  }

  const equipmentMembers = group.members.filter((member) => member.role === 'equipment');
  const stepX = DEFAULT_BATTLEFIELD_CARD_SIZE.width + REMOVE_ATTACHMENT_STACK_GAP;
  const direction = target.position.x >= stepX * equipmentMembers.length ? -1 : 1;

  return equipmentMembers.map((member, index) => ({
    instanceId: member.card.instanceId,
    position: {
      x: target.position.x + stepX * (index + 1) * direction,
      y: target.position.y,
    },
  }));
}

function stackMovesForTarget(
  cardsById: ReadonlyMap<string, GameCardInstance>,
  equipmentInstanceIds: readonly string[],
  attachedToInstanceId: string,
  positionFor: (card: GameCardInstance) => { x: number; y: number } | null,
): readonly AttachmentStackMove[] {
  const targetCard = cardsById.get(attachedToInstanceId);
  const targetPosition = targetCard ? positionFor(targetCard) : null;
  if (!targetPosition) {
    return [];
  }

  return equipmentInstanceIds
    .filter((instanceId) => cardsById.has(instanceId))
    .map((instanceId, index) => ({
      instanceId,
      position: {
        x: targetPosition.x + landStackOffsetX() * (index + 1),
        y: targetPosition.y - landStackOffsetY() * (index + 1),
      },
    }));
}

function uniqueMoves(moves: readonly AttachmentStackMove[]): readonly AttachmentStackMove[] {
  const unique = new Map<string, AttachmentStackMove>();
  for (const move of moves) {
    unique.set(move.instanceId, move);
  }

  return [...unique.values()];
}

function isLandPermanent(card: GameCardInstance | null | undefined): boolean {
  return /\bland\b/i.test(card?.typeLine ?? '');
}

function bestDropTarget(
  cards: readonly GameCardInstance[],
  draggedInstanceId: string,
  draggedPosition: { x: number; y: number },
  positionFor: (card: GameCardInstance) => { x: number; y: number } | null,
): GameCardInstance | null {
  const draggedRect = cardRect(draggedPosition);

  return cards
    .filter((card) => card.instanceId !== draggedInstanceId)
    .map((card) => {
      const position = positionFor(card);

      return position ? { card, overlap: overlapRatio(draggedRect, cardRect(position)) } : null;
    })
    .filter((entry): entry is { card: GameCardInstance; overlap: number } => entry !== null && entry.overlap >= DROP_OVERLAP_RATIO)
    .sort((left, right) => right.overlap - left.overlap)[0]?.card ?? null;
}

function cardRect(position: { x: number; y: number }): DOMRect {
  return {
    x: position.x,
    y: position.y,
    left: position.x,
    top: position.y,
    right: position.x + DEFAULT_BATTLEFIELD_CARD_SIZE.width,
    bottom: position.y + DEFAULT_BATTLEFIELD_CARD_SIZE.height,
    width: DEFAULT_BATTLEFIELD_CARD_SIZE.width,
    height: DEFAULT_BATTLEFIELD_CARD_SIZE.height,
    toJSON: () => ({}),
  } as DOMRect;
}

function overlapRatio(left: DOMRect, right: DOMRect): number {
  const overlapWidth = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const overlapHeight = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  const overlapArea = overlapWidth * overlapHeight;
  const cardArea = Math.max(1, left.width * left.height);

  return overlapArea / cardArea;
}
