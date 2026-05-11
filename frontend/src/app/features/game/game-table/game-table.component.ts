import { AfterViewChecked, ChangeDetectionStrategy, Component, ElementRef, HostListener, QueryList, ViewChildren, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { AppModalComponent } from '../../../shared/ui/app-modal/app-modal.component';
import { PrettyScrollDirective } from '../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { GameCardInstance, GameZoneName } from '../../../core/models/game.model';
import { GameTableCardActionsService } from './services/game-table-card-actions.service';
import { GameTableCardStatsService } from './services/game-table-card-stats.service';
import { GameTableBattlefieldDragCoordinatorService } from './services/game-table-battlefield-drag-coordinator.service';
import { GameTableCommandService } from './services/game-table-command.service';
import { GameTableDragService } from './services/game-table-drag.service';
import { GameTableDropActionsService } from './services/game-table-drop-actions.service';
import { GameTableInteractionActionsService } from './services/game-table-interaction-actions.service';
import { GameTableLibraryActionsService } from './services/game-table-library-actions.service';
import { GameTablePointerDragActionsService } from './services/game-table-pointer-drag-actions.service';
import { GameTableRealtimeService } from './services/game-table-realtime.service';
import { GameTableSelectionService } from './services/game-table-selection.service';
import { GameTableSessionService } from './services/game-table-session.service';
import { GameTableTurnActionsService } from './services/game-table-turn-actions.service';
import { GameTableZoneActionsService } from './services/game-table-zone-actions.service';
import { GameTableChatLogState } from './state/game-table-chat-log.state';
import { GameTableBattlefieldDragState } from './state/game-table-battlefield-drag.state';
import { GameTableSnapshotSelectors } from './state/game-table-snapshot-selectors';
import { GameContextMenu, GameTableUiState } from './state/game-table-ui.state';
import { GameTableZoneModalState } from './state/game-table-zone-modal.state';
import { GameTableStore, PlayerView } from './game-table.store';
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
  readonly title: string;
  readonly description: string;
  readonly defaultValue: number;
  readonly min: number;
  readonly max?: number;
  readonly confirmLabel: string;
}

interface CounterNumberActionRequest {
  readonly kind: 'counter';
  readonly menu: GameContextMenu;
  readonly counter: string;
  readonly title: string;
  readonly description: string;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly confirmLabel: string;
}

type NumberActionRequest = DrawNumberActionRequest | MoveTopNumberActionRequest | CounterNumberActionRequest;

