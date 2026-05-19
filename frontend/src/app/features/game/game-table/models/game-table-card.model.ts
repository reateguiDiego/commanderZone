import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';

export interface SelectedCard {
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
}

export interface PendingCardCounterCommand {
  playerId: string;
  zone: GameZoneName;
  instanceId: string;
  key: string;
  value: number | null;
}
