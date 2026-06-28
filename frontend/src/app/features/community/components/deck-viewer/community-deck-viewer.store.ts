import { Injectable, computed, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { runtimeTranslationFallback } from '../../../../core/localization/runtime-translate.pipe';
import { Card, CardFace } from '../../../../core/models/card.model';
import { Deck, DeckCard } from '../../../../core/models/deck.model';
import { bestCardFaceImage, bestCardImage } from '../../../../shared/utils/card-image';
import { cardDisplayFace, hasAlternateCardFace } from '../../../../shared/utils/card-faces';
import { commanderColorIdentityUnion } from '../../../../shared/utils/deck-commander';
import { CommonCardMenuAction } from '../../../../shared/ui/common-card-menu/common-card-menu.component';
import { CardMenuState, CardPreviewState, DeckCardColumn, DeckCardGroup, HoverListState, OpeningHandCard } from '../../../decks/models/deck-editor.models';
import { DeckAnalysisStore } from '../../../decks/deck-editor/deck-analysis-panel/deck-analysis-store.token';
import { DeckViewStore, DeckViewToggleFaceOptions } from '../../../decks/deck-editor/deck-view-store.token';
import { DeckAnalysisService } from '../../../decks/services/deck-analysis.service';
import { normalizedCardTypeLine, resolveCardTypeLine, resolvedDeckCardTypeLine } from '../../../decks/utils/deck-card-type-line';

const CARD_TYPE_GROUPS = [
  { id: 'planeswalker', title: 'community.deckViewer.groups.planeswalker', type: 'planeswalker' },
  { id: 'battle', title: 'community.deckViewer.groups.battle', type: 'battle' },
  { id: 'creature', title: 'community.deckViewer.groups.creature', type: 'creature' },
  { id: 'instant', title: 'community.deckViewer.groups.instant', type: 'instant' },
  { id: 'sorcery', title: 'community.deckViewer.groups.sorcery', type: 'sorcery' },
  { id: 'enchantment', title: 'community.deckViewer.groups.enchantment', type: 'enchantment' },
  { id: 'artifact', title: 'community.deckViewer.groups.artifact', type: 'artifact' },
  { id: 'land', title: 'community.deckViewer.groups.land', type: 'land' },
] as const;

const GROUPS: Array<{ id: string; title: string; matcher: (entry: DeckCard) => boolean }> = [
  { id: 'commander', title: 'community.deckViewer.groups.commander', matcher: (entry) => entry.section === 'commander' },
  ...CARD_TYPE_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    matcher: (entry: DeckCard) => hasMaindeckType(entry, group.type),
  })),
  { id: 'sideboard', title: 'community.deckViewer.groups.sideboard', matcher: (entry) => entry.section === 'sideboard' },
];

const DECK_TEXT_VIEW_TARGET_COLUMN_WEIGHT = 42;
const DECK_TEXT_VIEW_MAX_COLUMNS = 2;
const CARD_CONTEXT_MENU_WIDTH = 12 * 16;
const CARD_CONTEXT_MENU_HEIGHT = 10.5 * 16;

export type CommunityDeckCardAction = 'details' | 'addToDeck' | 'rulings' | 'printings';

export interface CommunityDeckCardActionEvent {
  readonly action: CommunityDeckCardAction;
  readonly card: Card;
}

interface CommunityCardContextMenuState {
  readonly card: Card;
  readonly top: number;
  readonly left: number;
}

@Injectable()
export class CommunityDeckViewerStore implements DeckViewStore, DeckAnalysisStore {
  private readonly translate = inject(TranslateService, { optional: true });
  private readonly analysisService = inject(DeckAnalysisService);

