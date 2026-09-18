import { GameCardInstance } from '../../../../core/models/game.model';

export function isRevealedCard(card: GameCardInstance): boolean {
  return card.hidden !== true
    && (card.revealMarker === true || (card.revealedTo?.length ?? 0) > 0);
}