interface PowerToughnessActionRequest {
  readonly menu: GameContextMenu;
  readonly power: string;
  readonly toughness: string;
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
    GameTableLibraryActionsService,
    GameTableTurnActionsService,
    GameTableZoneActionsService,
    GameTableSnapshotSelectors,
    GameTableUiState,
    GameTableBattlefieldDragState,
    GameTableZoneModalState,
    GameTableChatLogState,
  ],
  templateUrl: './game-table.component.html',
  styleUrl: './game-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameTableComponent implements AfterViewChecked {
  readonly store = inject(GameTableStore);
  readonly counterPresets = ['+1/+1', '-1/-1', 'loyalty', 'charge'];
  readonly moveZones: GameZoneName[] = ['battlefield', 'graveyard', 'exile', 'hand', 'command', 'library'];
  readonly colorAccent = (player: PlayerView | null): string => this.store.colorAccent(player);
  readonly topDraggableCard = (player: PlayerView, zone: GameZoneName): GameCardInstance | null => this.store.topDraggableCard(player, zone);
  readonly zoneCount = (player: PlayerView, zone: GameZoneName): number => this.store.zoneCount(player, zone);
  readonly logTime = (createdAt: string): string => this.store.logTime(createdAt);
  readonly isDropZoneHighlighted = (playerId: string, zone: GameZoneName): boolean => this.store.isDropZoneHighlighted(playerId, zone);
  readonly zoneTitle = (zone: GameZoneName): string => this.store.zoneTitle(zone);
  readonly zonePreviewImage = (player: PlayerView, zone: GameZoneName): string | null => this.store.zonePreviewImage(player, zone);
  readonly commanderCastCount = (player: PlayerView): number => this.store.commanderCastCount(player);
  readonly deckLabel = (player: PlayerView | null): string => this.store.deckLabel(player);
  readonly manaSymbols = (player: PlayerView | null): string[] => this.store.manaSymbols(player);
  readonly cardPosition = (card: GameCardInstance): { x: number; y: number } | null => this.store.cardPosition(card);
  readonly miniCardLeft = (card: GameCardInstance, index: number): number => this.store.miniCardLeft(card, index);
  readonly miniCardTop = (card: GameCardInstance, index: number): number => this.store.miniCardTop(card, index);
  readonly cardImage = (card: GameCardInstance): string | null => this.store.cardImage(card);
  readonly isPlayerDropHighlighted = (playerId: string): boolean => this.store.isPlayerDropHighlighted(playerId);
  readonly isPhasePast = (phase: string): boolean => this.store.isPhasePast(phase);
  readonly isCurrentPlayer = (playerId: string): boolean => this.store.isCurrentPlayer(playerId);
  readonly countItems = (count: number): number[] => this.store.countItems(count);
  readonly isSelected = (instanceId: string): boolean => this.store.isSelected(instanceId);
  readonly isDraggingCard = (card: GameCardInstance): boolean => this.store.isDraggingCard(card);
  readonly isHandDropTarget = (playerId: string, card: GameCardInstance, placement: 'before' | 'after'): boolean =>
    this.store.isHandDropTarget(playerId, card, placement);
  readonly canDragBattlefieldCard = (playerId: string, card: GameCardInstance): boolean => this.store.canDragBattlefieldCard(playerId, card);
  readonly isPendingBattlefieldTransfer = (card: GameCardInstance): boolean => this.store.isPendingBattlefieldTransfer(card);
  readonly shouldShowPowerToughness = (card: GameCardInstance): boolean => this.store.shouldShowPowerToughness(card);
  readonly cardPowerValue = (card: GameCardInstance): number => this.store.cardPowerValue(card);
  readonly cardToughnessValue = (card: GameCardInstance): number => this.store.cardToughnessValue(card);
  readonly firstCounter = (card: GameCardInstance): { key: string; value: number } | null => this.store.firstCounter(card);
  readonly alignmentGuideFor = (playerId: string): { y: number } | null => this.store.alignmentGuideFor(playerId);
  readonly isManaLaneHighlighted = (playerId: string): boolean => this.store.isManaLaneHighlighted(playerId);
  readonly canControlPlayer = (playerId: string): boolean => this.store.canControlPlayer(playerId);
  readonly canUseHiddenZone = (playerId: string, zone: GameZoneName): boolean => this.store.canUseHiddenZone(playerId, zone);
  readonly numberActionDialog = signal<NumberActionRequest | null>(null);
  readonly powerToughnessDialog = signal<PowerToughnessActionRequest | null>(null);
  readonly closeGameDialogOpen = signal(false);
  readonly isPowerToughnessDialogInvalid = computed(() => {
    const request = this.powerToughnessDialog();

    return !request || !Number.isFinite(Number(request.power)) || !Number.isFinite(Number(request.toughness));
  });
  private lastAutoScrollKey = '';

  @ViewChildren('autoScrollFeed') private readonly autoScrollFeeds?: QueryList<ElementRef<HTMLElement>>;

  ngAfterViewChecked(): void {
    const snapshot = this.store.snapshot();
    if (!snapshot) {
      return;
    }

    const log = this.store.eventLog();
    const latestChat = snapshot.chat.at(-1)?.createdAt ?? '';
    const latestLog = log.at(-1)?.id ?? '';
    const rawLatestLog = snapshot.eventLog.at(-1)?.id ?? '';
    const key = `${this.store.activeFloatingTab()}:${snapshot.chat.length}:${latestChat}:${snapshot.eventLog.length}:${rawLatestLog}:${log.length}:${latestLog}`;
    if (key === this.lastAutoScrollKey) {
      return;
    }

    this.lastAutoScrollKey = key;
    queueMicrotask(() => {
      for (const feed of this.autoScrollFeeds?.toArray() ?? []) {
        feed.nativeElement.scrollTop = feed.nativeElement.scrollHeight;
      }
    });
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
        void this.store.refetch(true);
        this.store.closeContextMenu();
        return;
      case 'focusCurrentPlayer':
        this.store.focusCurrentPlayer();
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
        this.store.leaveTable();
        return;
      case 'concedeGame':
        void this.store.concedeGame();
        return;
      case 'closeGame':
        this.openCloseGameDialog();
        this.store.closeContextMenu();
        return;
      case 'focusPlayer':
        this.store.focusPlayer(menu.playerId);
        return;
      case 'openZone':
        this.store.openZone(menu.playerId, action.zone);
        return;
      case 'changeLife':
        this.store.changeLife(menu.playerId, action.delta);
        this.store.closeContextMenu();
        return;
      case 'drawCard':
        void this.store.draw(menu.playerId);
        return;
      case 'drawPrompt':
        this.openDrawDialog(menu.playerId);
        return;
      case 'moveTop':
        this.openMoveTopDialog(menu.playerId, action.zone);
        return;
      case 'shuffle':
        void this.store.shuffle(menu.playerId);
        return;
      case 'revealTop':
        void this.store.revealTop(menu.playerId);
        return;
      case 'moveAll':
        void this.store.command('zone.move_all', { playerId: menu.playerId, fromZone: menu.zone, toZone: action.zone });
        return;
      case 'tapCard':
        void this.store.tapCard(menu);
        return;
      case 'faceDown':
        void this.store.faceDown(menu);
        return;
      case 'revealCard':
        void this.store.revealCard(menu);
        return;
      case 'tokenCopy':
        void this.store.tokenCopy(menu);
        return;
      case 'addToStack':
        void this.store.addToStack(menu);
        return;
      case 'setPowerToughness':
        this.openPowerToughnessDialog(menu);
        return;
      case 'changeCounter':
        this.openCounterDialog(menu, action.counter);
        return;
      case 'moveCard':
        this.store.moveCard(menu, action.zone);
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
        void this.store.moveTop(request.playerId, request.toZone, value);
        return;
      case 'counter':
        void this.store.changeCardCounter(request.menu, request.counter, value);
        return;
    }
  }

  cancelNumberAction(): void {
    this.numberActionDialog.set(null);
  }

  updatePowerToughnessValue(stat: 'power' | 'toughness', value: string): void {
    this.powerToughnessDialog.update((request) => request ? { ...request, [stat]: value } : request);
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

  confirmCloseGame(): void {
    this.closeGameDialogOpen.set(false);
    void this.store.closeGame();
  }

  cancelCloseGame(): void {
    this.closeGameDialogOpen.set(false);
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

  private openMoveTopDialog(playerId: string, toZone: GameZoneName): void {
    this.store.closeContextMenu();
    this.numberActionDialog.set({
      kind: 'moveTop',
      playerId,
      toZone,
      title: 'Move top cards',
      description: `Choose how many top library cards to move to ${this.store.zoneTitle(toZone).toLowerCase()}.`,
      defaultValue: 1,
      min: 1,
      confirmLabel: 'Move',
    });
  }

  private openCounterDialog(menu: GameContextMenu, counter: string): void {
    this.store.closeContextMenu();
    this.numberActionDialog.set({
      kind: 'counter',
      menu,
      counter,
      title: `Change ${counter} counter`,
      description: 'Use a positive or negative value to adjust this counter.',
      defaultValue: 1,
      min: -99,
      max: 99,
      confirmLabel: 'Apply',
    });
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

  private openCloseGameDialog(): void {
    this.closeGameDialogOpen.set(true);
  }
}
