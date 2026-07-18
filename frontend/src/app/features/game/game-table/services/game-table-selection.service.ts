import { Injectable, computed, signal } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';

export interface SelectedCardState {
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
}

interface CurrentPlayerView {
  id: string;
  state: { status?: string };
}

export type SelectionToggleResult = 'updated' | 'replacedSource';
export type SelectionModifierMode = 'replace' | 'add' | 'toggle';
export type SelectionInteractionType = 'clear' | 'click' | 'modifierClick' | 'keyboard' | 'selectAll' | 'marquee';

export interface GameTableSelectionState {
  readonly selectedIds: ReadonlySet<string>;
  readonly orderedSelectedIds: readonly string[];
  readonly ownerPlayerId: string | null;
  readonly zone: GameZoneName | null;
  readonly regionId: string | null;
  readonly focusedId: string | null;
  readonly anchorId: string | null;
  readonly interactionRevision: number;
  readonly lastInteractionType: SelectionInteractionType;
}

interface SelectionMetadata {
  readonly focusedId: string | null;
  readonly anchorId: string | null;
  readonly interactionRevision: number;
  readonly lastInteractionType: SelectionInteractionType;
}

@Injectable()
export class GameTableSelectionService {
  readonly selectedCards = signal<SelectedCardState[]>([]);
  private readonly metadata = signal<SelectionMetadata>({
    focusedId: null,
    anchorId: null,
    interactionRevision: 0,
    lastInteractionType: 'clear',
  });

  readonly state = computed<GameTableSelectionState>(() => {
    const selected = this.selectedCards();
    const first = selected[0] ?? null;
    const metadata = this.metadata();
    const orderedSelectedIds = selected.map((item) => item.card.instanceId);

    return {
      selectedIds: new Set(orderedSelectedIds),
      orderedSelectedIds,
      ownerPlayerId: first?.playerId ?? null,
      zone: first?.zone ?? null,
      regionId: first ? this.regionId(first.playerId, first.zone) : null,
      focusedId: metadata.focusedId,
      anchorId: metadata.anchorId,
      interactionRevision: metadata.interactionRevision,
      lastInteractionType: metadata.lastInteractionType,
    };
  });
  readonly selectedIds = computed(() => this.state().selectedIds);
  readonly orderedSelectedIds = computed(() => this.state().orderedSelectedIds);
  readonly selectedCount = computed(() => this.selectedCards().length);

  activeKeyboardCard(hoveredSelection: SelectedCardState | null): SelectedCardState | null {
    return this.selectedCards()[0] ?? hoveredSelection;
  }

  clearSelection(): void {
    this.commit([], 'clear', null, null);
  }

  selectSingle(playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    this.commit([{ playerId, zone, card }], 'click', card.instanceId, card.instanceId);
  }

  selectMany(playerId: string, zone: GameZoneName, cards: readonly GameCardInstance[]): void {
    const selected = this.uniqueCards(cards).map((card) => ({ playerId, zone, card }));
    this.commit(selected, 'selectAll', selected[0]?.card.instanceId ?? null, selected[0]?.card.instanceId ?? null);
  }

  applyMarqueeSelection(
    playerId: string,
    zone: GameZoneName,
    cards: readonly GameCardInstance[],
    mode: SelectionModifierMode,
  ): void {
    const candidates = this.uniqueCards(cards).map((card) => ({ playerId, zone, card }));
    const selected = this.selectedCards();
    const compatible = this.isCompatibleSource(selected, playerId, zone);
    let next: SelectedCardState[];

    if (mode === 'replace' || !compatible) {
      next = candidates;
    } else if (mode === 'add') {
      const existing = new Set(selected.map((item) => item.card.instanceId));
      next = [...selected, ...candidates.filter((item) => !existing.has(item.card.instanceId))];
    } else {
      const toggledIds = new Set(candidates.map((item) => item.card.instanceId));
      const retained = selected.filter((item) => !toggledIds.has(item.card.instanceId));
      const selectedIds = new Set(selected.map((item) => item.card.instanceId));
      next = [...retained, ...candidates.filter((item) => !selectedIds.has(item.card.instanceId))];
    }

    this.commit(next, 'marquee', next.at(-1)?.card.instanceId ?? null, next[0]?.card.instanceId ?? null);
  }

  toggleKeyboardSelection(playerId: string, zone: GameZoneName, card: GameCardInstance): SelectionToggleResult {
    return this.toggleCard(playerId, zone, card, 'keyboard');
  }

