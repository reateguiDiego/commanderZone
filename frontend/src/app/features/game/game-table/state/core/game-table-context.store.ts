import { Injectable, inject } from '@angular/core';
import { AuthStore } from '../../../../../core/auth/auth.store';
import { GameCardInstance, GameCommandType, GameSnapshot, GameZoneName } from '../../../../../core/models/game.model';
import { SelectedCard } from '../../models/game-table-card.model';
import { GameTableBattlefieldDragContext } from '../../services/game-table-battlefield-drag-coordinator.service';
import { GameTableCardActionContext } from '../../services/game-table-card-actions.service';
import { GameTableCardStatsContext } from '../../services/game-table-card-stats.service';
import { GameTableDebouncedValueCommandContext } from '../../services/game-table-debounced-value-commands.service';
import { GameTableDragService } from '../../services/game-table-drag.service';
import { GameTableDropActionContext, PendingBattlefieldMove, PendingLibraryMove } from '../../services/game-table-drop-actions.service';
import { GameTableInteractionActionsService, GameTableInteractionContext } from '../../services/game-table-interaction-actions.service';
import { GameTableLibraryActionContext } from '../../services/game-table-library-actions.service';
import { GameTablePointerDragActionContext } from '../../services/game-table-pointer-drag-actions.service';
import { GameTableSessionContext, GameTableSessionService } from '../../services/game-table-session.service';
import { GameTableTurnActionContext } from '../../services/game-table-turn-actions.service';
import { GameTableZoneActionContext, GameTableZoneActionsService } from '../../services/game-table-zone-actions.service';
import { GameTableWebsocketGameplayService } from '../../services/game-table-websocket-gameplay.service';
import { GameTableArrowInteractionContext } from '../arrows/game-table-arrows.state';
import { GameTableAttachmentInteractionContext } from '../attachments/game-table-attachments.state';
import { GameTableBattlefieldContext, GameTableBattlefieldState } from '../battlefield/game-table-battlefield.state';
import { GameTableCardCounterContext } from '../cards/game-table-cards.state';
import { GameTableDragDropContext, GameTableDragDropStore, GameTablePendingMoveContext } from '../drag-drop/game-table-drag-drop.store';
import { GameTableHandContext, GameTableHandState } from '../hand/game-table-hand.state';
import { GameTableDropFeedbackState } from '../drag-drop/game-table-drop-feedback.state';
import { GameTableGameActionsStore } from '../game-actions/game-table-game-actions.store';
import { GameTablePendingTransferState } from './game-table-pending-transfer.state';
import { GameTablePlayersStore } from '../players/game-table-players.store';
import { GameTableSelectionService } from '../../services/game-table-selection.service';
import { GameTableUiState } from './game-table-ui.state';
import { GameTableZoneModalState } from '../zones/game-table-zone-modal.state';
import { GameTableZonePilesState } from '../zones/game-table-zone-piles.state';
import { GameTableCommandContext } from './game-table-command.store';
import { GameTableCoreState } from './game-table-core.state';
import { gameTableErrorMessage } from './game-table-error-message.util';
import { GameTableToastState } from './game-table-toast.state';

export interface GameTableContextSource {
  readonly setSnapshot: (snapshot: GameSnapshot | null) => void;
  readonly refetch: (force?: boolean) => Promise<void>;
  readonly command: (type: GameCommandType, payload: Record<string, unknown>, force?: boolean) => Promise<void>;
  readonly playCard: (playerId: string, zone: GameZoneName, card: GameCardInstance) => Promise<void>;
  readonly setPendingBattlefieldMove: (move: PendingBattlefieldMove | null) => void;
  readonly setPendingLibraryMove: (move: PendingLibraryMove | null) => void;
  readonly pendingBattlefieldMove: () => PendingBattlefieldMove | null;
  readonly pendingLibraryMove: () => PendingLibraryMove | null;
}

