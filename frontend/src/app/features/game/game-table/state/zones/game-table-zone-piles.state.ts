import { Injectable } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTableSnapshotSelectors, PlayerView } from '../core/game-table-snapshot-selectors';

@Injectable()
export class GameTableZonePilesState {
  constructor(
    private readonly core: GameTableCoreState,
    private readonly selectors: GameTableSnapshotSelectors,
  ) {}

  zoneTitle(zone: GameZoneName): string {
    return this.selectors.zoneTitle(zone);
  }

  zoneHint(zone: GameZoneName): string {
    return this.selectors.zoneHint(zone);
  }

  topVisibleCard(player: PlayerView, zone: GameZoneName): GameCardInstance | null {
    return this.selectors.topVisibleCard(player, zone);
  }

  zonePreviewCard(player: PlayerView, zone: GameZoneName): GameCardInstance | null {
    return this.selectors.zonePreviewCard(player, zone);
  }

  zonePreviewImage(player: PlayerView, zone: GameZoneName): string | null {
    return this.selectors.zonePreviewImage(player, zone);
  }

  isLibraryTopRevealed(playerId: string): boolean {
    return this.core.snapshot()?.players[playerId]?.playTopLibraryRevealed === true;
  }

  topDraggableCard(player: PlayerView, zone: GameZoneName, canControlPlayer: boolean): GameCardInstance | null {
    return this.selectors.topDraggableCard(player, zone, canControlPlayer);
  }
}
