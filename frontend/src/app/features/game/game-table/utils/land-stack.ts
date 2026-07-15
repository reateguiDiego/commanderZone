import { GameBattlefieldStack, GameCardInstance } from '../../../../core/models/game.model';
import { DEFAULT_BATTLEFIELD_CARD_SIZE } from './battlefield-position';

export type LandStackRole = 'top' | 'under';

export interface LandStackMember {
  readonly card: GameCardInstance;
  readonly position: { x: number; y: number };
  readonly layer: number;
  readonly role: LandStackRole;
}

export interface LandStackGroup {
  readonly id: string;
  readonly topCard: GameCardInstance;
  readonly members: readonly LandStackMember[];
}

export interface LandStackView {
  readonly stackId: string;
  readonly size: number;
  readonly layer: number;
  readonly role: LandStackRole;
}

export interface LandStackDropTarget {
  readonly targetCard: GameCardInstance;
  readonly targetPosition: { x: number; y: number };
  readonly targetStack: LandStackGroup | null;
  readonly nextSize: number;
}

export interface LandStackLayoutMove {
  readonly card: GameCardInstance;
  readonly position: { x: number; y: number };
}

export interface LandStackDetachSource {
  readonly stackId: string;
  readonly playerId: string;
  readonly detachedInstanceId: string;
  readonly members: readonly {
    readonly instanceId: string;
    readonly x: number;
    readonly y: number;
    readonly layer: number;
  }[];
}

const STACK_OFFSET_Y_RATIO = 0.11;
const STACK_OFFSET_X_RATIO = 0.085;
const DROP_OVERLAP_RATIO = 0.32;
const REMOVE_STACK_GAP = 14;

type StackableCardKind = 'land';

export function isLandCard(card: GameCardInstance | null | undefined): boolean {
  return /\bland\b/i.test(card?.typeLine ?? '');
}

function stackableCardKind(card: GameCardInstance | null | undefined): StackableCardKind | null {
  return isLandCard(card) ? 'land' : null;
}

export function landStackOffsetY(cardHeight = DEFAULT_BATTLEFIELD_CARD_SIZE.height): number {
  return Math.max(1, cardHeight * STACK_OFFSET_Y_RATIO);
}

export function landStackOffsetX(cardWidth = DEFAULT_BATTLEFIELD_CARD_SIZE.width): number {
  return Math.max(1, cardWidth * STACK_OFFSET_X_RATIO);
}

export function buildLandStackGroups(
  cards: readonly GameCardInstance[],
  battlefieldStacks: readonly GameBattlefieldStack[],
  positionFor: (card: GameCardInstance) => { x: number; y: number } | null,
  cardSize: { width: number; height: number } = DEFAULT_BATTLEFIELD_CARD_SIZE,
): LandStackGroup[] {
  const cardsById = new Map(cards.map((card) => [card.instanceId, card]));
  const offsetX = landStackOffsetX(cardSize.width);
  const offsetY = landStackOffsetY(cardSize.height);

  return battlefieldStacks.flatMap((stack): LandStackGroup[] => {
    const root = cardsById.get(stack.rootInstanceId);
    const rootPosition = root ? positionFor(root) : null;
    const orderedIds = [stack.rootInstanceId, ...stack.orderedMemberIds.filter((id) => id !== stack.rootInstanceId)];
    if (!root || !rootPosition || orderedIds.length < 2 || new Set(orderedIds).size !== orderedIds.length) {
      return [];
    }
    const members = orderedIds.map((instanceId, layer): LandStackMember | null => {
      const card = cardsById.get(instanceId);
      return card
        ? {
            card,
            position: { x: rootPosition.x + offsetX * layer, y: rootPosition.y - offsetY * layer },
            layer,
            role: layer === 0 ? 'top' : 'under',
          }
        : null;
    }).filter((member): member is LandStackMember => member !== null);
    return members.length === orderedIds.length
      ? [{ id: stack.id, topCard: root, members }]
      : [];
  });
}

export function landStackViewFor(groups: readonly LandStackGroup[], instanceId: string): LandStackView | null {
  const group = groups.find((candidate) => candidate.members.some((member) => member.card.instanceId === instanceId));
  const member = group?.members.find((candidate) => candidate.card.instanceId === instanceId);
  if (!group || !member) {
    return null;
  }

  return {
    stackId: group.id,
    size: group.members.length,
    layer: member.layer,
    role: member.role,
  };
}

export function landStackGroupContaining(groups: readonly LandStackGroup[], instanceId: string): LandStackGroup | null {
  return groups.find((group) => group.members.some((member) => member.card.instanceId === instanceId)) ?? null;
}

