import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { DecksApi } from '../../../core/api/decks.api';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { Card } from '../../../core/models/card.model';
import { CardPreviewItem } from '../../../core/models/card-preview.model';
import { Deck, DeckSection } from '../../../core/models/deck.model';
import { AppModalComponent } from '../../ui/app-modal/app-modal.component';
import { FormatSelectComponent, FormatSelectOption } from '../format-select/format-select.component';
import { ManaSymbolsComponent } from '../../mana/mana-symbols/mana-symbols.component';
import { GlobalLoaderComponent } from '../../ui/global-loader/global-loader.component';
import { formatLabel } from '../../utils/card-details';
import { bestCardArtImage } from '../../utils/card-image';
import { isCommanderCandidate } from '../../utils/commander-candidate';
import { commanderColorIdentityUnion, commanderNames, primaryCommander, secondaryCommander } from '../../utils/deck-commander';

interface DeckSectionOption {
  readonly id: DeckSection;
  readonly labelKey: string;
}

interface AddToDeckWarning {
  readonly labelKey: string;
  readonly params: Record<string, string>;
  readonly colorSymbols?: readonly string[];
}

interface SelectedDeckPreview {
  readonly name: string;
  readonly commanderNames: readonly string[];
  readonly colorIdentity: readonly string[];
  readonly primaryArt: string | null;
  readonly secondaryArt: string | null;
}