@Injectable()
export class GameTableContextStore {
  private readonly auth = inject(AuthStore);
  private readonly core = inject(GameTableCoreState);
  private readonly battlefieldState = inject(GameTableBattlefieldState);
  private readonly drag = inject(GameTableDragService);
  private readonly dragDropStore = inject(GameTableDragDropStore);
  private readonly dropFeedbackState = inject(GameTableDropFeedbackState);
  private readonly gameActionsStore = inject(GameTableGameActionsStore);
  private readonly handState = inject(GameTableHandState);
  private readonly interactionActions = inject(GameTableInteractionActionsService);
  private readonly pendingTransferState = inject(GameTablePendingTransferState);
  private readonly playersStore = inject(GameTablePlayersStore);
  private readonly selection = inject(GameTableSelectionService);
  private readonly sessionService = inject(GameTableSessionService);
  private readonly toastState = inject(GameTableToastState);
  private readonly uiState = inject(GameTableUiState);
  private readonly websocketCommands = inject(GameTableWebsocketGameplayService);
  private readonly zoneActions = inject(GameTableZoneActionsService);
  private readonly zoneModalState = inject(GameTableZoneModalState);
  private readonly zonePilesState = inject(GameTableZonePilesState);
  private source: GameTableContextSource | null = null;

  bind(source: GameTableContextSource): void {
    this.source = source;
  }

  debouncedValueCommand(): GameTableDebouncedValueCommandContext {
    const source = this.boundSource();

    return {
      gameId: () => this.core.gameId(),
      pending: () => this.core.pending(),
      setPending: (pending) => this.core.pending.set(pending),
      setError: (message) => this.core.error.set(message),
      send: (type, payload) => this.websocketCommands.sendCommand(this.command().websocket(), type, payload),
      snapshot: () => this.core.snapshot(),
      setSnapshot: (snapshot) => source.setSnapshot(snapshot),
      refetch: () => source.refetch(true),
      errorMessage: (error) => this.errorMessage(error),
    };
  }

  libraryAction(): GameTableLibraryActionContext {
    const source = this.boundSource();

    return {
      isCurrentPlayer: (playerId) => this.playersStore.isCurrentPlayer(playerId, this.interaction()),
      currentPlayer: () => this.playersStore.currentPlayer(),
      focusedPlayer: () => this.playersStore.focusedPlayer(),
      focusPlayer: (playerId) => {
        this.playersStore.focusPlayer(playerId);
      },
      setError: (message) => this.core.error.set(message),
      command: (type, payload) => source.command(type, payload),
    };
  }

  cardAction(): GameTableCardActionContext {
    const source = this.boundSource();

    return {
      canControlPlayer: (playerId) => this.playersStore.canControlPlayer(playerId, this.interaction()),
      activeKeyboardCard: () => this.interactionActions.activeKeyboardCard() as SelectedCard | null,
      selectedCards: () => this.selectedCards(),
      clearSelectedCards: () => this.selection.selectedCards.set([]),
      zoneModal: () => this.zoneModalState.zoneModal(),
      replaceZoneModalCards: (cards) => this.zoneActions.replaceZoneModalCards(cards),
      loadZone: () => this.zoneActions.loadZone(this.zoneAction()),
      battlefieldCards: (playerId) => this.core.snapshot()?.players[playerId]?.zones.battlefield ?? [],
      cardPosition: (card) => this.battlefieldState.cardPosition(card),
      battlefieldPosition: (playerId, instanceId, position) => this.battlefieldState.ratioPositionForBattlefield(playerId, instanceId, position),
      updateLocalCardPosition: (playerId, instanceId, position) =>
        this.battlefieldState.updateLocalCardPosition(this.battlefield(), playerId, instanceId, position),
      playerName: (playerId) => this.playersStore.playerName(playerId),
      setError: (message) => this.core.error.set(message),
      closeContextMenu: () => this.uiState.closeContextMenu(),
      setPendingBattlefieldMove: (move) => source.setPendingBattlefieldMove(move),
      setPendingLibraryMove: (move) => source.setPendingLibraryMove(move),
      syncOpenZoneModalAfterMove: (playerId, fromZone, instanceIds) =>
        this.syncOpenZoneModalAfterMove(playerId, fromZone, instanceIds),
      recordCommanderCastIfNeeded: (playerId, fromZone, toZone) => this.recordCommanderCastIfNeeded(playerId, fromZone, toZone),
      command: (type, payload) => source.command(type, payload),
    };
  }

