import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { DecksApi, DeckCardMutationPayload } from '../../../core/api/decks.api';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { Card } from '../../../core/models/card.model';
import { AddCardToDeckModalComponent } from '../../../shared/components/add-card-to-deck-modal/add-card-to-deck-modal.component';
import { CommunityDeckDetail } from '../../../core/models/community.model';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { CardDetailsModalComponent } from '../../../shared/components/card-details-modal/card-details-modal.component';
import { CardPrintingsModalComponent } from '../../../shared/components/card-printings-modal/card-printings-modal.component';
import { AppModalComponent } from '../../../shared/ui/app-modal/app-modal.component';
import { DeckViewerComponent } from '../components/deck-viewer/deck-viewer.component';
import { HeroRuleComponent } from '../../../shared/ui/hero-rule/hero-rule.component';
import { CommunityDeckInspectorComponent } from '../components/deck-inspector/community-deck-inspector.component';
import { CommunityCacheService } from '../data-access/community-cache.service';
import { GlobalLoaderComponent } from '../../../shared/ui/global-loader/global-loader.component';
import { DeckImportExportService } from '../../decks/services/deck-import-export.service';
import { CommunityDeckCardActionEvent, CommunityDeckViewerStore } from '../components/deck-viewer/community-deck-viewer.store';
import { DECK_VIEW_STORE } from '../../decks/deck-editor/deck-view-store.token';
import { DECK_ANALYSIS_STORE } from '../../decks/deck-editor/deck-analysis-panel/deck-analysis-store.token';

interface CardDetailsDialogState {
  readonly title: string;
  readonly card: Card | null;
  readonly loading: boolean;
  readonly errorKey: string | null;
}

interface CardPrintingsDialogState {
  readonly title: string;
  readonly printings: readonly Card[];
  readonly loading: boolean;
  readonly errorKey: string | null;
}

