import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { DecksApi } from '../../../core/api/decks.api';
import { MissingDeckCard } from '../../../core/models/api-responses.model';
import { Card } from '../../../core/models/card.model';
import { CommanderValidation, Deck, DeckCard, DeckSection, DeckToken, UnresolvedDeckToken } from '../../../core/models/deck.model';
import { DeckCardImageCache } from './deck-card-image-cache.service';
import { DeckHistoryEntry, DeckHistoryStore } from './deck-history.store';
import { MissingCardsStore } from './missing-cards.store';
import { ClientCommanderValidationService } from '../services/client-commander-validation.service';
import { DeckAnalysisService } from '../services/deck-analysis.service';
import { DeckImportExportService, DecklistEntry } from '../services/deck-import-export.service';
import {
  CardMenuState,
  CardPreviewState,
  DeckCardColumn,
  DeckCardGroup,
  DeckEditorTab,
  DeckEditorViewMode,
  HoverListState,
  ImportStats,
  MissingCardItem,
  MissingSearchResult,
  PointerPosition,
} from '../models/deck-editor.models';

const GROUPS: Array<{ id: string; title: string; matcher: (entry: DeckCard) => boolean }> = [
  { id: 'commander', title: 'Comandante', matcher: (entry) => entry.section === 'commander' },
  { id: 'planeswalker', title: 'Planeswalkers', matcher: (entry) => hasMaindeckType(entry, 'planeswalker') },
  { id: 'creature', title: 'Criaturas', matcher: (entry) => hasMaindeckType(entry, 'creature') },
  { id: 'instant', title: 'Instantaneos', matcher: (entry) => hasMaindeckType(entry, 'instant') },
  { id: 'sorcery', title: 'Conjuros', matcher: (entry) => hasMaindeckType(entry, 'sorcery') },
  { id: 'enchantment', title: 'Encantamientos', matcher: (entry) => hasMaindeckType(entry, 'enchantment') },
  { id: 'artifact', title: 'Artefactos', matcher: (entry) => hasMaindeckType(entry, 'artifact') },
  { id: 'battle', title: 'Battles', matcher: (entry) => hasMaindeckType(entry, 'battle') },
  { id: 'land', title: 'Tierras', matcher: (entry) => hasMaindeckType(entry, 'land') },
  { id: 'sideboard', title: 'Banquillo', matcher: (entry) => entry.section === 'sideboard' },
];

@Injectable()
export class DeckEditorStore {
  private readonly decksApi = inject(DecksApi);
  private readonly cardsApi = inject(CardsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly importExport = inject(DeckImportExportService);
  private readonly analysisService = inject(DeckAnalysisService);
  private readonly clientValidation = inject(ClientCommanderValidationService);
  private readonly historyStore = inject(DeckHistoryStore);
  private readonly imageCache = inject(DeckCardImageCache);
  readonly missingStore = inject(MissingCardsStore);

  readonly deck = signal<Deck | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly missing = signal<string[]>([]);
  readonly missingSourceEntries = signal<MissingDeckCard[]>([]);
  readonly missingSearch = signal<MissingSearchResult | null>(null);
  readonly missingAddTarget = signal<string | null>(null);
  readonly tokens = signal<DeckToken[]>([]);
  readonly unresolvedTokens = signal<UnresolvedDeckToken[]>([]);
  readonly lastImportStats = signal<ImportStats | null>(null);
  readonly validation = signal<CommanderValidation | null>(null);
  readonly activeTab = signal<DeckEditorTab>('analysis');
  readonly viewMode = signal<DeckEditorViewMode>('text');
  readonly importModalOpen = signal(false);
  readonly restoreModalOpen = signal(false);
  readonly clearHistoryModalOpen = signal(false);
  readonly restoreTarget = signal<DeckHistoryEntry | null>(null);
  readonly history = signal<DeckHistoryEntry[]>([]);
  readonly cardPreview = signal<CardPreviewState | null>(null);
  readonly hoverList = signal<HoverListState | null>(null);
  readonly cardMenu = signal<CardMenuState | null>(null);
  readonly collapsedGroups = signal<Set<string>>(new Set());
  readonly flippedFaces = signal<Record<string, boolean>>({});
  readonly mainCards = computed(() => this.cardsBySection('main'));
  readonly commanderCards = computed(() => this.cardsBySection('commander'));
  readonly sideboardCards = computed(() => this.cardsBySection('sideboard'));
  readonly consideringCards = computed(() => this.cardsBySection('maybeboard'));
  readonly totalCards = computed(() => (this.deck()?.cards ?? [])
    .filter((entry) => entry.section !== 'maybeboard')
    .reduce((total, entry) => total + entry.quantity, 0));
  readonly analysis = computed(() => this.analysisService.analyze(this.deck()));
  readonly clientIssues = computed(() => this.clientValidation.validate(this.deck()));
  readonly backendErrorMessages = computed(() => {
    const validation = this.validation();
    if (!validation) {
      return [];
    }

    return validation.errors.map((entry) => this.formatValidationEntry(entry));
  });
  readonly backendWarningMessages = computed(() => {
    const validation = this.validation();
    if (!validation) {
      return [];
    }

    return validation.warnings.map((entry) => this.formatValidationEntry(entry));
  });
  readonly deckIssueTooltip = computed(() => this.backendErrorMessages().join('\n'));
  readonly hasDeckIssues = computed(() => this.backendErrorMessages().length > 0);
  readonly hasMissingContent = computed(() => (
    this.missingItems().length > 0
    || this.missingSearch() !== null
    || this.missingStore.watchlist().length > 0
  ));
  readonly visibleActiveTab = computed<DeckEditorTab>(() => (
    this.activeTab() === 'missing' && !this.hasMissingContent() ? 'analysis' : this.activeTab()
  ));
  readonly typeMetrics = computed(() => {
    const analysis = this.analysis();
    return [
      analysis.lands,
      analysis.planeswalkers,
      analysis.creatures,
      analysis.instants,
      analysis.sorceries,
      analysis.enchantments,
      analysis.artifacts,
    ];
  });
  readonly utilityMetrics = computed(() => {
    const analysis = this.analysis();
    return [analysis.ramp, analysis.draw, analysis.removal, analysis.wipes];
  });
  readonly visibleTypeMetrics = computed(() => this.typeMetrics().filter((metric) => metric.count > 0));
  readonly visibleUtilityMetrics = computed(() => this.utilityMetrics().filter((metric) => metric.count > 0));
  readonly manaSourceProfiles = computed(() => this.buildManaSourceProfiles());
  readonly manaSourceTotal = computed(() => this.manaSourceProfiles().reduce((sum, profile) => sum + profile.sourceCount, 0));
  readonly manaSourceDonutBackground = computed(() => this.buildManaSourceDonutBackground());
  readonly missingItems = computed(() => this.buildMissingItems());
  readonly cardGroups = computed(() => this.buildCardGroups());
  readonly cardColumns = computed(() => this.buildCardColumns());

  deckName = '';
  decklist = '';
  missingSearchQuery = '';
  private previewEnterTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastPreviewPointer: PointerPosition | null = null;

  constructor() {
    void this.load();
  }

  destroy(): void {
    if (this.previewEnterTimeout) {
      clearTimeout(this.previewEnterTimeout);
    }
    this.imageCache.clear();
  }

  closeCardMenu(): void {
    this.cardMenu.set(null);
  }

  async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Missing deck id.');
      this.loading.set(false);
      return;
    }

