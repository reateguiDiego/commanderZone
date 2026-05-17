import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { AppModalComponent } from '../../../../shared/ui/app-modal/app-modal.component';
import { GameRematchVote } from '../../../../core/models/game.model';

export interface RematchPlayerVoteView {
  readonly playerId: string;
  readonly displayName: string;
  readonly life: number;
  readonly vote: GameRematchVote | null;
}

export type RematchCountdownMode = 'initial' | 'courtesy';

@Component({
  selector: 'app-game-rematch-modal',
  imports: [AppModalComponent],
  templateUrl: './game-rematch-modal.component.html',
  styleUrl: './game-rematch-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameRematchModalComponent {
  readonly open = input(false);
  readonly winner = input(false);
  readonly players = input<readonly RematchPlayerVoteView[]>([]);
  readonly currentVote = input<GameRematchVote | null>(null);
  readonly pending = input(false);
  readonly playAgainDisabled = input(false);
  readonly countdownSeconds = input<number | null>(null);
  readonly countdownMode = input<RematchCountdownMode | null>(null);
  readonly missingPlayerNames = input<readonly string[]>([]);

  readonly playAgain = output<void>();
  readonly leaveRoom = output<void>();
  readonly closed = output<void>();

  readonly logoUrl = 'assets/icons/CM_logo.png';

  voteLabel(vote: GameRematchVote | null): string {
    switch (vote) {
      case 'play_again':
        return 'Jugar otra partida';
      case 'leave':
        return 'Abandona room';
      default:
        return 'Sin votar';
    }
  }

  countdownTitle(): string {
    return this.countdownMode() === 'courtesy' ? 'Tiempo extra' : 'Tiempo limite';
  }

  countdownMessage(): string {
    const seconds = this.countdownSeconds() ?? 0;
    if (this.countdownMode() === 'courtesy') {
      if (this.currentVote() === null) {
        return `Falta tu voto. Tienes ${seconds}s extra para votar.`;
      }

      return `Falta ${this.missingPlayersLabel()}. Tiene ${seconds}s extra para votar.`;
    }

    if (this.currentVote() === null) {
      return `Tienes ${seconds}s para votar.`;
    }

    return `${this.missingPlayersLabel()} tienen ${seconds}s para votar.`;
  }

  private missingPlayersLabel(): string {
    const names = this.missingPlayerNames().filter((name) => name.trim().length > 0);
    if (names.length === 0) {
      return 'los jugadores pendientes';
    }
    if (names.length === 1) {
      return names[0] ?? 'el jugador pendiente';
    }
    if (names.length === 2) {
      return `${names[0]} y ${names[1]}`;
    }

    return `${names[0]} y ${names.length - 1} mas`;
  }
}