  readonly deck = signal<Deck | null>(null);
  readonly cardMenu = signal<CardMenuState | null>(null);
  readonly cardPreview = signal<CardPreviewState | null>(null);
  readonly contextMenu = signal<CommunityCardContextMenuState | null>(null);
  readonly collapsedGroups = signal<Set<string>>(new Set());
  readonly flippedFaces = signal<Record<string, boolean>>({});
  readonly hoverList = signal<HoverListState | null>(null);
  readonly openingHand = signal<OpeningHandCard[]>([]);
  readonly cardGroups = computed(() => this.buildCardGroups());
  readonly cardColumns = computed(() => this.buildCardColumns());
  readonly analysis = computed(() => this.analysisService.analyze(this.deck()));
  readonly playableCardCount = computed(() => (
    (this.deck()?.cards ?? [])
      .filter((entry) => entry.section === 'commander' || entry.section === 'main')
      .reduce((total, entry) => total + entry.quantity, 0)
  ));
  readonly playableSectionCount = computed(() => this.cardGroups()
    .filter((group) => group.id !== 'sideboard')
    .length);
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
  readonly contextMenuActions: ReadonlyArray<CommonCardMenuAction<CommunityDeckCardAction>> = [
    { id: 'details', label: 'deckBuilder.cards.cardSearch.actions.showDetails' },
    { id: 'addToDeck', label: 'deckBuilder.cards.cardSearch.actions.addToDeck' },
    { id: 'rulings', label: 'deckBuilder.cards.cardSearch.actions.showRulings' },
    { id: 'printings', label: 'deckBuilder.cards.cardSearch.actions.viewPrintings' },
  ];

  private previewEnterTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastPreviewPointer: { x: number; y: number } | null = null;

  setDeck(deck: Deck): void {
    this.deck.set(deck);
    this.collapsedGroups.set(new Set());
    this.flippedFaces.set({});
    this.closeContextMenu();
    this.hideCardPreview();
    this.hideHoverList();
    this.drawOpeningHand(deck);
  }