  toggleSelection(event: MouseEvent, playerId: string, zone: GameZoneName, card: GameCardInstance): SelectionToggleResult {
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      return this.toggleCard(playerId, zone, card, 'modifierClick');
    }

    const selected = this.selectedCards();
    if (this.isCompatibleSource(selected, playerId, zone) && selected.some((item) => item.card.instanceId === card.instanceId)) {
      const refreshed = selected.map((item) => item.card.instanceId === card.instanceId ? { playerId, zone, card } : item);
      this.commit(refreshed, 'click', card.instanceId, this.metadata().anchorId ?? card.instanceId);
      return 'updated';
    }

    this.commit([{ playerId, zone, card }], 'click', card.instanceId, card.instanceId);
    return 'updated';
  }

  reconcileSelectedCards(cards: readonly SelectedCardState[]): void {
    const next = this.uniqueSelections(cards);
    const current = this.selectedCards();
    const unchanged = current.length === next.length
      && current.every((item, index) => item.playerId === next[index]?.playerId
        && item.zone === next[index]?.zone
        && item.card === next[index]?.card);
    if (!unchanged) {
      this.selectedCards.set(next);
    }
  }

  isSelected(instanceId: string): boolean {
    return this.selectedIds().has(instanceId);
  }

  isCurrentPlayer(currentPlayer: CurrentPlayerView | null, playerId: string): boolean {
    return currentPlayer?.id === playerId;
  }

  canControlPlayer(currentPlayer: CurrentPlayerView | null, playerId: string): boolean {
    return currentPlayer?.id === playerId && currentPlayer.state.status === 'active';
  }

  canUseHiddenZone(currentPlayer: CurrentPlayerView | null, playerId: string, zone: GameZoneName): boolean {
    return !['library', 'hand'].includes(zone) || this.isCurrentPlayer(currentPlayer, playerId);
  }

  private toggleCard(
    playerId: string,
    zone: GameZoneName,
    card: GameCardInstance,
    interactionType: 'keyboard' | 'modifierClick',
  ): SelectionToggleResult {
    const selected = this.selectedCards();
    if (!this.isCompatibleSource(selected, playerId, zone)) {
      this.commit([{ playerId, zone, card }], interactionType, card.instanceId, card.instanceId);
      return selected.length > 0 ? 'replacedSource' : 'updated';
    }

    const existing = selected.some((item) => item.card.instanceId === card.instanceId);
    const next = existing
      ? selected.filter((item) => item.card.instanceId !== card.instanceId)
      : [...selected, { playerId, zone, card }];
    this.commit(next, interactionType, card.instanceId, next[0]?.card.instanceId ?? null);
    return 'updated';
  }

  private commit(
    selected: readonly SelectedCardState[],
    lastInteractionType: SelectionInteractionType,
    focusedId: string | null,
    anchorId: string | null,
  ): void {
    const next = this.uniqueSelections(selected);
    this.selectedCards.set(next);
    this.metadata.update((current) => ({
      focusedId: next.some((item) => item.card.instanceId === focusedId) ? focusedId : next.at(-1)?.card.instanceId ?? null,
      anchorId: next.some((item) => item.card.instanceId === anchorId) ? anchorId : next[0]?.card.instanceId ?? null,
      interactionRevision: current.interactionRevision + 1,
      lastInteractionType,
    }));
  }

  private isCompatibleSource(selected: readonly SelectedCardState[], playerId: string, zone: GameZoneName): boolean {
    const first = selected[0];
    return !first || first.playerId === playerId && first.zone === zone;
  }

  private regionId(playerId: string, zone: GameZoneName): string {
    return `${playerId}:${zone}`;
  }

  private uniqueCards(cards: readonly GameCardInstance[]): GameCardInstance[] {
    const ids = new Set<string>();
    return cards.filter((card) => {
      if (card.instanceId === '' || ids.has(card.instanceId)) {
        return false;
      }
      ids.add(card.instanceId);
      return true;
    });
  }

  private uniqueSelections(selected: readonly SelectedCardState[]): SelectedCardState[] {
    const ids = new Set<string>();
    return selected.filter((item) => {
      if (item.card.instanceId === '' || ids.has(item.card.instanceId)) {
        return false;
      }
      ids.add(item.card.instanceId);
      return true;
    });
  }
}
