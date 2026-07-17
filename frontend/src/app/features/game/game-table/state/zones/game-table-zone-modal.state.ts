import { Injectable, signal } from '@angular/core';
import { GameCardInstance, GameLibraryWindowState, GameSnapshot, GameZoneName } from '../../../../../core/models/game.model';

export type ZoneModalLifecycle = 'loading' | 'ready' | 'stale' | 'error' | 'closing';

export interface ZoneModalState {
  playerId: string;
  zone: GameZoneName;
  title: string;
  selectedCardId: string | null;
  cards: GameCardInstance[];
  filterSourceCards: readonly GameCardInstance[] | null;
  total: number;
  type: string;
  search: string;
  showFilters: boolean;
  readOnly: boolean;
  allowRandomSelect: boolean;
  allowGiveDestination?: boolean;
  allowReorder: boolean;
  drawOrderLabels: readonly string[];
  viewTopCount: number | null;
  selectedCard: GameCardInstance | null;
  loading: boolean;
  lifecycle: ZoneModalLifecycle;
  statusMessageKey: string | null;
  localMultiSelect: boolean;
  selectionRevision: string;
  libraryWindow?: GameLibraryWindowState | null;
  mutationPending?: boolean;
  mutationErrorKey?: string | null;
}

@Injectable()
export class GameTableZoneModalState {
  readonly zoneModal = signal<ZoneModalState | null>(null);
  private selectionRevision = 0;

  open(
    playerId: string,
    zone: GameZoneName,
    title: string,
    selectedCardId: string | null = null,
    readOnly = false,
    options: { allowGiveDestination?: boolean; localMultiSelect?: boolean } = {},
  ): void {
    this.zoneModal.set({
      playerId,
      zone,
      title,
      selectedCardId,
      cards: [],
      filterSourceCards: null,
      total: 0,
      type: '',
      search: '',
      showFilters: true,
      readOnly,
      allowRandomSelect: true,
      allowGiveDestination: options.allowGiveDestination === true,
      allowReorder: false,
      drawOrderLabels: [],
      viewTopCount: null,
      selectedCard: null,
      loading: true,
      lifecycle: 'loading',
      statusMessageKey: null,
      localMultiSelect: options.localMultiSelect === true,
      selectionRevision: this.nextSelectionRevision(playerId, zone),
      libraryWindow: null,
      mutationPending: false,
      mutationErrorKey: null,
    });
  }

  openFixed(
    playerId: string,
    zone: GameZoneName,
    title: string,
    cards: GameCardInstance[],
    selectedCardId: string | null = null,
    allowRandomSelect = false,
    options: { allowGiveDestination?: boolean; allowReorder?: boolean; drawOrderLabels?: readonly string[]; viewTopCount?: number | null; localMultiSelect?: boolean } = {},
  ): void {
    this.zoneModal.set({
      playerId,
      zone,
      title,
      selectedCardId,
      cards,
      filterSourceCards: null,
      total: cards.length,
      type: '',
      search: '',
      showFilters: false,
      readOnly: false,
      allowRandomSelect,
      allowGiveDestination: options.allowGiveDestination === true,
      allowReorder: options.allowReorder === true,
      drawOrderLabels: options.drawOrderLabels ?? [],
      viewTopCount: options.viewTopCount ?? null,
      selectedCard: cards.find((card) => card.instanceId === selectedCardId) ?? cards[0] ?? null,
      loading: false,
      lifecycle: 'ready',
      statusMessageKey: null,
      localMultiSelect: options.localMultiSelect === true,
      selectionRevision: this.nextSelectionRevision(playerId, zone),
      libraryWindow: null,
      mutationPending: false,
      mutationErrorKey: null,
    });
  }

  setLoading(): void {
    const modal = this.zoneModal();
    if (!modal) {
      return;
    }

    this.zoneModal.set({ ...modal, loading: true, lifecycle: 'loading', statusMessageKey: null });
  }

  setLoaded(cards: GameCardInstance[], total: number, filterSourceCards?: readonly GameCardInstance[] | null): void {
    const modal = this.zoneModal();
    if (!modal) {
      return;
    }

    this.zoneModal.set({
      ...modal,
      cards,
      filterSourceCards: filterSourceCards === undefined ? modal.filterSourceCards : filterSourceCards,
      total,
      selectedCard: cards.find((card) => card.instanceId === modal.selectedCardId) ?? cards[0] ?? null,
      drawOrderLabels: modal.drawOrderLabels.slice(0, cards.length),
      loading: false,
      lifecycle: 'ready',
      statusMessageKey: null,
    });
  }

  patchFilters(patch: Partial<Pick<ZoneModalState, 'type' | 'search'>>): void {
    const modal = this.zoneModal();
    if (!modal) {
      return;
    }

    this.zoneModal.set({ ...modal, ...patch });
  }

  selectCard(card: GameCardInstance): void {
    const modal = this.zoneModal();
    if (!modal) {
      return;
    }

    this.zoneModal.set({ ...modal, selectedCardId: card.instanceId, selectedCard: card });
  }