  turnAction(): GameTableTurnActionContext {
    const source = this.boundSource();

    return {
      snapshot: () => this.core.snapshot(),
      players: () => this.playersStore.players(),
      phases: () => this.core.phases,
      command: (type, payload) => source.command(type, payload),
    };
  }

  arrowInteraction(): GameTableArrowInteractionContext {
    const source = this.boundSource();

    return {
      canControlOwnedCard: (playerId, card) => this.playersStore.canControlOwnedCard(playerId, card, this.interaction()),
      setError: (message) => this.core.error.set(message),
      closeContextMenu: () => this.uiState.closeContextMenu(),
      showArrowTargetProgressToast: (remainingTargets) => this.toastState.showArrowTargetProgressToast(remainingTargets),
      showTargetToast: (message) => this.toastState.showTargetToast(message),
      clearTargetToast: () => this.toastState.clearTargetToast(),
      command: (type, payload) => source.command(type, payload),
    };
  }

  attachmentInteraction(): GameTableAttachmentInteractionContext {
    const source = this.boundSource();

    return {
      snapshot: () => this.core.snapshot(),
      canControlOwnedCard: (playerId, card) => this.playersStore.canControlOwnedCard(playerId, card, this.interaction()),
      battlefieldCards: (playerId) => this.core.snapshot()?.players[playerId]?.zones.battlefield ?? [],
      cardPosition: (card) => this.battlefieldState.cardPosition(card),
      battlefieldPosition: (playerId, instanceId, position) => this.battlefieldState.ratioPositionForBattlefield(playerId, instanceId, position),
      updateLocalCardPosition: (playerId, instanceId, position) =>
        this.battlefieldState.updateLocalCardPosition(this.battlefield(), playerId, instanceId, position),
      setError: (message) => this.core.error.set(message),
      closeContextMenu: () => this.uiState.closeContextMenu(),
      showTargetToast: (message) => this.toastState.showTargetToast(message),
      clearTargetToast: () => this.toastState.clearTargetToast(),
      command: (type, payload) => source.command(type, payload),
    };
  }

  command(): GameTableCommandContext {
    const source = this.boundSource();

    return {
      setSnapshot: (snapshot) => source.setSnapshot(snapshot),
      websocket: () => ({
        gameId: () => this.core.gameId(),
        snapshot: () => this.core.snapshot(),
        setSnapshot: (snapshot) => source.setSnapshot(snapshot),
        refetch: (force) => source.refetch(force),
        setError: (message) => this.core.error.set(message),
        onCommandBlocked: (_reason, type, payload) => this.handleCommandBlocked(source, type, payload),
      }),
      errorMessage: (error) => this.errorMessage(error),
      queueBattlefieldPositionCommand: (gameId, payload, persist) =>
        this.battlefieldState.tryQueueBattlefieldPositionCommand(this.battlefield(), gameId, payload, persist),
    };
  }

  cardCounter(): GameTableCardCounterContext {
    const source = this.boundSource();

    return {
      setSnapshot: (snapshot) => source.setSnapshot(snapshot),
      errorMessage: (error) => this.errorMessage(error),
      refetch: (force) => source.refetch(force),
      command: (type, payload) => this.websocketCommands.sendCommand(this.command().websocket(), type, payload),
    };
  }

  battlefield(): GameTableBattlefieldContext {
    const source = this.boundSource();

    return {
      snapshot: () => this.core.snapshot(),
      setSnapshot: (snapshot) => source.setSnapshot(snapshot),
      setError: (message) => this.core.error.set(message),
      errorMessage: (error) => this.errorMessage(error),
      battlefieldDragContext: () => this.battlefieldDrag(),
      alignmentGuideFor: (playerId) => this.dragDropStore.alignmentGuideFor(playerId),
    };
  }

