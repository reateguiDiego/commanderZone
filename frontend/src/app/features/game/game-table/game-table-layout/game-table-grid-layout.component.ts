import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { GridPlayerBattlefieldComponent } from './grid-player-battlefield.component';
import { GridPlayerSummaryBindingsMemo } from './game-table-grid-render-memo';
import { playerIsDefeated } from '../utils/game-player-defeat';
import type {
  GridSeat,
  PlayerBattlefieldSize,
  GridPlayerSummaryBindings,
  PlayerRegionTemplates,
} from './game-table-grid-seat.model';

@Component({
  selector: 'app-game-table-grid-layout',
  imports: [GridPlayerBattlefieldComponent],
  templateUrl: './game-table-grid-layout.component.html',
  styleUrl: './game-table-grid-layout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameTableGridLayoutComponent {
  private readonly summaryBindingsMemo = new GridPlayerSummaryBindingsMemo();
  readonly seats = input.required<readonly GridSeat[]>();
  readonly regions = input.required<PlayerRegionTemplates>();
  readonly summaryBindings = input.required<GridPlayerSummaryBindings>();
  readonly renderMemoEnabled = input(false);
  readonly playmatImage = input<(player: GridSeat['player']) => string>(() => '');
  readonly activePlayerId = input<string | null>(null);
  readonly canConcede = input<(playerId: string) => boolean>(() => false);
  readonly deferSummaryCollisionDuringPointerDrag = input(false);
  readonly hasActiveBattlefieldPointerDrag = input(false);
  readonly dropAllowed = output<DragEvent>();
  readonly playerDropped = output<{ event: DragEvent; playerId: string }>();
  readonly battlefieldSizeChanged = output<PlayerBattlefieldSize>();
  readonly concedeRequested = output<MouseEvent>();
  readonly playerMenuOpened = output<{ event: MouseEvent; playerId: string }>();
  readonly renderedSummaryBindings = computed(() =>
    this.renderMemoEnabled()
      ? this.summaryBindingsMemo.memoize(this.summaryBindings())
      : this.summaryBindings(),
  );
  readonly seatTurnEntries = computed(() => {
    const summaryPlayers = this.renderedSummaryBindings().players;
    const summaryPlayersById = new Map(summaryPlayers.map((player) => [player.id, player]));
    const activePlayers = summaryPlayers.filter((player) => !playerIsDefeated(player));
    const activePlayerIndex = activePlayers.findIndex((player) => player.id === this.activePlayerId());

    return this.seats().map((seat) => {
      const playerIndex = activePlayers.findIndex((player) => player.id === seat.player.id);
      const turnDistance = activePlayerIndex >= 0 && playerIndex >= 0
        ? (playerIndex - activePlayerIndex + activePlayers.length) % activePlayers.length
        : null;

      return {
        seat,
        summaryPlayer: summaryPlayersById.get(seat.player.id) ?? seat.player,
        turnDistance,
      };
    });
  });
}
