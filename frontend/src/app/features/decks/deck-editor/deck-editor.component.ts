import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { CardAutocompleteComponent } from '../../../shared/components/card-autocomplete/card-autocomplete.component';
import { ManaSymbolsComponent } from '../../../shared/mana/mana-symbols/mana-symbols.component';
import { AppModalComponent } from '../../../shared/ui/app-modal/app-modal.component';
import { DeckCardImageCache } from '../data-access/deck-card-image-cache.service';
import { DeckEditorStore } from '../data-access/deck-editor.store';
import { DeckAnalysisPanelComponent } from './deck-analysis-panel/deck-analysis-panel.component';
import { DeckCardMenuComponent } from './deck-card-menu/deck-card-menu.component';
import { DeckCardSpoilerViewComponent } from './deck-card-spoiler-view/deck-card-spoiler-view.component';
import { DeckCardTextViewComponent } from './deck-card-text-view/deck-card-text-view.component';

@Component({
  selector: 'app-deck-editor',
  imports: [
    FormsModule,
    RouterLink,
    LucideAngularModule,
    AppModalComponent,
    CardAutocompleteComponent,
    ManaSymbolsComponent,
    DeckAnalysisPanelComponent,
    DeckCardMenuComponent,
    DeckCardSpoilerViewComponent,
    DeckCardTextViewComponent,
  ],
  templateUrl: './deck-editor.component.html',
  styleUrl: './deck-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DeckCardImageCache, DeckEditorStore],
})
export class DeckEditorComponent implements OnDestroy {
  readonly store = inject(DeckEditorStore);
  private readonly pageHeader = inject(PageHeaderStore);
  private readonly router = inject(Router);
  private readonly visualViewport = window.visualViewport ?? null;
  private readonly closeCardMenuOnViewportChange = () => this.store.closeCardMenu();

  constructor() {
    this.visualViewport?.addEventListener('resize', this.closeCardMenuOnViewportChange);
    this.visualViewport?.addEventListener('scroll', this.closeCardMenuOnViewportChange);
    effect(() => {
      const deck = this.store.deck();
      if (!deck) {
        this.pageHeader.set({
          title: 'Deck editor',
          actions: [this.backToDecksAction()],
        });
        return;
      }

      this.pageHeader.set({
        title: deck.name,
        titleWarning: this.store.hasDeckIssues()
          ? {
            icon: 'triangle-alert',
            label: 'Deck warnings',
            tooltip: this.store.deckIssueTooltip(),
            tone: 'danger',
          }
          : undefined,
        actions: [
          this.backToDecksAction(),
          {
            id: 'import-deck',
            label: 'Import',
            icon: 'upload',
            iconOnly: true,
            tooltip: 'Import',
            variant: 'primary',
            execute: () => this.store.openImportModal(),
          },
          {
            id: 'export-deck',
            label: 'Export',
            icon: 'file-down',
            iconOnly: true,
            tooltip: 'Export',
            variant: 'secondary',
            execute: () => this.store.exportDeck(deck),
          },
        ],
      });
    });
  }

  @HostListener('document:click')
  handleDocumentClick(): void {
    this.store.closeCardMenu();
  }

  @HostListener('window:scroll')
  handleWindowScroll(): void {
    if (window.innerWidth <= 720 || window.innerHeight <= 640) {
      this.store.closeCardMenu();
    }
  }

  @HostListener('window:resize')
  handleWindowResize(): void {
    this.store.closeCardMenu();
  }

  @HostListener('window:wheel', ['$event'])
  handleWindowWheel(event: WheelEvent): void {
    if (event.ctrlKey) {
      this.store.closeCardMenu();
    }
  }

  ngOnDestroy(): void {
    this.visualViewport?.removeEventListener('resize', this.closeCardMenuOnViewportChange);
    this.visualViewport?.removeEventListener('scroll', this.closeCardMenuOnViewportChange);
    this.pageHeader.clear();
    this.store.destroy();
  }

  private backToDecksAction() {
    return {
      id: 'back-to-decks',
      label: 'Back to decks',
      icon: 'arrow-left',
      variant: 'secondary' as const,
      execute: () => {
        void this.router.navigate(['/decks']);
      },
    };
  }
}