  battlefieldDrag(): GameTableBattlefieldDragContext {
    return {
      zones: this.core.zones,
      snapshot: () => this.core.snapshot(),
      selectedCards: () => this.selectedCards(),
      findCard: (playerId, zone, instanceId) => this.findCard(playerId, zone, instanceId),
      cardPosition: (card) => this.battlefieldState.cardPosition(card),
      updateLocalCardPosition: (playerId, instanceId, position) =>
        this.battlefieldState.updateLocalCardPosition(this.battlefield(), playerId, instanceId, position),
    };
  }

  cardStats(): GameTableCardStatsContext {
    const source = this.boundSource();

    return {
      canControlOwnedCard: (playerId, card) => this.playersStore.canControlOwnedCard(playerId, card, this.interaction()),
      findCard: (playerId, zone, instanceId) => this.findCard(playerId, zone, instanceId),
      updateLocalCardPowerToughness: (playerId, zone, instanceId, power, toughness) =>
        this.updateLocalCardPowerToughness(playerId, zone, instanceId, power, toughness),
      updateLocalCardLoyalty: (playerId, zone, instanceId, loyalty) => this.updateLocalCardLoyalty(playerId, zone, instanceId, loyalty),
      setError: (message) => this.core.error.set(message),
      command: (type, payload, force) => source.command(type, payload, force),
    };
  }

  dropAction(): GameTableDropActionContext {
    const source = this.boundSource();

    return {
      zones: this.core.zones,
      snapshot: () => this.core.snapshot(),
      handDropPreview: () => this.handState.handDropPreview(),
      findCard: (playerId, zone, instanceId) => this.findCard(playerId, zone, instanceId),
      canControlPlayer: (playerId) => this.playersStore.canControlPlayer(playerId, this.interaction()),
      canControlOwnedCard: (playerId, card) => this.playersStore.canControlOwnedCard(playerId, card, this.interaction()),
      playerName: (playerId) => this.playersStore.playerName(playerId),
      setPendingBattlefieldMove: (move) => source.setPendingBattlefieldMove(move),
      setPendingLibraryMove: (move) => source.setPendingLibraryMove(move),
      endCardDrag: () => this.dragDropStore.endCardDrag(this.dragDrop()),
      clearHandDropPreview: () => this.handState.clearHandDropPreview(),
      clearSelectedCards: () => this.selection.selectedCards.set([]),
      suppressCardPreview: () => this.uiState.suppressCardPreview(450),
      setError: (message) => this.core.error.set(message),
      cardPosition: (card) => this.battlefieldState.cardPosition(card),
      snapBattlefieldPosition: (playerId, instanceId, position, rawZone) =>
        this.battlefieldState.snappedBattlefieldPosition(this.battlefield(), playerId, instanceId, position, rawZone),
      markPendingManaDrop: (playerId, instanceIds) => this.dropFeedbackState.markPendingManaDrop(playerId, instanceIds),
      markPendingTransfer: (playerId, fromZone, instanceIds, options) => this.pendingTransferState.register({
        playerId,
        fromZone,
        instanceIds,
        sourceVersion: this.core.snapshot()?.version ?? null,
        expires: options?.expires,
      }),
      syncOpenZoneModalAfterMove: (playerId, fromZone, instanceIds) =>
        this.syncOpenZoneModalAfterMove(playerId, fromZone, instanceIds),
      command: (type, payload) => source.command(type, payload),
      recordCommanderCastIfNeeded: (playerId, fromZone, toZone, targetPlayerId) =>
        this.recordCommanderCastIfNeeded(playerId, fromZone, toZone, targetPlayerId),
    };
  }