  replaceCards(cards: GameCardInstance[]): void {
    const modal = this.zoneModal();
    if (!modal) {
      return;
    }

    const fixedSlotCount = modal.allowReorder
      ? Math.max(modal.total, modal.drawOrderLabels.length, cards.length)
      : cards.length;

    this.zoneModal.set({
      ...modal,
      cards,
      filterSourceCards: null,
      total: fixedSlotCount,
      selectedCard: cards.find((card) => card.instanceId === modal.selectedCardId) ?? cards[0] ?? null,
      drawOrderLabels: modal.allowReorder ? modal.drawOrderLabels : modal.drawOrderLabels.slice(0, cards.length),
    });
  }

  removeCards(instanceIds: readonly string[]): void {
    const modal = this.zoneModal();
    if (!modal || instanceIds.length === 0) {
      return;
    }

    const movedIds = new Set(instanceIds);
    const cards = modal.cards.filter((card) => !movedIds.has(card.instanceId));
    const removedCount = modal.cards.length - cards.length;
    if (removedCount === 0) {
      return;
    }

    if (modal.localMultiSelect) {
      this.markLibraryViewStale();
      return;
    }

    const fixedSlotCount = modal.allowReorder
      ? Math.max(modal.total, modal.drawOrderLabels.length)
      : Math.max(0, modal.total - removedCount);

    this.zoneModal.set({
      ...modal,
      cards,
      filterSourceCards: null,
      total: fixedSlotCount,
      selectedCard: cards.find((card) => card.instanceId === modal.selectedCardId) ?? cards[0] ?? null,
      drawOrderLabels: modal.allowReorder ? modal.drawOrderLabels : modal.drawOrderLabels.slice(0, cards.length),
      loading: false,
    });
  }

  close(): void {
    this.zoneModal.set(null);
  }

  bindLibraryWindow(window: GameLibraryWindowState): void {
    const modal = this.zoneModal();
    if (!modal?.localMultiSelect || modal.playerId === '' || window.status !== 'active') {
      return;
    }
    this.zoneModal.set({ ...modal, libraryWindow: { ...window }, mutationErrorKey: null });
  }

  setMutationPending(pending: boolean): void {
    const modal = this.zoneModal();
    if (!modal?.localMultiSelect || modal.lifecycle !== 'ready') {
      return;
    }
    this.zoneModal.set({ ...modal, mutationPending: pending, mutationErrorKey: pending ? null : modal.mutationErrorKey });
  }

  setMutationError(messageKey = 'game.zoneModal.batchError'): void {
    const modal = this.zoneModal();
    if (!modal?.localMultiSelect || modal.lifecycle !== 'ready') {
      return;
    }
    this.zoneModal.set({ ...modal, mutationPending: false, mutationErrorKey: messageKey });
  }

  markLibraryViewStale(messageKey = 'game.zoneModal.viewStale'): void {
    const modal = this.zoneModal();
    if (!modal?.localMultiSelect || modal.lifecycle === 'stale') {
      return;
    }

    this.zoneModal.set({
      ...modal,
      cards: [],
      filterSourceCards: null,
      selectedCardId: null,
      selectedCard: null,
      total: 0,
      loading: false,
      lifecycle: 'stale',
      statusMessageKey: messageKey,
      mutationPending: false,
      mutationErrorKey: null,
    });
  }

  markLibraryViewError(messageKey = 'game.zoneModal.viewError'): void {
    const modal = this.zoneModal();
    if (!modal?.localMultiSelect) {
      return;
    }

    this.zoneModal.set({
      ...modal,
      cards: [],
      filterSourceCards: null,
      selectedCardId: null,
      selectedCard: null,
      total: 0,
      loading: false,
      lifecycle: 'error',
      statusMessageKey: messageKey,
      mutationPending: false,
      mutationErrorKey: null,
    });
  }

  reconcileLibraryView(snapshot: GameSnapshot | null): void {
    const modal = this.zoneModal();
    if (!modal?.localMultiSelect || modal.zone !== 'library' || modal.lifecycle !== 'ready') {
      return;
    }

    const player = snapshot?.players[modal.playerId];
    if (!player) {
      this.markLibraryViewStale();
      return;
    }
    if (modal.libraryWindow) {
      const authoritative = player.libraryWindow;
      if (
        !authoritative
        || authoritative.status !== 'active'
        || authoritative.windowId !== modal.libraryWindow.windowId
        || authoritative.expectedEpoch !== modal.libraryWindow.expectedEpoch
      ) {
        this.markLibraryViewStale();
        return;
      }
    }

    const visibleLibrary = player.zones.library.filter((card) => card.hidden !== true);
    const authorizedCards = modal.viewTopCount === null
      ? visibleLibrary
      : visibleLibrary.slice(0, modal.viewTopCount);
    const currentIds = modal.cards.map((card) => card.instanceId);
    const authorizedIds = authorizedCards.map((card) => card.instanceId);
    if (!sameOrder(currentIds, authorizedIds)) {
      this.markLibraryViewStale();
      return;
    }

    this.zoneModal.set({
      ...modal,
      cards: [...authorizedCards],
      selectedCard: authorizedCards.find((card) => card.instanceId === modal.selectedCardId) ?? authorizedCards[0] ?? null,
    });
  }

  private nextSelectionRevision(playerId: string, zone: GameZoneName): string {
    this.selectionRevision += 1;
    return `${playerId}:${zone}:${this.selectionRevision}`;
  }
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((instanceId, index) => instanceId === right[index]);
}

