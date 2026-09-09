import { GameBattlefieldStack, GameCardInstance } from '../../../../core/models/game.model';
import { DEFAULT_BATTLEFIELD_CARD_SIZE } from './battlefield-position';
import { buildPermanentStackPresentationGroups } from './permanent-stack-presentation';

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
  readonly nextSize: 2 | 3;
}

export interface LandStackLayoutMove {
  readonly card: GameCardInstance;
  readonly position: { x: number; y: number };
}

export interface LandStackDetachSource {
  readonly playerId: string;
  readonly detachedInstanceId: string;
  readonly stackId: string;
  readonly members: readonly {
    readonly instanceId: string;
    readonly x: number;
    readonly y: number;
    readonly layer: number;
  }[];
}

const STACK_OFFSET_Y = 18;
const STACK_OFFSET_X = 10;
const MAX_STACK_SIZE = 3;
const DROP_OVERLAP_RATIO = 0.32;
const REMOVE_STACK_GAP = 14;

export function isLandCard(card: GameCardInstance | null | undefined): boolean {
  return /\bland\b/i.test(card?.typeLine ?? '');
}

export function isStackableBattlefieldCard(card: GameCardInstance | null | undefined): boolean {
  return Boolean(card && (isLandCard(card) || card.isToken === true || card.isTokenCopy === true));
}

export function landStackOffsetY(): number {
  return STACK_OFFSET_Y;
}

export function landStackOffsetX(): number {
  return STACK_OFFSET_X;
}

/**
 * Builds visual groups exclusively from persisted stack relations. Land/token
 * eligibility is enforced when writing a relation; rebuilding the visual must
 * not depend on optional static-card metadata arriving in the same patch.
 * Positions determine layout only; they never determine stack membership.
 */
export function buildLandStackGroups(
  cards: readonly GameCardInstance[],
  stacks: readonly GameBattlefieldStack[],
  positionFor: (card: GameCardInstance) => { x: number; y: number } | null,
): LandStackGroup[] {
  const cardsById = new Map(cards.map((card) => [card.instanceId, card]));
  const stacksByTop = new Map<string, GameBattlefieldStack[]>();

  for (const stack of stacks) {
    const top = cardsById.get(stack.stackTopInstanceId);
    const under = cardsById.get(stack.stackedInstanceId);
    if (!top || !under) {
      continue;
    }

    stacksByTop.set(stack.stackTopInstanceId, [
      ...(stacksByTop.get(stack.stackTopInstanceId) ?? []),
      stack,
    ]);
  }

  return buildPermanentStackPresentationGroups(
    cards,
    [...stacksByTop.values()].flatMap((topStacks) => topStacks.map((stack) => ({
      targetInstanceId: stack.stackTopInstanceId,
      layeredInstanceId: stack.stackedInstanceId,
    }))),
    positionFor,
    MAX_STACK_SIZE - 1,
  ).map((group): LandStackGroup => {
    const topStacks = stacksByTop.get(group.targetCard.instanceId) ?? [];

    return {
      id: `${group.targetCard.instanceId}:${topStacks.map((stack) => stack.id).sort().join(':')}`,
      topCard: group.targetCard,
      members: group.members.map((member): LandStackMember => ({
        card: member.card,
        position: member.position,
        layer: member.layer,
        role: member.role === 'target' ? 'top' : 'under',
      })),
    };
  });
}

