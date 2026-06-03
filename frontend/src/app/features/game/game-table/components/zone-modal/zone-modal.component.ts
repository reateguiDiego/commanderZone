import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, OnDestroy, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { CardSpoilerGridComponent } from '../card-spoiler-grid/card-spoiler-grid.component';
import { ZoneModalState } from '../../state/zones/game-table-zone-modal.state';

@Component({
  selector: 'app-zone-modal',
  imports: [RuntimeTranslatePipe, FormsModule, LucideAngularModule, CardSpoilerGridComponent],
  templateUrl: './zone-modal.component.html',
  styleUrl: './zone-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZoneModalComponent implements OnDestroy {
  private searchDebounceHandle?: number;
  private readonly searchDebounceMs = 250;

  readonly modal = input.required<ZoneModalState>();
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();

  readonly close = output<void>();
  readonly filterChanged = output<Partial<Pick<ZoneModalState, 'type' | 'search'>>>();
  readonly cardSelected = output<GameCardInstance>();
  readonly cardsReordered = output<readonly GameCardInstance[]>();
  readonly cardMenuOpened = output<{ event: MouseEvent; card: GameCardInstance }>();

  ngOnDestroy(): void {
    if (this.searchDebounceHandle !== undefined) {
      window.clearTimeout(this.searchDebounceHandle);
    }
  }

  stopClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  updateType(type: string): void {
    this.filterChanged.emit({ type });
  }

  updateSearch(search: string): void {
    if (this.searchDebounceHandle !== undefined) {
      window.clearTimeout(this.searchDebounceHandle);
    }

    this.searchDebounceHandle = window.setTimeout(() => {
      this.searchDebounceHandle = undefined;
      this.filterChanged.emit({ search });
    }, this.searchDebounceMs);
  }
}