  destroy(): void {
    if (this.previewEnterTimeout) {
      clearTimeout(this.previewEnterTimeout);
      this.previewEnterTimeout = null;
    }
    this.hideCardPreview();
    this.hideHoverList();
    this.openingHand.set([]);
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

  deckColorIdentitySymbols(): readonly ('W' | 'U' | 'B' | 'R' | 'G')[] {
    return commanderColorIdentityUnion(this.deck())
      .filter((color): color is 'W' | 'U' | 'B' | 'R' | 'G' => ['W', 'U', 'B', 'R', 'G'].includes(color));
  }

  displayCardImageUrl(card: Card): string | null {
    return bestCardFaceImage(this.displayCardFace(card)) ?? this.imageUrl(card);
  }

  ensureCardImages(_cards: readonly DeckCard[]): void {}

  curveTotalHeight(total: number): number {
    const max = Math.max(...this.analysis().manaCurve.map((bucket) => bucket.total), 1) + 20;
    if (total <= 0) {
      return 0;
    }

    return Math.max((total / max) * 100, 12);
  }

  curvePermanentShare(permanents: number, total: number): string {
    return `${total > 0 ? Math.round((permanents / total) * 100) : 0}%`;
  }

  curveManaValueLabel(manaValue: number): string {
    return manaValue === 9 ? '9+' : `${manaValue}`;
  }

  showHoverList(event: MouseEvent, title: string, items: readonly string[]): void {
    this.hoverList.set({
      title,
      items: [...items],
      top: Math.min(event.clientY + 16, window.innerHeight - 220),
      left: Math.min(event.clientX + 16, window.innerWidth - 280),
    });
  }

  showCurveHoverList(event: MouseEvent, manaValue: number): void {
    this.hoverList.set({
      title: `Mana value ${this.curveManaValueLabel(manaValue)}`,
      items: [],
      sections: [
        {
          title: 'deckBuilder.deckManaCurvePanel.permanents',
          items: this.curveHoverItems(manaValue, 'permanent'),
        },
        {
          title: 'deckBuilder.deckManaCurvePanel.spells',
          items: this.curveHoverItems(manaValue, 'spell'),
        },
      ],
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

  showCardPreview(event: MouseEvent, card: Card): void {
    if (this.previewEnterTimeout) {
      clearTimeout(this.previewEnterTimeout);
    }

    this.lastPreviewPointer = { x: event.clientX, y: event.clientY };
    this.previewEnterTimeout = setTimeout(() => {
      this.updatePreviewPosition(this.lastPreviewPointer ?? { x: event.clientX, y: event.clientY }, card);
      this.previewEnterTimeout = null;
    }, 180);
  }

  moveCardPreview(event: MouseEvent): void {
    this.lastPreviewPointer = { x: event.clientX, y: event.clientY };
    const preview = this.cardPreview();
    if (!preview) {
      return;
    }

    this.updatePreviewPosition(this.lastPreviewPointer, preview.card);
  }

  hideCardPreview(): void {
    if (this.previewEnterTimeout) {
      clearTimeout(this.previewEnterTimeout);
      this.previewEnterTimeout = null;
    }
    this.lastPreviewPointer = null;
    this.cardPreview.set(null);
  }

  drawOpeningHand(deck = this.deck()): void {
    const entries = (deck?.cards ?? [])
      .filter((entry) => entry.section === 'main')
      .flatMap((entry) => Array.from({ length: entry.quantity }, (_, index) => ({
        id: `${entry.id}-${index}`,
        card: entry.card,
        name: entry.card.name,
        typeLine: entry.card.typeLine,
        manaCost: entry.card.manaCost,
        imageUrl: this.imageUrl(entry.card),
      })));

    this.openingHand.set(this.shuffle(entries).slice(0, 7));
  }

  closeContextMenu(): void {
    this.contextMenu.set(null);
  }

  hasAlternateFace(card: Card): boolean {
    return hasAlternateCardFace(card);
  }

  displayCardName(card: Card): string {
    if (this.hasAlternateFace(card)) {
      return card.name;
    }

    return this.displayCardFace(card)?.name ?? card.name;
  }

  displayCardListName(card: Card): string {
    return card.name;
  }

  displayCardTypeLine(card: Card): string | null {
    const typeLine = resolveCardTypeLine(card, this.displayCardFace(card));

    return typeLine ? primaryTypeLinePart(typeLine) : null;
  }

  displayCardManaCost(card: Card): string | null {
    const face = this.displayCardFace(card);

    return face?.manaCost ?? card.manaCost;
  }

  shouldShowManaCost(card: Card): boolean {
    const manaCost = this.displayCardManaCost(card);
    if (manaCost) {
      return true;
    }

    return !normalizedCardTypeLine(card, this.displayCardFace(card)).includes('land');
  }

  imageUrl(card: Card): string | null {
    return bestCardImage(card);
  }

  toggleCardMenu(event: MouseEvent, entry: DeckCard): void {
    event.preventDefault();
    event.stopPropagation();

    const currentMenu = this.contextMenu();
    if (currentMenu?.card.scryfallId === entry.card.scryfallId) {
      this.closeContextMenu();
      return;
    }

    this.hideCardPreview();
    this.contextMenu.set(this.cardMenuPosition(event, entry.card));
  }

  toggleCardFace(event: MouseEvent, card: Card, options: DeckViewToggleFaceOptions = {}): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (this.previewEnterTimeout) {
      clearTimeout(this.previewEnterTimeout);
      this.previewEnterTimeout = null;
    }

    const next = { ...this.flippedFaces() };
    next[card.scryfallId] = !next[card.scryfallId];
    this.flippedFaces.set(next);

    if (options.updatePreview ?? true) {
      this.lastPreviewPointer = { x: event.clientX, y: event.clientY };
      this.updatePreviewPosition(this.lastPreviewPointer, card);
    }
  }

  resetCardFace(card: Card): boolean {
    if (!this.isFaceFlipped(card)) {
      return false;
    }

    const next = { ...this.flippedFaces() };
    delete next[card.scryfallId];
    this.flippedFaces.set(next);

    return true;
  }

  isCardInvalidForDeck(card: Card): boolean {
    const format = this.deckFormatKey();
    const legality = (card.legalities?.[format] ?? '').toLowerCase();
    if (format === 'commander') {
      return !card.commanderLegal || ['banned', 'not_legal'].includes(legality);
    }

    return ['banned', 'not_legal'].includes(legality) || legality === '';
  }

  invalidCardMessage(_card: Card): string {
    return this.translateText('community.deckViewer.invalidCard', { format: this.deckFormatLabel() });
  }

  private updatePreviewPosition(pointer: { x: number; y: number }, card: Card): void {
    const imageUrl = this.displayCardImageUrl(card);
    const width = 280;
    const height = 390;
    const margin = 12;
    const x = Math.min(pointer.x + 16, window.innerWidth - width - margin);
    const y = Math.min(pointer.y + 16, window.innerHeight - height - margin);

    this.cardPreview.set({
      card,
      imageUrl,
      top: Math.max(margin, y),
      left: Math.max(margin, x),
    });
  }

  private displayCardFace(card: Card): CardFace | null {
    return cardDisplayFace(card, this.isFaceFlipped(card));
  }

  private cardMenuPosition(event: MouseEvent, card: Card): CommunityCardContextMenuState {
    const margin = 12;
    const sourceElement = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const sourceRect = sourceElement?.getBoundingClientRect();
    const centerX = sourceRect ? sourceRect.left + (sourceRect.width / 2) : event.clientX;
    const centerY = sourceRect ? sourceRect.top + (sourceRect.height / 2) : event.clientY;

    return {
      card,
      left: Math.max(margin, Math.min(centerX - (CARD_CONTEXT_MENU_WIDTH / 2), window.innerWidth - CARD_CONTEXT_MENU_WIDTH - margin)),
      top: Math.max(margin, Math.min(centerY - (CARD_CONTEXT_MENU_HEIGHT / 2), window.innerHeight - CARD_CONTEXT_MENU_HEIGHT - margin)),
    };
  }

  isFaceFlipped(card: Card): boolean {
    return this.flippedFaces()[card.scryfallId] ?? false;
  }

  private buildCardGroups(): DeckCardGroup[] {
    const cards = [...(this.deck()?.cards ?? [])]
      .filter((entry) => entry.section !== 'maybeboard');
    const groups: DeckCardGroup[] = [];
    const assigned = new Set<string>();
    const assignedMdfcLandQuantity = () => cards
      .filter((entry) => assigned.has(entry.id) && this.isMdfcLandEntry(entry))
      .reduce((total, entry) => total + entry.quantity, 0);

    for (const group of GROUPS) {
      const items = cards.filter((entry) => !assigned.has(entry.id) && group.matcher(entry));
      const groupCards = group.id === 'sideboard' ? sortSideboardCards(items) : sortCardsWithinSection(items);
      if (items.length === 0 && group.id !== 'commander') {
        continue;
      }

      const mdfcLandQuantity = group.id === 'land' ? assignedMdfcLandQuantity() : 0;
      items.forEach((entry) => assigned.add(entry.id));
      groups.push(this.toCardGroup(group.id, group.title, groupCards, mdfcLandQuantity));
    }

    const remaining = cards.filter((entry) => !assigned.has(entry.id));
    if (remaining.length > 0) {
      groups.push(this.toCardGroup('other', 'community.deckViewer.groups.other', sortCardsWithinSection(remaining)));
    }

    return groups;
  }

  private toCardGroup(id: string, title: string, cards: DeckCard[], mdfcLandQuantity = 0): DeckCardGroup {
    const quantity = cards.reduce((total, entry) => total + entry.quantity, 0);
    const includingMdfc = quantity + mdfcLandQuantity;

    return {
      id,
      title: this.translateText(title),
      cards,
      quantity,
      ...(id === 'land' && mdfcLandQuantity > 0
        ? { detail: this.translateText('community.deckViewer.groups.includingMdfc', { count: includingMdfc }) }
        : {}),
    };
  }

  private buildCardColumns(): DeckCardColumn[] {
    const groups = this.cardGroups();
    if (groups.length === 0) {
      return [];
    }

    const totalWeight = groups.reduce((total, group) => total + this.cardGroupColumnWeight(group), 0);
    const columnCount = Math.min(
      DECK_TEXT_VIEW_MAX_COLUMNS,
      Math.max(1, Math.ceil(totalWeight / DECK_TEXT_VIEW_TARGET_COLUMN_WEIGHT)),
      groups.length,
    );

    return this.orderedBalancedColumnGroups(groups, columnCount)
      .map((column) => ({
        id: column.map((item) => item.id).join('-'),
        groups: column,
      }));
  }

  private orderedBalancedColumnGroups(groups: DeckCardGroup[], columnCount: number): DeckCardGroup[][] {
    if (columnCount <= 1 || groups.length <= 1) {
      return [groups];
    }

    let bestColumns: DeckCardGroup[][] = [groups];
    let bestScore = Number.POSITIVE_INFINITY;
    let bestMaxWeight = Number.POSITIVE_INFINITY;

    const visit = (startIndex: number, remainingColumns: number, currentColumns: DeckCardGroup[][]): void => {
      if (remainingColumns === 1) {
        const candidate = [...currentColumns, groups.slice(startIndex)];
        const weights = candidate.map((column) => this.cardColumnWeight(column));
        const maxWeight = Math.max(...weights);
        const score = maxWeight - Math.min(...weights);

        if (score < bestScore || (score === bestScore && maxWeight < bestMaxWeight)) {
          bestColumns = candidate;
          bestScore = score;
          bestMaxWeight = maxWeight;
        }
        return;
      }

      const maxEndIndex = groups.length - remainingColumns + 1;
      for (let endIndex = startIndex + 1; endIndex <= maxEndIndex; endIndex += 1) {
        visit(endIndex, remainingColumns - 1, [...currentColumns, groups.slice(startIndex, endIndex)]);
      }
    };

    visit(0, columnCount, []);

    return bestColumns;
  }

  private cardColumnWeight(groups: DeckCardGroup[]): number {
    return groups.reduce((total, group) => total + this.cardGroupColumnWeight(group), 0);
  }

  private cardGroupColumnWeight(group: DeckCardGroup): number {
    const headerWeight = 2;
    if (this.isGroupCollapsed(group.id)) {
      return headerWeight;
    }

    if (group.id === 'commander') {
      return headerWeight + Math.max(8, group.cards.length * 8);
    }

    return headerWeight + group.cards.reduce((total, entry) => total + Math.max(1, entry.quantity), 0);
  }

  private isMdfcLandEntry(entry: DeckCard): boolean {
    return entry.card.layout === 'modal_dfc' && hasType(entry, 'land');
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
      return 'conic-gradient(rgb(var(--cz-text-rgb) / 8%) 0deg 360deg)';
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

  private isManaSourceCard(entry: DeckCard): boolean {
    if (/(^|\s)land(\s|$)/i.test(resolvedDeckCardTypeLine(entry))) {
      return true;
    }

    if (/(^|\s)(instant|sorcery)(\s|$)/i.test(resolvedDeckCardTypeLine(entry))) {
      return false;
    }

    const oracle = entry.card.oracleText?.toLowerCase() ?? '';
    return /add /.test(oracle) || /treasure token/.test(oracle);
  }

  private manaSourceColors(entry: DeckCard, deckColors: Array<'W' | 'U' | 'B' | 'R' | 'G'>): Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'> {
    const colors = new Set<'W' | 'U' | 'B' | 'R' | 'G' | 'C'>();
    const typeLine = resolvedDeckCardTypeLine(entry);
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
      if (isManaColor(color)) {
        colors.add(color);
      }
    }

    return Array.from(colors);
  }

  private deckColorIdentity(): Array<'W' | 'U' | 'B' | 'R' | 'G'> {
    const commanderColors = this.commanderColorIdentity();
    if (commanderColors.length > 0) {
      return commanderColors;
    }

    return ['W', 'U', 'B', 'R', 'G'].filter((color) => (
      this.analysis().colorProfiles.some((profile) => profile.color === color && profile.count > 0)
    )) as Array<'W' | 'U' | 'B' | 'R' | 'G'>;
  }

  private commanderColorIdentity(): Array<'W' | 'U' | 'B' | 'R' | 'G'> {
    const colors = new Set<'W' | 'U' | 'B' | 'R' | 'G'>();
    for (const entry of this.deck()?.cards ?? []) {
      if (entry.section !== 'commander') {
        continue;
      }

      for (const color of entry.card.colorIdentity ?? []) {
        if (isManaColor(color)) {
          colors.add(color);
        }
      }
    }

    return Array.from(colors);
  }

  private curveHoverItems(manaValue: number, kind: 'permanent' | 'spell'): string[] {
    const entries = (this.deck()?.cards ?? [])
      .filter((entry) => entry.section === 'main')
      .filter((entry) => Math.min(this.cardManaValue(entry.card), 9) === manaValue)
      .filter((entry) => kind === 'spell' ? this.isSpellEntry(entry) : !this.isSpellEntry(entry))
      .map((entry) => entry.card.name);

    return Array.from(new Set(entries)).sort((left, right) => left.localeCompare(right));
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

  private isSpellEntry(entry: DeckCard): boolean {
    const typeLine = resolvedDeckCardTypeLine(entry);
    return typeLine.includes('instant') || typeLine.includes('sorcery');
  }

  private shuffle<T>(items: readonly T[]): T[] {
    const next = [...items];
    for (let index = next.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [next[index], next[swapIndex]] = [next[swapIndex]!, next[index]!];
    }
    return next;
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

  private translateText(value: string, params?: Record<string, unknown>): string {
    const translated = this.translate?.instant(value, params);
    return typeof translated === 'string' && translated !== value
      ? translated
      : runtimeTranslationFallback(value, params);
  }

}

function hasType(entry: DeckCard, type: string): boolean {
  return new RegExp(`(^|\\s)${type}(\\s|$)`, 'i').test(resolvedDeckCardTypeLine(entry));
}

function hasMaindeckType(entry: DeckCard, type: string): boolean {
  return entry.section !== 'sideboard' && hasType(entry, type);
}

function sortCardsWithinSection(cards: DeckCard[]): DeckCard[] {
  return [...cards].sort(compareCardsWithinSection);
}

function compareCardsWithinSection(left: DeckCard, right: DeckCard): number {
  const nameOrder = left.card.name.localeCompare(right.card.name);
  if (nameOrder !== 0) {
    return nameOrder;
  }

  const leftTypes = cardTypeSortParts(left);
  const rightTypes = cardTypeSortParts(right);
  const subtypeOrder = leftTypes.subtype.localeCompare(rightTypes.subtype);
  if (subtypeOrder !== 0) {
    return subtypeOrder;
  }

  const primaryTypeOrder = leftTypes.primaryType.localeCompare(rightTypes.primaryType);
  if (primaryTypeOrder !== 0) {
    return primaryTypeOrder;
  }

  return left.id.localeCompare(right.id);
}

function sortSideboardCards(cards: DeckCard[]): DeckCard[] {
  return [...cards].sort((left, right) => {
    const typeOrder = cardTypeGroupIndex(left) - cardTypeGroupIndex(right);
    if (typeOrder !== 0) {
      return typeOrder;
    }

    return compareCardsWithinSection(left, right);
  });
}

function cardTypeGroupIndex(entry: DeckCard): number {
  const index = CARD_TYPE_GROUPS.findIndex((group) => hasType(entry, group.type));

  return index === -1 ? CARD_TYPE_GROUPS.length : index;
}

function cardTypeSortParts(entry: DeckCard): { primaryType: string; subtype: string } {
  const typeLine = primaryTypeLinePart(resolvedDeckCardTypeLine(entry));
  const [primaryType = '', ...subtypeParts] = typeLine.split(/\s+(?:-|\u2013|\u2014)\s+/u);

  return {
    primaryType: normalizeSortText(primaryType),
    subtype: normalizeSortText(subtypeParts.join(' ')),
  };
}

function normalizeSortText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function primaryTypeLinePart(typeLine: string): string {
  const [front] = typeLine.split('//').map((part) => part.trim());

  return front || typeLine.trim();
}

function isManaColor(value: string): value is 'W' | 'U' | 'B' | 'R' | 'G' {
  return value === 'W' || value === 'U' || value === 'B' || value === 'R' || value === 'G';
}
