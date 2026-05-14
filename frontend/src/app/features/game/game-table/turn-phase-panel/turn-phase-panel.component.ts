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

  isCurrentTurnPlayer(): boolean {
    const currentPlayerId = this.currentPlayerId();

    return currentPlayerId !== null && currentPlayerId === this.turn().activePlayerId;
  }

  nextPhaseLabel(): string {
    const phases = this.phases();
    const currentPhaseIndex = phases.indexOf(this.turn().phase);
    const nextPhase = currentPhaseIndex >= 0 && currentPhaseIndex < phases.length - 1
      ? phases[currentPhaseIndex + 1]
      : phases[0];

    return this.phaseLabel(nextPhase ?? 'untap');
  }

  isCompactPhase(phase: string): boolean {
    return phase === 'untap' || phase === 'upkeep' || phase === 'draw' || phase === 'end';
  }

  private phaseLabel(phase: string): string {
    return phase
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('-');
  }
}
