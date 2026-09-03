import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, OnDestroy, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { CardSpoilerGridComponent } from '../card-spoiler-grid/card-spoiler-grid.component';
import { ZoneModalState } from '../../state/zones/game-table-zone-modal.state';
import { CzButtonDirective } from '../../../../../shared/ui/button/button.directive';
import { FormatSelectComponent, type FormatSelectOption } from '../../../../../shared/components/format-select/format-select.component';

const CARD_TYPE_OPTIONS: readonly FormatSelectOption[] = [
  { id: '', labelKey: 'shared.text.allTypes' },
  { id: 'creature', labelKey: 'shared.text.creatures' },
  { id: 'instant', labelKey: 'shared.text.instants' },
  { id: 'sorcery', labelKey: 'shared.text.sorceries' },
  { id: 'artifact', labelKey: 'shared.text.artifacts' },
  { id: 'enchantment', labelKey: 'shared.text.enchantments' },
  { id: 'planeswalker', labelKey: 'shared.text.planeswalkers' },
  { id: 'land', labelKey: 'shared.text.lands' },
];

@Component({
  selector: 'app-zone-modal',
  imports: [RuntimeTranslatePipe, FormsModule, LucideAngularModule, CardSpoilerGridComponent, CzButtonDirective, FormatSelectComponent],
  templateUrl: './zone-modal.component.html',
  styleUrl: './zone-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZoneModalComponent implements OnDestroy {
  private searchDebounceHandle?: number;
  private readonly searchDebounceMs = 250;

  readonly modal = input.required<ZoneModalState>();
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();
  readonly cardTypeOptions = CARD_TYPE_OPTIONS;

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
