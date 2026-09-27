import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { PointerDropTarget } from '../services/game-table-pointer-drag.service';

export interface ZonePointerDragSource {
  readonly playerId: string;
  readonly fromZone: GameZoneName;
  /**
   * Library drags intentionally have no card identity. The runtime resolves
   * the current top card when the drop command is applied.
   */
  readonly card: GameCardInstance | null;
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

interface ZonePointerDropRequestBase {
  readonly playerId: string;
  readonly targetPlayerId: string;
  readonly toZone: GameZoneName;
  readonly rawZone?: string;
  readonly position?: { x: number; y: number };
}

export interface LibraryTopPointerDropRequest extends ZonePointerDropRequestBase {
  readonly fromZone: 'library';
  readonly instanceId: null;
}

export interface KnownZonePointerDropRequest extends ZonePointerDropRequestBase {
  readonly fromZone: Exclude<GameZoneName, 'library'>;
  readonly instanceId: string;
}

export type ZonePointerDropRequest = LibraryTopPointerDropRequest | KnownZonePointerDropRequest;

export interface ZonePointerDropResult {
  readonly source: ZonePointerDragSource;
  readonly request: ZonePointerDropRequest | null;
  readonly moved: boolean;
}
