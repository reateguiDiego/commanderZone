import { GameCardInstance } from '../../../../core/models/game.model';
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
  readonly nextSize: 2 | 3;
}

export interface LandStackLayoutMove {
  readonly card: GameCardInstance;
  readonly position: { x: number; y: number };
}

export interface LandStackDetachSource {
  readonly playerId: string;
  readonly detachedInstanceId: string;
  readonly members: readonly {
    readonly instanceId: string;
    readonly x: number;
    readonly y: number;
    readonly layer: number;
  }[];
}

const STACK_OFFSET_Y = 14;
const STACK_OFFSET_X = 10;
const PREVIOUS_STACK_OFFSET_Y = 28;
const LEGACY_STACK_OFFSET_Y = 20;
const STACK_LAYER_OFFSETS = [STACK_OFFSET_Y, PREVIOUS_STACK_OFFSET_Y, LEGACY_STACK_OFFSET_Y] as const;
const STACK_X_TOLERANCE = 10;
const STACK_Y_TOLERANCE = 8;
const DROP_OVERLAP_RATIO = 0.32;
const REMOVE_STACK_GAP = 14;

interface PositionedLand {
  readonly card: GameCardInstance;
  readonly position: { x: number; y: number };
}

export function isLandCard(card: GameCardInstance | null | undefined): boolean {
  return /\bland\b/i.test(card?.typeLine ?? '');
}

export function landStackOffsetY(): number {
  return STACK_OFFSET_Y;
}

export function landStackOffsetX(): number {
  return STACK_OFFSET_X;
}

export function buildLandStackGroups(
  cards: readonly GameCardInstance[],
  positionFor: (card: GameCardInstance) => { x: number; y: number } | null,
): LandStackGroup[] {
  const lands = cards
    .map((card) => ({ card, position: positionFor(card) }))
    .filter((entry): entry is PositionedLand => isLandCard(entry.card) && entry.position !== null)
    .sort((left, right) => right.position.y - left.position.y || left.position.x - right.position.x);
  const used = new Set<string>();
  const groups: LandStackGroup[] = [];

  for (const top of lands) {
    if (used.has(top.card.instanceId)) {
      continue;
    }

    const firstUnder = nearestStackLayer(lands, top, 1, used);
    if (!firstUnder) {
      continue;
    }

    const usedWithFirstLayer = new Set([...used, firstUnder.card.instanceId]);
    const secondUnder = nearestStackLayer(lands, top, 2, usedWithFirstLayer);
    const members: LandStackMember[] = [
      { card: top.card, position: top.position, layer: 0, role: 'top' },
      { card: firstUnder.card, position: firstUnder.position, layer: 1, role: 'under' },
      ...(secondUnder ? [{ card: secondUnder.card, position: secondUnder.position, layer: 2, role: 'under' } satisfies LandStackMember] : []),
    ];

    for (const member of members) {
      used.add(member.card.instanceId);
    }

    groups.push({
      id: members.map((member) => member.card.instanceId).join(':'),
      topCard: top.card,
      members,
    });
  }

  return groups;
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
  draggedInstanceId: string,
  draggedPosition: { x: number; y: number },
  positionFor: (card: GameCardInstance) => { x: number; y: number } | null,
  blockedInstanceIds: ReadonlySet<string> = new Set<string>(),
): LandStackDropTarget | null {
  const dragged = cards.find((card) => card.instanceId === draggedInstanceId);
  if (!isLandCard(dragged) || blockedInstanceIds.has(draggedInstanceId)) {
    return null;
  }

  const targetCards = cards.filter((card) => card.instanceId !== draggedInstanceId);
  const groups = buildLandStackGroups(targetCards, positionFor);
  const target = bestDropTarget(targetCards, draggedInstanceId, draggedPosition, positionFor);
  if (!target || !isLandCard(target)) {
    return null;
  }

  const targetStack = landStackGroupContaining(groups, target.instanceId);
  if (targetStack) {
    if (
      targetStack.members.length >= 3
      || targetStack.members.some((member) => member.card.instanceId === draggedInstanceId)
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
  draggedInstanceId: string,
  draggedPosition: { x: number; y: number },
  positionFor: (card: GameCardInstance) => { x: number; y: number } | null,
): LandStackGroup | null {
  const dragged = cards.find((card) => card.instanceId === draggedInstanceId);
  if (!isLandCard(dragged)) {
    return null;
  }

  const targetCards = cards.filter((card) => card.instanceId !== draggedInstanceId);
  const groups = buildLandStackGroups(targetCards, positionFor);
  const target = bestDropTarget(targetCards, draggedInstanceId, draggedPosition, positionFor);
  const targetStack = target ? landStackGroupContaining(groups, target.instanceId) : null;
  if (!targetStack || targetStack.members.length < 3) {
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

export function landStackDetachSource(playerId: string, group: LandStackGroup, detachedInstanceId: string): LandStackDetachSource | null {
  const detached = group.members.find((member) => member.card.instanceId === detachedInstanceId);
  if (!detached || detached.role !== 'under') {
    return null;
  }

  return {
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

function nearestStackLayer(
  lands: readonly PositionedLand[],
  top: PositionedLand,
  layer: 1 | 2,
  used: ReadonlySet<string>,
): PositionedLand | null {
  return lands
    .filter((candidate) => candidate.card.instanceId !== top.card.instanceId && !used.has(candidate.card.instanceId))
    .map((candidate) => ({
      candidate,
      dx: nearestLayerXDistance(candidate.position.x, top.position.x, layer),
      dy: nearestLayerDistance(candidate.position.y, top.position.y, layer),
    }))
    .filter((entry) => entry.dx <= STACK_X_TOLERANCE && entry.dy <= STACK_Y_TOLERANCE)
    .sort((left, right) => left.dy - right.dy || left.dx - right.dx)[0]?.candidate ?? null;
}

function nearestLayerDistance(candidateY: number, topY: number, layer: 1 | 2): number {
  return Math.min(...STACK_LAYER_OFFSETS.map((offset) => Math.abs(candidateY - (topY - offset * layer))));
}

function nearestLayerXDistance(candidateX: number, topX: number, layer: 1 | 2): number {
  return Math.min(
    Math.abs(candidateX - topX),
    Math.abs(candidateX - (topX + STACK_OFFSET_X * layer)),
  );
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
