import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { PrettyScrollDirective } from '../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { ZoneModalState } from '../state/game-table-zone-modal.state';

@Component({
  selector: 'app-zone-modal',
  imports: [FormsModule, LucideAngularModule, PrettyScrollDirective],
  templateUrl: './zone-modal.component.html',
  styleUrl: './zone-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZoneModalComponent {
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
}
