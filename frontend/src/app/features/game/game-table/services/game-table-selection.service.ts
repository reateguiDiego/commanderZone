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

export interface BattlefieldStackSelectionRef {
  readonly kind: 'battlefield-stack';
  readonly stackId: string;
  readonly rootInstanceId: string;
  readonly playerId: string;
  readonly zone: 'battlefield';
  readonly memberCount: number;
}

export type GroupSelectionRef = BattlefieldStackSelectionRef;

export interface ResolvedGroupSelection {
  readonly ref: GroupSelectionRef;
  readonly rootCard: GameCardInstance;
}

export interface GameTableSelectionState {
  readonly selectedIds: ReadonlySet<string>;
  readonly orderedSelectedIds: readonly string[];
  readonly ownerPlayerId: string | null;
  readonly zone: GameZoneName | null;
  readonly regionId: string | null;
  readonly focusedId: string | null;
  readonly anchorId: string | null;
  readonly selectedGroupRefs: ReadonlySet<GroupSelectionRef>;
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
  readonly selectedGroupRefs = signal<readonly GroupSelectionRef[]>([]);
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
      selectedGroupRefs: new Set(this.selectedGroupRefs()),
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
    this.selectedGroupRefs.set([]);
    this.commit([], 'clear', null, null);
  }

  selectSingle(playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    this.selectedGroupRefs.set([]);
    this.commit([{ playerId, zone, card }], 'click', card.instanceId, card.instanceId);
  }

  selectMany(
    playerId: string,
    zone: GameZoneName,
    cards: readonly GameCardInstance[],
    groupRefs: readonly GroupSelectionRef[] = [],
  ): void {
    const selected = this.uniqueCards(cards).map((card) => ({ playerId, zone, card }));
    this.selectedGroupRefs.set(this.validGroupRefsForSelection(groupRefs, selected));
    this.commit(selected, 'selectAll', selected[0]?.card.instanceId ?? null, selected[0]?.card.instanceId ?? null);
  }

  replaceSelectedCards(cards: readonly SelectedCardState[]): void {
    this.selectedGroupRefs.set([]);
    this.commit(cards, 'click', cards.at(-1)?.card.instanceId ?? null, cards[0]?.card.instanceId ?? null);
  }

  selectStackGroup(event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>, ref: BattlefieldStackSelectionRef, rootCard: GameCardInstance): SelectionToggleResult {
    const selected = this.selectedCards();
    const compatible = this.isCompatibleSource(selected, ref.playerId, 'battlefield');
    const modifier = event.ctrlKey || event.metaKey || event.shiftKey;
    const groupSelected = this.selectedGroupRefs().some((candidate) => candidate.stackId === ref.stackId);

    if (!modifier) {
      if (compatible && groupSelected && selected.some((item) => item.card.instanceId === ref.rootInstanceId)) {
        this.commit(selected, 'click', ref.rootInstanceId, this.metadata().anchorId ?? ref.rootInstanceId);
        return 'updated';
      }
      this.selectedGroupRefs.set([ref]);
      this.commit([{ playerId: ref.playerId, zone: 'battlefield', card: rootCard }], 'click', ref.rootInstanceId, ref.rootInstanceId);
      return selected.length > 0 && !compatible ? 'replacedSource' : 'updated';
    }

    if (!compatible) {
      this.selectedGroupRefs.set([ref]);
      this.commit([{ playerId: ref.playerId, zone: 'battlefield', card: rootCard }], 'modifierClick', ref.rootInstanceId, ref.rootInstanceId);
      return selected.length > 0 ? 'replacedSource' : 'updated';
    }

    if (groupSelected) {
      this.selectedGroupRefs.set(this.selectedGroupRefs().filter((candidate) => candidate.stackId !== ref.stackId));
      this.commit(selected.filter((item) => item.card.instanceId !== ref.rootInstanceId), 'modifierClick', ref.rootInstanceId, null);
      return 'updated';
    }

    const withoutRoot = selected.filter((item) => item.card.instanceId !== ref.rootInstanceId);
    this.selectedGroupRefs.set([...this.selectedGroupRefs(), ref]);
    this.commit([...withoutRoot, { playerId: ref.playerId, zone: 'battlefield', card: rootCard }], 'modifierClick', ref.rootInstanceId, this.metadata().anchorId ?? ref.rootInstanceId);
    return 'updated';
  }

  selectHandRange(
    playerId: string,
    visualCards: readonly GameCardInstance[],
    targetCard: GameCardInstance,
    additive: boolean,
  ): void {
    const cards = this.uniqueCards(visualCards);
    const selected = this.selectedCards();
    const compatible = this.isCompatibleSource(selected, playerId, 'hand');
    const visualIds = new Set(cards.map((card) => card.instanceId));
    const metadata = this.metadata();
    const selectedAnchor = compatible
      ? selected.find((item) => visualIds.has(item.card.instanceId))?.card.instanceId ?? null
      : null;
    const anchorId = compatible && metadata.anchorId !== null && visualIds.has(metadata.anchorId)
      ? metadata.anchorId
      : compatible && metadata.focusedId !== null && visualIds.has(metadata.focusedId)
        ? metadata.focusedId
        : selectedAnchor ?? targetCard.instanceId;
    const anchorIndex = cards.findIndex((card) => card.instanceId === anchorId);
    const targetIndex = cards.findIndex((card) => card.instanceId === targetCard.instanceId);
    if (targetIndex < 0) {
      return;
    }
    const start = Math.min(anchorIndex < 0 ? targetIndex : anchorIndex, targetIndex);
    const end = Math.max(anchorIndex < 0 ? targetIndex : anchorIndex, targetIndex);
    const range = cards.slice(start, end + 1).map((card) => ({ playerId, zone: 'hand' as const, card }));
    const next = additive && compatible ? this.uniqueSelections([...selected, ...range]) : range;

    this.selectedGroupRefs.set([]);
    this.commit(next, 'modifierClick', targetCard.instanceId, anchorId);
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

    this.selectedGroupRefs.set([]);
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
    const ids = new Set(next.map((item) => item.card.instanceId));
    this.selectedGroupRefs.set(this.selectedGroupRefs().filter((ref) => ids.has(ref.rootInstanceId)));
    this.metadata.update((current) => ({
      ...current,
      focusedId: current.focusedId && ids.has(current.focusedId) ? current.focusedId : next.at(-1)?.card.instanceId ?? null,
      anchorId: current.anchorId && ids.has(current.anchorId) ? current.anchorId : next[0]?.card.instanceId ?? null,
    }));
  }

  reconcileGroupReferences(resolved: readonly ResolvedGroupSelection[]): void {
    const currentRefs = this.selectedGroupRefs();
    if (currentRefs.length === 0) {
      return;
    }
    const resolvedById = new Map(resolved.map((item) => [item.ref.stackId, item]));
    const oldRootIds = new Set(currentRefs.map((ref) => ref.rootInstanceId));
    const replacements = currentRefs
      .map((ref) => resolvedById.get(ref.stackId) ?? null)
      .filter((item): item is ResolvedGroupSelection => item !== null);
    const replacementByOldRoot = new Map(currentRefs.map((ref) => [ref.rootInstanceId, resolvedById.get(ref.stackId) ?? null]));
    const next: SelectedCardState[] = [];
    const insertedGroups = new Set<string>();
    for (const item of this.selectedCards()) {
      if (!oldRootIds.has(item.card.instanceId)) {
        next.push(item);
        continue;
      }
      const replacement = replacementByOldRoot.get(item.card.instanceId);
      if (replacement && !insertedGroups.has(replacement.ref.stackId)) {
        next.push({ playerId: replacement.ref.playerId, zone: 'battlefield', card: replacement.rootCard });
        insertedGroups.add(replacement.ref.stackId);
      }
    }
    for (const replacement of replacements) {
      if (!insertedGroups.has(replacement.ref.stackId)) {
        next.push({ playerId: replacement.ref.playerId, zone: 'battlefield', card: replacement.rootCard });
      }
    }
    this.selectedGroupRefs.set(replacements.map((item) => item.ref));
    this.reconcileSelectedCards(next);
  }

  setFocusedId(instanceId: string | null): void {
    this.metadata.update((current) => ({ ...current, focusedId: instanceId }));
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
      this.selectedGroupRefs.set([]);
      this.commit([{ playerId, zone, card }], interactionType, card.instanceId, card.instanceId);
      return selected.length > 0 ? 'replacedSource' : 'updated';
    }

    const existing = selected.some((item) => item.card.instanceId === card.instanceId);
    const next = existing
      ? selected.filter((item) => item.card.instanceId !== card.instanceId)
      : [...selected, { playerId, zone, card }];
    this.commit(next, interactionType, card.instanceId, next[0]?.card.instanceId ?? null);
    if (zone !== 'battlefield' || !next.some((item) => item.card.instanceId === card.instanceId)) {
      this.selectedGroupRefs.set(this.selectedGroupRefs().filter((ref) => next.some((item) => item.card.instanceId === ref.rootInstanceId)));
    }
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

  private validGroupRefsForSelection(
    refs: readonly GroupSelectionRef[],
    selected: readonly SelectedCardState[],
  ): GroupSelectionRef[] {
    const selectedIds = new Set(selected.map((item) => item.card.instanceId));
    const seen = new Set<string>();
    return refs.filter((ref) => {
      if (seen.has(ref.stackId) || !selectedIds.has(ref.rootInstanceId)) {
        return false;
      }
      seen.add(ref.stackId);
      return true;
    });
  }
}