@Component({
  selector: 'app-add-card-to-deck-modal',
  imports: [
    AppModalComponent,
    FormatSelectComponent,
    GlobalLoaderComponent,
    ManaSymbolsComponent,
    RuntimeTranslatePipe,
  ],
  templateUrl: './add-card-to-deck-modal.component.html',
  styleUrl: './add-card-to-deck-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddCardToDeckModalComponent {
  private readonly cardsApi = inject(CardsApi);
  private readonly decksApi = inject(DecksApi);
  private activeCardKey: string | null = null;

  readonly open = input(false);
  readonly card = input<Card | CardPreviewItem | null>(null);
  readonly closeRequested = output<void>();

  readonly resolvedCard = signal<Card | null>(null);
  readonly decks = signal<Deck[]>([]);
  readonly loadingCard = signal(false);
  readonly loadingDecks = signal(false);
  readonly addingToDeck = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly selectedDeckId = signal('');
  readonly selectedDeckSection = signal<DeckSection | ''>('');
  readonly selectedDeckQuantity = signal(1);
  readonly selectedDeck = computed(() => this.decks().find((deck) => deck.id === this.selectedDeckId()) ?? null);
  readonly selectedDeckPreview = computed<SelectedDeckPreview | null>(() => {
    const deck = this.selectedDeck();
    if (!deck) {
      return null;
    }

    const primary = primaryCommander(deck);
    const secondary = secondaryCommander(deck);

    return {
      name: deck.name.trim(),
      commanderNames: commanderNames(deck),
      colorIdentity: commanderColorIdentityUnion(deck),
      primaryArt: bestCardArtImage(primary),
      secondaryArt: bestCardArtImage(secondary),
    };
  });
  readonly addToDeckSectionOptions = computed(() => this.deckSectionOptions(this.resolvedCard()));
  readonly deckSelectOptions = computed<readonly FormatSelectOption[]>(() => [
    { id: '', labelKey: 'deckBuilder.cards.cardSearch.addToDeck.selectDeck', disabled: true },
    ...this.decks().map((deck) => ({ id: deck.id, name: deck.name })),
  ]);
  readonly deckSectionSelectOptions = computed<readonly FormatSelectOption[]>(() => [
    { id: '', labelKey: 'deckBuilder.cards.cardSearch.addToDeck.selectSection', disabled: true },
    ...this.addToDeckSectionOptions().map((section) => ({ id: section.id, labelKey: section.labelKey })),
  ]);
  readonly addToDeckWarnings = computed(() => this.buildAddToDeckWarnings(
    this.selectedDeck(),
    this.resolvedCard(),
    this.selectedDeckSection(),
  ));
  readonly canAddToDeck = computed(() => (
    this.resolvedCard() !== null
    && this.selectedDeckId().trim() !== ''
    && this.selectedDeckSection() !== ''
    && this.selectedDeckQuantity() > 0
    && !this.loadingCard()
    && !this.loadingDecks()
    && !this.addingToDeck()
  ));
  readonly displayCardName = computed(() => this.card()?.name ?? this.resolvedCard()?.name ?? '');

  constructor() {
    effect(() => {
      const open = this.open();
      const card = this.card();

      if (!open || !card) {
        this.activeCardKey = null;
        this.resetFormState();
        this.resolvedCard.set(null);
        this.loadingCard.set(false);
        this.errorKey.set(null);
        return;
      }

      const nextKey = card.scryfallId;
      if (this.activeCardKey === nextKey) {
        return;
      }

      this.activeCardKey = nextKey;
      this.resetFormState();
      this.errorKey.set(null);
      void this.resolveCard(card);
      void this.loadDecksForModal();
    });
  }

  requestClose(): void {
    this.closeRequested.emit();
  }

  deckPreviewArt(imageUrl: string | null): string | null {
    return imageUrl ? `url("${imageUrl}")` : null;
  }

  selectDeck(value: string): void {
    this.selectedDeckId.set(value);
  }

  selectDeckSection(value: string): void {
    if (value === 'main' || value === 'commander' || value === 'sideboard' || value === 'maybeboard') {
      this.selectedDeckSection.set(value);
      return;
    }

    this.selectedDeckSection.set('');
  }

  selectDeckQuantity(event: Event): void {
    const target = event.target;
    const rawValue = target instanceof HTMLInputElement ? target.value : '';
    this.setDeckQuantity(rawValue);
    if (target instanceof HTMLInputElement) {
      target.value = String(this.selectedDeckQuantity());
    }
  }

  increaseDeckQuantity(): void {
    this.selectedDeckQuantity.update((quantity) => Math.min(99, quantity + 1));
  }

  decreaseDeckQuantity(): void {
    this.selectedDeckQuantity.update((quantity) => Math.max(1, quantity - 1));
  }

  async addSelectedCardToDeck(): Promise<void> {
    const card = this.resolvedCard();
    const deckId = this.selectedDeckId();
    const section = this.selectedDeckSection();
    if (!card || !deckId || section === '' || !this.canAddToDeck()) {
      return;
    }

    this.addingToDeck.set(true);
    this.errorKey.set(null);
    try {
      await firstValueFrom(this.decksApi.addCard(deckId, {
        scryfallId: card.scryfallId,
        quantity: this.selectedDeckQuantity(),
        section,
      }));
      this.closeRequested.emit();
    } catch {
      this.errorKey.set('deckBuilder.cards.cardSearch.addToDeck.couldNotAdd');
    } finally {
      this.addingToDeck.set(false);
    }
  }

  private async resolveCard(card: Card | CardPreviewItem): Promise<void> {
    if (this.isFullCard(card)) {
      this.resolvedCard.set(card);
      this.loadingCard.set(false);
      return;
    }

    this.loadingCard.set(true);
    this.resolvedCard.set(null);
    try {
      const response = await firstValueFrom(this.cardsApi.get(card.scryfallId));
      if (this.activeCardKey === card.scryfallId) {
        this.resolvedCard.set(response.card);
      }
    } catch {
      if (this.activeCardKey === card.scryfallId) {
        this.errorKey.set('deckBuilder.cards.cardSearch.addToDeck.couldNotAdd');
      }
    } finally {
      if (this.activeCardKey === card.scryfallId) {
        this.loadingCard.set(false);
      }
    }
  }

  private async loadDecksForModal(): Promise<void> {
    if (this.decks().length > 0 || this.loadingDecks()) {
      return;
    }

    this.loadingDecks.set(true);
    try {
      const response = await firstValueFrom(this.decksApi.list());
      this.decks.set(response.data);
    } catch {
      this.errorKey.set('deckBuilder.cards.cardSearch.addToDeck.couldNotLoadDecks');
    } finally {
      this.loadingDecks.set(false);
    }
  }

  private resetFormState(): void {
    this.selectedDeckId.set('');
    this.selectedDeckSection.set('');
    this.selectedDeckQuantity.set(1);
    this.addingToDeck.set(false);
  }

  private deckSectionOptions(card: Card | null): DeckSectionOption[] {
    const options: DeckSectionOption[] = [
      { id: 'main', labelKey: 'deckBuilder.cards.cardSearch.addToDeck.sectionMain' },
      { id: 'sideboard', labelKey: 'deckBuilder.cards.cardSearch.addToDeck.sectionSideboard' },
      { id: 'maybeboard', labelKey: 'deckBuilder.cards.cardSearch.addToDeck.sectionConsidering' },
    ];

    if (card && card.commanderLegal && isCommanderCandidate(card)) {
      options.splice(1, 0, { id: 'commander', labelKey: 'deckBuilder.cards.cardSearch.addToDeck.sectionCommander' });
    }

    return options;
  }

  private buildAddToDeckWarnings(deck: Deck | null, card: Card | null, section: DeckSection | ''): AddToDeckWarning[] {
    if (!deck || !card) {
      return [];
    }

    const warnings: AddToDeckWarning[] = [];
    const colorWarning = this.colorIdentityWarning(deck, card, section);
    if (colorWarning) {
      warnings.push(colorWarning);
    }

    const legalityWarning = this.formatLegalityWarning(deck, card);
    if (legalityWarning) {
      warnings.push(legalityWarning);
    }

    return warnings;
  }

  private colorIdentityWarning(deck: Deck, card: Card, section: DeckSection | ''): AddToDeckWarning | null {
    if (this.deckFormatKey(deck) !== 'commander' || section === 'sideboard' || section === 'commander') {
      return null;
    }

    const commanderColors = commanderColorIdentityUnion(deck);
    if (commanderColors.length === 0) {
      return null;
    }

    const allowedColors = new Set(commanderColors);
    const invalidColors = (card.colorIdentity ?? []).filter((color) => !allowedColors.has(color));
    if (invalidColors.length === 0) {
      return null;
    }

    return {
      labelKey: 'deckBuilder.cards.cardSearch.addToDeck.colorIdentityWarning',
      params: {
        card: card.name,
        deck: deck.name,
      },
      colorSymbols: invalidColors,
    };
  }

  private formatLegalityWarning(deck: Deck, card: Card): AddToDeckWarning | null {
    const format = this.deckFormatKey(deck);
    if (!format) {
      return null;
    }

    const legality = (card.legalities?.[format] ?? '').toLowerCase();
    const legal = format === 'commander'
      ? card.commanderLegal && legality === 'legal'
      : legality === 'legal';
    if (legal) {
      return null;
    }

    return {
      labelKey: 'deckBuilder.cards.cardSearch.addToDeck.formatLegalityWarning',
      params: {
        card: card.name,
        deck: deck.name,
        format: formatLabel(format),
      },
    };
  }

  private deckFormatKey(deck: Deck): string {
    return (deck.format ?? '').trim().toLowerCase();
  }

  private setDeckQuantity(value: string): void {
    const numericValue = value.replace(/\D+/g, '').slice(0, 2);
    const parsedValue = Number.parseInt(numericValue, 10);
    this.selectedDeckQuantity.set(Math.min(99, Math.max(1, Number.isFinite(parsedValue) ? parsedValue : 1)));
  }

  private isFullCard(card: Card | CardPreviewItem): card is Card {
    return 'commanderLegal' in card
      && 'legalities' in card
      && 'colorIdentity' in card
      && Array.isArray(card.colorIdentity);
  }
}
