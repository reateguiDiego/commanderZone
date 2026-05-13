import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { GameSnapshot } from '../../../../core/models/game.model';
import { PlayerView } from '../game-table.store';

@Component({
  selector: 'app-turn-phase-panel',
  templateUrl: './turn-phase-panel.component.html',
  styleUrl: './turn-phase-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TurnPhasePanelComponent {
  readonly turn = input.required<GameSnapshot['turn']>();
  readonly players = input.required<ReadonlyArray<PlayerView>>();
  readonly phases = input.required<ReadonlyArray<string>>();
  readonly currentPlayerId = input.required<string | null>();
  readonly isPhasePast = input.required<(phase: string) => boolean>();
  readonly pending = input.required<boolean>();
  readonly canAdvance = input.required<boolean>();
  readonly advancePhase = output<void>();
  readonly passTurn = output<void>();

  activePlayerName(): string {
    const turn = this.turn();
    if (this.currentPlayerId() === turn.activePlayerId) {
      return 'Your Turn';
    }

    return this.players().find((player) => player.id === turn.activePlayerId)?.state.user.displayName ?? 'Unknown player';
  }

  isCompactPhase(phase: string): boolean {
    return phase === 'untap' || phase === 'upkeep' || phase === 'draw' || phase === 'end';
  }
}
