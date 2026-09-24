import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { GameSnapshot } from '../../../../../core/models/game.model';
import { CzButtonDirective } from '../../../../../shared/ui/button/button.directive';
import { CompactCheckboxComponent } from '../../../../../shared/ui/compact-checkbox/compact-checkbox.component';
import { PlayerView } from '../../game-table.store';
import { playerIsDefeated } from '../../utils/game-player-defeat';
import { PlayersOrderComponent } from './players-order/players-order.component';

interface NextTurnPlayer {
  readonly id: string;
  readonly name: string;
}

@Component({
  selector: 'app-turn-phase-panel',
  imports: [
    RuntimeTranslatePipe,
    LucideAngularModule,
    PlayersOrderComponent,
    CzButtonDirective,
    CompactCheckboxComponent,
  ],
  templateUrl: './turn-phase-panel.component.html',
  styleUrl: './turn-phase-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TurnPhasePanelComponent {
  readonly turn = input.required<GameSnapshot['turn']>();
  readonly players = input.required<ReadonlyArray<PlayerView>>();
  readonly phases = input.required<ReadonlyArray<string>>();
  readonly currentPlayerId = input.required<string | null>();
  readonly playerColor = input.required<(playerId: string) => string>();
  readonly isPhasePast = input.required<(phase: string) => boolean>();
  readonly canAdvance = input.required<boolean>();
  readonly gridLayout = input(false);
  readonly followActiveTurnPlayer = input(false);
  readonly advancePhase = output<void>();
  readonly passTurn = output<void>();
  readonly followActiveTurnPlayerChanged = output<boolean>();
  readonly activeTurnPlayerName = computed(() => {
    const activePlayerId = this.turn().activePlayerId;
    if (!activePlayerId) {
      return null;
    }

    const player = this.players().find(({ id }) => id === activePlayerId);
    const displayName = player?.state.user.displayName?.trim();

    return displayName || null;
  });
  readonly nextTurnPlayer = computed<NextTurnPlayer | null>(() => {
    const activePlayerId = this.turn().activePlayerId;
    const activePlayers = this.players().filter((player) => !playerIsDefeated(player));
    const activePlayerIndex = activePlayers.findIndex((player) => player.id === activePlayerId);

    if (activePlayerIndex < 0 || activePlayers.length < 2) {
      return null;
    }

    const player = activePlayers[(activePlayerIndex + 1) % activePlayers.length];

    return player
      ? {
          id: player.id,
          name: player.state.user.displayName.trim() || 'Unknown player',
        }
      : null;
  });

  isCurrentTurnPlayer(): boolean {
    const currentPlayerId = this.currentPlayerId();

    return currentPlayerId !== null && currentPlayerId === this.turn().activePlayerId;
  }

  activeTurnPlayerColor(): string | null {
    const activePlayerId = this.turn().activePlayerId;

    return activePlayerId ? this.playerColor()(activePlayerId) : null;
  }

  isCompactPhase(phase: string): boolean {
    return phase === 'untap' || phase === 'upkeep' || phase === 'draw' || phase === 'end';
  }

  phaseTranslationKey(phase: string): string {
    return `game.turnPhasePanel.phaseLabels.${phase}`;
  }
}
