import { GameCardInstance } from '../../../../core/models/game.model';

export type PermanentStackPresentationRole = 'target' | 'layer';

export interface PermanentStackPresentationRelation {
  readonly targetInstanceId: string;
  readonly layeredInstanceId: string;
}

export interface PermanentStackPresentationMember {
  readonly card: GameCardInstance;
  readonly position: { x: number; y: number };
  readonly layer: number;
  readonly role: PermanentStackPresentationRole;
}

export interface PermanentStackPresentationGroup {
  readonly id: string;
  readonly targetCard: GameCardInstance;
  readonly members: readonly PermanentStackPresentationMember[];
}

/**
 * Builds the visual pile shared by attachments and manual land/token stacks.
 * Domain callers validate their own relations before passing them here.
 */
export function buildPermanentStackPresentationGroups(
  cards: readonly GameCardInstance[],
  relations: readonly PermanentStackPresentationRelation[],
  positionFor: (card: GameCardInstance) => { x: number; y: number } | null,
  maxLayeredCards = Number.POSITIVE_INFINITY,
): PermanentStackPresentationGroup[] {
  const cardsById = new Map(cards.map((card) => [card.instanceId, card]));
  const relationsByTarget = new Map<string, PermanentStackPresentationRelation[]>();

  for (const relation of relations) {
    if (!cardsById.has(relation.targetInstanceId) || !cardsById.has(relation.layeredInstanceId)) {
      continue;
    }

    relationsByTarget.set(relation.targetInstanceId, [
      ...(relationsByTarget.get(relation.targetInstanceId) ?? []),
      relation,
    ]);
  }

  return [...relationsByTarget.entries()]
    .map(([targetInstanceId, targetRelations]): PermanentStackPresentationGroup | null => {
      const targetCard = cardsById.get(targetInstanceId);
      const targetPosition = targetCard ? positionFor(targetCard) : null;
      if (!targetCard || !targetPosition) {
        return null;
      }

      const members: PermanentStackPresentationMember[] = [
        { card: targetCard, position: targetPosition, layer: 0, role: 'target' },
        ...targetRelations
          .slice(0, maxLayeredCards)
          .map((relation, index): PermanentStackPresentationMember | null => {
            const card = cardsById.get(relation.layeredInstanceId);
            const position = card ? positionFor(card) : null;

            return card && position
              ? { card, position, layer: index + 1, role: 'layer' }
              : null;
          })
          .filter((member): member is PermanentStackPresentationMember => member !== null),
      ];

      return members.length > 1
        ? {
            id: members.map((member) => member.card.instanceId).join(':'),
            targetCard,
            members,
          }
        : null;
    })
    .filter((group): group is PermanentStackPresentationGroup => group !== null);
}
