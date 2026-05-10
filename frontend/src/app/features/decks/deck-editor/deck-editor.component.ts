import { ChangeDetectionStrategy, Component, HostListener, NgZone, OnDestroy, effect, inject } from '@angular/core';
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
  private readonly ngZone = inject(NgZone);
  private readonly visualViewport = window.visualViewport ?? null;
  private readonly closeOverlaysOnViewportChange = () => this.closeTransientOverlays();
  private readonly closeOverlaysOnDocumentWheel = (event: WheelEvent) => {
    if (event.ctrlKey) {
      this.closeTransientOverlays();
    }
  };
  private readonly closeOverlaysOnDocumentKeydown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && this.isZoomShortcut(event)) {
      this.closeTransientOverlays();
    }
  };
  private readonly closeOverlaysOnDocumentScroll = (event: Event) => {
    if (!this.isScrollInsideOverlay(event)) {
      this.closeTransientOverlays();
    }
  };
  private readonly zoomMonitorId: ReturnType<typeof setInterval>;
  private zoomSignature = this.currentZoomSignature();

  constructor() {
    this.visualViewport?.addEventListener('resize', this.closeOverlaysOnViewportChange);
    this.visualViewport?.addEventListener('scroll', this.closeOverlaysOnViewportChange);
    document.addEventListener('wheel', this.closeOverlaysOnDocumentWheel, { capture: true, passive: true });
    document.addEventListener('keydown', this.closeOverlaysOnDocumentKeydown, { capture: true });
    document.addEventListener('scroll', this.closeOverlaysOnDocumentScroll, { capture: true, passive: true });
    this.zoomMonitorId = window.setInterval(() => this.closeOverlaysAfterZoomChange(), 150);
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
    this.closeTransientOverlays();
  }

  @HostListener('window:scroll')
  handleWindowScroll(): void {
    this.closeTransientOverlays();
  }

  @HostListener('window:resize')
  handleWindowResize(): void {
    this.zoomSignature = this.currentZoomSignature();
    this.closeTransientOverlays();
  }

  @HostListener('window:wheel', ['$event'])
  handleWindowWheel(event: WheelEvent): void {
    if (event.ctrlKey) {
      this.closeTransientOverlays();
    }
  }

  @HostListener('document:keydown', ['$event'])
  handleDocumentKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && this.isZoomShortcut(event)) {
      this.closeTransientOverlays();
    }
  }

  ngOnDestroy(): void {
    this.visualViewport?.removeEventListener('resize', this.closeOverlaysOnViewportChange);
    this.visualViewport?.removeEventListener('scroll', this.closeOverlaysOnViewportChange);
    document.removeEventListener('wheel', this.closeOverlaysOnDocumentWheel, { capture: true });
    document.removeEventListener('keydown', this.closeOverlaysOnDocumentKeydown, { capture: true });
    document.removeEventListener('scroll', this.closeOverlaysOnDocumentScroll, { capture: true });
    window.clearInterval(this.zoomMonitorId);
    this.pageHeader.clear();
    this.store.destroy();
  }

  private closeTransientOverlays(): void {
    this.ngZone.run(() => this.store.closeTransientOverlays());
  }

  private closeOverlaysAfterZoomChange(): void {
    const current = this.currentZoomSignature();
    if (current === this.zoomSignature) {
      return;
    }

    this.zoomSignature = current;
    this.closeTransientOverlays();
  }

  private currentZoomSignature(): string {
    const viewport = this.visualViewport;

    return [
      window.devicePixelRatio,
      window.innerWidth,
      window.innerHeight,
      viewport?.scale ?? 1,
      viewport?.width ?? window.innerWidth,
      viewport?.height ?? window.innerHeight,
    ].join('|');
  }

  private isZoomShortcut(event: KeyboardEvent): boolean {
    return ['+', '-', '=', '0'].includes(event.key) || ['NumpadAdd', 'NumpadSubtract', 'Numpad0'].includes(event.code);
  }

  private isScrollInsideOverlay(event: Event): boolean {
    const target = event.target;
    if (!(target instanceof Element)) {
      return false;
    }

    return Boolean(target.closest('.card-menu-popover, .card-hover-preview, .analysis-hover-list'));
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