  dragDrop(): GameTableDragDropContext {
    const source = this.boundSource();

    return {
      zones: this.core.zones,
      snapshot: () => this.core.snapshot(),
      players: () => this.playersStore.players(),
      selectedCards: () => this.selectedCards(),
      setSelectedCards: (cards) => this.selection.selectedCards.set(cards),
      canControlOwnedCard: (playerId, card) => this.playersStore.canControlOwnedCard(playerId, card, this.interaction()),
      battlefieldDragContext: () => this.battlefieldDrag(),
      pointerDragActionContext: () => this.pointerDragAction(),
      cardPosition: (card) => this.battlefieldState.cardPosition(card),
      updateLocalCardPosition: (playerId, instanceId, position) =>
        this.battlefieldState.updateLocalCardPosition(this.battlefield(), playerId, instanceId, position),
      hideCardPreview: () => this.uiState.hideCardPreview(),
      clearCardPreview: () => this.uiState.clearCardPreview(),
      closeContextMenuForCardDrag: (instanceId) => this.uiState.closeContextMenuForCardDrag(instanceId),
      suppressCardPreview: () => this.uiState.suppressCardPreview(450),
      clearHandDropPreview: () => this.handState.clearHandDropPreview(),
      setError: (message) => this.core.error.set(message),
      applyDeferredRemoteSnapshot: () => this.sessionService.applyDeferredRemoteSnapshot(this.session()),
    };
  }

  pendingMove(): GameTablePendingMoveContext {
    const source = this.boundSource();

    return {
      refetch: (force) => source.refetch(force),
      setPendingBattlefieldMove: (move) => source.setPendingBattlefieldMove(move),
      setPendingLibraryMove: (move) => source.setPendingLibraryMove(move),
    };
  }

  hand(): GameTableHandContext {
    const source = this.boundSource();

    return {
      zones: this.core.zones,
      snapshot: () => this.core.snapshot(),
      selectedDragInstanceIds: (playerId, zone, instanceId) =>
        this.dragDropStore.selectedDragInstanceIds(this.dragDrop(), playerId, zone, instanceId),
      findCard: (playerId, zone, instanceId) => this.findCard(playerId, zone, instanceId),
      canControlOwnedCard: (playerId, card) => this.playersStore.canControlOwnedCard(playerId, card, this.interaction()),
      playerName: (playerId) => this.playersStore.playerName(playerId),
      battlefieldDragContext: () => this.battlefieldDrag(),
      snapBattlefieldPosition: (playerId, instanceId, position, rawZone) =>
        this.battlefieldState.snappedBattlefieldPosition(this.battlefield(), playerId, instanceId, position, rawZone),
      moveLocalCardsFromHandToBattlefield: (playerId, targetPlayerId, movedInstanceIds, position) =>
        this.battlefieldState.moveLocalCardsFromHandToBattlefield(
          this.battlefield(),
          playerId,
          targetPlayerId,
          movedInstanceIds,
          position,
        ),
      markPendingManaDrop: (playerId, instanceIds) => this.dropFeedbackState.markPendingManaDrop(playerId, instanceIds),
      markPendingBattlefieldEntry: (playerId, instanceIds) => this.dropFeedbackState.markPendingBattlefieldEntry(playerId, instanceIds),
      markPendingTransfer: (playerId, fromZone, instanceIds) => this.pendingTransferState.register({
        playerId,
        fromZone,
        instanceIds,
        sourceVersion: this.core.snapshot()?.version ?? null,
      }),
      setPendingBattlefieldMove: (move) => source.setPendingBattlefieldMove(move),
      setPendingLibraryMove: (move) => source.setPendingLibraryMove(move),
      clearSelectedCards: () => this.selection.selectedCards.set([]),
      setError: (message) => this.core.error.set(message),
      command: (type, payload) => source.command(type, payload),
      recordCommanderCastIfNeeded: (playerId, fromZone, toZone, targetPlayerId) =>
        this.recordCommanderCastIfNeeded(playerId, fromZone, toZone, targetPlayerId),
    };
  }

