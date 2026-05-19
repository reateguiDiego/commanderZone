import { Injectable, signal } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';

export interface ZoneModalState {
  playerId: string;
  zone: GameZoneName;
  title: string;
  selectedCardId: string | null;
  cards: GameCardInstance[];
  total: number;
  type: string;
  search: string;
  showFilters: boolean;
  readOnly: boolean;
  allowRandomSelect: boolean;
  allowReorder: boolean;
  drawOrderLabels: readonly string[];
  selectedCard: GameCardInstance | null;
  loading: boolean;
}

@Injectable()
export class GameTableZoneModalState {
  readonly zoneModal = signal<ZoneModalState | null>(null);

  open(playerId: string, zone: GameZoneName, title: string, selectedCardId: string | null = null, readOnly = false): void {
    this.zoneModal.set({
      playerId,
      zone,
      title,
      selectedCardId,
      cards: [],
      total: 0,
      type: '',
      search: '',
      showFilters: true,
      readOnly,
      allowRandomSelect: true,
      allowReorder: false,
      drawOrderLabels: [],
      selectedCard: null,
      loading: true,
    });
  }

  openFixed(
    playerId: string,
    zone: GameZoneName,
    title: string,
    cards: GameCardInstance[],
    selectedCardId: string | null = null,
    allowRandomSelect = false,
    options: { allowReorder?: boolean; drawOrderLabels?: readonly string[] } = {},
  ): void {
    this.zoneModal.set({
      playerId,
      zone,
      title,
      selectedCardId,
      cards,
      total: cards.length,
      type: '',
      search: '',
      showFilters: false,
      readOnly: false,
      allowRandomSelect,
      allowReorder: options.allowReorder === true,
      drawOrderLabels: options.drawOrderLabels ?? [],
      selectedCard: cards.find((card) => card.instanceId === selectedCardId) ?? cards[0] ?? null,
      loading: false,
    });
  }

  setLoading(): void {
    const modal = this.zoneModal();
    if (!modal) {
      return;
    }

    this.zoneModal.set({ ...modal, loading: true });
  }

  setLoaded(cards: GameCardInstance[], total: number): void {
    const modal = this.zoneModal();
    if (!modal) {
      return;
    }

    this.zoneModal.set({
      ...modal,
      cards,
      total,
      selectedCard: cards.find((card) => card.instanceId === modal.selectedCardId) ?? cards[0] ?? null,
      drawOrderLabels: modal.drawOrderLabels.slice(0, cards.length),
      loading: false,
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

    this.zoneModal.set({
      ...modal,
      cards,
      total: cards.length,
      selectedCard: cards.find((card) => card.instanceId === modal.selectedCardId) ?? cards[0] ?? null,
      drawOrderLabels: modal.drawOrderLabels.slice(0, cards.length),
    });
  }

  close(): void {
    this.zoneModal.set(null);
  }
}

