import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { AppModalComponent } from '../../../../../shared/ui/app-modal/app-modal.component';
import { GameDisconnectVoteChoice } from '../../../../../core/models/game.model';
import { DisconnectVotePlayerView } from '../../services/game-table-disconnect-vote.service';

@Component({
  selector: 'app-game-disconnect-vote-modal',
  imports: [AppModalComponent],
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

  voteLabel(vote: GameDisconnectVoteChoice | null): string {
    if (vote === 'wait') {
      return 'Esperar';
    }
    if (vote === 'expel') {
      return 'Expulsar';
    }

    return 'Sin voto';
  }
}
