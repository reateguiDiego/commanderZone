import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { type DeckVisibility } from '../../../core/models/deck.model';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { CardAutocompleteComponent } from '../../../shared/components/card-autocomplete/card-autocomplete.component';
import { ManaSymbolsComponent } from '../../../shared/mana/mana-symbols/mana-symbols.component';
import { VisibilityChoiceComponent } from '../../../shared/components/visibility-choice/visibility-choice.component';
import { FormatSelectComponent } from '../../../shared/components/format-select/format-select.component';
import { AppModalComponent } from '../../../shared/ui/app-modal/app-modal.component';
import { PrettyScrollDirective } from '../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { DeckListStore } from '../data-access/deck-list.store';

interface CommanderHoverPreview {
  imageUrl: string;
  x: number;
  y: number;
}

@Component({
  selector: 'app-deck-list',
  imports: [RuntimeTranslatePipe, FormsModule, LucideAngularModule, AppModalComponent, CardAutocompleteComponent, ManaSymbolsComponent, PrettyScrollDirective, VisibilityChoiceComponent, FormatSelectComponent],
  templateUrl: './deck-list.component.html',
  styleUrl: './deck-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DeckListStore],
})
export class DeckListComponent implements OnInit, OnDestroy {
  readonly store = inject(DeckListStore);
  private readonly pageHeader = inject(PageHeaderStore);
  readonly commanderHoverPreview = signal<CommanderHoverPreview | null>(null);

  private commanderHoverTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCommanderPreview: CommanderHoverPreview | null = null;

  ngOnInit(): void {
    this.pageHeader.set({
      title: 'deckBuilder.deckList.header.title',
      actions: [
        {
          id: 'create-deck',
          label: 'deckBuilder.deckList.header.createDeck',
          icon: 'plus',
          variant: 'primary',
          execute: () => this.store.openCreateModal(),
        },
        {
          id: 'create-folder',
          label: 'deckBuilder.deckList.header.createFolder',
          icon: 'folder-plus',
          variant: 'secondary',
          execute: () => this.store.openFolderCreateModal(),
        },
      ],
    });
  }

  ngOnDestroy(): void {
    this.clearCommanderHoverTimer();
    this.pageHeader.clear();
  }

  visibilityIcon(visibility: DeckVisibility | undefined): 'globe' | 'lock' {
    return visibility === 'public' ? 'globe' : 'lock';
  }

  scheduleCommanderPreview(event: MouseEvent, imageUrl: string): void {
    this.pendingCommanderPreview = { imageUrl, ...this.previewPosition(event) };
    this.clearCommanderHoverTimer();
    this.commanderHoverTimer = setTimeout(() => {
      if (this.pendingCommanderPreview) {
        this.commanderHoverPreview.set(this.pendingCommanderPreview);
      }
      this.commanderHoverTimer = null;
    }, 260);
  }

  moveCommanderPreview(event: MouseEvent): void {
    const current = this.commanderHoverPreview();
    if (current) {
      this.commanderHoverPreview.set({ ...current, ...this.previewPosition(event) });
      return;
    }

    if (this.pendingCommanderPreview) {
      this.pendingCommanderPreview = {
        imageUrl: this.pendingCommanderPreview.imageUrl,
        ...this.previewPosition(event),
      };
    }
  }

  hideCommanderPreview(): void {
    this.clearCommanderHoverTimer();
    this.pendingCommanderPreview = null;
    this.commanderHoverPreview.set(null);
  }

  private previewPosition(event: MouseEvent): { x: number; y: number } {
    const margin = 12;
    const previewWidth = 288;
    const previewHeight = 402;
    let x = event.clientX + 18;
    let y = event.clientY - 18;

    if (x + previewWidth > window.innerWidth - margin) {
      x = event.clientX - previewWidth - 18;
    }
    if (y + previewHeight > window.innerHeight - margin) {
      y = window.innerHeight - previewHeight - margin;
    }

    return {
      x: Math.max(margin, Math.min(x, window.innerWidth - previewWidth - margin)),
      y: Math.max(margin, y),
    };
  }

  private clearCommanderHoverTimer(): void {
    if (this.commanderHoverTimer) {
      clearTimeout(this.commanderHoverTimer);
      this.commanderHoverTimer = null;
    }
  }
}
