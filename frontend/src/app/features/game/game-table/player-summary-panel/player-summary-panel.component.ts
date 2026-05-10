import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { PlayerAvatarComponent } from '../../../../shared/ui/player-avatar/player-avatar.component';
import { PlayerNameComponent } from '../../../../shared/ui/player-name/player-name.component';
import { PlayerView } from '../game-table.store';

interface LifeChangeEvent {
  playerId: string;
  delta: number;
}

@Component({
  selector: 'app-player-summary-panel',
  imports: [ManaSymbolsComponent, PlayerAvatarComponent, PlayerNameComponent],
  templateUrl: './player-summary-panel.component.html',
  styleUrl: './player-summary-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayerSummaryPanelComponent {
  readonly player = input.required<PlayerView>();
  readonly colorAccent = input.required<(player: PlayerView | null) => string>();
  readonly deckLabel = input.required<(player: PlayerView | null) => string>();
  readonly manaSymbols = input.required<(player: PlayerView | null) => string[]>();
  readonly lifeChanged = output<LifeChangeEvent>();

  changeLife(event: MouseEvent, delta: number): void {
    if (delta < 0) {
      event.preventDefault();
    }

    this.lifeChanged.emit({ playerId: this.player().id, delta });
  }
}