@Component({
  selector: 'app-community-deck-detail-page',
  imports: [
    RuntimeTranslatePipe,
    AddCardToDeckModalComponent,
    HeroRuleComponent,
    DeckViewerComponent,
    CommunityDeckInspectorComponent,
    GlobalLoaderComponent,
    AppModalComponent,
    CardDetailsModalComponent,
    CardPrintingsModalComponent,
  ],
  templateUrl: './community-deck-detail-page.component.html',
  styleUrl: './community-deck-detail-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    CommunityDeckViewerStore,
    { provide: DECK_VIEW_STORE, useExisting: CommunityDeckViewerStore },
    { provide: DECK_ANALYSIS_STORE, useExisting: CommunityDeckViewerStore },
  ],
})
export class CommunityDeckDetailPageComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cache = inject(CommunityCacheService);
  private readonly cardsApi = inject(CardsApi);
  private readonly decksApi = inject(DecksApi);
  private readonly pageHeader = inject(PageHeaderStore);
  private readonly importExport = inject(DeckImportExportService);
  private readonly deckViewerStore = inject(CommunityDeckViewerStore);
  private readonly deckId = this.route.snapshot.paramMap.get('id');
  private copiedShareHandle?: number;

  readonly deck = signal<CommunityDeckDetail | null>(this.deckId ? (this.cache.peekDeck(this.deckId)?.deck ?? null) : null);
  readonly loading = signal(this.deck() === null);
  readonly error = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly shareCopied = signal(false);
  readonly saveConfirmationModalOpen = signal(false);
  readonly saveSuccessModalOpen = signal(false);
  readonly savedDeckId = signal<string | null>(null);
  readonly addToDeckCard = signal<Card | null>(null);
  readonly detailsDialog = signal<CardDetailsDialogState | null>(null);
  readonly printingsDialog = signal<CardPrintingsDialogState | null>(null);
  constructor() {
    effect(() => {
      const deck = this.deck();
      const saving = this.saving();
      if (deck) {
        this.deckViewerStore.setDeck(deck);
      }

      this.pageHeader.set({
        context: 'community-deck-detail',
        title: deck?.name ?? 'community.detail.headerTitle',
        sharedBy: deck
          ? {
            displayName: deck.owner.displayName,
          }
          : null,
        actions: [
          this.backToCommunityDecksAction(),
          ...(deck
            ? [
              {
                id: 'save-deck',
                label: 'community.detail.save',
                icon: 'save',
                tooltip: 'community.detail.save',
                disabled: saving,
                variant: 'primary' as const,
                execute: () => {
                  this.openSaveConfirmation();
                },
              },
              {
                id: 'export-deck',
                label: 'deckBuilder.deckEditor.header.export',
                icon: 'file-down',
                iconOnly: true,
                tooltip: 'deckBuilder.deckEditor.header.export',
                variant: 'secondary' as const,
                execute: () => this.exportDeck(),
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
            ]
            : []),
        ],
        actionFeedback: this.shareCopied()
          ? {
            message: 'deckBuilder.deckEditor.header.shareCopied',
            tone: 'success',
          }
          : null,
      });
    });
    void this.load();
  }

  ngOnDestroy(): void {
    if (this.copiedShareHandle !== undefined) {
      window.clearTimeout(this.copiedShareHandle);
    }
    this.deckViewerStore.destroy();
    this.pageHeader.clear();
  }

  private async load(): Promise<void> {
    if (this.deck() !== null) {
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    const id = this.deckId;

    if (!id) {
      this.error.set('community.detail.missingId');
      this.loading.set(false);
      return;
    }

    try {
      const response = await this.cache.deck(id);
      this.deck.set(response.deck);
    } catch (error) {
      if (error instanceof HttpErrorResponse && (error.status === 403 || error.status === 404)) {
        await this.router.navigateByUrl('/404', { replaceUrl: true });
        return;
      }

      this.error.set('community.detail.error');
    } finally {
      this.loading.set(false);
    }
  }

  exportDeck(): void {
    const deck = this.deck();
    if (!deck) {
      return;
    }

    this.importExport.downloadDeck(deck);
  }

  openSaveConfirmation(): void {
    if (!this.deck() || this.saving()) {
      return;
    }

    this.actionError.set(null);
    this.saveConfirmationModalOpen.set(true);
  }

  closeSaveConfirmation(): void {
    this.saveConfirmationModalOpen.set(false);
  }

  async confirmSaveDeck(): Promise<void> {
    this.closeSaveConfirmation();
    await this.saveDeck();
  }

  async saveDeck(): Promise<void> {
    const deck = this.deck();
    if (!deck || this.saving()) {
      return;
    }

    this.actionError.set(null);
    this.saving.set(true);
    try {
      const response = await firstValueFrom(this.decksApi.quickBuild({
        name: deck.name,
        format: deck.format,
        visibility: 'private',
        cards: this.buildCloneCards(deck),
      }));
      this.savedDeckId.set(response.deck.id);
      this.saveSuccessModalOpen.set(true);
    } catch {
      this.actionError.set('community.detail.saveError');
    } finally {
      this.saving.set(false);
    }
  }

  closeSaveSuccessModal(): void {
    this.saveSuccessModalOpen.set(false);
    this.savedDeckId.set(null);
  }

  async handleCardAction(event: CommunityDeckCardActionEvent): Promise<void> {
    switch (event.action) {
      case 'details':
        await this.openDetails(event.card.scryfallId, event.card.name);
        return;
      case 'addToDeck':
        this.addToDeckCard.set(event.card);
        return;
      case 'printings':
        await this.openPrintings(event.card.scryfallId, event.card.name);
        return;
      case 'rulings':
        this.openRulings(event.card);
        return;
    }
  }

  closeDetails(): void {
    this.detailsDialog.set(null);
  }

  closeAddToDeck(): void {
    this.addToDeckCard.set(null);
  }

  closePrintings(): void {
    this.printingsDialog.set(null);
  }

  openCreatedDeckFromSuccess(): void {
    const deckId = this.savedDeckId();
    this.closeSaveSuccessModal();
    if (deckId) {
      void this.router.navigate(['/decks', deckId]);
    }
  }

  returnToDeckListFromSuccess(): void {
    this.closeSaveSuccessModal();
    void this.router.navigate(['/decks']);
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
      this.actionError.set('community.detail.shareError');
    }
  }

  private buildCloneCards(deck: CommunityDeckDetail): DeckCardMutationPayload[] {
    return (deck.cards ?? []).map((entry) => ({
      scryfallId: entry.card.scryfallId,
      quantity: entry.quantity,
      section: entry.section,
    }));
  }

  private async openDetails(scryfallId: string, name: string): Promise<void> {
    this.detailsDialog.set({
      title: name,
      card: null,
      loading: true,
      errorKey: null,
    });

    try {
      const response = await firstValueFrom(this.cardsApi.get(scryfallId));
      this.detailsDialog.set({
        title: response.card.name || name,
        card: response.card,
        loading: false,
        errorKey: null,
      });
    } catch {
      this.detailsDialog.update((state) => state ? {
        ...state,
        loading: false,
        errorKey: 'deckBuilder.cards.cardSearch.details.couldNotLoad',
      } : state);
    }
  }

  private async openPrintings(scryfallId: string, name: string): Promise<void> {
    this.printingsDialog.set({
      title: name,
      printings: [],
      loading: true,
      errorKey: null,
    });

    try {
      const response = await firstValueFrom(this.cardsApi.printings(scryfallId));
      this.printingsDialog.set({
        title: name,
        printings: response.data,
        loading: false,
        errorKey: null,
      });
    } catch {
      this.printingsDialog.update((state) => state ? {
        ...state,
        loading: false,
        errorKey: 'deckBuilder.cards.cardSearch.printings.couldNotLoad',
      } : state);
    }
  }

  private openRulings(card: Card): void {
    const set = card.set?.trim();
    const collectorNumber = card.collectorNumber?.trim();
    if (set && collectorNumber) {
      window.open(
        `https://scryfall.com/card/${encodeURIComponent(set)}/${encodeURIComponent(collectorNumber)}?utm_source=commanderzone#rulings`,
        '_blank',
        'noopener,noreferrer',
      );
      return;
    }

    window.open(
      `https://scryfall.com/search?q=!%22${encodeURIComponent(card.name)}%22&utm_source=commanderzone`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  private backToCommunityDecksAction() {
    return {
      id: 'back-to-community-decks',
      label: 'common.navigation.back',
      isBack: true,
      variant: 'secondary' as const,
      execute: () => {
        void this.router.navigate(['/community/decks']);
      },
    };
  }
}
