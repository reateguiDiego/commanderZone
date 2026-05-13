import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { PrettyScrollDirective } from '../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { ZoneModalState } from '../state/game-table-zone-modal.state';

interface ZoneCardAction {
  readonly zone: GameZoneName;
  readonly label: string;
}

@Component({
  selector: 'app-zone-modal',
  imports: [FormsModule, LucideAngularModule, ManaSymbolsComponent, PrettyScrollDirective],
  templateUrl: './zone-modal.component.html',
  styleUrl: './zone-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZoneModalComponent {
  readonly cardActions: readonly ZoneCardAction[] = [
    { zone: 'battlefield', label: 'Battlefield' },
    { zone: 'hand', label: 'Hand' },
    { zone: 'graveyard', label: 'Graveyard' },
    { zone: 'exile', label: 'Exile' },
  ];

  readonly modal = input.required<ZoneModalState>();
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();
  readonly canUseHiddenZone = input.required<(playerId: string, zone: GameZoneName) => boolean>();

  readonly close = output<void>();
  readonly filterChanged = output<Partial<Pick<ZoneModalState, 'type' | 'search'>>>();
  readonly cardSelected = output<GameCardInstance>();
  readonly cardMoved = output<{ card: GameCardInstance; zone: GameZoneName }>();
  readonly cardRevealed = output<GameCardInstance>();

  stopClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  cardTypeLine(card: GameCardInstance): string {
    return card.typeLine?.trim() || 'Card';
  }
}
