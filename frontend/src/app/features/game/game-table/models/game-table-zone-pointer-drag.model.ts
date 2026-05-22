import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { PointerDropTarget } from '../services/game-table-pointer-drag.service';

export interface ZonePointerDragSource {
  readonly playerId: string;
  readonly fromZone: GameZoneName;
  readonly card: GameCardInstance;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface ZonePointerDragMove {
  readonly source: ZonePointerDragSource;
  readonly x: number;
  readonly y: number;
  readonly target: PointerDropTarget | null;
  readonly dragging: boolean;
}

export interface ZonePointerDropRequest {
  readonly playerId: string;
  readonly targetPlayerId: string;
  readonly fromZone: GameZoneName;
  readonly toZone: GameZoneName;
  readonly instanceId: string;
  readonly rawZone?: string;
  readonly position?: { x: number; y: number };
}

export interface ZonePointerDropResult {
  readonly source: ZonePointerDragSource;
  readonly request: ZonePointerDropRequest | null;
  readonly moved: boolean;
}
