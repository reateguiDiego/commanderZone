import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { GameZoneName } from '../../../../core/models/game.model';
import { PrettyScrollDirective } from '../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { GameContextMenu } from '../state/game-table-ui.state';
import { PlayerView } from '../game-table.store';

export type ContextMenuAction =
  | { type: 'drawMine' }
  | { type: 'draw7Mine' }
  | { type: 'revealTopMine' }
  | { type: 'shuffleMine' }
  | { type: 'copyGameId' }
  | { type: 'refreshSnapshot' }
  | { type: 'focusCurrentPlayer' }
  | { type: 'openChat' }
  | { type: 'openLog' }
  | { type: 'leaveTable' }
  | { type: 'concedeGame' }
  | { type: 'closeGame' }
  | { type: 'focusPlayer' }
  | { type: 'openZone'; zone: GameZoneName }
  | { type: 'changeLife'; delta: number }
  | { type: 'drawCard' }
  | { type: 'drawPrompt' }
  | { type: 'moveTop'; zone: GameZoneName }
  | { type: 'shuffle' }
  | { type: 'revealTop' }
  | { type: 'moveAll'; zone: GameZoneName }
  | { type: 'tapCard' }
  | { type: 'faceDown' }
  | { type: 'revealCard' }
  | { type: 'tokenCopy' }
  | { type: 'addToStack' }
  | { type: 'setPowerToughness' }
  | { type: 'changeCounter'; counter: string }
  | { type: 'moveCard'; zone: GameZoneName }
  | { type: 'previewCard' };

@Component({
  selector: 'app-context-menu',
  imports: [PrettyScrollDirective],
  templateUrl: './context-menu.component.html',
  styleUrl: './context-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextMenuComponent {
  readonly menu = input.required<GameContextMenu>();
  readonly currentPlayer = input<PlayerView | null>(null);
  readonly isGameOwner = input(false);
  readonly counterPresets = input.required<readonly string[]>();
  readonly moveZones = input.required<readonly GameZoneName[]>();
  readonly isCurrentPlayer = input.required<(playerId: string) => boolean>();
  readonly canControlPlayer = input.required<(playerId: string) => boolean>();
  readonly zoneTitle = input.required<(zone: GameZoneName) => string>();

  readonly actionSelected = output<ContextMenuAction>();
  readonly close = output<void>();

  isLibraryMenu(): boolean {
    const currentMenu = this.menu();
    return currentMenu.zone === 'library' && !currentMenu.card;
  }

  isZoneOnlyMenu(): boolean {
    const currentMenu = this.menu();
    return !currentMenu.card && currentMenu.zone !== 'library';
  }

  isCurrentPlayerActive(): boolean {
    return this.currentPlayer()?.state.status !== 'conceded';
  }

  stopClick(event: MouseEvent): void {
    event.stopPropagation();
  }
}