  pointerDragAction(): GameTablePointerDragActionContext {
    const source = this.boundSource();

    return {
      zones: this.core.zones,
      snapshot: () => this.core.snapshot(),
      handDropPreview: () => this.handState.handDropPreview(),
      selectedCards: () => this.selectedCards(),
      battlefieldDragContext: () => this.battlefieldDrag(),
      alignmentGuideY: (playerId) => this.dragDropStore.alignmentGuideFor(playerId)?.y ?? null,
      isManaLaneHighlighted: (playerId) => this.dragDropStore.isManaLaneHighlighted(playerId),
      findCard: (playerId, zone, instanceId) => this.findCard(playerId, zone, instanceId),
      cardPosition: (card) => this.battlefieldState.cardPosition(card),
      landStackDetachSource: () => this.dragDropStore.landStackDetachSource(),
      attachmentStackDetachSource: () => this.dragDropStore.attachmentStackDetachSource(),
      canControlPlayer: (playerId) => this.playersStore.canControlPlayer(playerId, this.interaction()),
      canControlOwnedCard: (playerId, card) => this.playersStore.canControlOwnedCard(playerId, card, this.interaction()),
      playerName: (playerId) => this.playersStore.playerName(playerId),
      battlefieldPosition: (playerId, instanceId, position) => this.battlefieldState.ratioPositionForBattlefield(playerId, instanceId, position),
      updateLocalCardPosition: (playerId, instanceId, position) =>
        this.battlefieldState.updateLocalCardPosition(this.battlefield(), playerId, instanceId, position),
      setPendingBattlefieldMove: (move) => source.setPendingBattlefieldMove(move),
      setPendingLibraryMove: (move) => source.setPendingLibraryMove(move),
      endCardDrag: () => this.dragDropStore.endCardDrag(this.dragDrop()),
      clearSelectedCards: () => this.selection.selectedCards.set([]),
      suppressCardPreview: () => this.uiState.suppressCardPreview(450),
      setError: (message) => this.core.error.set(message),
      applyDeferredRemoteSnapshot: () => this.sessionService.applyDeferredRemoteSnapshot(this.session()),
      refetch: (force) => source.refetch(force),
      markPendingManaDrop: (playerId, instanceIds) => this.dropFeedbackState.markPendingManaDrop(playerId, instanceIds),
      markPendingTransfer: (playerId, fromZone, instanceIds, options) => this.pendingTransferState.register({
        playerId,
        fromZone,
        instanceIds,
        sourceVersion: this.core.snapshot()?.version ?? null,
        expires: options?.expires,
      }),
      command: (type, payload) => source.command(type, payload),
    };
  }

  zoneAction(): GameTableZoneActionContext {
    return {
      gameId: () => this.core.gameId(),
      snapshot: () => this.core.snapshot(),
      playerName: (playerId) => this.playersStore.playerName(playerId),
      zoneTitle: (zone) => this.zonePilesState.zoneTitle(zone),
      setError: (message) => this.core.error.set(message),
    };
  }

  interaction(): GameTableInteractionContext {
    const source = this.boundSource();

    return {
      currentPlayer: () => this.playersStore.currentPlayer(),
      focusedPlayer: () => this.playersStore.focusedPlayer(),
      zoneCardCount: (playerId, zone) => this.playersStore.zoneCardCountById(playerId, zone),
      setError: (message) => this.core.error.set(message),
      playCard: (playerId, zone, card) => source.playCard(playerId, zone, card),
    };
  }

  session(): GameTableSessionContext {
    const source = this.boundSource();

    return {
      gameId: () => this.core.gameId(),
      snapshot: () => this.core.snapshot(),
      setSnapshot: (snapshot) => source.setSnapshot(snapshot),
      focusedPlayerId: () => this.uiState.focusedPlayerId(),
      setFocusedPlayerId: (playerId) => this.uiState.focusedPlayerId.set(playerId),
      ownPlayerId: (snapshot) => this.ownPlayerId(snapshot),
      hasActivePointerDrag: () => this.drag.hasActivePointerDrag(),
      isPending: () => this.core.pending(),
      setLoading: (loading) => this.core.loading.set(loading),
      setError: (message) => this.core.error.set(message),
      refreshViewerControlAccess: () => this.gameActionsStore.refreshViewerControlAccess(),
      navigateToRoomsWithLoadError: () => {
        void this.gameActionsStore.navigateToRoomsWithLoadError();
      },
      navigateToWaitingRoom: (roomId) => {
        void this.gameActionsStore.navigateToWaitingRoom(roomId);
      },
    };
  }

