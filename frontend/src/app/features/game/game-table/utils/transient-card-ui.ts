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
    selectedCards: state.selectedCards.filter((selection) => cardRefStillInZone(snapshot, selection)),
    clearCardPreview: state.hoveredSelection !== null && !cardRefStillInZone(snapshot, state.hoveredSelection),
    closeContextMenu: state.contextMenu?.card !== undefined && !cardRefStillInZone(snapshot, {
      playerId: state.contextMenu.playerId,
      zone: state.contextMenu.zone,
      card: state.contextMenu.card,
    }),
  };
}

function cardRefStillInZone(snapshot: GameSnapshot | null, ref: CardSelectionRef): boolean {
  return snapshot?.players[ref.playerId]?.zones[ref.zone]
    ?.some((card) => card.instanceId === ref.card.instanceId) ?? false;
}