export function landStackDropTarget(
  cards: readonly GameCardInstance[],
  battlefieldStacks: readonly GameBattlefieldStack[],
  draggedInstanceId: string,
  draggedPosition: { x: number; y: number },
  positionFor: (card: GameCardInstance) => { x: number; y: number } | null,
  blockedInstanceIds: ReadonlySet<string> = new Set<string>(),
): LandStackDropTarget | null {
  const dragged = cards.find((card) => card.instanceId === draggedInstanceId);
  const draggedStackKind = stackableCardKind(dragged);
  if (!dragged || !draggedStackKind || blockedInstanceIds.has(draggedInstanceId)) {
    return null;
  }

  const targetCards = cards.filter((card) => card.instanceId !== draggedInstanceId);
  const groups = buildLandStackGroups(targetCards, battlefieldStacks, positionFor);
  const target = bestDropTarget(targetCards, draggedInstanceId, draggedPosition, positionFor);
  if (!target || stackableCardKind(target) !== draggedStackKind) {
    return null;
  }

  const targetStack = landStackGroupContaining(groups, target.instanceId);
  if (targetStack) {
    if (
      targetStack.members.length >= 8
      || targetStack.members.some((member) => member.card.instanceId === draggedInstanceId)
      || targetStack.members.some((member) => blockedInstanceIds.has(member.card.instanceId))
    ) {
      return null;
    }

    return {
      targetCard: targetStack.topCard,
      targetPosition: targetStack.members[0]!.position,
      targetStack,
      nextSize: targetStack.members.length + 1,
    };
  }

  if (target.instanceId === draggedInstanceId || blockedInstanceIds.has(target.instanceId)) {
    return null;
  }

  return {
    targetCard: target,
    targetPosition: positionFor(target)!,
    targetStack: null,
    nextSize: 2,
  };
}

export function fullLandStackDropTarget(
  cards: readonly GameCardInstance[],
  battlefieldStacks: readonly GameBattlefieldStack[],
  draggedInstanceId: string,
  draggedPosition: { x: number; y: number },
  positionFor: (card: GameCardInstance) => { x: number; y: number } | null,
): LandStackGroup | null {
  const dragged = cards.find((card) => card.instanceId === draggedInstanceId);
  const draggedStackKind = stackableCardKind(dragged);
  if (!draggedStackKind) {
    return null;
  }

  const targetCards = cards.filter((card) => card.instanceId !== draggedInstanceId);
  const groups = buildLandStackGroups(targetCards, battlefieldStacks, positionFor);
  const target = bestDropTarget(targetCards, draggedInstanceId, draggedPosition, positionFor);
  const targetStack = target ? landStackGroupContaining(groups, target.instanceId) : null;
  if (!targetStack || stackableCardKind(targetStack.topCard) !== draggedStackKind || targetStack.members.length < 8) {
    return null;
  }

  return targetStack.members.some((member) => member.card.instanceId === draggedInstanceId) ? null : targetStack;
}

export function createLandStackMoves(
  target: LandStackDropTarget,
  dragged: GameCardInstance,
  topPosition: { x: number; y: number } = target.targetPosition,
): readonly LandStackLayoutMove[] {
  const top = {
    x: topPosition.x,
    y: topPosition.y,
  };
  const layer = target.targetStack ? target.targetStack.members.length : 1;
  const targetMoved = top.x !== target.targetPosition.x || top.y !== target.targetPosition.y;

  if (target.targetStack && targetMoved) {
    return [
      ...target.targetStack.members.map((member) => ({
        card: member.card,
        position: {
          x: top.x + landStackOffsetX() * member.layer,
          y: top.y - landStackOffsetY() * member.layer,
        },
      })),
      {
        card: dragged,
        position: {
          x: top.x + landStackOffsetX() * layer,
          y: top.y - landStackOffsetY() * layer,
        },
      },
    ];
  }

  return [{
    card: dragged,
    position: {
      x: top.x + landStackOffsetX() * layer,
      y: top.y - landStackOffsetY() * layer,
    },
  }];
}

export function removeLandStackMoves(group: LandStackGroup): readonly LandStackLayoutMove[] {
  const top = group.members[0];
  if (!top) {
    return [];
  }

  const stepX = DEFAULT_BATTLEFIELD_CARD_SIZE.width + REMOVE_STACK_GAP;
  const direction = top.position.x >= stepX * (group.members.length - 1) ? -1 : 1;

  return group.members.map((member, index) => ({
    card: member.card,
    position: {
      x: top.position.x + stepX * index * direction,
      y: top.position.y,
    },
  }));
}

export function detachLandStackMoves(source: LandStackDetachSource): readonly { instanceId: string; position: { x: number; y: number } }[] {
  const remaining = source.members
    .filter((member) => member.instanceId !== source.detachedInstanceId)
    .sort((left, right) => left.layer - right.layer);

  if (remaining.length < 2) {
    return [];
  }

  const top = remaining[0];
  if (!top) {
    return [];
  }

  return remaining.map((member, index) => ({
    instanceId: member.instanceId,
    position: {
      x: top.x + landStackOffsetX() * index,
      y: top.y - landStackOffsetY() * index,
    },
  }));
}

export function landStackDetachSource(playerId: string, group: LandStackGroup, detachedInstanceId: string): LandStackDetachSource | null {
  const detached = group.members.find((member) => member.card.instanceId === detachedInstanceId);
  if (!detached || detached.role !== 'under') {
    return null;
  }

  return {
    stackId: group.id,
    playerId,
    detachedInstanceId,
    members: group.members.map((member) => ({
      instanceId: member.card.instanceId,
      x: member.position.x,
      y: member.position.y,
      layer: member.layer,
    })),
  };
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