  private selectedCards(): SelectedCard[] {
    return this.selection.selectedCards() as SelectedCard[];
  }

  private findCard(playerId: string, zone: GameZoneName, instanceId: string): GameCardInstance | null {
    return this.core.snapshot()?.players[playerId]?.zones[zone]?.find((card) => card.instanceId === instanceId) ?? null;
  }

  private updateLocalCardPowerToughness(playerId: string, zone: GameZoneName, instanceId: string, power: number, toughness: number): void {
    const snapshot = this.core.snapshot();
    if (!snapshot) {
      return;
    }

    const next = structuredClone(snapshot);
    const card = next.players[playerId]?.zones[zone]?.find((candidate) => candidate.instanceId === instanceId);
    if (card) {
      card.power = power;
      card.toughness = toughness;
      this.boundSource().setSnapshot(next);
    }
  }

  private updateLocalCardLoyalty(playerId: string, zone: GameZoneName, instanceId: string, loyalty: number): void {
    const snapshot = this.core.snapshot();
    if (!snapshot) {
      return;
    }

    const next = structuredClone(snapshot);
    const card = next.players[playerId]?.zones[zone]?.find((candidate) => candidate.instanceId === instanceId);
    if (card) {
      card.loyalty = loyalty;
      this.boundSource().setSnapshot(next);
    }
  }

  private async recordCommanderCastIfNeeded(
    playerId: string,
    fromZone: GameZoneName,
    toZone: GameZoneName = 'battlefield',
    targetPlayerId: string = playerId,
  ): Promise<void> {
    const player = this.playersStore.players().find((candidate) => candidate.id === playerId);
    if (!player || fromZone !== 'command' || toZone !== 'battlefield' || targetPlayerId !== playerId) {
      return;
    }

    await this.boundSource().command('counter.changed', {
      scope: `commander:${playerId}`,
      key: 'casts',
      value: this.playersStore.commanderCastCount(player) + 1,
    });
  }

  private ownPlayerId(snapshot: GameSnapshot): string | null {
    if (!this.core.viewerCanControlTable()) {
      return null;
    }

    const userId = this.auth.user()?.id;
    if (!userId) {
      return null;
    }

    return Object.entries(snapshot.players).find(([, player]) => player.user.id === userId)?.[0] ?? null;
  }

  private async syncOpenZoneModalAfterMove(playerId: string, fromZone: GameZoneName, instanceIds: readonly string[]): Promise<void> {
    const modal = this.zoneModalState.zoneModal();
    if (!modal || modal.playerId !== playerId || modal.zone !== fromZone || instanceIds.length === 0) {
      return;
    }

    this.zoneActions.removeZoneModalCards(instanceIds);
  }

  private errorMessage(error: unknown): string {
    return gameTableErrorMessage(error);
  }

  private handleCommandBlocked(
    source: GameTableContextSource,
    type: GameCommandType | 'disconnect.vote',
    payload: Record<string, unknown>,
  ): void {
    const pendingBattlefieldMove = source.pendingBattlefieldMove();
    if (
      pendingBattlefieldMove
      && (pendingBattlefieldMove.commandType ?? 'card.moved') === type
      && this.samePayload(pendingBattlefieldMove.payload, payload)
    ) {
      source.setPendingBattlefieldMove(null);
    }

    const pendingLibraryMove = source.pendingLibraryMove();
    if (
      pendingLibraryMove
      && pendingLibraryMove.commandType === type
      && this.samePayload(pendingLibraryMove.payload, payload)
    ) {
      source.setPendingLibraryMove(null);
    }
  }

  private samePayload(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
    return this.stableStringify(left) === this.stableStringify(right);
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.stableStringify(entry)).join(',')}]`;
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();

      return `{${keys.map((key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`).join(',')}}`;
    }

    const serialized = JSON.stringify(value);
    return serialized ?? 'null';
  }

  private boundSource(): GameTableContextSource {
    if (!this.source) {
      throw new Error('GameTableContextStore must be bound before building contexts.');
    }

    return this.source;
  }
}