export function landStackViewFor(groups: readonly LandStackGroup[], instanceId: string): LandStackView | null {
  const group = landStackGroupContaining(groups, instanceId);
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

export function landStackRelationInstanceIds(stacks: readonly GameBattlefieldStack[]): ReadonlySet<string> {
  const instanceIds = new Set<string>();
  for (const stack of stacks) {
    instanceIds.add(stack.stackedInstanceId);
    instanceIds.add(stack.stackTopInstanceId);
  }

  return instanceIds;
}

export function landStackDropTarget(
  cards: readonly GameCardInstance[],
  stacks: readonly GameBattlefieldStack[],
  draggedInstanceId: string,
  draggedPosition: { x: number; y: number },
  positionFor: (card: GameCardInstance) => { x: number; y: number } | null,
  blockedInstanceIds: ReadonlySet<string> = new Set<string>(),
): LandStackDropTarget | null {
  const dragged = cards.find((card) => card.instanceId === draggedInstanceId);
  if (!dragged || !isStackableBattlefieldCard(dragged) || blockedInstanceIds.has(draggedInstanceId)) {
    return null;
  }

  const targetCards = cards.filter((card) => card.instanceId !== draggedInstanceId);
  const groups = buildLandStackGroups(targetCards, stacks, positionFor);
  const target = bestDropTarget(targetCards, draggedInstanceId, draggedPosition, positionFor);
  if (!target || !isStackableBattlefieldCard(target)) {
    return null;
  }

  const targetStack = landStackGroupContaining(groups, target.instanceId);
  if (targetStack) {
    if (
      targetStack.members.length >= MAX_STACK_SIZE
      || targetStack.members.some((member) => blockedInstanceIds.has(member.card.instanceId))
    ) {
      return null;
    }

    return {
      targetCard: targetStack.topCard,
      targetPosition: targetStack.members[0]!.position,
      targetStack,
      nextSize: 3,
    };
  }

  if (blockedInstanceIds.has(target.instanceId)) {
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
  stacks: readonly GameBattlefieldStack[],
  draggedInstanceId: string,
  draggedPosition: { x: number; y: number },
  positionFor: (card: GameCardInstance) => { x: number; y: number } | null,
): LandStackGroup | null {
  const dragged = cards.find((card) => card.instanceId === draggedInstanceId);
  if (!isStackableBattlefieldCard(dragged)) {
    return null;
  }

  const targetCards = cards.filter((card) => card.instanceId !== draggedInstanceId);
  const groups = buildLandStackGroups(targetCards, stacks, positionFor);
  const target = bestDropTarget(targetCards, draggedInstanceId, draggedPosition, positionFor);
  const targetStack = target ? landStackGroupContaining(groups, target.instanceId) : null;
  if (!targetStack || targetStack.members.length < MAX_STACK_SIZE) {
    return null;
  }

  return targetStack;
}

export function createLandStackMoves(
  target: LandStackDropTarget,
  dragged: GameCardInstance,
  topPosition: { x: number; y: number } = target.targetPosition,
): readonly LandStackLayoutMove[] {
  const top = { x: topPosition.x, y: topPosition.y };
  const layer = target.targetStack ? target.targetStack.members.length : 1;
  const targetMoved = top.x !== target.targetPosition.x || top.y !== target.targetPosition.y;

  if (target.targetStack && targetMoved) {
    return [
      ...target.targetStack.members.map((member) => ({
        card: member.card,
        position: {
          x: top.x + STACK_OFFSET_X * member.layer,
          y: top.y - STACK_OFFSET_Y * member.layer,
        },
      })),
      {
        card: dragged,
        position: {
          x: top.x + STACK_OFFSET_X * layer,
          y: top.y - STACK_OFFSET_Y * layer,
        },
      },
    ];
  }

  return [{
    card: dragged,
    position: {
      x: top.x + STACK_OFFSET_X * layer,
      y: top.y - STACK_OFFSET_Y * layer,
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
      x: top.x + STACK_OFFSET_X * index,
      y: top.y - STACK_OFFSET_Y * index,
    },
  }));
}

export function landStackDetachSource(
  playerId: string,
  stacks: readonly GameBattlefieldStack[],
  group: LandStackGroup,
  detachedInstanceId: string,
): LandStackDetachSource | null {
  const detached = group.members.find((member) => member.card.instanceId === detachedInstanceId);
  const stack = stacks.find((candidate) =>
    candidate.stackedInstanceId === detachedInstanceId
    && candidate.stackTopInstanceId === group.topCard.instanceId,
  ) ?? null;
  if (!detached || detached.role !== 'under' || !stack) {
    return null;
  }

  return {
    playerId,
    detachedInstanceId,
    stackId: stack.id,
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
  const cardWidth = DEFAULT_BATTLEFIELD_CARD_SIZE.width;
  const cardHeight = DEFAULT_BATTLEFIELD_CARD_SIZE.height;
  const maxHorizontalDistance = cardWidth * (1 - DROP_OVERLAP_RATIO);
  const maxVerticalDistance = cardHeight * (1 - DROP_OVERLAP_RATIO);

  return cards
    .filter((card) => card.instanceId !== draggedInstanceId)
    .map((card) => {
      const position = positionFor(card);
      if (!position) {
        return null;
      }

      const dx = Math.abs(draggedPosition.x - position.x);
      const dy = Math.abs(draggedPosition.y - position.y);
      if (dx > maxHorizontalDistance || dy > maxVerticalDistance) {
        return null;
      }

      return { card, distance: dx + dy };
    })
    .filter((candidate): candidate is { card: GameCardInstance; distance: number } => candidate !== null)
    .sort((left, right) => left.distance - right.distance)[0]?.card ?? null;
}
