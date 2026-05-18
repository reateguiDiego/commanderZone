import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { GameCardInstance } from '../../../../core/models/game.model';
import { CardSpoilerGridComponent } from '../card-spoiler-grid/card-spoiler-grid.component';
import { ZoneModalState } from '../state/game-table-zone-modal.state';

@Component({
  selector: 'app-zone-modal',
  imports: [FormsModule, LucideAngularModule, CardSpoilerGridComponent],
  templateUrl: './zone-modal.component.html',
  styleUrl: './zone-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZoneModalComponent {
  readonly modal = input.required<ZoneModalState>();
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();

  readonly close = output<void>();
  readonly filterChanged = output<Partial<Pick<ZoneModalState, 'type' | 'search'>>>();
  readonly cardSelected = output<GameCardInstance>();
  readonly cardsReordered = output<readonly GameCardInstance[]>();
  readonly cardMenuOpened = output<{ event: MouseEvent; card: GameCardInstance }>();

  stopClick(event: MouseEvent): void {
    event.stopPropagation();
  }
}
