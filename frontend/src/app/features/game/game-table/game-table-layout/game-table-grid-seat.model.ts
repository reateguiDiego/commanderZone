import type { TemplateRef } from '@angular/core';
import type { GameSpecialEntity } from '../../../../core/models/game.model';
import type { PlayerView } from '../game-table.store';
import type { SpecialEntityPreviewRequest } from '../models/special-entity-preview-request.model';

export type BattlefieldViewLayout = 'square' | 'grid';
export type GridSeatName = 'opponent-1' | 'opponent-2' | 'opponent-3' | 'current';
export type GridPlayerCount = 1 | 2 | 3 | 4;

export interface GridSeat {
  readonly player: PlayerView;
  readonly seat: GridSeatName;
}

export interface BattlefieldLayoutRect {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface PlayerBattlefieldSize {
  readonly playerId: string;
  readonly rect: BattlefieldLayoutRect;
}

export interface PlayerRegionContext {
  readonly $implicit: PlayerView;
  readonly grid: boolean;
  /** Local visual transform for upper Grid seats; it never changes game state. */
  readonly battlefieldVerticallyInverted?: boolean;
  readonly isTurnOwner?: boolean;
  readonly handPosition?: 'top' | 'bottom';
  /** When false, the zones render with Square's regular horizontal presentation. */
  readonly zoneCompact?: boolean;
  readonly reportSize?: (rect: BattlefieldLayoutRect) => void;
}

export interface PlayerRegionTemplates {
  readonly battlefield: TemplateRef<PlayerRegionContext>;
  readonly hand: TemplateRef<PlayerRegionContext>;
  readonly zones: TemplateRef<PlayerRegionContext>;
}

export interface GridPlayerSummaryBindings {
  readonly players: readonly PlayerView[];
  readonly colorAccent: (player: PlayerView | null) => string;
  readonly deckLabel: (player: PlayerView | null) => string;
  readonly manaSymbols: (player: PlayerView | null) => string[];
  readonly playerCounterValue: (player: PlayerView, key: string) => number;
  readonly canEditCounters: (playerId: string) => boolean;
  readonly autoApplyCommanderDamageToLife: boolean;
  readonly specialEntities: (playerId: string) => readonly GameSpecialEntity[];
  readonly showHelperPreview: (request: SpecialEntityPreviewRequest) => void;
  readonly hideHelperPreview: () => void;
  readonly openHelperContext: (event: MouseEvent, entity: GameSpecialEntity) => void;
  readonly changeLife: (playerId: string, delta: number) => void;
  readonly changeCommanderDamage: (
    targetPlayerId: string,
    sourcePlayerId: string,
    commanderInstanceId: string,
    delta: number,
  ) => void;
  readonly changePlayerCounter: (playerId: string, key: string, delta: number) => void;
}

export function buildGridSeats(
  players: readonly PlayerView[],
  currentPlayer: PlayerView | null,
): readonly GridSeat[] {
  const local = players.find((player) => player.id === currentPlayer?.id);
  if (players.length < 1 || players.length > 4 || !local) {
    return [];
  }

  const opponentSeats: readonly GridSeatName[] = ['opponent-1', 'opponent-2', 'opponent-3'];
  const opponents = players.filter((player) => player.id !== local.id);
  return [
    ...opponents.map((player, index): GridSeat => ({ player, seat: opponentSeats[index] })),
    { player: local, seat: 'current' },
  ];
}
