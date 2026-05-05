import { Injectable, signal } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';

export interface ZoneModalState {
  playerId: string;
  zone: GameZoneName;
  title: string;
  cards: GameCardInstance[];
  total: number;
  type: string;
  search: string;
  selectedCard: GameCardInstance | null;
  loading: boolean;
}

@Injectable()
export class GameTableZoneModalState {
  readonly zoneModal = signal<ZoneModalState | null>(null);

  open(playerId: string, zone: GameZoneName, title: string): void {
    this.zoneModal.set({
      playerId,
      zone,
      title,
      cards: [],
      total: 0,
      type: '',
      search: '',
      selectedCard: null,
      loading: true,
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
      selectedCard: cards[0] ?? null,
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

    this.zoneModal.set({ ...modal, selectedCard: card });
  }

  close(): void {
    this.zoneModal.set(null);
  }
}

