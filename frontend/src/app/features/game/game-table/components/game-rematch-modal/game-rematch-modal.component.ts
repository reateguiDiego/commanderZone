import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { AppModalComponent } from '../../../../../shared/ui/app-modal/app-modal.component';
import { GameRematchVote } from '../../../../../core/models/game.model';

export interface RematchPlayerVoteView {
  readonly playerId: string;
  readonly displayName: string;
  readonly winner: boolean;
  readonly life: number;
  readonly defeated: boolean;
  readonly vote: GameRematchVote | null;
}

@Component({
  selector: 'app-game-rematch-modal',
  imports: [RuntimeTranslatePipe, LucideAngularModule, AppModalComponent],
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
  readonly missingPlayerNames = input<readonly string[]>([]);

  readonly playAgain = output<void>();
  readonly leaveRoom = output<void>();
  readonly closed = output<void>();

  readonly logoUrl = 'assets/icons/CZ/CZ_logo.webp';

  titleKey(): string {
    return this.winner() ? 'game.gameRematchModal.legendaryVictory' : 'game.gameRematchModal.youDied';
  }

  messageKey(): string {
    return this.winner()
      ? 'game.gameRematchModal.winnerMessage'
      : 'game.gameRematchModal.defeatedMessage';
  }

  voteLabel(vote: GameRematchVote | null): string {
    switch (vote) {
      case 'play_again':
        return 'game.gameRematchModal.playAgain';
      case 'leave_room':
        return 'game.gameRematchModal.leaveRoom';
      default:
        return 'game.gameRematchModal.noVote';
    }
  }

  countdownTitle(): string { return 'game.gameRematchModal.timeLimit'; }

  countdownMessageKey(): string {
    if (this.currentVote() === null) {
      return 'game.gameRematchModal.youHaveSecondsToVote';
    }

    return 'game.gameRematchModal.playersHaveSecondsToVote';
  }

  countdownMessageParams(): Record<string, unknown> {
    return {
      playerNames: this.missingPlayersLabel(),
      seconds: this.countdownSeconds() ?? 0,
    };
  }

  private missingPlayersLabel(): string {
    const names = this.missingPlayerNames().filter((name) => name.trim().length > 0);
    if (names.length === 0) {
      return 'pending players';
    }
    if (names.length === 1) {
      return names[0] ?? 'the pending player';
    }
    if (names.length === 2) {
      return `${names[0]} and ${names[1]}`;
    }

    return `${names[0]} and ${names.length - 1} more`;
  }
}
