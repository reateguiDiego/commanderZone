import { GameSnapshot, GameZoneName } from '../../../../core/models/game.model';
import { SelectedCard } from '../models/game-table-card.model';

interface CardSelectionRef {
  readonly playerId: string;
  readonly zone: GameZoneName;
  readonly card: { readonly instanceId: string };
}

interface ContextMenuRef {
  readonly playerId: string;
  readonly zone: GameZoneName;
  readonly card?: { readonly instanceId: string };
}

export interface TransientCardUiState {
  readonly selectedCards: readonly SelectedCard[];
  readonly currentPlayerId: string | null;
  readonly hoveredSelection: CardSelectionRef | null;
  readonly contextMenu: ContextMenuRef | null;
}

export interface TransientCardUiPruneResult {
  readonly selectedCards: SelectedCard[];
  readonly clearCardPreview: boolean;
  readonly closeContextMenu: boolean;
}

export function pruneTransientCardUiState(
  snapshot: GameSnapshot | null,
  state: TransientCardUiState,
): TransientCardUiPruneResult {
  return {
    selectedCards: pruneSelectedCards(snapshot, state.selectedCards, state.currentPlayerId),
    clearCardPreview: state.hoveredSelection !== null && !cardRefStillInZone(snapshot, state.hoveredSelection),
    closeContextMenu: state.contextMenu?.card !== undefined && !cardRefStillInZone(snapshot, {
      playerId: state.contextMenu.playerId,
      zone: state.contextMenu.zone,
      card: state.contextMenu.card,
    }),
  };
}

function pruneSelectedCards(
  snapshot: GameSnapshot | null,
  selectedCards: readonly SelectedCard[],
  currentPlayerId: string | null,
): SelectedCard[] {
  const currentPlayer = currentPlayerId ? snapshot?.players[currentPlayerId] : null;
  if (!snapshot || !currentPlayerId || !currentPlayer || currentPlayer.status !== 'active' || snapshot.gamePhase === 'FINISHED') {
    return [];
  }

  const source = selectedCards[0] ?? null;
  if (!source || (source.zone !== 'hand' && source.zone !== 'battlefield')) {
    return [];
  }

  const hiddenStackMembers = new Set(
    (snapshot.battlefieldStacks ?? []).flatMap((stack) =>
      stack.orderedMemberIds.filter((instanceId) => instanceId !== stack.rootInstanceId),
    ),
  );
  const retainedIds = new Set<string>();
  const retained: SelectedCard[] = [];

  for (const selection of selectedCards) {
    if (selection.playerId !== source.playerId || selection.zone !== source.zone || retainedIds.has(selection.card.instanceId)) {
      continue;
    }
    const card = snapshot.players[selection.playerId]?.zones[selection.zone]
      ?.find((candidate) => candidate.instanceId === selection.card.instanceId);
    if (!card || card.hidden === true) {
      continue;
    }
    if (selection.zone === 'hand' && (
      selection.playerId !== currentPlayerId
      || card.controllerId !== undefined && card.controllerId !== currentPlayerId
    )) {
      continue;
    }
    if (selection.zone === 'battlefield' && (
      (card.controllerId || selection.playerId) !== currentPlayerId
      || hiddenStackMembers.has(card.instanceId)
    )) {
      continue;
    }

    retainedIds.add(card.instanceId);
    retained.push({ ...selection, card });
  }

  return retained;
}

function cardRefStillInZone(snapshot: GameSnapshot | null, ref: CardSelectionRef): boolean {
  return snapshot?.players[ref.playerId]?.zones[ref.zone]
    ?.some((card) => card.instanceId === ref.card.instanceId) ?? false;
}