    try {
      const [response, tokensResponse] = await Promise.all([
        firstValueFrom(this.decksApi.get(id)),
        firstValueFrom(this.decksApi.tokens(id)),
      ]);
      this.deck.set(response.deck);
      this.deckName = response.deck.name;
      this.tokens.set(tokensResponse.data);
      this.unresolvedTokens.set(tokensResponse.unresolved);
      this.missing.set([]);
      this.missingSourceEntries.set([]);
      this.refreshHistory(response.deck.id);
      void this.refreshBackendValidation(response.deck.id);
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not load deck.'));
    } finally {
      this.loading.set(false);
    }
  }

  async rename(id: string): Promise<void> {
    try {
      const response = await firstValueFrom(this.decksApi.rename(id, this.deckName.trim()));
      this.deck.set(response.deck);
      this.deckName = response.deck.name;
      this.recordHistory(response.deck, 'Rename');
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not rename deck.'));
    }
  }

  async importDeck(id: string): Promise<void> {
    try {
      const entries = this.importExport.parse(this.decklist, 'plain');
      const response = await firstValueFrom(this.decksApi.importDecklist(id, this.importExport.toBackendDecklist(entries)));
      this.deck.set(response.deck);
      this.missing.set(response.missing);
      this.missingSourceEntries.set(response.missingCards ?? []);
      this.lastImportStats.set({
        parsedCards: response.summary?.parsedCards ?? entries.reduce((total, entry) => total + entry.quantity, 0),
        importedCards: response.summary?.importedCards ?? (response.deck.cards ?? []).reduce((total, entry) => total + entry.quantity, 0),
        missingCards: response.missing.length,
      });
      this.validation.set(null);
      this.missingSearch.set(null);
      this.recordHistory(response.deck, 'Import plain text');
      void this.refreshTokens(response.deck.id);
      void this.refreshBackendValidation(response.deck.id);
      if (response.missing.length > 0) {
        this.activeTab.set('missing');
      } else {
        this.importModalOpen.set(false);
      }
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not import deck.'));
    }
  }

  async validate(id: string): Promise<void> {
    await this.refreshBackendValidation(id, true);
  }

  loadDeckFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      this.decklist = String(reader.result ?? '');
      input.value = '';
    };
    reader.readAsText(file);
  }

  openImportModal(): void {
    this.importModalOpen.set(true);
  }

  closeImportModal(): void {
    this.importModalOpen.set(false);
  }

  toggleGroup(groupId: string): void {
    const next = new Set(this.collapsedGroups());
    if (next.has(groupId)) {
      next.delete(groupId);
    } else {
      next.add(groupId);
    }
    this.collapsedGroups.set(next);
  }

  isGroupCollapsed(groupId: string): boolean {
    return this.collapsedGroups().has(groupId);
  }

  curveSegmentHeight(count: number): number {
    const max = Math.max(...this.analysis().manaCurve.map((bucket) => bucket.total), 1);
    return Math.max((count / max) * 100, count > 0 ? 12 : 0);
  }

  curveHoverTitle(manaValue: number, label: string): string {
    return `${label} - MV ${manaValue === 7 ? '7+' : manaValue}`;
  }

  curveHoverItems(manaValue: number, kind: 'permanent' | 'spell'): string[] {
    const entries = (this.deck()?.cards ?? [])
      .filter((entry) => entry.section === 'main')
      .filter((entry) => Math.min(this.cardManaValue(entry.card), 7) === manaValue)
      .filter((entry) => kind === 'spell' ? this.isSpellEntry(entry) : !this.isSpellEntry(entry))
      .map((entry) => entry.card.name);

    return Array.from(new Set(entries)).sort((left, right) => left.localeCompare(right));
  }

  copyMissing(name: string): void {
    void navigator.clipboard?.writeText(name);
  }

  async searchMissing(name: string): Promise<void> {
    this.missingAddTarget.set(name);
    this.missingSearchQuery = name;
    await this.searchMissingQuery();
  }

  async searchMissingQuery(): Promise<void> {
    const query = this.missingSearchQuery.trim();
    if (!query) {
      return;
    }

    try {
      const response = await firstValueFrom(this.cardsApi.search(query, 1, 8));
      this.missingSearch.set({ name: query, cards: response.data });
    } catch {
      this.missingSearch.set({ name: query, cards: [] });
    }
  }

  saveMissing(name: string, deckId: string): void {
    this.missingStore.add(name, deckId);
  }

  async addMissingCard(missingName: string, card: Card): Promise<void> {
    const currentDeck = this.deck();
    if (!currentDeck) {
      return;
    }

    const targetName = this.missingAddTarget() ?? missingName;
    const sourceEntries = this.missingSourceEntries().filter((entry) => entry.name.toLowerCase() === targetName.toLowerCase());
    const quantity = sourceEntries.reduce((total, entry) => total + entry.quantity, 0) || 1;
    const section = (sourceEntries.find((entry) => entry.section === 'commander')?.section
      ?? sourceEntries.find((entry) => entry.section === 'sideboard')?.section
      ?? sourceEntries.find((entry) => entry.section === 'maybeboard')?.section
      ?? sourceEntries[0]?.section
      ?? 'main') as DeckSection;

    try {
      const response = await firstValueFrom(this.decksApi.addCard(currentDeck.id, {
        scryfallId: card.scryfallId,
        quantity,
        section,
      }));
      this.deck.set(response.deck);
      this.missing.set(this.missing().filter((name) => name !== targetName));
      this.missingSourceEntries.set(this.missingSourceEntries().filter((entry) => entry.name.toLowerCase() !== targetName.toLowerCase()));
      this.validation.set(null);
      this.recordHistory(response.deck, `Manual add ${card.name}`);
      void this.refreshBackendValidation(response.deck.id);
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not add selected card.'));
    }
  }

  addSearchedCard(card: Card, amount: number): void {
    void this.addSearchedCardInternal(card, amount);
  }

  missingPreview(): string {
    const items = this.missingItems();
    const preview = items.slice(0, 6).map((item) => `${item.quantity} ${item.name}`).join(', ');
    return items.length > 6 ? `${preview}...` : preview;
  }

  ignoreMissing(name: string): void {
    this.missingStore.ignoreForSession(name);
    this.missing.set([...this.missing()]);
  }

  recordHistory(deck: Deck, source: string): void {
    this.historyStore.record(deck, source);
    this.refreshHistory(deck.id);
  }

  restoreHistory(entry: DeckHistoryEntry): void {
    this.restoreTarget.set(entry);
    this.restoreModalOpen.set(true);
  }

  async confirmRestoreHistory(deckId: string): Promise<void> {
    const entry = this.restoreTarget();
    const current = this.deck();
    if (!current || !entry) {
      return;
    }

    try {
      this.historyStore.record(current, 'Before restore');
      const response = await firstValueFrom(this.decksApi.importDecklist(deckId, entry.decklist));
      this.deck.set(response.deck);
      this.deckName = response.deck.name;
      this.missing.set(response.missing);
      this.missingSourceEntries.set(response.missingCards ?? []);
      this.missingSearch.set(null);
      this.validation.set(null);
      this.refreshHistory(deckId);
      void this.refreshTokens(deckId);
      void this.refreshBackendValidation(deckId);
      this.restoreModalOpen.set(false);
      this.restoreTarget.set(null);
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not restore history entry.'));
    }
  }

  confirmClearHistory(deckId: string): void {
    this.historyStore.clear(deckId);
    this.refreshHistory(deckId);
    this.clearHistoryModalOpen.set(false);
  }

  formatDate(value: string): string {
    return new Intl.DateTimeFormat('en', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  }

  isCardInvalidForDeck(card: Card): boolean {
    const format = this.deckFormatKey();
    const legality = (card.legalities?.[format] ?? '').toLowerCase();
    if (format === 'commander') {
      return !card.commanderLegal || ['banned', 'not_legal'].includes(legality);
    }

    return ['banned', 'not_legal'].includes(legality) || legality === '';
  }

  invalidCardMessage(card: Card): string {
    return `Esta carta no es valida en ${this.deckFormatLabel()}.`;
  }

  toggleCardMenu(event: MouseEvent, entry: DeckCard): void {
    event.stopPropagation();
    const current = this.cardMenu();
    if (current?.entryId === entry.id) {
      this.cardMenu.set(null);
      return;
    }

    this.cardMenu.set({
      entryId: entry.id,
      top: event.clientY + 10,
      left: Math.min(event.clientX + 10, window.innerWidth - 180),
      amount: 1,
    });
  }

  setCardMenuAmount(value: unknown): void {
    const current = this.cardMenu();
    if (!current) {
      return;
    }

    this.cardMenu.set({
      ...current,
      amount: this.normalizeQuantity(value),
    });
  }

  async addCardCopy(event: MouseEvent, entry: DeckCard): Promise<void> {
    event.stopPropagation();
    const currentDeck = this.deck();
    if (!currentDeck) {
      return;
    }

    try {
      const response = entry.section === 'commander'
        ? await this.addCopiesToMain(currentDeck, entry.card, this.cardMenuAmount())
        : await firstValueFrom(this.decksApi.updateCard(currentDeck.id, entry.id, {
          quantity: entry.quantity + this.cardMenuAmount(),
        }));
      this.applyDeckUpdate(response.deck, `Add copy ${entry.card.name}`);
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not add card copy.'));
    }
  }

  async removeCardCopy(event: MouseEvent, entry: DeckCard): Promise<void> {
    event.stopPropagation();
    const currentDeck = this.deck();
    if (!currentDeck) {
      return;
    }

    try {
      const response = this.cardMenuAmount() >= entry.quantity
        ? await firstValueFrom(this.decksApi.removeCard(currentDeck.id, entry.id))
        : await firstValueFrom(this.decksApi.updateCard(currentDeck.id, entry.id, {
          quantity: entry.quantity - this.cardMenuAmount(),
        }));
      this.applyDeckUpdate(response.deck, `Remove copy ${entry.card.name}`);
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not remove card copy.'));
    }
  }

  async moveCardToSection(event: MouseEvent, entry: DeckCard, target: DeckSection): Promise<void> {
    event.stopPropagation();
    const currentDeck = this.deck();
    if (!currentDeck || entry.section === target) {
      this.cardMenu.set(null);
      return;
    }

    try {
      let deck: Deck;
      if (target === 'commander') {
        deck = await this.moveCardIntoCommander(currentDeck, entry);
      } else if (entry.section === 'commander') {
        deck = await this.moveCommanderOut(currentDeck, entry, target);
      } else {
        const response = await firstValueFrom(this.decksApi.updateCard(currentDeck.id, entry.id, { section: target }));
        deck = response.deck;
      }

      this.applyDeckUpdate(deck, `Move ${entry.card.name} to ${this.sectionLabel(target)}`);
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, `Could not move card to ${this.sectionLabel(target)}.`));
    }
  }

  showHoverList(event: MouseEvent, title: string, items: string[]): void {
    this.hoverList.set({
      title,
      items,
      top: Math.min(event.clientY + 16, window.innerHeight - 220),
      left: Math.min(event.clientX + 16, window.innerWidth - 280),
    });
  }

  moveHoverList(event: MouseEvent): void {
    const current = this.hoverList();
    if (!current) {
      return;
    }

    this.hoverList.set({
      ...current,
      top: Math.min(event.clientY + 16, window.innerHeight - 220),
      left: Math.min(event.clientX + 16, window.innerWidth - 280),
    });
  }

  hideHoverList(): void {
    this.hoverList.set(null);
  }

  shouldShowManaCost(card: Card): boolean {
    if (card.manaCost) {
      return true;
    }

    return !(card.typeLine?.toLowerCase().includes('land') ?? false);
  }

  imageUrl(card: Card): string | null {
    return this.imageCache.imageUrl(card);
  }

  ensureCardImage(card: Card): void {
    this.imageCache.load(card);
  }

  ensureCardImages(cards: readonly DeckCard[]): void {
    for (const entry of cards) {
      this.ensureCardImage(entry.card);
    }
  }

  showCardPreview(event: MouseEvent, card: Card): void {
    if (this.previewEnterTimeout) {
      clearTimeout(this.previewEnterTimeout);
    }

    this.lastPreviewPointer = { x: event.clientX, y: event.clientY };
    this.previewEnterTimeout = setTimeout(() => {
      this.updatePreviewPosition(this.lastPreviewPointer ?? { x: event.clientX, y: event.clientY }, card, this.imageUrl(card));
      void this.resolvePreviewImage(card);
    }, 120);
  }

  moveCardPreview(event: MouseEvent): void {
    this.lastPreviewPointer = { x: event.clientX, y: event.clientY };
    const preview = this.cardPreview();
    if (!preview) {
      return;
    }

    this.updatePreviewPosition(this.lastPreviewPointer, preview.card, preview.imageUrl);
  }

  hideCardPreview(): void {
    if (this.previewEnterTimeout) {
      clearTimeout(this.previewEnterTimeout);
      this.previewEnterTimeout = null;
    }
    this.lastPreviewPointer = null;
    this.cardPreview.set(null);
  }

  hasAlternateFace(card: Card): boolean {
    return card.name.includes('//');
  }

  displayCardName(card: Card): string {
    if (!this.hasAlternateFace(card)) {
      return card.name;
    }

    const [front, back] = card.name.split('//').map((part) => part.trim());
    return this.isFaceFlipped(card) ? `${back} // ${front}` : `${front} // ${back}`;
  }

  displayCardTypeLine(card: Card): string | null {
    if (!card.typeLine) {
      return null;
    }

    if (!this.hasAlternateFace(card)) {
      return card.typeLine;
    }

    const [front, back] = card.typeLine.split('//').map((part) => part.trim());
    if (!front || !back) {
      return card.typeLine;
    }

    return this.isFaceFlipped(card) ? `${back} // ${front}` : `${front} // ${back}`;
  }

  toggleCardFace(event: MouseEvent, card: Card): void {
    event.stopPropagation();
    const next = { ...this.flippedFaces() };
    next[card.scryfallId] = !next[card.scryfallId];
    this.flippedFaces.set(next);
  }

  private async addSearchedCardInternal(card: Card, amount: number): Promise<void> {
    const currentDeck = this.deck();
    if (!currentDeck) {
      return;
    }

    try {
      const response = await this.addCopiesToMain(currentDeck, card, amount);
      this.applyDeckUpdate(response.deck, `Manual add ${card.name}`);
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not add selected card.'));
    }
  }

  private refreshHistory(deckId: string): void {
    this.history.set(this.historyStore.list(deckId));
  }

  private buildMissingItems(): MissingCardItem[] {
    const aggregated = new Map<string, MissingCardItem>();
    for (const source of this.missingSourceEntries()) {
      if (this.missingStore.isIgnored(source.name)) {
        continue;
      }

      const key = source.name.toLowerCase();
      const existing = aggregated.get(key);
      if (existing) {
        existing.quantity += source.quantity;
        if (source.section === 'commander' || source.section === 'sideboard' || source.section === 'maybeboard') {
          existing.section = source.section as DeckSection;
        }
        continue;
      }

      aggregated.set(key, {
        name: source.name,
        quantity: source.quantity,
        section: this.normalizeMissingSection(source.section),
        watched: this.missingStore.isWatched(source.name),
      });
    }

    if (aggregated.size > 0) {
      return Array.from(aggregated.values()).filter((item) => this.missing().includes(item.name));
    }

    return this.missing()
      .filter((name) => !this.missingStore.isIgnored(name))
      .map((name) => ({
        name,
        quantity: 1,
        section: 'main' as DeckSection,
        watched: this.missingStore.isWatched(name),
      }));
  }

  private buildCardGroups(): DeckCardGroup[] {
    const cards = [...(this.deck()?.cards ?? [])]
      .filter((entry) => entry.section !== 'maybeboard')
      .sort((left, right) => left.card.name.localeCompare(right.card.name));
    const groups: DeckCardGroup[] = [];
    const assigned = new Set<string>();

    for (const group of GROUPS) {
      const items = cards.filter((entry) => !assigned.has(entry.id) && group.matcher(entry));
      if (items.length === 0 && group.id !== 'commander') {
        continue;
      }

      items.forEach((entry) => assigned.add(entry.id));
      groups.push({ id: group.id, title: group.title, cards: items });
    }

    const remaining = cards.filter((entry) => !assigned.has(entry.id));
    if (remaining.length > 0) {
      groups.push({ id: 'other', title: 'Otros', cards: remaining });
    }

    return groups;
  }

  private buildCardColumns(): DeckCardColumn[] {
    const groups = this.cardGroups();
    if (groups.length === 0) {
      return [];
    }

    const columns: DeckCardColumn[] = [];
    const targetCardsPerColumn = 18;
    let currentGroups: DeckCardGroup[] = [];
    let currentCount = 0;

    for (const group of groups) {
      const shouldStartNewColumn = currentGroups.length > 0
        && currentCount >= targetCardsPerColumn
        && group.cards.length > 4
        && group.id !== 'sideboard'
        && group.id !== 'land'
        && currentGroups[currentGroups.length - 1]?.id !== 'sideboard';

      if (shouldStartNewColumn) {
        columns.push({
          id: currentGroups.map((item) => item.id).join('-'),
          groups: currentGroups,
        });
        currentGroups = [];
        currentCount = 0;
      }

      currentGroups.push(group);
      currentCount += group.cards.length;
    }

    if (currentGroups.length > 0) {
      columns.push({
        id: currentGroups.map((item) => item.id).join('-'),
        groups: currentGroups,
      });
    }

    return columns;
  }

  private cardManaValue(card: Card): number {
    const cost = card.manaCost;
    if (!cost) {
      return 0;
    }

    return (cost.match(/\{[^}]+\}/g) ?? []).reduce((total, symbol) => {
      const value = symbol.slice(1, -1);
      const numeric = Number.parseInt(value, 10);

      if (Number.isFinite(numeric)) {
        return total + numeric;
      }

      return value === 'X' ? total : total + 1;
    }, 0);
  }

  private applyDeckUpdate(deck: Deck, historySource: string): void {
    this.deck.set({ ...deck, cards: this.deckCardsOf(deck) });
    this.validation.set(null);
    this.cardMenu.set(null);
    this.recordHistory(deck, historySource);
    void this.refreshTokens(deck.id);
    void this.refreshBackendValidation(deck.id);
    if (!Array.isArray(deck.cards)) {
      void this.reloadDeckCards(deck.id);
    }
  }

  private async moveCardIntoCommander(currentDeck: Deck, entry: DeckCard): Promise<Deck> {
    if (entry.section === 'commander') {
      return currentDeck;
    }

    const currentCommanders = (currentDeck.cards ?? []).filter((candidate) => candidate.section === 'commander');
    if (currentCommanders.length >= 2) {
      throw new Error('Commander slot already has two cards.');
    }

    let response = await firstValueFrom(this.decksApi.replaceCommanders(currentDeck.id, [
      ...currentCommanders.map((candidate) => ({ scryfallId: candidate.card.scryfallId })),
      { scryfallId: entry.card.scryfallId },
    ]));
    let nextDeck = await this.ensureDeckCardsLoaded(response.deck);

    if (entry.section !== 'main') {
      const sourceEntry = this.deckCardsOf(nextDeck).find((candidate) => (
        candidate.section === entry.section
        && candidate.card.scryfallId === entry.card.scryfallId
      ));
      if (sourceEntry) {
        response = sourceEntry.quantity > 1
          ? await firstValueFrom(this.decksApi.updateCard(nextDeck.id, sourceEntry.id, { quantity: sourceEntry.quantity - 1 }))
          : await firstValueFrom(this.decksApi.removeCard(nextDeck.id, sourceEntry.id));
        nextDeck = await this.ensureDeckCardsLoaded(response.deck);
      }
    }

    return nextDeck;
  }

  private async moveCommanderOut(currentDeck: Deck, entry: DeckCard, target: Exclude<DeckSection, 'commander'>): Promise<Deck> {
    const remainingCommanders = (currentDeck.cards ?? [])
      .filter((candidate) => candidate.section === 'commander' && candidate.id !== entry.id)
      .map((candidate) => ({ scryfallId: candidate.card.scryfallId }));

    let response = await firstValueFrom(this.decksApi.replaceCommanders(currentDeck.id, remainingCommanders));
    let nextDeck = await this.ensureDeckCardsLoaded(response.deck);
    if (target === 'main') {
      return nextDeck;
    }

    const mainEntry = this.deckCardsOf(nextDeck).find((candidate) => (
      candidate.section === 'main'
      && candidate.card.scryfallId === entry.card.scryfallId
    ));
    if (!mainEntry) {
      return nextDeck;
    }

    if (mainEntry.quantity > 1) {
      response = await firstValueFrom(this.decksApi.updateCard(nextDeck.id, mainEntry.id, { quantity: mainEntry.quantity - 1 }));
      response = await firstValueFrom(this.decksApi.addCard(nextDeck.id, {
        scryfallId: entry.card.scryfallId,
        quantity: 1,
        section: target,
      }));
      return this.ensureDeckCardsLoaded(response.deck);
    }

    response = await firstValueFrom(this.decksApi.updateCard(nextDeck.id, mainEntry.id, { section: target }));
    return this.ensureDeckCardsLoaded(response.deck);
  }

  private sectionLabel(section: DeckSection): string {
    switch (section) {
      case 'commander':
        return 'commander';
      case 'sideboard':
        return 'sideboard';
      case 'maybeboard':
        return 'considering';
      default:
        return 'main';
    }
  }

  private async refreshTokens(deckId: string): Promise<void> {
    try {
      const response = await firstValueFrom(this.decksApi.tokens(deckId));
      this.tokens.set(response.data);
      this.unresolvedTokens.set(response.unresolved);
    } catch {
      this.tokens.set([]);
      this.unresolvedTokens.set([]);
    }
  }

  private async refreshBackendValidation(deckId: string, reportError = false): Promise<void> {
    try {
      const response = await firstValueFrom(this.decksApi.validateCommander(deckId));
      this.validation.set(response);
    } catch (error) {
      this.validation.set(null);
      if (reportError) {
        this.error.set(this.apiErrorMessage(error, 'Could not validate deck.'));
      }
    }
  }

  private async reloadDeckCards(deckId: string): Promise<void> {
    try {
      const response = await firstValueFrom(this.decksApi.get(deckId));
      this.deck.set(response.deck);
    } catch {
      return;
    }
  }

  private cardMenuAmount(): number {
    return this.cardMenu()?.amount ?? 1;
  }

  private async addCopiesToMain(currentDeck: Deck, card: Card, amount: number) {
    const existingEntry = (currentDeck.cards ?? []).find((entry) => (
      entry.section === 'main' && entry.card.name.trim().toLowerCase() === card.name.trim().toLowerCase()
    ));

    if (existingEntry) {
      return firstValueFrom(this.decksApi.updateCard(currentDeck.id, existingEntry.id, {
        quantity: existingEntry.quantity + amount,
      }));
    }

    return firstValueFrom(this.decksApi.addCard(currentDeck.id, {
      scryfallId: card.scryfallId,
      quantity: amount,
      section: 'main',
    }));
  }

  private buildManaSourceProfiles(): Array<{
    color: 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
    label: string;
    demandCount: number;
    demandPercent: number;
    sourceCount: number;
    sourcePercent: number;
  }> {
    const demandProfiles = this.analysis().colorProfiles;
    const sourceCounts: Record<'W' | 'U' | 'B' | 'R' | 'G' | 'C', number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    const deckColors = this.deckColorIdentity();
    const sourceEntries = (this.deck()?.cards ?? []).filter((entry) => entry.section === 'main' && this.isManaSourceCard(entry));

    for (const entry of sourceEntries) {
      for (const color of this.manaSourceColors(entry, deckColors)) {
        sourceCounts[color] += entry.quantity;
      }
    }

    const totalSources = Object.values(sourceCounts).reduce((sum, value) => sum + value, 0);
    const labels: Record<'W' | 'U' | 'B' | 'R' | 'G' | 'C', string> = {
      W: 'White',
      U: 'Blue',
      B: 'Black',
      R: 'Red',
      G: 'Green',
      C: 'Colorless',
    };

    return (['W', 'U', 'B', 'R', 'G', 'C'] as const)
      .map((color) => {
        const demand = demandProfiles.find((entry) => entry.color === color);
        return {
          color,
          label: labels[color],
          demandCount: demand?.count ?? 0,
          demandPercent: demand?.percent ?? 0,
          sourceCount: sourceCounts[color],
          sourcePercent: totalSources > 0 ? Math.round((sourceCounts[color] / totalSources) * 100) : 0,
        };
      })
      .filter((entry) => entry.demandCount > 0 || entry.sourceCount > 0);
  }

  private buildManaSourceDonutBackground(): string {
    const profiles = this.manaSourceProfiles();
    if (profiles.length === 0) {
      return 'conic-gradient(rgb(255 255 255 / 8%) 0deg 360deg)';
    }

    const palette: Record<'W' | 'U' | 'B' | 'R' | 'G' | 'C', string> = {
      W: '#f1ebac',
      U: '#9fc4ec',
      B: '#8a7f84',
      R: '#e29a79',
      G: '#8fbe78',
      C: '#d8d8d8',
    };

    let cursor = 0;
    const stops = profiles.map((profile) => {
      const start = cursor;
      const width = Math.max(profile.sourcePercent, profile.sourceCount > 0 ? 2 : 0);
      cursor += width;
      return `${palette[profile.color]} ${start}% ${Math.min(cursor, 100)}%`;
    });

    return `conic-gradient(${stops.join(', ')})`;
  }

  private isSpellEntry(entry: DeckCard): boolean {
    const typeLine = entry.card.typeLine?.toLowerCase() ?? '';
    return typeLine.includes('instant') || typeLine.includes('sorcery');
  }

  private normalizeMissingSection(section: string): DeckSection {
    if (section === 'commander' || section === 'sideboard' || section === 'maybeboard') {
      return section;
    }

    return 'main';
  }

  private deckCardsOf(deck: Deck | null | undefined): DeckCard[] {
    return Array.isArray(deck?.cards) ? deck.cards : [];
  }

  private async ensureDeckCardsLoaded(deck: Deck): Promise<Deck> {
    if (Array.isArray(deck.cards)) {
      return deck;
    }

    const response = await firstValueFrom(this.decksApi.get(deck.id));
    return response.deck;
  }

  private deckColorIdentity(): Array<'W' | 'U' | 'B' | 'R' | 'G'> {
    const colors = new Set<'W' | 'U' | 'B' | 'R' | 'G'>();
    for (const entry of this.commanderCards()) {
      for (const color of entry.card.colorIdentity ?? []) {
        if (color === 'W' || color === 'U' || color === 'B' || color === 'R' || color === 'G') {
          colors.add(color);
        }
      }
    }

    if (colors.size > 0) {
      return Array.from(colors);
    }

    return ['W', 'U', 'B', 'R', 'G'].filter((color) => (
      this.analysis().colorProfiles.some((profile) => profile.color === color && profile.count > 0)
    )) as Array<'W' | 'U' | 'B' | 'R' | 'G'>;
  }

  private isManaSourceCard(entry: DeckCard): boolean {
    if (hasType(entry, 'land')) {
      return true;
    }

    if (this.isSpellEntry(entry)) {
      return false;
    }

    const oracle = entry.card.oracleText?.toLowerCase() ?? '';
    return /add /.test(oracle) || /treasure token/.test(oracle);
  }

  private manaSourceColors(entry: DeckCard, deckColors: Array<'W' | 'U' | 'B' | 'R' | 'G'>): Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'> {
    const colors = new Set<'W' | 'U' | 'B' | 'R' | 'G' | 'C'>();
    const typeLine = entry.card.typeLine?.toLowerCase() ?? '';
    const oracle = entry.card.oracleText?.toLowerCase() ?? '';
    const basicTypes: Record<'W' | 'U' | 'B' | 'R' | 'G', string> = {
      W: 'plains',
      U: 'island',
      B: 'swamp',
      R: 'mountain',
      G: 'forest',
    };

    for (const [color, basicType] of Object.entries(basicTypes) as Array<['W' | 'U' | 'B' | 'R' | 'G', string]>) {
      if (typeLine.includes(basicType) || oracle.includes(`{${color.toLowerCase()}}`) || oracle.includes(`{${color}}`) || oracle.includes(basicType)) {
        colors.add(color);
      }
    }

    if (/any color in your commander's color identity/.test(oracle)) {
      for (const color of (deckColors.length > 0 ? deckColors : ['W', 'U', 'B', 'R', 'G'] as const)) {
        colors.add(color);
      }
    } else if (/any color|mana of any type/.test(oracle)) {
      for (const color of ['W', 'U', 'B', 'R', 'G'] as const) {
        colors.add(color);
      }
    }

    if (oracle.includes('{c}') || /colorless/.test(oracle) || entry.card.colorIdentity?.length === 0) {
      colors.add('C');
    }

    for (const color of entry.card.colorIdentity ?? []) {
      if (color === 'W' || color === 'U' || color === 'B' || color === 'R' || color === 'G') {
        colors.add(color);
      }
    }

    return Array.from(colors);
  }

  private normalizeQuantity(value: unknown): number {
    const parsed = Number.parseInt(String(value ?? '1'), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  private updatePreviewPosition(pointer: PointerPosition, card: Card, imageUrl: string | null): void {
    const width = 280;
    const height = 390;
    const margin = 18;
    const left = pointer.x + width + margin < window.innerWidth ? pointer.x + margin : Math.max(12, pointer.x - width - margin);
    const top = Math.min(Math.max(12, pointer.y - 26), Math.max(12, window.innerHeight - height - 12));
    this.cardPreview.set({ card, imageUrl, top, left });
  }

  private async resolvePreviewImage(card: Card): Promise<void> {
    const imageUrl = await this.imageCache.resolve(card);
    if (this.cardPreview()?.card.scryfallId === card.scryfallId && this.lastPreviewPointer) {
      this.updatePreviewPosition(this.lastPreviewPointer, card, imageUrl);
    }
  }

  private cardsBySection(section: DeckSection): DeckCard[] {
    return (this.deck()?.cards ?? []).filter((entry) => entry.section === section);
  }

  private isFaceFlipped(card: Card): boolean {
    return this.flippedFaces()[card.scryfallId] ?? false;
  }

  private deckFormatKey(): string {
    const raw = (this.deck()?.format ?? 'commander').trim().toLowerCase();
    return raw.replace(/[\s-]+/g, '_');
  }

  private deckFormatLabel(): string {
    const raw = (this.deck()?.format ?? 'commander').trim().replace(/[_-]+/g, ' ');
    if (!raw) {
      return 'Commander';
    }

    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  private apiErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.error === 'string' && error.error.error.trim()) {
      return error.error.error;
    }

    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return fallback;
  }

  private formatValidationEntry(entry: { title: string; detail: string; cards: string[] }): string {
    const cards = entry.cards.length > 0 ? `: ${entry.cards.join(', ')}` : '';
    return `${entry.title}${cards}. ${entry.detail}`;
  }
}

function hasType(entry: DeckCard, type: string): boolean {
  return new RegExp(`(^|\\s)${type}(\\s|$)`, 'i').test(entry.card.typeLine ?? '');
}

function hasMaindeckType(entry: DeckCard, type: string): boolean {
  return entry.section !== 'sideboard' && hasType(entry, type);
}
