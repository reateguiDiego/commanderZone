import { GameCardInstance } from '../../../core/models/game.model';

export type OpponentCardsTargetRole = 'source' | 'target' | 'both';

export interface OpponentCardsTargetCard {
  readonly card: GameCardInstance;
  readonly role: OpponentCardsTargetRole;
}
