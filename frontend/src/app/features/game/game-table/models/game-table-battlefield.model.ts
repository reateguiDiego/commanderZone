import { GameCardRatioPosition } from '../../../../core/models/game.model';

export interface BattlefieldPositionCommand {
  playerId: string;
  instanceId: string;
  position: GameCardRatioPosition;
}

export interface BattlefieldPositionBatchCommand {
  playerId: string;
  positions: BattlefieldPositionCommand[];
}

export interface ViewportClampedBattlefieldPosition {
  playerId: string;
  instanceId: string;
  sourcePosition: { x: number; y: number };
  clampedPosition: { x: number; y: number };
}
