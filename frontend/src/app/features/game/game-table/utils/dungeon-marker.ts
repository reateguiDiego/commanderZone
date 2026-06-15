import { GameCardDungeonMarker, GameCardInstance } from '../../../../core/models/game.model';
import { isDungeonCard } from './gameplay-card-kind';

export const DEFAULT_DUNGEON_MARKER: GameCardDungeonMarker = { x: 0.5, y: 0.5 };

export function dungeonMarkerForCard(card: Pick<GameCardInstance, 'layout' | 'typeLine' | 'name' | 'dungeonMarker'>): GameCardDungeonMarker | null {
  if (!isDungeonCard(card)) {
    return null;
  }

  return normalizedDungeonMarker(card.dungeonMarker ?? DEFAULT_DUNGEON_MARKER);
}

export function normalizedDungeonMarker(marker: GameCardDungeonMarker): GameCardDungeonMarker {
  return {
    x: clampRatio(marker.x),
    y: clampRatio(marker.y),
  };
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}
