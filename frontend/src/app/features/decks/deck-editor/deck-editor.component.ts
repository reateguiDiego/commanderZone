import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, HostListener, NgZone, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { Card } from '../../../core/models/card.model';
import { CardAutocompleteComponent } from '../../../shared/components/card-autocomplete/card-autocomplete.component';
import { ManaSymbolsComponent } from '../../../shared/mana/mana-symbols/mana-symbols.component';
import { AppModalComponent } from '../../../shared/ui/app-modal/app-modal.component';
import { DeckCardImageCache } from '../data-access/deck-card-image-cache.service';
import { DeckEditorStore } from '../data-access/deck-editor.store';
import { DeckEditorViewMode } from '../models/deck-editor.models';
import { DeckAnalysisPanelComponent } from './deck-analysis-panel/deck-analysis-panel.component';
import { DeckCardMenuComponent } from './deck-card-menu/deck-card-menu.component';
import { DeckCardSpoilerViewComponent } from './deck-card-spoiler-view/deck-card-spoiler-view.component';
import { DeckCardTextViewComponent } from './deck-card-text-view/deck-card-text-view.component';
import { runDeckFaceToggleAnimation } from './deck-face-toggle-animation';

@Component({
  selector: 'app-deck-editor',
  imports: [RuntimeTranslatePipe, 
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
  readonly viewModeMenuOpen = signal(false);
  readonly viewModeOptions: ReadonlyArray<{ value: DeckEditorViewMode; labelKey: string }> = [
    { value: 'text', labelKey: 'deckBuilder.deckEditor.text' },
    { value: 'spoiler', labelKey: 'deckBuilder.deckEditor.spoiler' },
  ];
  readonly selectedViewModeLabelKey = computed(() => (
    this.viewModeOptions.find((option) => option.value === this.store.viewMode())?.labelKey
    ?? 'deckBuilder.deckEditor.text'
  ));
  private readonly pageHeader = inject(PageHeaderStore);
  private readonly router = inject(Router);
  private readonly ngZone = inject(NgZone);
  private readonly visualViewport = window.visualViewport ?? null;
  private readonly closeOverlaysOnViewportChange = () => this.closeTransientUi();
  private readonly closeOverlaysOnDocumentWheel = (event: WheelEvent) => {
    if (event.ctrlKey) {
      this.closeTransientUi();
    }
  };
  private readonly closeOverlaysOnDocumentKeydown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && this.isZoomShortcut(event)) {
      this.closeTransientUi();
    }
  };
  private readonly closeOverlaysOnDocumentScroll = (event: Event) => {
    if (!this.isScrollInsideOverlay(event)) {
      this.closeTransientUi();
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
          title: 'deckBuilder.deckEditor.header.title',
          actions: [this.backToDecksAction()],
        });
        return;
      }

      this.pageHeader.set({
        title: deck.name,
        titleWarning: this.store.hasDeckIssues()
          ? {
            icon: 'triangle-alert',
            label: 'deckBuilder.deckEditor.header.deckWarnings',
            tooltip: this.store.deckIssueTooltip(),
            tone: 'danger',
          }
          : undefined,
        actions: [
          this.backToDecksAction(),
          {
            id: 'import-deck',
            label: 'deckBuilder.deckEditor.header.import',
            icon: 'upload',
            iconOnly: true,
            tooltip: 'deckBuilder.deckEditor.header.import',
            variant: 'primary',
            execute: () => this.store.openImportModal(),
          },
          {
            id: 'export-deck',
            label: 'deckBuilder.deckEditor.header.export',
            icon: 'file-down',
            iconOnly: true,
            tooltip: 'deckBuilder.deckEditor.header.export',
            variant: 'secondary',
            execute: () => this.store.exportDeck(deck),
          },
        ],
      });
    });
  }

  @HostListener('document:click')
  handleDocumentClick(): void {
    this.closeViewModeMenu();
    this.closeTransientOverlays();
  }

  @HostListener('window:scroll')
  handleWindowScroll(): void {
    this.closeViewModeMenu();
    this.closeTransientOverlays();
  }

  @HostListener('window:resize')
  handleWindowResize(): void {
    this.zoomSignature = this.currentZoomSignature();
    this.closeViewModeMenu();
    this.closeTransientOverlays();
  }

  @HostListener('window:wheel', ['$event'])
  handleWindowWheel(event: WheelEvent): void {
    if (event.ctrlKey) {
      this.closeViewModeMenu();
      this.closeTransientOverlays();
    }
  }

  @HostListener('document:keydown', ['$event'])
  handleDocumentKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.viewModeMenuOpen()) {
      this.closeViewModeMenu();
    }

    if ((event.ctrlKey || event.metaKey) && this.isZoomShortcut(event)) {
      this.closeViewModeMenu();
      this.closeTransientOverlays();
    }
  }

  toggleViewModeMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.store.closeTransientOverlays();
    this.viewModeMenuOpen.update((open) => !open);
  }

  selectViewMode(value: DeckEditorViewMode, event: MouseEvent): void {
    event.stopPropagation();
    this.store.viewMode.set(value);
    this.closeViewModeMenu();
    this.store.closeTransientOverlays();
  }

  showCardPreview(event: MouseEvent, card: Card): void {
    this.store.resetCardFace(card);
    this.store.showCardPreview(event, card);
  }

  hideCardPreview(card: Card): void {
    this.store.hideCardPreview();
    this.store.resetCardFace(card);
  }

  toggleCardFace(event: MouseEvent, card: Card): void {
    event.preventDefault();
    event.stopPropagation();
    this.store.toggleCardFace(event, card);
    runDeckFaceToggleAnimation(event.currentTarget, 'text-preview');
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

  private closeTransientUi(): void {
    this.closeViewModeMenu();
    this.closeTransientOverlays();
  }

  private closeViewModeMenu(): void {
    this.viewModeMenuOpen.set(false);
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
      label: 'deckBuilder.deckEditor.header.backToDecks',
      icon: 'arrow-left',
      variant: 'secondary' as const,
      execute: () => {
        void this.router.navigate(['/decks']);
      },
    };
  }
}
