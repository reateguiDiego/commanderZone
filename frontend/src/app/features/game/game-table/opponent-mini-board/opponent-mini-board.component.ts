import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { PlayerView } from '../game-table.store';
import { GameCardViewComponent } from '../game-card-view/game-card-view.component';

interface PlayerDropEvent {
  event: DragEvent;
  playerId: string;
}

interface PlayerMenuEvent {
  event: MouseEvent;
  playerId: string;
}

@Component({
  selector: 'app-opponent-mini-board',
  imports: [ManaSymbolsComponent, GameCardViewComponent],
  templateUrl: './opponent-mini-board.component.html',
  styleUrl: './opponent-mini-board.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpponentMiniBoardComponent {
  readonly player = input.required<PlayerView>();
  readonly colorAccent = input.required<(player: PlayerView | null) => string>();
  readonly deckLabel = input.required<(player: PlayerView | null) => string>();
  readonly manaSymbols = input.required<(player: PlayerView | null) => string[]>();
  readonly zoneCount = input.required<(player: PlayerView, zone: GameZoneName) => number>();
  readonly cardPosition = input.required<(card: GameCardInstance) => { x: number; y: number } | null>();
  readonly miniCardLeft = input.required<(card: GameCardInstance, index: number) => number>();
  readonly miniCardTop = input.required<(card: GameCardInstance, index: number) => number>();
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();
  readonly isPlayerDropHighlighted = input.required<(playerId: string) => boolean>();

  readonly focusPlayer = output<string>();
  readonly dropAllowed = output<DragEvent>();
  readonly playerDropped = output<PlayerDropEvent>();
  readonly playerMenuOpened = output<PlayerMenuEvent>();
}
