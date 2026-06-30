import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { AppModalComponent } from '../../../../../shared/ui/app-modal/app-modal.component';
import { GameDisconnectVoteChoice } from '../../../../../core/models/game.model';
import { DisconnectVotePlayerView } from '../../services/game-table-disconnect-vote.service';

@Component({
  selector: 'app-game-disconnect-vote-modal',
  imports: [RuntimeTranslatePipe, AppModalComponent],
  templateUrl: './game-disconnect-vote-modal.component.html',
  styleUrl: './game-disconnect-vote-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameDisconnectVoteModalComponent {
  readonly open = input(false);
  readonly targetPlayerName = input<string | null>(null);
  readonly targetOnline = input(false);
  readonly currentVote = input<GameDisconnectVoteChoice | null>(null);
  readonly players = input<readonly DisconnectVotePlayerView[]>([]);
  readonly pending = input(false);
  readonly countdownSeconds = input<number | null>(null);
  readonly error = input<string | null>(null);

  readonly voteWait = output<void>();
  readonly voteExpel = output<void>();
  readonly closed = output<void>();

  disconnectMessageKey(): string {
    return this.targetPlayerName()
      ? 'game.gameDisconnectVoteModal.playerDisconnectedMessage'
      : 'game.gameDisconnectVoteModal.genericDisconnectedMessage';
  }

  disconnectMessageParams(): Record<string, unknown> | undefined {
    const playerName = this.targetPlayerName();

    return playerName ? { playerName } : undefined;
  }

  voteLabel(vote: GameDisconnectVoteChoice | null): string {
    if (vote === 'wait') {
      return 'game.gameDisconnectVoteModal.wait';
    }
    if (vote === 'expel') {
      return 'game.gameDisconnectVoteModal.expel';
    }

    return 'game.gameDisconnectVoteModal.noVote';
  }
}
