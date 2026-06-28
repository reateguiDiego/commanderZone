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
import { type DeckEditorTab, DeckEditorViewMode } from '../models/deck-editor.models';
import { DeckAnalysisPanelComponent } from './deck-analysis-panel/deck-analysis-panel.component';
import { DeckCardMenuComponent } from './deck-card-menu/deck-card-menu.component';
import { DeckCardSpoilerViewComponent } from './deck-card-spoiler-view/deck-card-spoiler-view.component';
import { DeckCardTextViewComponent } from './deck-card-text-view/deck-card-text-view.component';
import { runDeckFaceToggleAnimation } from './deck-face-toggle-animation';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';
import { GlobalLoaderComponent } from '../../../shared/ui/global-loader/global-loader.component';
import { TabListComponent, type TabListItem } from '../../../shared/ui/tab-list/tab-list.component';
import { TooltipComponent } from '../../../shared/ui/tooltip/tooltip.component';
import { CardFaceImageComponent } from '../../../shared/components/card-face-image/card-face-image.component';
import { DECK_VIEW_STORE } from './deck-view-store.token';
import { DECK_ANALYSIS_STORE } from './deck-analysis-panel/deck-analysis-store.token';

@Component({
  selector: 'app-deck-editor',
  imports: [
    RuntimeTranslatePipe,
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
    CzButtonDirective,
    GlobalLoaderComponent,
    TabListComponent,
    TooltipComponent,
    CardFaceImageComponent,
  ],
  templateUrl: './deck-editor.component.html',
  styleUrl: './deck-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    DeckCardImageCache,
    DeckEditorStore,
    { provide: DECK_VIEW_STORE, useExisting: DeckEditorStore },
    { provide: DECK_ANALYSIS_STORE, useExisting: DeckEditorStore },
  ],
})
export class DeckEditorComponent implements OnDestroy {
  readonly store = inject(DeckEditorStore);
  readonly actionError = signal<string | null>(null);
  readonly shareCopied = signal(false);
  readonly viewModeMenuOpen = signal(false);
  readonly viewModeOptions: ReadonlyArray<{ value: DeckEditorViewMode; labelKey: string }> = [
    { value: 'text', labelKey: 'deckBuilder.deckEditor.text' },
    { value: 'spoiler', labelKey: 'deckBuilder.deckEditor.spoiler' },
  ];
  readonly tabItems = computed<readonly TabListItem[]>(() => {
    const items: TabListItem[] = [
      { id: 'analysis', label: 'deckBuilder.deckEditor.analysis', icon: 'bar-chart-3' },
      { id: 'considering', label: 'deckBuilder.deckEditor.considering', icon: 'layers-3' },
      { id: 'validation', label: 'deckBuilder.deckEditor.validation', icon: 'shield-check' },
    ];

    if (this.store.hasMissingContent()) {
      items.push({ id: 'missing', label: 'deckBuilder.deckEditor.missing', icon: 'search-x' });
    }

    items.push({ id: 'history', label: 'deckBuilder.deckEditor.history', icon: 'history' });

    return items;
  });
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
  private copiedShareHandle?: number;
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
      const shareCopied = this.shareCopied();
      if (!deck) {
      this.pageHeader.set({
        context: 'deck-editor',
        title: 'deckBuilder.deckEditor.header.title',
        heroRule: true,
        actions: [this.backToDecksAction()],
      });
      return;
      }

      this.pageHeader.set({
        context: 'deck-editor',
        title: deck.name,
        heroRule: true,
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
          ...(deck.visibility === 'public'
            ? [{
              id: 'share-deck',
              label: 'deckBuilder.deckEditor.header.share',
              icon: 'link',
              iconOnly: true,
              tooltip: 'deckBuilder.deckEditor.header.share',
              variant: 'secondary' as const,
              execute: () => {
                void this.copyCommunityDeckLink(deck.id);
              },
            }]
            : []),
        ],
        actionFeedback: shareCopied
          ? {
            message: 'deckBuilder.deckEditor.header.shareCopied',
            tone: 'success',
          }
          : null,
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

  selectDeckTab(tab: string): void {
    if (isDeckEditorTab(tab)) {
      this.store.activeTab.set(tab);
    }
  }

  showCardPreview(event: MouseEvent, card: Card): void {
    this.store.showCardPreview(event, card);
  }

  hideCardPreview(): void {
    this.store.hideCardPreview();
  }

  isBattlePreviewCard(card: Card): boolean {
    return (this.store.displayCardTypeLine(card) ?? '').trim().toLowerCase().startsWith('battle');
  }

  toggleCardFace(event: MouseEvent, card: Card): void {
    event.preventDefault();
    event.stopPropagation();
    this.store.toggleCardFace(event, card);
    runDeckFaceToggleAnimation(event.currentTarget, 'text-preview');
  }

  ngOnDestroy(): void {
    if (this.copiedShareHandle !== undefined) {
      window.clearTimeout(this.copiedShareHandle);
    }
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
      label: 'common.navigation.back',
      isBack: true,
      variant: 'secondary' as const,
      execute: () => {
        void this.router.navigate(['/decks']);
      },
    };
  }

  private async copyCommunityDeckLink(deckId: string): Promise<void> {
    try {
      this.actionError.set(null);
      await navigator.clipboard.writeText(`${window.location.origin}/community/decks/${deckId}`);
      this.shareCopied.set(true);
      if (this.copiedShareHandle !== undefined) {
        window.clearTimeout(this.copiedShareHandle);
      }
      this.copiedShareHandle = window.setTimeout(() => {
        this.copiedShareHandle = undefined;
        this.shareCopied.set(false);
      }, 5000);
    } catch {
      this.actionError.set('deckBuilder.deckEditor.header.shareError');
    }
  }
}

function isDeckEditorTab(tab: string): tab is DeckEditorTab {
  return tab === 'analysis'
    || tab === 'considering'
    || tab === 'validation'
    || tab === 'missing'
    || tab === 'history';
}
