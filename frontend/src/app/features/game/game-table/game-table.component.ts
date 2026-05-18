import { AfterViewChecked, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, QueryList, ViewChild, ViewChildren, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { AppModalComponent } from '../../../shared/ui/app-modal/app-modal.component';
import { PrettyScrollDirective } from '../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { Card } from '../../../core/models/card.model';
import { GameCardInstance, GameRematchVote, GameZoneName } from '../../../core/models/game.model';
import { GamesApi } from '../../../core/api/games.api';
import { GameTableCardActionsService } from './services/game-table-card-actions.service';
import { GameTableCardStatsService } from './services/game-table-card-stats.service';
import { GameTableBattlefieldDragCoordinatorService } from './services/game-table-battlefield-drag-coordinator.service';
import { GameTableCommandService } from './services/game-table-command.service';
import { GameTableDragService } from './services/game-table-drag.service';
import { GameTableDropActionsService, type PendingLibraryMove } from './services/game-table-drop-actions.service';
import { GameTableInteractionActionsService } from './services/game-table-interaction-actions.service';
import { GameTableLibraryActionsService } from './services/game-table-library-actions.service';
import { GameTablePointerDragActionsService } from './services/game-table-pointer-drag-actions.service';
import { GameTablePointerDragService } from './services/game-table-pointer-drag.service';
import { GameTableRealtimeService } from './services/game-table-realtime.service';
import { GameTableSelectionService } from './services/game-table-selection.service';
import { GameTableSessionService } from './services/game-table-session.service';
import { GameTableTurnActionsService } from './services/game-table-turn-actions.service';
import { GameTableZoneActionsService } from './services/game-table-zone-actions.service';
import { GameTableChatLogState } from './state/game-table-chat-log.state';
import { GameTableBattlefieldDragState } from './state/game-table-battlefield-drag.state';
import { GameTableDropFeedbackState } from './state/game-table-drop-feedback.state';
import { GameTablePendingTransferState } from './state/game-table-pending-transfer.state';
import { GameTableSnapshotSelectors } from './state/game-table-snapshot-selectors';
import { GameContextMenu, GameTableUiState } from './state/game-table-ui.state';
import { GameTableZoneModalState } from './state/game-table-zone-modal.state';
import { GameTableStore, PlayerView } from './game-table.store';
import { playerIsActiveForTurn, playerIsDefeated } from './game-player-defeat';
import { GameLogPanelComponent } from './game-log-panel/game-log-panel.component';
import { ZonePilesPanelComponent } from './zone-piles-panel/zone-piles-panel.component';
import { OpponentMiniBoardComponent } from './opponent-mini-board/opponent-mini-board.component';
import { PlayerSummaryPanelComponent } from './player-summary-panel/player-summary-panel.component';
import { TurnPhasePanelComponent } from './turn-phase-panel/turn-phase-panel.component';
import { PlayerHandPanelComponent } from './player-hand-panel/player-hand-panel.component';
import { FocusedBattlefieldComponent } from './focused-battlefield/focused-battlefield.component';
import { ContextMenuAction, ContextMenuComponent } from './context-menu/context-menu.component';
import { ZoneModalComponent } from './zone-modal/zone-modal.component';
import { NumberActionDialogComponent } from './number-action-dialog/number-action-dialog.component';
import { GameTableHeaderComponent } from './game-table-header/game-table-header.component';
import { CardPreviewOverlayComponent } from './card-preview-overlay/card-preview-overlay.component';
import { CardMarkerRailComponent } from './game-card-view/card-marker-rail/card-marker-rail.component';
import { LoyaltyCounterComponent } from './game-card-view/loyalty-counter/loyalty-counter.component';
import { PowerToughnessDialogComponent, PowerToughnessDialogValueChange } from './power-toughness-dialog/power-toughness-dialog.component';
import { GameArrowLayerComponent } from './game-arrow-layer/game-arrow-layer.component';
import { ArrowTargetDialogComponent, ArrowTargetDialogValue } from './arrow-target-dialog/arrow-target-dialog.component';
import { GameRematchModalComponent, RematchPlayerVoteView } from './game-rematch-modal/game-rematch-modal.component';
import { TokenSearchModalComponent } from './token-search-modal/token-search-modal.component';
import { RollModalComponent } from '../../../core/ui/roll-modal/roll-modal.component';
import { type RollResult } from '../../../core/ui/roll-modal/roll';

interface DrawNumberActionRequest {
  readonly kind: 'draw';
  readonly playerId: string;
  readonly title: string;
  readonly description: string;
  readonly defaultValue: number;
  readonly min: number;
  readonly max?: number;
  readonly confirmLabel: string;
}

interface MoveTopNumberActionRequest {
  readonly kind: 'moveTop';
  readonly playerId: string;
  readonly toZone: GameZoneName;
  readonly targetPlayerId?: string;
  readonly position?: 'top' | 'bottom';
  readonly title: string;
  readonly description: string;
  readonly defaultValue: number;
  readonly min: number;
  readonly max?: number;
  readonly confirmLabel: string;
}

interface ViewTopNumberActionRequest {
  readonly kind: 'viewTop';
  readonly playerId: string;
  readonly title: string;
  readonly description: string;
  readonly defaultValue: number;
  readonly min: number;
  readonly max?: number;
  readonly confirmLabel: string;
}

type NumberActionRequest = DrawNumberActionRequest | MoveTopNumberActionRequest | ViewTopNumberActionRequest;
type RematchCountdownMode = 'initial' | 'courtesy';
type TableExitAction = 'concede' | 'leave';

interface ZoneMoveAllLibraryRequest {
  readonly playerId: string;
  readonly fromZone: GameZoneName;
  readonly count: number;
}

interface HandCardGiveRequest {
  readonly menu: GameContextMenu;
  readonly targetPlayerId: string;
  readonly targetPlayerName: string;
  readonly cardName: string;
}

interface LibraryCardMoveToHandRequest {
  readonly menu: GameContextMenu;
  readonly cardName: string;
}

interface PowerToughnessActionRequest {
  readonly menu: GameContextMenu;
  readonly power: string;
  readonly toughness: string;
}

interface ArrowTargetDialogRequest {
  readonly sourceMenu: GameContextMenu;
  readonly selectedPlayerId: string;
  readonly multipleTargets: boolean;
  readonly targetCount: number;
}

interface BattlefieldLayoutSize {
  readonly width: number;
  readonly height: number;
}

interface BattlefieldLayoutRect extends BattlefieldLayoutSize {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

@Component({
  selector: 'app-game-table',
  imports: [
    FormsModule,
    LucideAngularModule,
    AppModalComponent,
    PrettyScrollDirective,
    GameLogPanelComponent,
    ZonePilesPanelComponent,
    OpponentMiniBoardComponent,
    PlayerSummaryPanelComponent,
    TurnPhasePanelComponent,
    PlayerHandPanelComponent,
    FocusedBattlefieldComponent,
    ContextMenuComponent,
    ZoneModalComponent,
    NumberActionDialogComponent,
    GameTableHeaderComponent,
    CardPreviewOverlayComponent,
    CardMarkerRailComponent,
    LoyaltyCounterComponent,
    PowerToughnessDialogComponent,
    GameArrowLayerComponent,
    ArrowTargetDialogComponent,
    GameRematchModalComponent,
    TokenSearchModalComponent,
    RollModalComponent,
  ],
  providers: [
    GameTableStore,
    GameTableCardActionsService,
    GameTableCardStatsService,
    GameTableBattlefieldDragCoordinatorService,
    GameTableRealtimeService,
    GameTableCommandService,
    GameTableSelectionService,
    GameTableSessionService,
    GameTableDragService,
    GameTableDropActionsService,
    GameTableInteractionActionsService,
    GameTablePointerDragActionsService,
    GameTablePointerDragService,
    GameTableLibraryActionsService,
    GameTableTurnActionsService,
    GameTableZoneActionsService,
    GameTableSnapshotSelectors,
    GameTableUiState,
    GameTableBattlefieldDragState,
    GameTableDropFeedbackState,
    GameTablePendingTransferState,
    GameTableZoneModalState,
    GameTableChatLogState,
  ],
  templateUrl: './game-table.component.html',
  styleUrl: './game-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameTableComponent implements AfterViewChecked, OnDestroy {
  readonly store = inject(GameTableStore);
  private readonly gamesApi = inject(GamesApi);
  private readonly router = inject(Router);
  readonly counterPresets = ['-1/-1', '+1/+1', 'red', 'green', 'blue', 'black', 'yellow'];
  readonly moveZones: GameZoneName[] = ['battlefield', 'graveyard', 'exile', 'hand', 'command', 'library'];
  readonly colorAccent = (player: PlayerView | null): string => this.store.colorAccent(player);
  readonly topDraggableCard = (player: PlayerView, zone: GameZoneName): GameCardInstance | null => this.store.topDraggableCard(player, zone);
  readonly zoneCount = (player: PlayerView, zone: GameZoneName): number => this.store.zoneCount(player, zone);
  readonly zoneCardCountById = (playerId: string, zone: GameZoneName): number => this.store.zoneCardCountById(playerId, zone);
  readonly logTime = (createdAt: string): string => this.store.logTime(createdAt);
  readonly isDropZoneHighlighted = (playerId: string, zone: GameZoneName): boolean => this.store.isDropZoneHighlighted(playerId, zone);
  readonly zoneTitle = (zone: GameZoneName): string => this.store.zoneTitle(zone);
  readonly zonePreviewCard = (player: PlayerView, zone: GameZoneName): GameCardInstance | null => this.store.zonePreviewCard(player, zone);
  readonly zonePreviewImage = (player: PlayerView, zone: GameZoneName): string | null => this.store.zonePreviewImage(player, zone);
  readonly commanderCastCount = (player: PlayerView): number => this.store.commanderCastCount(player);
  readonly playerCounterValue = (player: PlayerView, key: string): number => this.store.playerCounterValue(player.id, key);
  readonly deckLabel = (player: PlayerView | null): string => this.store.deckLabel(player);
  readonly gameBackgroundImage = (player: PlayerView | null): string => this.store.gameBackgroundImage(player);
  readonly manaSymbols = (player: PlayerView | null): string[] => this.store.manaSymbols(player);
  readonly cardPosition = (card: GameCardInstance): { x: number; y: number } | null => this.store.cardPosition(card);
  readonly cardImage = (card: GameCardInstance): string | null => this.store.cardImage(card);
  readonly handCardImage = (card: GameCardInstance): string | null => {
    const handPlayer = this.store.handPlayer();
    const currentPlayer = this.store.currentPlayer();

    return handPlayer && currentPlayer && handPlayer.id !== currentPlayer.id && (card.hidden ?? false)
      ? this.store.cardBackImage(handPlayer)
      : this.store.cardImage(card);
  };
  readonly isHandPlayerReadOnly = computed(() => {
    const handPlayer = this.store.handPlayer();
    const currentPlayer = this.store.currentPlayer();

    return Boolean(handPlayer && currentPlayer && handPlayer.id !== currentPlayer.id);
  });
  readonly isPlayerDropHighlighted = (playerId: string): boolean => this.store.isPlayerDropHighlighted(playerId);
  readonly isPhasePast = (phase: string): boolean => this.store.isPhasePast(phase);
  readonly isCurrentPlayer = (playerId: string): boolean => this.store.isCurrentPlayer(playerId);
  readonly countItems = (count: number): number[] => this.store.countItems(count);
  readonly isSelected = (instanceId: string): boolean => this.store.isSelected(instanceId);
  readonly isDraggingCard = (card: GameCardInstance): boolean => this.store.isDraggingCard(card);
  readonly isHandDropTarget = (playerId: string, card: GameCardInstance, placement: 'before' | 'after'): boolean =>
    this.store.isHandDropTarget(playerId, card, placement);
  readonly isCardDropSettling = (playerId: string, zone: GameZoneName, card: GameCardInstance): boolean =>
    this.store.isCardDropSettling(playerId, zone, card);
  readonly isManaDropSettling = (playerId: string, card: GameCardInstance): boolean => this.store.isManaDropSettling(playerId, card);
  readonly isBattlefieldEntrySettling = (playerId: string, card: GameCardInstance): boolean =>
    this.store.isBattlefieldEntrySettling(playerId, card);
  readonly isCommanderEntrySettling = (playerId: string, card: GameCardInstance): boolean =>
    this.store.isCommanderEntrySettling(playerId, card);
  readonly isZoneDropSettling = (playerId: string, zone: GameZoneName): boolean => this.store.isZoneDropSettling(playerId, zone);
  readonly isCardTransferPending = (playerId: string, zone: GameZoneName, card: GameCardInstance): boolean =>
    this.store.isCardTransferPending(playerId, zone, card);
  readonly ownedArrowCount = (playerId: string): number => this.store.ownedArrowCount(playerId);
  readonly isZoneTransferPending = (playerId: string, zone: GameZoneName): boolean => this.store.isZoneTransferPending(playerId, zone);
  readonly canDragBattlefieldCard = (playerId: string, card: GameCardInstance): boolean => this.store.canDragBattlefieldCard(playerId, card);
  readonly isPendingBattlefieldTransfer = (card: GameCardInstance): boolean => this.store.isPendingBattlefieldTransfer(card);
  readonly shouldShowPowerToughness = (card: GameCardInstance): boolean => this.store.shouldShowPowerToughness(card);
  readonly cardPowerValue = (card: GameCardInstance): number | null => this.store.cardPowerValue(card);
  readonly cardToughnessValue = (card: GameCardInstance): number | null => this.store.cardToughnessValue(card);
  readonly firstCounter = (card: GameCardInstance): { key: string; value: number } | null => this.store.firstCounter(card);
  readonly cardCounters = (card: GameCardInstance): readonly { key: string; value: number }[] =>
    Object.entries(card.counters ?? {})
      .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) >= 0)
      .map(([key, value]) => ({ key, value: Number(value) }));
  readonly alignmentGuideFor = (playerId: string): { y: number; referenceInstanceIds: readonly string[] } | null =>
    this.store.alignmentGuideFor(playerId);
  readonly isManaLaneHighlighted = (playerId: string): boolean => this.store.isManaLaneHighlighted(playerId);
  readonly canControlPlayer = (playerId: string): boolean => this.store.canControlPlayer(playerId);
  readonly numberActionDialog = signal<NumberActionRequest | null>(null);
  readonly powerToughnessDialog = signal<PowerToughnessActionRequest | null>(null);
  readonly arrowTargetDialog = signal<ArrowTargetDialogRequest | null>(null);
  readonly libraryMoveRandomOrder = signal(false);
  readonly zoneMoveAllLibraryDialog = signal<ZoneMoveAllLibraryRequest | null>(null);
  readonly zoneMoveAllLibraryRandomOrder = signal(false);
  readonly handCardGiveDialog = signal<HandCardGiveRequest | null>(null);
  readonly libraryCardMoveToHandDialog = signal<LibraryCardMoveToHandRequest | null>(null);
  readonly followActiveTurnPlayer = signal(false);
  readonly rematchModalOpen = signal(false);
  readonly rematchPending = signal(false);
  readonly rematchToast = signal<string | null>(null);
  readonly rematchCountdownSeconds = signal<number | null>(null);
  readonly rematchCountdownMode = signal<RematchCountdownMode | null>(null);
  readonly tableExitAction = signal<TableExitAction | null>(null);
  readonly tokenSearchPlayerId = signal<string | null>(null);
  readonly tokenSearchPending = signal(false);
  readonly rollModalOpen = signal(false);
  readonly tableExitTitle = computed(() => this.tableExitAction() === 'leave' ? 'Leave table?' : 'Concede game?');
  readonly tableExitMessage = computed(() => this.tableExitAction() === 'leave'
    ? 'You will concede this game and leave the room. This cannot be undone.'
    : 'You will lose this game immediately. This cannot be undone.');
  readonly tableExitPrimaryLabel = computed(() => this.tableExitAction() === 'leave' ? 'Leave table' : 'Concede');
  private readonly leavingTable = signal(false);
  private readonly tableExitPending = computed(() => this.tableExitAction() !== null || this.leavingTable());
  readonly focusEffectsEnabled = computed(() => this.arrowTargetDialog() === null && this.store.pendingArrowSource() === null);
  readonly battlefieldLayoutSize = signal<BattlefieldLayoutRect>({ width: 900, height: 520, left: 0, top: 0, right: 900, bottom: 520 });
  readonly closeGameDialogOpen = signal(false);
  readonly isPowerToughnessDialogInvalid = computed(() => {
    const request = this.powerToughnessDialog();

    return !request || !Number.isFinite(Number(request.power)) || !Number.isFinite(Number(request.toughness));
  });
  readonly latestLogEntry = computed(() => this.store.eventLog().at(-1) ?? null);
  readonly latestChatMessage = computed(() => this.store.snapshot()?.chat.at(-1) ?? null);
  readonly tableToast = computed(() => this.store.tableToast() ?? this.rematchToast());
  readonly tableBackgroundImage = computed(() => `url("${this.store.gameBackgroundImage(this.store.focusedPlayer() ?? this.store.currentPlayer())}")`);
  readonly alivePlayers = computed(() => this.store.players().filter((player) => playerIsActiveForTurn(player)));
  readonly rematchVoteCountdownEnabled = computed(() => this.alivePlayers().length <= 1);
  readonly currentRematchVote = computed<GameRematchVote | null>(() => {
    const currentPlayerId = this.store.currentPlayer()?.id;

    return currentPlayerId ? this.store.snapshot()?.rematch?.votes[currentPlayerId]?.vote ?? null : null;
  });
  readonly rematchPromptKind = computed<'defeated' | 'winner' | null>(() => {
    const currentPlayer = this.store.currentPlayer();
    if (!currentPlayer) {
      return null;
    }
    if (playerIsDefeated(currentPlayer)) {
      return 'defeated';
    }

    const alivePlayers = this.alivePlayers();
    return alivePlayers.length === 1 && alivePlayers[0]?.id === currentPlayer.id ? 'winner' : null;
  });
  readonly rematchPromptKey = computed(() => {
    const kind = this.rematchPromptKind();
    const currentPlayerId = this.store.currentPlayer()?.id ?? '';

    return kind && currentPlayerId ? `${currentPlayerId}:${kind}` : '';
  });
  readonly isCurrentPlayerWinner = computed(() => this.rematchPromptKind() === 'winner');
  readonly shouldShowRematchVotesButton = computed(() => this.rematchPromptKind() !== null && !this.rematchModalOpen() && !this.tableExitPending());
  readonly rematchVotePlayers = computed<readonly RematchPlayerVoteView[]>(() => {
    const votes = this.store.snapshot()?.rematch?.votes ?? {};

    return this.store.players().map((player) => ({
      playerId: player.id,
      displayName: player.state.user.displayName || player.state.user.email || player.id,
      life: player.state.life,
      defeated: playerIsDefeated(player),
      vote: votes[player.id]?.vote ?? null,
    }));
  });
  readonly rematchMissingVotePlayers = computed(() => this.rematchVotePlayers().filter((player) => player.vote === null));
  readonly rematchMissingVotePlayerNames = computed(() => this.rematchMissingVotePlayers().map((player) => player.displayName));
  readonly currentPlayerNeedsRematchVote = computed(() => {
    const currentPlayerId = this.store.currentPlayer()?.id ?? null;

    return currentPlayerId !== null
      && this.currentRematchVote() === null
      && this.rematchVotePlayers().some((player) => player.playerId === currentPlayerId);
  });
  readonly playAgainDisabledByOtherVotes = computed(() => {
    const currentPlayerId = this.store.currentPlayer()?.id ?? null;
    const otherPlayers = this.rematchVotePlayers().filter((player) => player.playerId !== currentPlayerId);
    if (otherPlayers.length === 0) {
      return false;
    }

    return otherPlayers.every((player) => player.vote === 'leave');
  });
  readonly opponentTargetingPills = computed(() => this.store.opponentTargetingPills());
  readonly opponentCardsTargetCards = computed(() => this.store.opponentCardsTargetCards());
  readonly arrowTargetPlayers = computed(() => {
    const currentPlayerId = this.store.currentPlayer()?.id;
    const players = this.store.players();
    if (!currentPlayerId) {
      return players;
    }

    return [
      ...players.filter((player) => player.id === currentPlayerId),
      ...players.filter((player) => player.id !== currentPlayerId),
    ];
  });
  readonly arrowTargetPlayerLabel = (player: PlayerView): string => {
    const deck = this.deckLabel(player);
    const name = player.state.user.displayName || player.state.user.email || player.id;

    return deck ? `${deck} - ${name}` : name;
  };
  private lastAutoScrollKey = '';
  private floatingScrollFrame: number | null = null;
  private floatingScrollTimer: number | null = null;
  private battlefieldReflowFrame: number | null = null;
  private rematchToastTimer: number | null = null;
  private rematchCountdownTimer: number | null = null;
  private rematchCountdownDeadlineMs: number | null = null;
  private rematchCountdownKey = '';
  private rematchAutoLeaveKey = '';
  private lastAutoRematchPromptKey = '';
  private lastFocusedTurnPlayerId: string | null = null;

  @ViewChild('gameScreen', { static: true }) private readonly gameScreen?: ElementRef<HTMLElement>;
  @ViewChild(GameLogPanelComponent) private readonly gameLogPanel?: GameLogPanelComponent;
  @ViewChildren('autoScrollFeed') private readonly autoScrollFeeds?: QueryList<ElementRef<HTMLElement>>;

  constructor() {
    effect(() => {
      if (this.tableExitPending()) {
        return;
      }

      const key = this.rematchPromptKey();
      if (!key || key === this.lastAutoRematchPromptKey) {
        return;
      }
      if (this.rematchPromptKind() === 'defeated' && this.alivePlayers().length > 1 && this.currentRematchVote() !== null) {
        this.lastAutoRematchPromptKey = key;
        return;
      }

      this.lastAutoRematchPromptKey = key;
      queueMicrotask(() => {
        if (this.rematchPromptKey() === key && !this.rematchModalOpen()) {
          this.rematchModalOpen.set(true);
        }
      });
    });

    effect(() => {
      if (this.tableExitPending()) {
        queueMicrotask(() => this.clearRematchCountdown());
        return;
      }

      const promptKey = this.rematchPromptKey();
      const missingPlayers = this.rematchMissingVotePlayers();
      const hasMissingVotes = missingPlayers.length > 0;
      const countdownEnabled = this.rematchVoteCountdownEnabled();

      queueMicrotask(() => this.syncRematchCountdown(promptKey, hasMissingVotes, countdownEnabled));
    });

    effect(() => {
      const activePlayerId = this.store.snapshot()?.turn.activePlayerId ?? null;
      const followEnabled = this.followActiveTurnPlayer();

      queueMicrotask(() => {
        if (followEnabled && this.followActiveTurnPlayer()) {
          this.syncFollowActiveTurnPlayer(activePlayerId);
        }
      });
    });
  }

  ngAfterViewChecked(): void {
    const snapshot = this.store.snapshot();
    if (!snapshot) {
      return;
    }

    this.syncFollowActiveTurnPlayer(snapshot.turn.activePlayerId);

    const log = this.store.eventLog();
    const latestChat = snapshot.chat.at(-1)?.createdAt ?? '';
    const latestLog = log.at(-1)?.id ?? '';
    const rawLatestLog = snapshot.eventLog.at(-1)?.id ?? '';
    const key = `${this.store.activeFloatingTab()}:${snapshot.chat.length}:${latestChat}:${snapshot.eventLog.length}:${rawLatestLog}:${log.length}:${latestLog}`;
    if (key === this.lastAutoScrollKey) {
      return;
    }

    this.lastAutoScrollKey = key;
    queueMicrotask(() => this.queueFloatingContentScrollToBottom());
    this.queueBattlefieldReflow();
  }

  ngOnDestroy(): void {
    this.clearQueuedFloatingContentScroll();
    this.clearQueuedBattlefieldReflow();
    this.clearRematchToastTimer();
    this.clearRematchCountdown();
  }

  scrollFloatingContentToBottom(): void {
    this.gameLogPanel?.scrollToBottom();
    for (const feed of this.autoScrollFeeds?.toArray() ?? []) {
      feed.nativeElement.scrollTop = feed.nativeElement.scrollHeight;
    }
  }

  queueFloatingContentScrollToBottom(): void {
    this.clearQueuedFloatingContentScroll();
    this.scrollFloatingContentToBottom();
    this.floatingScrollFrame = window.requestAnimationFrame(() => {
      this.floatingScrollFrame = null;
      this.scrollFloatingContentToBottom();
    });
    this.floatingScrollTimer = window.setTimeout(() => {
      this.floatingScrollTimer = null;
      this.scrollFloatingContentToBottom();
    }, 260);
  }

  handleFloatingPanelFocusOut(event: FocusEvent): void {
    const currentTarget = event.currentTarget;
    const nextTarget = event.relatedTarget;
    if (currentTarget instanceof HTMLElement && nextTarget instanceof Node && currentTarget.contains(nextTarget)) {
      return;
    }

    this.queueFloatingContentScrollToBottom();
  }

  handleFloatingPanelTransitionEnd(event: TransitionEvent): void {
    if (event.propertyName === 'max-height') {
      this.queueFloatingContentScrollToBottom();
    }
  }

  updateBattlefieldLayoutSize(size: BattlefieldLayoutRect): void {
    const current = this.battlefieldLayoutSize();
    if (
      current.width === size.width
      && current.height === size.height
      && current.left === size.left
      && current.top === size.top
      && current.right === size.right
      && current.bottom === size.bottom
    ) {
      return;
    }

    this.battlefieldLayoutSize.set(size);
    this.store.setBattlefieldLayoutSize(size);
  }

  @HostListener('window:resize')
  handleViewportResize(): void {
    this.queueBattlefieldReflow();
  }

  @HostListener('document:keydown', ['$event'])
  handleShortcut(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
      return;
    }

    const current = this.store.currentPlayer();
    const selected = this.store.activeKeyboardCard();
    switch (event.key.toLowerCase()) {
      case 'escape':
        this.store.closeContextMenu();
        this.store.closeZoneModal();
        this.cancelNumberAction();
        this.cancelPowerToughnessDialog();
        this.cancelArrowTargetDialog();
        this.closeGameDialogOpen.set(false);
        this.store.clearSelection();
        break;
      case 'd':
        if (current) {
          event.preventDefault();
          void this.store.draw(current.id);
        }
        break;
      case 's':
        if (current) {
          event.preventDefault();
          void this.store.shuffle(current.id);
        }
        break;
      case 'u':
        if (current) {
          event.preventDefault();
          void this.store.untapCurrentBattlefield();
        }
        break;
      case 't':
        if (selected && this.store.canControlPlayer(selected.playerId)) {
          event.preventDefault();
          void this.store.command('card.tapped', {
            playerId: selected.playerId,
            zone: selected.zone,
            instanceId: selected.card.instanceId,
            tapped: !selected.card.tapped,
          });
        }
        break;
      case 'z':
        if (selected && this.store.canControlPlayer(selected.playerId)) {
          event.preventDefault();
          void this.store.command('card.face_down.changed', {
            playerId: selected.playerId,
            zone: selected.zone,
            instanceId: selected.card.instanceId,
            faceDown: !selected.card.faceDown,
          });
        }
        break;
      case 'k':
        if (selected && this.store.canControlPlayer(selected.playerId)) {
          event.preventDefault();
          void this.store.command('stack.card_added', {
            playerId: selected.playerId,
            zone: selected.zone,
            instanceId: selected.card.instanceId,
          });
        }
        break;
      case 'w':
        if (selected && this.store.canControlPlayer(selected.playerId)) {
          event.preventDefault();
          void this.store.moveActiveCard('graveyard');
        }
        break;
    }
  }

  @HostListener('window:pointermove', ['$event'])
  handlePointerMove(event: PointerEvent): void {
    this.store.moveFloatingPanel(event);
    this.store.moveCardPointerDrag(event);
  }

  @HostListener('window:pointerup', ['$event'])
  handlePointerUp(event: PointerEvent): void {
    this.store.endFloatingDrag();
    void this.store.endCardPointerDrag(event);
  }

  @HostListener('window:pointercancel', ['$event'])
  handlePointerCancel(event: PointerEvent): void {
    this.store.endFloatingDrag();
    void this.store.cancelCardPointerDrag(event);
  }

  isLibraryMenu(menu: GameContextMenu): boolean {
    return menu.zone === 'library' && !menu.card;
  }

  isHandContextMenuOpenForPlayer(playerId: string): boolean {
    const menu = this.store.contextMenu();

    return menu?.playerId === playerId && menu.zone === 'hand';
  }

  private queueBattlefieldReflow(): void {
    if (this.battlefieldReflowFrame !== null) {
      return;
    }

    this.battlefieldReflowFrame = window.requestAnimationFrame(() => {
      this.battlefieldReflowFrame = null;
      this.store.reflowBattlefieldCardPositions();
    });
  }

  private clearQueuedBattlefieldReflow(): void {
    if (this.battlefieldReflowFrame === null) {
      return;
    }

    window.cancelAnimationFrame(this.battlefieldReflowFrame);
    this.battlefieldReflowFrame = null;
  }

  isZoneOnlyMenu(menu: GameContextMenu): boolean {
    return !menu.card && menu.zone !== 'library';
  }

  handleContextMenuAction(action: ContextMenuAction, menu: GameContextMenu): void {
    const current = this.store.currentPlayer();

    switch (action.type) {
      case 'drawMine':
        if (current) void this.store.draw(current.id);
        this.store.closeContextMenu();
        return;
      case 'draw7Mine':
        if (current) void this.store.draw(current.id, 7);
        this.store.closeContextMenu();
        return;
      case 'revealTopMine':
        if (current) void this.store.revealTop(current.id);
        this.store.closeContextMenu();
        return;
      case 'shuffleMine':
        if (current) void this.store.shuffle(current.id);
        this.store.closeContextMenu();
        return;
      case 'copyGameId':
        this.store.copyGameId();
        return;
      case 'refreshSnapshot':
        this.store.closeContextMenu();
        window.location.reload();
        return;
      case 'focusCurrentPlayer':
        this.store.focusCurrentPlayer();
        this.store.closeContextMenu();
        return;
      case 'openChat':
        this.store.activeFloatingTab.set('chat');
        this.store.closeContextMenu();
        return;
      case 'openLog':
        this.store.activeFloatingTab.set('log');
        this.store.closeContextMenu();
        return;
      case 'leaveTable':
        this.requestTableExit('leave');
        return;
      case 'concedeGame':
        this.requestTableExit('concede');
        return;
      case 'closeGame':
        this.openCloseGameDialog();
        this.store.closeContextMenu();
        return;
      case 'focusPlayer':
        this.focusPlayerBattlefield(menu.playerId);
        return;
      case 'openZone':
        this.store.closeContextMenu();
        void this.store.openZone(menu.playerId, action.zone);
        return;
      case 'changeLife':
        this.store.changeLife(menu.playerId, action.delta);
        this.store.closeContextMenu();
        return;
      case 'drawCard':
        this.store.closeContextMenu();
        void this.store.draw(menu.playerId);
        return;
      case 'drawPrompt':
        this.openDrawDialog(menu.playerId);
        return;
      case 'moveTop':
        this.openMoveTopDialog(menu.playerId, action.zone, {
          targetPlayerId: action.targetPlayerId,
          position: action.position,
        });
        return;
      case 'shuffle':
        this.store.closeContextMenu();
        void this.store.shuffle(menu.playerId);
        return;
      case 'revealTop':
        this.store.closeContextMenu();
        void this.store.revealTop(menu.playerId, action.target ?? 'all');
        return;
      case 'revealLibrary':
        this.store.closeContextMenu();
        void this.store.revealLibrary(menu.playerId, action.targetPlayerId);
        return;
      case 'playTopRevealed':
        this.store.closeContextMenu();
        void this.store.setPlayTopRevealed(menu.playerId, action.enabled);
        return;
      case 'openLibraryView':
        if (action.mode === 'all') {
          this.store.closeContextMenu();
          void this.store.viewLibrary(menu.playerId);
          return;
        }
        this.openViewTopLibraryDialog(menu.playerId);
        return;
      case 'moveAll':
        this.moveAllFromZone(menu, action.zone, action.targetPlayerId);
        return;
      case 'selectRandomCard':
        this.store.closeContextMenu();
        void this.store.selectRandomZoneCard(menu.playerId, menu.zone);
        return;
      case 'tapCard':
        void this.store.tapCard(menu);
        return;
      case 'faceDown':
        void this.store.faceDown(menu);
        return;
      case 'playFaceDown':
        void this.store.playFaceDown(menu);
        return;
      case 'flipCardFace':
        void this.store.flipCardFace(menu);
        return;
      case 'revealCard':
        void this.store.revealCard(menu, action.target);
        return;
      case 'createToken':
        this.openTokenSearchModal(menu.playerId);
        return;
      case 'rollDice':
        this.openRollModal();
        return;
      case 'tokenCopy':
        void this.store.tokenCopy(menu);
        return;
      case 'drawArrow':
        this.openArrowTargetDialog(menu);
        return;
      case 'addToStack':
        void this.store.addToStack(menu);
        return;
      case 'setPowerToughness':
        this.openPowerToughnessDialog(menu);
        return;
      case 'clearPowerToughness':
        void this.store.clearPowerToughness(menu);
        return;
      case 'changeCounter':
        void this.store.setCardCounter(menu, action.counter, 0);
        return;
      case 'removeCounter':
        void this.store.deleteCardCounterByKey(menu, action.counter);
        return;
      case 'removeAllCounters':
        void this.store.deleteAllCardCounters(menu);
        return;
      case 'giveToPlayer':
        if (menu.zone === 'hand') {
          this.openHandCardGiveDialog(menu, action.targetPlayerId);
          return;
        }
        void this.store.giveCardToPlayer(menu, action.targetPlayerId);
        return;
      case 'moveCard':
        if (menu.zone === 'library' && action.zone === 'hand' && menu.card) {
          this.openLibraryCardMoveToHandDialog(menu);
          return;
        }
        this.store.moveCard(menu, action.zone, { position: action.position });
        return;
      case 'deleteArrow':
        void this.store.deleteArrow(menu);
        return;
      case 'deleteArrows':
        void this.store.deleteOwnedArrows(menu);
        return;
      case 'deleteCounter':
        void this.store.deleteCardCounter(menu);
        return;
      case 'previewCard':
        if (menu.card) {
          this.store.showCardPreview(menu.card);
        }
        this.store.closeContextMenu();
        return;
      }
  }

  confirmNumberAction(value: number): void {
    const request = this.numberActionDialog();
    this.numberActionDialog.set(null);

    if (!request) {
      return;
    }

    switch (request.kind) {
      case 'draw':
        void this.store.draw(request.playerId, value);
        return;
      case 'moveTop':
        void this.store.moveTop(request.playerId, request.toZone, value, {
          targetPlayerId: request.targetPlayerId,
          position: request.position,
        });
        return;
      case 'viewTop':
        void this.store.viewTopLibrary(request.playerId, value);
        return;
    }
  }

  onZoneDoubleClick(playerId: string, zone: GameZoneName): void {
    if (zone === 'library') {
      void this.store.draw(playerId);
    }
  }

  cancelNumberAction(): void {
    this.numberActionDialog.set(null);
  }

  updateZoneMoveAllLibraryRandomOrder(event: Event): void {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    this.zoneMoveAllLibraryRandomOrder.set(input?.checked ?? false);
  }

  confirmZoneMoveAllToLibrary(position: 'top' | 'bottom'): void {
    const request = this.zoneMoveAllLibraryDialog();
    if (!request) {
      return;
    }

    const randomOrder = request.count > 1 && this.zoneMoveAllLibraryRandomOrder();
    this.zoneMoveAllLibraryDialog.set(null);
    this.zoneMoveAllLibraryRandomOrder.set(false);
    void this.store.moveAllZoneCards(request.playerId, request.fromZone, 'library', { position, randomOrder });
  }

  cancelZoneMoveAllToLibrary(): void {
    this.zoneMoveAllLibraryDialog.set(null);
    this.zoneMoveAllLibraryRandomOrder.set(false);
  }

  confirmHandCardGive(): void {
    const request = this.handCardGiveDialog();
    this.handCardGiveDialog.set(null);
    if (!request) {
      return;
    }

    void this.store.giveHandCardToPlayer(request.menu, request.targetPlayerId);
  }

  confirmLibraryCardMoveToHand(reveal: boolean): void {
    const request = this.libraryCardMoveToHandDialog();
    this.libraryCardMoveToHandDialog.set(null);
    if (!request) {
      return;
    }

    void this.store.moveLibraryCardToHand(request.menu, reveal);
  }

  cancelLibraryCardMoveToHand(): void {
    this.libraryCardMoveToHandDialog.set(null);
    this.store.closeContextMenu();
  }

  cancelHandCardGive(): void {
    this.handCardGiveDialog.set(null);
  }

  updatePowerToughnessValue(change: PowerToughnessDialogValueChange): void {
    this.powerToughnessDialog.update((request) => request ? { ...request, [change.stat]: change.value } : request);
  }

  confirmPowerToughnessDialog(): void {
    const request = this.powerToughnessDialog();
    if (!request || this.isPowerToughnessDialogInvalid()) {
      return;
    }

    this.powerToughnessDialog.set(null);
    void this.store.setPowerToughness(request.menu, Number(request.power), Number(request.toughness));
  }

  cancelPowerToughnessDialog(): void {
    this.powerToughnessDialog.set(null);
  }

  updateArrowTargetDialog(value: ArrowTargetDialogValue): void {
    const request = this.arrowTargetDialog();
    if (!request) {
      return;
    }

    this.arrowTargetDialog.set({
      ...request,
      selectedPlayerId: value.playerId,
      multipleTargets: value.multipleTargets,
      targetCount: value.targetCount,
    });
    this.focusPlayerBattlefield(value.playerId);
    window.requestAnimationFrame(() => this.focusPlayerBattlefield(value.playerId));
  }

  confirmArrowTargetDialog(value: ArrowTargetDialogValue): void {
    const request = this.arrowTargetDialog();
    if (!request) {
      return;
    }

    this.arrowTargetDialog.set(null);
    this.focusPlayerBattlefield(value.playerId);
    window.requestAnimationFrame(() => this.focusPlayerBattlefield(value.playerId));
    this.store.startArrowFrom(request.sourceMenu, value.targetCount);
  }

  cancelArrowTargetDialog(): void {
    this.arrowTargetDialog.set(null);
  }

  confirmCloseGame(): void {
    this.closeGameDialogOpen.set(false);
    void this.store.closeGame();
  }

  cancelCloseGame(): void {
    this.closeGameDialogOpen.set(false);
  }

  async confirmTableExitAction(): Promise<void> {
    const action = this.tableExitAction();
    this.tableExitAction.set(null);
    if (action === 'concede') {
      await this.store.concedeGame();
      return;
    }
    if (action === 'leave') {
      await this.leaveTableFromContextMenu();
    }
  }

  cancelTableExitAction(): void {
    this.tableExitAction.set(null);
  }

  async createSelectedToken(card: Card): Promise<void> {
    const playerId = this.tokenSearchPlayerId();
    if (!playerId || this.tokenSearchPending()) {
      return;
    }

    this.tokenSearchPending.set(true);
    try {
      await this.store.createToken(playerId, card);
      this.tokenSearchPlayerId.set(null);
    } finally {
      this.tokenSearchPending.set(false);
    }
  }

  closeTokenSearchModal(): void {
    if (this.tokenSearchPending()) {
      return;
    }

    this.tokenSearchPlayerId.set(null);
  }

  openRollModal(): void {
    this.store.closeContextMenu();
    this.rollModalOpen.set(true);
  }

  closeRollModal(): void {
    this.rollModalOpen.set(false);
  }

  async recordRollResult(result: RollResult): Promise<void> {
    await this.store.recordDiceRoll({
      kind: result.kind,
      label: result.label,
      finalResult: result.finalResult,
    });
  }

  openRematchModal(): void {
    this.rematchModalOpen.set(true);
  }

  closeRematchModal(): void {
    this.rematchModalOpen.set(false);
  }

  async votePlayAgain(): Promise<void> {
    await this.submitRematchVote('play_again');
  }

  async abandonRematchRoom(): Promise<void> {
    await this.submitRematchVote('leave');
  }

  pendingLibraryMoveSupportsRandomOrder(pendingMove: PendingLibraryMove): boolean {
    const instanceIds = pendingMove.payload['instanceIds'];

    return pendingMove.commandType === 'cards.moved'
      && pendingMove.payload['toZone'] === 'library'
      && Array.isArray(instanceIds)
      && instanceIds.length > 1;
  }

  pendingLibraryMoveMessage(pendingMove: PendingLibraryMove): string {
    const instanceIds = pendingMove.payload['instanceIds'];
    const isMultiMove = Array.isArray(instanceIds) && instanceIds.length > 1;

    return isMultiMove
      ? 'Donde quieres poner estas cartas?'
      : 'Donde quieres poner esta carta?';
  }

  updateLibraryMoveRandomOrder(event: Event): void {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    this.libraryMoveRandomOrder.set(input?.checked ?? false);
  }

  confirmPendingLibraryMove(position: 'top' | 'bottom'): void {
    const pendingMove = this.store.pendingLibraryMove();
    const randomOrder = pendingMove
      ? this.pendingLibraryMoveSupportsRandomOrder(pendingMove) && this.libraryMoveRandomOrder()
      : false;

    this.libraryMoveRandomOrder.set(false);
    void this.store.confirmPendingLibraryMove(position, randomOrder);
  }

  cancelPendingLibraryMove(): void {
    this.libraryMoveRandomOrder.set(false);
    void this.store.cancelPendingLibraryMove();
  }

  focusPlayerBattlefield(playerId: string): void {
    const focused = this.store.focusPlayer(playerId);
    if (focused) {
      this.queueBattlefieldReflow();
    }
  }

  updateFollowActiveTurnPlayer(enabled: boolean): void {
    this.followActiveTurnPlayer.set(enabled);
    if (!enabled) {
      this.lastFocusedTurnPlayerId = null;
      return;
    }

    this.syncFollowActiveTurnPlayer(this.store.snapshot()?.turn.activePlayerId ?? null);
  }

  private openDrawDialog(playerId: string): void {
    this.store.closeContextMenu();
    this.numberActionDialog.set({
      kind: 'draw',
      playerId,
      title: 'Draw cards',
      description: 'Choose how many cards to draw from your library.',
      defaultValue: 1,
      min: 1,
      confirmLabel: 'Draw',
    });
  }

  private openLibraryCardMoveToHandDialog(menu: GameContextMenu): void {
    if (!menu.card) {
      return;
    }

    this.store.closeContextMenu();
    this.libraryCardMoveToHandDialog.set({
      menu,
      cardName: menu.card.name,
    });
  }

  private requestTableExit(action: TableExitAction): void {
    this.store.closeContextMenu();
    this.rematchModalOpen.set(false);
    this.tableExitAction.set(action);
  }

  private openTokenSearchModal(playerId: string): void {
    this.store.closeContextMenu();
    this.tokenSearchPlayerId.set(playerId);
  }

  private async leaveTableFromContextMenu(): Promise<void> {
    this.store.closeContextMenu();
    this.rematchModalOpen.set(false);
    this.leavingTable.set(true);
    try {
      await this.store.leaveTable();
    } catch (error) {
      this.leavingTable.set(false);
      throw error;
    }
  }

  private openMoveTopDialog(
    playerId: string,
    toZone: GameZoneName,
    options: { targetPlayerId?: string; position?: 'top' | 'bottom' } = {},
  ): void {
    this.store.closeContextMenu();
    const destination = this.libraryMoveTopDestinationLabel(toZone, options.targetPlayerId, options.position);
    this.numberActionDialog.set({
      kind: 'moveTop',
      playerId,
      toZone,
      targetPlayerId: options.targetPlayerId,
      position: options.position,
      title: 'Move top cards',
      description: `Choose how many top library cards to move to ${destination}.`,
      defaultValue: 1,
      min: 1,
      confirmLabel: 'Move',
    });
  }

  private openViewTopLibraryDialog(playerId: string): void {
    this.store.closeContextMenu();
    this.numberActionDialog.set({
      kind: 'viewTop',
      playerId,
      title: 'View top cards',
      description: 'Choose how many top library cards to view.',
      defaultValue: 1,
      min: 1,
      confirmLabel: 'View',
    });
  }

  private libraryMoveTopDestinationLabel(toZone: GameZoneName, targetPlayerId?: string, position?: 'top' | 'bottom'): string {
    if (toZone === 'library' && position === 'bottom') {
      return 'the bottom of your library';
    }
    if (targetPlayerId) {
      return `${this.store.playerDisplayName(targetPlayerId)} ${this.store.zoneTitle(toZone).toLowerCase()}`;
    }

    return this.store.zoneTitle(toZone).toLowerCase();
  }

  private moveAllFromZone(menu: GameContextMenu, toZone: GameZoneName, targetPlayerId?: string): void {
    this.store.closeContextMenu();
    const count = this.store.zoneCardInstanceIds(menu.playerId, menu.zone).length;
    if (count <= 0) {
      return;
    }

    if (toZone === 'library') {
      this.zoneMoveAllLibraryDialog.set({ playerId: menu.playerId, fromZone: menu.zone, count });
      return;
    }

    void this.store.moveAllZoneCards(menu.playerId, menu.zone, toZone, { targetPlayerId });
  }

  private openHandCardGiveDialog(menu: GameContextMenu, targetPlayerId: string): void {
    if (!menu.card || menu.zone !== 'hand') {
      return;
    }

    this.store.closeContextMenu();
    this.handCardGiveDialog.set({
      menu,
      targetPlayerId,
      targetPlayerName: this.playerName(targetPlayerId),
      cardName: menu.card.name,
    });
  }

  private playerName(playerId: string): string {
    return this.store.players().find((player) => player.id === playerId)?.state.user.displayName || playerId;
  }

  private openPowerToughnessDialog(menu: GameContextMenu): void {
    if (!menu.card) {
      return;
    }

    this.store.closeContextMenu();
    this.powerToughnessDialog.set({
      menu,
      power: String(menu.card.power ?? 0),
      toughness: String(menu.card.toughness ?? 0),
    });
  }

  private syncFollowActiveTurnPlayer(activePlayerId: string | null | undefined): void {
    if (!this.followActiveTurnPlayer()) {
      this.lastFocusedTurnPlayerId = null;
      return;
    }

    if (!activePlayerId || activePlayerId === this.lastFocusedTurnPlayerId) {
      return;
    }

    this.lastFocusedTurnPlayerId = activePlayerId;
    this.focusPlayerBattlefield(activePlayerId);
  }

  private openArrowTargetDialog(menu: GameContextMenu): void {
    if (!menu.card || menu.zone !== 'battlefield') {
      return;
    }

    const selectedPlayerId = this.arrowTargetPlayers()[0]?.id
      ?? menu.playerId;
    this.store.closeContextMenu();
    this.arrowTargetDialog.set({
      sourceMenu: menu,
      selectedPlayerId,
      multipleTargets: false,
      targetCount: 1,
    });
    this.focusPlayerBattlefield(selectedPlayerId);
    window.requestAnimationFrame(() => this.focusPlayerBattlefield(selectedPlayerId));
  }

  private openCloseGameDialog(): void {
    this.closeGameDialogOpen.set(true);
  }

  private clearQueuedFloatingContentScroll(): void {
    if (this.floatingScrollFrame !== null) {
      window.cancelAnimationFrame(this.floatingScrollFrame);
      this.floatingScrollFrame = null;
    }

    if (this.floatingScrollTimer !== null) {
      window.clearTimeout(this.floatingScrollTimer);
      this.floatingScrollTimer = null;
    }
  }

  private syncRematchCountdown(promptKey: string, hasMissingVotes: boolean, countdownEnabled: boolean): void {
    if (!promptKey || !hasMissingVotes || !countdownEnabled) {
      this.clearRematchCountdown();
      return;
    }

    const mode: RematchCountdownMode = this.rematchMissingVotePlayers().length === 1 ? 'courtesy' : 'initial';
    const countdownKey = `${promptKey}:${mode}`;
    if (this.rematchCountdownKey === countdownKey && this.rematchCountdownDeadlineMs !== null) {
      this.updateRematchCountdown();
      return;
    }

    this.rematchCountdownKey = countdownKey;
    this.rematchCountdownDeadlineMs = Date.now() + (mode === 'courtesy' ? 30_000 : 60_000);
    this.rematchCountdownMode.set(mode);
    this.startRematchCountdownTimer();
    this.updateRematchCountdown();
  }

  private startRematchCountdownTimer(): void {
    if (this.rematchCountdownTimer !== null) {
      return;
    }

    this.rematchCountdownTimer = window.setInterval(() => this.updateRematchCountdown(), 250);
  }

  private updateRematchCountdown(): void {
    if (this.rematchCountdownDeadlineMs === null) {
      return;
    }
    if (!this.rematchVoteCountdownEnabled()) {
      this.clearRematchCountdown();
      return;
    }

    const seconds = Math.max(0, Math.ceil((this.rematchCountdownDeadlineMs - Date.now()) / 1000));
    this.rematchCountdownSeconds.set(seconds);
    if (seconds > 0 || !this.currentPlayerNeedsRematchVote() || this.rematchPending()) {
      return;
    }

    const countdownKey = this.rematchCountdownKey;
    if (!countdownKey || countdownKey === this.rematchAutoLeaveKey) {
      return;
    }

    this.rematchAutoLeaveKey = countdownKey;
    void this.submitRematchVote('leave');
  }

  private async submitRematchVote(vote: GameRematchVote): Promise<void> {
    if (this.rematchPending()) {
      return;
    }

    const gameId = this.store.gameId();
    if (!gameId) {
      return;
    }

    this.rematchPending.set(true);
    this.rematchToast.set(null);
    try {
      const response = await firstValueFrom(this.gamesApi.rematchVote(gameId, vote));
      if (vote === 'leave') {
        this.rematchModalOpen.set(false);
        await this.router.navigate(['/rooms']);
        return;
      }
      if (response.status === 'room_ready' && response.room) {
        this.rematchModalOpen.set(false);
        await this.router.navigate(['/rooms', response.room.id, 'waiting']);
        return;
      }
      if (response.status === 'left' || response.status === 'room_deleted') {
        this.rematchModalOpen.set(false);
        await this.router.navigate(['/rooms']);
        return;
      }
      if (response.status === 'waiting_for_game_end') {
        this.rematchModalOpen.set(false);
        this.showRematchToast(response.message ?? 'Tu voto se ha guardado. Espera a que termine la partida.');
      }

      await this.store.refetch(true);
    } catch (error) {
      this.showRematchToast(this.rematchErrorMessage(error));
    } finally {
      this.rematchPending.set(false);
    }
  }

  private showRematchToast(message: string): void {
    this.clearRematchToastTimer();
    this.rematchToast.set(message);
    this.rematchToastTimer = window.setTimeout(() => {
      if (this.rematchToast() === message) {
        this.rematchToast.set(null);
      }
      this.rematchToastTimer = null;
    }, 3000);
  }

  private rematchErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'error' in error) {
      const response = (error as { error?: { error?: string; detail?: string } }).error;
      return response?.error ?? response?.detail ?? 'No se pudo guardar la votacion.';
    }

    return 'No se pudo guardar la votacion.';
  }

  private clearRematchToastTimer(): void {
    if (this.rematchToastTimer === null) {
      return;
    }

    window.clearTimeout(this.rematchToastTimer);
    this.rematchToastTimer = null;
  }

  private clearRematchCountdown(): void {
    if (this.rematchCountdownTimer !== null) {
      window.clearInterval(this.rematchCountdownTimer);
      this.rematchCountdownTimer = null;
    }

    this.rematchCountdownDeadlineMs = null;
    this.rematchCountdownKey = '';
    this.rematchCountdownSeconds.set(null);
    this.rematchCountdownMode.set(null);
  }

}
