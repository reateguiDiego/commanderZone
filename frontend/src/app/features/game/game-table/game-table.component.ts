import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { AfterViewChecked, AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, QueryList, ViewChild, ViewChildren, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom, Subscription } from 'rxjs';
import { BodyScrollLockService } from '../../../shared/services/body-scroll-lock.service';
import { AppModalComponent } from '../../../shared/ui/app-modal/app-modal.component';
import { PrettyScrollDirective } from '../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { ChatMessage, ChatReactionType, GameCardDungeonMarker, GameCardInstance, GameCardPosition, GameCardStatValue, GamePowerToughnessValue, GameRematchVote, GameSnapshot, GameSpecialEntity, GameZoneName } from '../../../core/models/game.model';
import { GameSnapshotPatchOperation } from '../../../core/models/game-realtime.model';
import { Card } from '../../../core/models/card.model';
import { CardsApi } from '../../../core/api/cards.api';
import { GamesApi } from '../../../core/api/games.api';
import { GameTableCardActionsService } from './services/game-table-card-actions.service';
import { GameTableCardStatsService } from './services/game-table-card-stats.service';
import { GameTableBattlefieldDragCoordinatorService } from './services/game-table-battlefield-drag-coordinator.service';
import { GameTableCommandService } from './services/game-table-command.service';
import { GameTableDebouncedValueCommandsService } from './services/game-table-debounced-value-commands.service';
import { GameTableDragService } from './services/game-table-drag.service';
import { GameTableDropActionsService, type PendingLibraryMove } from './services/game-table-drop-actions.service';
import { GameTableInteractionActionsService } from './services/game-table-interaction-actions.service';
import { GameTableLibraryActionsService } from './services/game-table-library-actions.service';
import { GameTablePointerDragActionsService } from './services/game-table-pointer-drag-actions.service';
import { GameTablePointerDragService } from './services/game-table-pointer-drag.service';
import { GameTableGameRealtimeService } from './services/game-table-game-realtime.service';
import { GameTableSelectionService } from './services/game-table-selection.service';
import { GameTableSessionService } from './services/game-table-session.service';
import { GameTableDisconnectVoteService } from './services/game-table-disconnect-vote.service';
import { GameTableWebsocketGameplayService } from './services/game-table-websocket-gameplay.service';
import { GameTableWebsocketTransportService } from './services/game-table-websocket-transport.service';
import { GameTableTurnActionsService } from './services/game-table-turn-actions.service';
import { GameTableZoneActionsService } from './services/game-table-zone-actions.service';
import { GameTableZonePointerMoveActionsService } from './services/game-table-zone-pointer-move-actions.service';
import { GameTableMotionService } from './services/game-table-motion.service';
import { GameTableChatReadStateService, type GameTableChatReadContext } from './services/game-table-chat-read-state.service';
import { GameTableNotificationSoundService } from './services/game-table-notification-sound.service';
import { GameTableManaCometService } from './services/game-table-mana-comet.service';
import {
  GameTableRealtimeAnimationBusService,
  type GameTableRealtimePatchAnimationEvent,
} from './services/game-table-realtime-animation-bus.service';
import { GameTableChatLogState } from './state/chat/game-table-chat-log.state';
import { GameTableChatStore } from './state/chat/game-table-chat.store';
import { GameTableCommandStore } from './state/core/game-table-command.store';
import { GameTableCoreState } from './state/core/game-table-core.state';
import { GameTablePendingTransferRegistrarState } from './state/core/game-table-pending-transfer-registrar.state';
import { GameTableBattlefieldDragState } from './state/drag-drop/game-table-battlefield-drag.state';
import { GameTableBattlefieldState } from './state/battlefield/game-table-battlefield.state';
import { GameTableBattlefieldZoomState, MIN_BATTLEFIELD_ZOOM_PERCENT } from './state/battlefield/game-table-battlefield-zoom.state';
import { GameTableCardsState } from './state/cards/game-table-cards.state';
import { GameTableContextStore } from './state/core/game-table-context.store';
import { GameTableCountersState } from './state/cards/game-table-counters.state';
import { GameTableDragDropStore } from './state/drag-drop/game-table-drag-drop.store';
import { GameTableDropFeedbackState } from './state/drag-drop/game-table-drop-feedback.state';
import { GameTableGameActionsStore } from './state/game-actions/game-table-game-actions.store';
import { GameTableHandState } from './state/hand/game-table-hand.state';
import { GameTableLibraryTopState } from './state/zones/game-table-library-top.state';
import { GameTableMulliganState } from './state/mulligan/game-table-mulligan.state';
import { GameTablePendingTransferState } from './state/core/game-table-pending-transfer.state';
import { GameTableArrowsState } from './state/arrows/game-table-arrows.state';
import { GameTableAttachmentsState } from './state/attachments/game-table-attachments.state';
import { GameTableOpponentTargetsState } from './state/arrows/game-table-opponent-targets.state';
import { GameTablePlayersStore } from './state/players/game-table-players.store';
import { GameTableSnapshotCoordinatorState } from './state/core/game-table-snapshot-coordinator.state';
import { GameTableSnapshotSelectors } from './state/core/game-table-snapshot-selectors';
import { GameTableToastState } from './state/core/game-table-toast.state';
import { GameContextMenu, GameTableUiState } from './state/core/game-table-ui.state';
import { GameTableZoneModalState } from './state/zones/game-table-zone-modal.state';
import { GameTableZonePilesState } from './state/zones/game-table-zone-piles.state';
import { GameTableManaPoolState } from './state/mana/game-table-mana-pool.state';
import { GameTableStore, PlayerView, SelectedCard } from './game-table.store';
import { playerIsActiveForTurn, playerIsDefeated } from './utils/game-player-defeat';
import { GameLogPanelComponent } from './components/game-log-panel/game-log-panel.component';
import { ZonePilesPanelComponent } from './components/zone-piles-panel/zone-piles-panel.component';
import { OpponentMiniBoardComponent } from './components/opponent-mini-board/opponent-mini-board.component';
import { PlayerSummaryPanelComponent } from './components/player-summary-panel/player-summary-panel.component';
import { TurnPhasePanelComponent } from './components/turn-phase-panel/turn-phase-panel.component';
import { PlayerHandPanelComponent } from './components/player-hand-panel/player-hand-panel.component';
import { FocusedBattlefieldComponent } from './components/focused-battlefield/focused-battlefield.component';
import { BattlefieldZoomControlsComponent } from './components/battlefield-zoom-controls/battlefield-zoom-controls.component';
import { ContextMenuAction, ContextMenuComponent } from './components/context-menu/context-menu.component';
import { ZoneModalComponent } from './components/zone-modal/zone-modal.component';
import { NumberActionDialogComponent } from './components/number-action-dialog/number-action-dialog.component';
import { ManaActionDialogComponent, ManaActionDialogValueChange } from './components/mana-action-dialog/mana-action-dialog.component';
import { ManaCometLayerComponent } from './components/mana-comet-layer/mana-comet-layer.component';
import { GameTableHeaderComponent } from './components/game-table-header/game-table-header.component';
import { GameAdBannerComponent } from './components/game-ad-banner/game-ad-banner.component';
import { CardPreviewOverlayComponent } from './components/card-preview-overlay/card-preview-overlay.component';
import { DungeonLocationPinComponent } from './components/dungeon-location-pin/dungeon-location-pin.component';
import { CardMarkerRailComponent } from './components/game-card-view/card-marker-rail/card-marker-rail.component';
import { BattleCounterComponent } from './components/game-card-view/battle-counter/battle-counter.component';
import { LoyaltyCounterComponent } from './components/game-card-view/loyalty-counter/loyalty-counter.component';
import { PowerToughnessDialogComponent, PowerToughnessDialogValueChange } from './components/power-toughness-dialog/power-toughness-dialog.component';
import { GameArrowLayerComponent } from './components/game-arrow-layer/game-arrow-layer.component';
import { ArrowTargetDialogComponent, ArrowTargetDialogValue } from './components/arrow-target-dialog/arrow-target-dialog.component';
import { GameRematchModalComponent, RematchPlayerVoteView } from './components/game-rematch-modal/game-rematch-modal.component';
import { GameDisconnectVoteModalComponent } from './components/game-disconnect-vote-modal/game-disconnect-vote-modal.component';
import { MulliganOverlayComponent } from './components/mulligan-overlay/mulligan-overlay.component';
import {
  GameplayCardSearchKind,
  GameplayCardSearchSelection,
  TokenSearchModalComponent,
} from './components/token-search-modal/token-search-modal.component';
import { ChatRecipientSelectComponent } from './components/chat-recipient-select/chat-recipient-select.component';
import { RollModalComponent } from '../../../core/ui/roll-modal/roll-modal.component';
import { type RollResult } from '../../../core/ui/roll-modal/roll';
import { GameTablePermanentRelationService } from './services/game-table-permanent-relation.service';
import { GameTableSpecialEntityActionsService } from './services/game-table-special-entity-actions.service';
import { ZonePointerDropRequest } from './models/game-table-zone-pointer-drag.model';
import { buildCardPreviewAttachmentInfo, buildCardPreviewCardStateInfo, resolveCardPreviewCard } from './utils/card-preview-attachment-info';
import { dungeonMarkerForCard } from './utils/dungeon-marker';
import { isDayNightCard, isDungeonCard, isEmblemCard, isGameplayCardTapLocked, isInitiativeCard, isMonarchCard, isTheRingCard } from './utils/gameplay-card-kind';
import { ManaAddition, ManaPoolColor, ManaSourceSuggestion } from './utils/mana-source-detector';
import { GameTablePlayerSpecialEntitiesSummary, GameTableSpecialEntitiesState } from './state/helpers/game-table-special-entities.state';
import { VentureCardKind } from './utils/venture-card-kind';

const MANA_POOL_TARGET_COLORS: readonly ManaPoolColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

type PendingManaPoolColorCounts = Readonly<Record<string, Readonly<Partial<Record<ManaPoolColor, number>>>>>;

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
type FloatingPanelTab = 'chat' | 'log';
const CHAT_REACTION_WINDOW_MS = 30 * 60 * 1000;

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

interface GameplayCardSearchRequest {
  readonly playerId: string;
  readonly kind: GameplayCardSearchKind;
}

interface PendingDungeonReplacementRequest {
  readonly playerId: string;
  readonly card: Card;
  readonly currentDungeonName: string;
}

interface PendingCitysBlessingRemovalRequest {
  readonly playerId: string;
  readonly source: 'context-menu' | 'pill';
}

const GAMEPLAY_CARD_SEARCH_BATTLEFIELD_POSITION: GameCardPosition = { x: 0, y: 0, unit: 'ratio' };
const DAY_NIGHT_FIXED_BATTLEFIELD_POSITION: GameCardPosition = { x: 1, y: 0, unit: 'ratio' };
const DAY_NIGHT_SEARCH_QUERY = 'Day // Night';
const MONARCH_SEARCH_QUERY = 'The Monarch';
const INITIATIVE_SEARCH_QUERY = 'Undercity // The Initiative';
const CITYS_BLESSING_SEARCH_QUERY = "City's Blessing";
const SPECIAL_MECHANIC_CARD_SEARCH_LIMIT = 16;
const THE_RING_FALLBACK_CARD: Card = {
  id: 'the-ring',
  scryfallId: '7215460e-8c06-47d0-94e5-d1832d0218af',
  name: 'The Ring // The Ring Tempts You',
  manaCost: null,
  typeLine: 'Emblem // Card',
  oracleText: 'Your Ring-bearer is legendary and can\'t be blocked by creatures with greater power.\nWhenever your Ring-bearer attacks, draw a card, then discard a card.\nWhenever your Ring-bearer becomes blocked by a creature, that creature\'s controller sacrifices it at end of combat.\nWhenever your Ring-bearer deals combat damage to a player, each opponent loses 3 life.\n//\nAs the Ring tempts you, you get an emblem named The Ring if you don\'t have one. Then your emblem gains its next ability and you choose a creature you control to become or remain your Ring-bearer.',
  colors: [],
  colorIdentity: [],
  legalities: {},
  imageUris: {
    small: 'https://cards.scryfall.io/small/front/7/2/7215460e-8c06-47d0-94e5-d1832d0218af.jpg?1742651318',
    normal: 'https://cards.scryfall.io/normal/front/7/2/7215460e-8c06-47d0-94e5-d1832d0218af.jpg?1742651318',
    large: 'https://cards.scryfall.io/large/front/7/2/7215460e-8c06-47d0-94e5-d1832d0218af.jpg?1742651318',
    png: 'https://cards.scryfall.io/png/front/7/2/7215460e-8c06-47d0-94e5-d1832d0218af.png?1742651318',
    art_crop: 'https://cards.scryfall.io/art_crop/front/7/2/7215460e-8c06-47d0-94e5-d1832d0218af.jpg?1742651318',
    border_crop: 'https://cards.scryfall.io/border_crop/front/7/2/7215460e-8c06-47d0-94e5-d1832d0218af.jpg?1742651318',
  },
  cardFaces: [
    {
      name: 'The Ring',
      manaCost: null,
      typeLine: 'Emblem',
      oracleText: 'Your Ring-bearer is legendary and can\'t be blocked by creatures with greater power.\nWhenever your Ring-bearer attacks, draw a card, then discard a card.\nWhenever your Ring-bearer becomes blocked by a creature, that creature\'s controller sacrifices it at end of combat.\nWhenever your Ring-bearer deals combat damage to a player, each opponent loses 3 life.',
      power: null,
      toughness: null,
      loyalty: null,
      colors: [],
      imageUris: {
        small: 'https://cards.scryfall.io/small/front/7/2/7215460e-8c06-47d0-94e5-d1832d0218af.jpg?1742651318',
        normal: 'https://cards.scryfall.io/normal/front/7/2/7215460e-8c06-47d0-94e5-d1832d0218af.jpg?1742651318',
        large: 'https://cards.scryfall.io/large/front/7/2/7215460e-8c06-47d0-94e5-d1832d0218af.jpg?1742651318',
        png: 'https://cards.scryfall.io/png/front/7/2/7215460e-8c06-47d0-94e5-d1832d0218af.png?1742651318',
        art_crop: 'https://cards.scryfall.io/art_crop/front/7/2/7215460e-8c06-47d0-94e5-d1832d0218af.jpg?1742651318',
        border_crop: 'https://cards.scryfall.io/border_crop/front/7/2/7215460e-8c06-47d0-94e5-d1832d0218af.jpg?1742651318',
      },
    },
    {
      name: 'The Ring Tempts You',
      manaCost: null,
      typeLine: 'Card',
      oracleText: 'As the Ring tempts you, you get an emblem named The Ring if you don\'t have one. Then your emblem gains its next ability and you choose a creature you control to become or remain your Ring-bearer.',
      power: null,
      toughness: null,
      loyalty: null,
      colors: [],
      imageUris: {
        small: 'https://cards.scryfall.io/small/back/7/2/7215460e-8c06-47d0-94e5-d1832d0218af.jpg?1742651318',
        normal: 'https://cards.scryfall.io/normal/back/7/2/7215460e-8c06-47d0-94e5-d1832d0218af.jpg?1742651318',
        large: 'https://cards.scryfall.io/large/back/7/2/7215460e-8c06-47d0-94e5-d1832d0218af.jpg?1742651318',
        png: 'https://cards.scryfall.io/png/back/7/2/7215460e-8c06-47d0-94e5-d1832d0218af.png?1742651318',
        art_crop: 'https://cards.scryfall.io/art_crop/back/7/2/7215460e-8c06-47d0-94e5-d1832d0218af.jpg?1742651318',
        border_crop: 'https://cards.scryfall.io/border_crop/back/7/2/7215460e-8c06-47d0-94e5-d1832d0218af.jpg?1742651318',
      },
    },
  ],
  layout: 'double_faced_token',
  commanderLegal: false,
  set: 'tltr',
  collectorNumber: 'H13',
};

interface PowerToughnessActionRequest {
  readonly menu: GameContextMenu;
  readonly power: string;
  readonly toughness: string;
}

interface ManaActionRequest {
  readonly menu: GameContextMenu;
  readonly suggestion: ManaSourceSuggestion;
  readonly selectedColor: ManaPoolColor | null;
  readonly amount: number;
  readonly position: { x: number; y: number } | null;
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

interface ContextMenuAvoidRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const CONTEXT_MENU_AVOID_WIDTH = 264;
const CONTEXT_MENU_AVOID_COMPACT_WIDTH = 172;
const CONTEXT_MENU_AVOID_HEIGHT = 360;

interface ViewportPoint {
  readonly x: number;
  readonly y: number;
}

interface BattlefieldCardDoubleClickEvent {
  readonly event: MouseEvent;
  readonly playerId: string;
  readonly card: GameCardInstance;
}

interface HandCardPointerMovedEvent {
  readonly playerId: string;
  readonly targetPlayerId: string;
  readonly movedInstanceId: string;
  readonly toZone: GameZoneName;
  readonly rawZone?: string;
  readonly position?: { x: number; y: number };
}

interface HandDroppedEvent {
  readonly event: DragEvent;
  readonly playerId: string;
}

interface HandCardPointerReorderedEvent {
  readonly playerId: string;
  readonly movedInstanceId: string;
  readonly targetInstanceId: string;
  readonly placement: 'before' | 'after';
}

interface ZoneDropEvent {
  readonly event: DragEvent;
  readonly playerId: string;
  readonly zone: GameZoneName;
}

interface ZonePointerDragStartedEvent {
  readonly playerId: string;
  readonly zone: GameZoneName;
  readonly card: GameCardInstance;
}

interface ZonePointerDroppedEvent {
  readonly request: ZonePointerDropRequest | null;
  readonly moved: boolean;
}

interface ManaLaneDropEvent {
  readonly event: DragEvent;
  readonly playerId: string;
}

interface PlayerDropEvent {
  readonly event: DragEvent;
  readonly playerId: string;
}

type DropZoneTarget = GameZoneName | 'mana';
type PendingCardMotionTarget =
  | { readonly kind: 'zone'; readonly zone: DropZoneTarget }
  | { readonly kind: 'player' };

interface ChatReactionOption {
  readonly type: ChatReactionType;
  readonly label: string;
  readonly emoji: string;
}

interface HandDragPayload {
  readonly playerId: string;
  readonly zone: GameZoneName;
  readonly instanceId: string;
  readonly instanceIds?: readonly string[];
}

interface HandGhostOptions {
  readonly sourceElement?: HTMLElement | null;
  readonly sourceInstanceId?: string | null;
  readonly sourceRect?: MotionSourceRect | null;
  readonly targetPlayerId?: string | null;
}

interface PlayerGhostOptions {
  readonly sourceElement?: HTMLElement | null;
  readonly sourceInstanceId?: string | null;
  readonly sourceRect?: MotionSourceRect | null;
  readonly targetPlayerId: string;
}

interface ZoneGhostOptions {
  readonly sourceElement?: HTMLElement | null;
  readonly sourceInstanceId?: string | null;
  readonly sourceRect?: MotionSourceRect | null;
  readonly targetPlayerId: string;
  readonly targetZone: DropZoneTarget;
  readonly battlefieldPosition?: { readonly x: number; readonly y: number };
  readonly dropEvent?: DragEvent;
}

interface PendingCardMotion {
  readonly sourceInstanceId: string;
  readonly sourceRect?: MotionSourceRect | null;
  readonly targetPlayerId: string;
  readonly target: PendingCardMotionTarget;
}

interface MotionSourceRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

@Component({
  selector: 'app-game-table',
  imports: [
    RuntimeTranslatePipe,
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
    BattlefieldZoomControlsComponent,
    ContextMenuComponent,
    ZoneModalComponent,
    NumberActionDialogComponent,
    ManaActionDialogComponent,
    ManaCometLayerComponent,
    GameTableHeaderComponent,
    GameAdBannerComponent,
    CardPreviewOverlayComponent,
    DungeonLocationPinComponent,
    CardMarkerRailComponent,
    BattleCounterComponent,
    LoyaltyCounterComponent,
    PowerToughnessDialogComponent,
    GameArrowLayerComponent,
    ArrowTargetDialogComponent,
    GameRematchModalComponent,
    GameDisconnectVoteModalComponent,
    MulliganOverlayComponent,
    TokenSearchModalComponent,
    ChatRecipientSelectComponent,
    RollModalComponent,
  ],
  providers: [
    GameTableStore,
    GameTableCoreState,
    GameTableCommandStore,
    GameTablePendingTransferRegistrarState,
    GameTableArrowsState,
    GameTableAttachmentsState,
    GameTableOpponentTargetsState,
    GameTableBattlefieldState,
    GameTableBattlefieldZoomState,
    GameTableCardsState,
    GameTableContextStore,
    GameTableCountersState,
    GameTableChatStore,
    GameTableDragDropStore,
    GameTableGameActionsStore,
    GameTableHandState,
    GameTableLibraryTopState,
    GameTableMulliganState,
    GameTablePlayersStore,
    GameTableSnapshotCoordinatorState,
    GameTableToastState,
    GameTableZonePilesState,
    GameTableManaPoolState,
    GameTableCardActionsService,
    GameTableCardStatsService,
    GameTableDebouncedValueCommandsService,
    GameTableBattlefieldDragCoordinatorService,
    GameTableGameRealtimeService,
    GameTableDisconnectVoteService,
    GameTableWebsocketGameplayService,
    GameTableWebsocketTransportService,
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
    GameTableZonePointerMoveActionsService,
    GameTableMotionService,
    GameTableChatReadStateService,
    GameTableNotificationSoundService,
    GameTableManaCometService,
    GameTableRealtimeAnimationBusService,
    GameTablePermanentRelationService,
    GameTableSpecialEntityActionsService,
    GameTableSnapshotSelectors,
    GameTableUiState,
    GameTableBattlefieldDragState,
    GameTableDropFeedbackState,
    GameTablePendingTransferState,
    GameTableZoneModalState,
    GameTableChatLogState,
    GameTableSpecialEntitiesState,
  ],
  templateUrl: './game-table.component.html',
  styleUrls: ['./game-table.component.scss', './game-table-chat-panel.scss', './game-table-responsive.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameTableComponent implements AfterViewInit, AfterViewChecked, OnDestroy {
  private readonly mobileScrollLockQuery = '(max-width: 1180px), (hover: none) and (pointer: coarse)';
  private readonly aggressiveCompactQuery = '(max-width: 1180px) and (max-height: 768px)';
  readonly store = inject(GameTableStore);
  readonly disconnectVote = inject(GameTableDisconnectVoteService);
  readonly specialEntityState = inject(GameTableSpecialEntitiesState);
  private readonly cardsApi = inject(CardsApi);
  private readonly gamesApi = inject(GamesApi);
  private readonly router = inject(Router);
  private readonly motion = inject(GameTableMotionService);
  private readonly chatReadState = inject(GameTableChatReadStateService);
  readonly manaComets = inject(GameTableManaCometService);
  private readonly notificationSound = inject(GameTableNotificationSoundService);
  private readonly realtimeAnimations = inject(GameTableRealtimeAnimationBusService);
  private readonly bodyScrollLock = inject(BodyScrollLockService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  readonly battlefieldZoom = inject(GameTableBattlefieldZoomState);
  readonly aggressiveCompactViewport = signal(false);
  readonly effectiveBattlefieldZoomPercent = computed(() => (
    this.aggressiveCompactViewport()
      ? MIN_BATTLEFIELD_ZOOM_PERCENT
      : this.battlefieldZoom.zoomPercent()
  ));
  readonly effectiveBattlefieldCardWidthRem = computed(() => this.battlefieldZoom.cardWidthRemFor(this.effectiveBattlefieldZoomPercent()));
  readonly effectiveBattlefieldGapRem = computed(() => this.battlefieldZoom.gapRemFor(this.effectiveBattlefieldZoomPercent()));
  readonly effectiveBattlefieldManaLaneHeightRem = computed(() => this.battlefieldZoom.manaLaneMinHeightRemFor(this.effectiveBattlefieldZoomPercent()));
  readonly handMotionActive = this.motion.handMotionActive;
  readonly counterPresets = ['-1/-1', '+1/+1', 'red', 'green', 'blue', 'black', 'yellow'];
  readonly colorAccent = (player: PlayerView | null): string => this.store.colorAccent(player);
  readonly topDraggableCard = (player: PlayerView, zone: GameZoneName): GameCardInstance | null => this.store.topDraggableCard(player, zone);
  readonly zoneCount = (player: PlayerView, zone: GameZoneName): number => this.store.zoneCount(player, zone);
  readonly zoneCardCountById = (playerId: string, zone: GameZoneName): number => this.store.zoneCardCountById(playerId, zone);
  readonly logTime = (createdAt: string): string => this.store.logTime(createdAt);
  readonly isDropZoneHighlighted = (playerId: string, zone: GameZoneName): boolean => this.store.isDropZoneHighlighted(playerId, zone);
  readonly zoneTitle = (zone: GameZoneName): string => this.store.zoneTitle(zone);
  readonly zonePreviewCard = (player: PlayerView, zone: GameZoneName): GameCardInstance | null => this.store.zonePreviewCard(player, zone);
  readonly zonePreviewImage = (player: PlayerView, zone: GameZoneName): string | null => this.store.zonePreviewImage(player, zone);
  readonly zoneStackLayerImage = (player: PlayerView, zone: GameZoneName): string | null => this.store.zoneStackLayerImage(player, zone);
  readonly commandZoneCards = (player: PlayerView): readonly GameCardInstance[] => this.store.commandZoneCards(player);
  readonly commanderCards = (player: PlayerView): readonly GameCardInstance[] => this.store.commanderCards(player);
  readonly commanderCastCount = (player: PlayerView, commander: GameCardInstance): number => this.store.commanderCastCount(player, commander);
  readonly playerCounterValue = (player: PlayerView, key: string): number => this.store.playerCounterValue(player.id, key);
  readonly deckLabel = (player: PlayerView | null): string => this.store.deckLabel(player);
  readonly gameBackgroundImage = (player: PlayerView | null): string => this.store.gameBackgroundImage(player);
  readonly manaSymbols = (player: PlayerView | null): string[] => this.store.manaSymbols(player);
  readonly pendingManaPoolColorsFor = (playerId: string): readonly ManaPoolColor[] => {
    const counts = this.pendingManaPoolColorCounts()[playerId] ?? {};

    return MANA_POOL_TARGET_COLORS.filter((color) => (counts[color] ?? 0) > 0);
  };
  readonly cardPosition = (card: GameCardInstance): { x: number; y: number } | null => this.store.cardPosition(card);
  readonly battlefieldMechanicCardsForPlayer = (playerId: string): readonly GameCardInstance[] =>
    [
      ...this.specialEntityState.battlefieldMechanicCardsForPlayer(playerId),
      ...this.battlefieldEmblemsForPlayer(playerId),
    ];
  readonly cardImage = (card: GameCardInstance): string | null => this.store.cardImage(card);
  readonly dungeonMarkerForCard = dungeonMarkerForCard;
  readonly dungeonPinSizeForWidth = (width: number): string => `${Math.round(Math.max(28, Math.min(58, width * 0.25)))}px`;
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
  readonly moveZones: GameZoneName[] = ['battlefield', 'graveyard', 'exile', 'hand', 'command', 'library'];
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
  private readonly tapAnimationLockedCardIds = signal<ReadonlySet<string>>(new Set<string>());
  private readonly pendingManaPoolColorCounts = signal<PendingManaPoolColorCounts>({});
  readonly canDragBattlefieldCard = (playerId: string, card: GameCardInstance): boolean =>
    !isDayNightCard(card)
    && !isMonarchCard(card)
    && !isInitiativeCard(card)
    && this.store.canDragBattlefieldCard(playerId, card)
    && !this.tapAnimationLockedCardIds().has(card.instanceId);
  readonly isPendingBattlefieldTransfer = (card: GameCardInstance): boolean => this.store.isPendingBattlefieldTransfer(card);
  readonly shouldShowPowerToughness = (card: GameCardInstance): boolean => this.store.shouldShowPowerToughness(card);
  readonly isLandStacked = (playerId: string, card: GameCardInstance): boolean => this.store.isLandStacked(playerId, card);
  readonly isAttachedEquipment = (playerId: string, card: GameCardInstance): boolean => this.store.isAttachedEquipment(playerId, card);
  readonly isAttachmentTarget = (playerId: string, card: GameCardInstance): boolean => this.store.isAttachmentTarget(playerId, card);
  readonly canAttachEquipment = (playerId: string, card: GameCardInstance): boolean => this.store.canAttachEquipment(playerId, card);
  readonly cardPowerValue = (card: GameCardInstance): GamePowerToughnessValue => this.store.cardPowerValue(card);
  readonly cardToughnessValue = (card: GameCardInstance): GamePowerToughnessValue => this.store.cardToughnessValue(card);
  readonly cardBattleValue = (card: GameCardInstance): GameCardStatValue => this.store.cardBattleValue(card);
  readonly cardLoyaltyValue = (card: GameCardInstance): GameCardStatValue => this.store.cardLoyaltyValue(card);
  readonly firstCounter = (card: GameCardInstance): { key: string; value: number } | null => this.store.firstCounter(card);
  readonly cardCounters = (card: GameCardInstance): readonly { key: string; value: number }[] =>
    Object.entries(card.counters ?? {})
      .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) >= 0)
      .map(([key, value]) => ({ key, value: Number(value) }));
  readonly alignmentGuideFor = (playerId: string): { y: number; referenceInstanceIds: readonly string[] } | null =>
    this.store.alignmentGuideFor(playerId);
  readonly isManaLaneHighlighted = (playerId: string): boolean => this.store.isManaLaneHighlighted(playerId);
  readonly manaSourceSuggestion = (playerId: string, card: GameCardInstance): ManaSourceSuggestion =>
    this.store.manaSourceSuggestion(playerId, card);
  readonly canControlPlayer = (playerId: string): boolean => this.store.canControlPlayer(playerId);
  readonly numberActionDialog = signal<NumberActionRequest | null>(null);
  readonly powerToughnessDialog = signal<PowerToughnessActionRequest | null>(null);
  readonly manaActionDialog = signal<ManaActionRequest | null>(null);
  readonly arrowTargetDialog = signal<ArrowTargetDialogRequest | null>(null);
  readonly libraryMoveRandomOrder = signal(false);
  readonly zoneMoveAllLibraryDialog = signal<ZoneMoveAllLibraryRequest | null>(null);
  readonly zoneMoveAllLibraryRandomOrder = signal(false);
  readonly handCardGiveDialog = signal<HandCardGiveRequest | null>(null);
  readonly libraryCardMoveToHandDialog = signal<LibraryCardMoveToHandRequest | null>(null);
  private readonly pendingCardMotion = signal<PendingCardMotion | null>(null);
  readonly followActiveTurnPlayer = signal(false);
  readonly rematchModalOpen = signal(false);
  readonly rematchPending = signal(false);
  readonly rematchToast = signal<string | null>(null);
  readonly rematchCountdownSeconds = signal<number | null>(null);
  readonly rematchCountdownMode = signal<RematchCountdownMode | null>(null);
  readonly tableExitAction = signal<TableExitAction | null>(null);
  readonly gameplayCardSearchRequest = signal<GameplayCardSearchRequest | null>(null);
  readonly gameplayCardSearchPending = signal(false);
  readonly pendingDungeonReplacement = signal<PendingDungeonReplacementRequest | null>(null);
  readonly dungeonReplacementPending = signal(false);
  readonly pendingCitysBlessingRemoval = signal<PendingCitysBlessingRemovalRequest | null>(null);
  readonly activeDayNight = computed(() => this.specialEntityState.dayNight() !== null);
  readonly monarchOwnerPlayerId = computed(() => this.specialEntityState.globalEntity('monarch')?.ownerPlayerId ?? null);
  readonly initiativeOwnerPlayerId = computed(() => this.specialEntityState.globalEntity('initiative')?.ownerPlayerId ?? null);
  readonly playerHasCitysBlessing = (playerId: string): boolean =>
    this.specialEntityState.playerEntity(playerId, 'citys_blessing') !== null;
  readonly playerHasTheRing = (playerId: string): boolean =>
    this.store.players()
      .find((player) => player.id === playerId)
      ?.state.zones.battlefield.some((card) => isTheRingCard(card)) ?? false;
  readonly rollModalOpen = signal(false);
  readonly tableExitTitle = computed(() => this.tableExitAction() === 'leave' ? 'Leave table?' : 'Concede game?');
  readonly tableExitMessage = computed(() => this.tableExitAction() === 'leave'
    ? 'You will concede this game and leave the room. This cannot be undone.'
    : 'You will lose this game immediately. This cannot be undone.');
  readonly tableExitPrimaryLabel = computed(() => this.tableExitAction() === 'leave' ? 'Leave table' : 'Concede');
  private readonly leavingTable = signal(false);
  private readonly tableExitPending = computed(() => this.tableExitAction() !== null || this.leavingTable());
  readonly manualRelationTargetingActive = computed(() =>
    this.store.pendingArrowSource() !== null || this.store.pendingAttachmentSource() !== null,
  );
  readonly focusEffectsEnabled = computed(() => this.arrowTargetDialog() === null && !this.manualRelationTargetingActive());
  readonly battlefieldLayoutSize = signal<BattlefieldLayoutRect>({ width: 900, height: 520, left: 0, top: 0, right: 900, bottom: 520 });
  readonly contextMenuAvoidRect = computed<ContextMenuAvoidRect | null>(() => {
    const menu = this.store.contextMenu();
    const viewportHeight = window.innerHeight || 0;
    if (!menu || viewportHeight <= 0) {
      return null;
    }

    const width = menu.kind === 'counter' || menu.kind === 'arrow' ? CONTEXT_MENU_AVOID_COMPACT_WIDTH : CONTEXT_MENU_AVOID_WIDTH;
    const top = menu.verticalOrigin === 'bottom' ? viewportHeight - menu.y - CONTEXT_MENU_AVOID_HEIGHT : menu.y;

    return {
      left: menu.x,
      top,
      right: menu.x + width,
      bottom: top + CONTEXT_MENU_AVOID_HEIGHT,
    };
  });
  readonly closeGameDialogOpen = signal(false);
  readonly isPowerToughnessDialogInvalid = computed(() => {
    const request = this.powerToughnessDialog();

    return !request || !Number.isFinite(Number(request.power)) || !Number.isFinite(Number(request.toughness));
  });
  readonly latestLogEntry = computed(() => this.store.eventLog().at(-1) ?? null);
  readonly latestChatMessage = computed(() => this.store.snapshot()?.chat.at(-1) ?? null);
  readonly hoveredPreviewAttachmentInfo = computed(() => {
    const preview = this.store.hoveredPreview();
    const snapshot = this.store.snapshot();

    return preview ? buildCardPreviewAttachmentInfo(snapshot, resolveCardPreviewCard(snapshot, preview)) : null;
  });
  readonly hoveredPreviewCardStateInfo = computed(() => {
    const preview = this.store.hoveredPreview();
    const snapshot = this.store.snapshot();

    return preview ? buildCardPreviewCardStateInfo(resolveCardPreviewCard(snapshot, preview)) : null;
  });

  private battlefieldEmblemsForPlayer(playerId: string): readonly GameCardInstance[] {
    const player = this.store.players().find((candidate) => candidate.id === playerId);

    return player?.state.zones.battlefield.filter((card) => isEmblemCard(card)) ?? [];
  }
  readonly hoveredPreviewDungeonMarkerOverride = computed<GameCardDungeonMarker | null>(() => {
    const preview = this.store.hoveredPreview();
    const override = this.store.dungeonMarkerPreviewOverride();

    return preview !== null && override?.instanceId === preview.card.instanceId ? override.marker : null;
  });
  readonly unreadChat = signal(false);
  readonly unreadLog = signal(false);
  readonly highlightedChatMessageKeys = signal<readonly string[]>([]);
  readonly fadingChatMessageKeys = signal<readonly string[]>([]);
  readonly highlightedLogEntryIds = signal<readonly string[]>([]);
  readonly fadingLogEntryIds = signal<readonly string[]>([]);
  readonly chatReactionClockMs = signal(Date.now());
  readonly chatReactionOptions: readonly ChatReactionOption[] = [
    { type: 'like', label: 'game.reactions.like', emoji: '👍' },
    { type: 'dislike', label: 'game.reactions.dislike', emoji: '👎' },
    { type: 'love', label: 'game.reactions.love', emoji: '❤️' },
    { type: 'laugh', label: 'game.reactions.laugh', emoji: '😂' },
    { type: 'angry', label: 'game.reactions.angry', emoji: '🤬' },
    { type: 'vomit', label: 'game.reactions.vomit', emoji: '🤮' },
    { type: 'cry', label: 'game.reactions.cry', emoji: '😭' },
  ];
  readonly tableToast = computed(() => this.store.tableToast() ?? this.rematchToast());
  readonly tableBackgroundImage = computed(() => `url("${this.store.gameBackgroundImage(this.store.focusedPlayer() ?? this.store.currentPlayer())}")`);
  readonly focusedOpponentPlayer = computed<PlayerView | null>(() => {
    const currentPlayer = this.store.currentPlayer();
    const focusedPlayer = this.store.focusedPlayer();

    return currentPlayer && focusedPlayer && currentPlayer.id !== focusedPlayer.id ? focusedPlayer : null;
  });
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
  readonly opponentSidebarPlayers = computed(() => {
    const focusedPlayerId = this.store.focusedPlayer()?.id ?? null;
    const opponents = this.store.players().filter((player) => player.id !== focusedPlayerId);

    return this.sortOpponentSidebarPlayers(opponents);
  });
  readonly playerSpecialEntitiesSummary = (playerId: string): GameTablePlayerSpecialEntitiesSummary =>
    this.specialEntityState.summaryForPlayer(playerId);
  readonly playerSpecialEntities = (playerId: string): readonly GameSpecialEntity[] =>
    this.specialEntityState.displayEntitiesForPlayer(playerId);
  readonly opponentsDrawerOpen = signal(false);
  readonly arrowTargetPlayers = computed(() => {
    const currentPlayerId = this.store.currentPlayer()?.id;
    const players = this.store.players().filter((player) => playerIsActiveForTurn(player));
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
  private battlefieldZoomReflowFrame: number | null = null;
  private destroyed = false;
  private rematchToastTimer: number | null = null;
  private rematchCountdownTimer: number | null = null;
  private rematchCountdownDeadlineMs: number | null = null;
  private chatReactionClockTimer: number | null = null;
  private rematchCountdownKey = '';
  private rematchAutoLeaveKey = '';
  private lastAutoRematchPromptKey = '';
  private lastFocusedTurnPlayerId: string | null = null;
  private lastObservedChatKey: string | null = null;
  private lastObservedLogKey: string | null = null;
  private lastObservedLogEntryId: string | null = null;
  private lastUnreadChatNotificationKey: string | null = null;
  private readonly chatHighlightTimers = new Map<string, number>();
  private readonly logHighlightTimers = new Map<string, number>();
  private readonly battlefieldDragStartRects = new Map<string, MotionSourceRect>();
  private readonly realtimeAnimationSubscriptions = new Subscription();
  private mobileScrollLockMediaQuery: MediaQueryList | null = null;
  private aggressiveCompactMediaQuery: MediaQueryList | null = null;
  private mobileScrollLocked = false;
  private readonly handleMobileScrollLockChange = (): void => this.syncMobileScrollLock();
  private readonly handleAggressiveCompactChange = (): void => this.syncAggressiveCompactViewport();

  @ViewChild('gameScreen', { static: true }) private readonly gameScreen?: ElementRef<HTMLElement>;
  @ViewChild(GameLogPanelComponent) private readonly gameLogPanel?: GameLogPanelComponent;
  @ViewChildren('autoScrollFeed') private readonly autoScrollFeeds?: QueryList<ElementRef<HTMLElement>>;

  constructor() {
    this.realtimeAnimationSubscriptions.add(
      this.realtimeAnimations.patchAnimation$.subscribe((event) => this.handleRealtimePatchAnimation(event)),
    );

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

    effect(() => {
      const snapshot = this.store.snapshot();
      const activeTab = this.store.activeFloatingTab();
      const latestChat = snapshot?.chat.at(-1);
      const eventLog = this.store.eventLog();
      const latestLog = eventLog.at(-1);
      const unreadKey = [
        activeTab,
        snapshot?.chat.length ?? 0,
        latestChat?.createdAt ?? '',
        latestChat?.userId ?? '',
        latestChat?.message ?? '',
        eventLog.length,
        latestLog?.id ?? '',
      ].join(':');

      queueMicrotask(() => {
        if (this.store.activeFloatingTab() === activeTab && unreadKey) {
          this.syncFloatingUnreadState();
        }
      });
    });
  }

  ngAfterViewInit(): void {
    if (this.gameScreen) {
      this.motion.init(this.gameScreen);
    }
    this.notificationSound.startUserGestureUnlock();
    this.startChatReactionClock();
    this.setupMobileScrollLock();
    this.setupAggressiveCompactViewport();
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
    this.destroyed = true;
    this.realtimeAnimationSubscriptions.unsubscribe();
    this.destroyMobileScrollLock();
    this.destroyAggressiveCompactViewport();
    this.motion.destroy();
    this.clearQueuedFloatingContentScroll();
    this.clearQueuedBattlefieldReflow();
    this.clearQueuedBattlefieldZoomReflow();
    this.clearRematchToastTimer();
    this.clearRematchCountdown();
    this.clearChatReactionClock();
    this.clearMessageHighlightTimers();
  }

  private startChatReactionClock(): void {
    this.clearChatReactionClock();
    this.chatReactionClockTimer = window.setInterval(() => this.chatReactionClockMs.set(Date.now()), 30_000);
  }

  private clearChatReactionClock(): void {
    if (this.chatReactionClockTimer === null) {
      return;
    }

    window.clearInterval(this.chatReactionClockTimer);
    this.chatReactionClockTimer = null;
  }

  private setupMobileScrollLock(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    this.mobileScrollLockMediaQuery = window.matchMedia(this.mobileScrollLockQuery);
    this.mobileScrollLockMediaQuery.addEventListener('change', this.handleMobileScrollLockChange);
    this.syncMobileScrollLock();
  }

  private syncMobileScrollLock(): void {
    const shouldLock = this.mobileScrollLockMediaQuery?.matches === true;
    if (shouldLock === this.mobileScrollLocked) {
      return;
    }

    this.mobileScrollLocked = shouldLock;
    if (shouldLock) {
      this.bodyScrollLock.lock();
    } else {
      this.bodyScrollLock.unlock();
    }
  }

  private destroyMobileScrollLock(): void {
    this.mobileScrollLockMediaQuery?.removeEventListener('change', this.handleMobileScrollLockChange);
    this.mobileScrollLockMediaQuery = null;
    if (!this.mobileScrollLocked) {
      return;
    }

    this.mobileScrollLocked = false;
    this.bodyScrollLock.unlock();
  }

  private setupAggressiveCompactViewport(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    this.aggressiveCompactMediaQuery = window.matchMedia(this.aggressiveCompactQuery);
    this.aggressiveCompactMediaQuery.addEventListener('change', this.handleAggressiveCompactChange);
    this.syncAggressiveCompactViewport();
  }

  private syncAggressiveCompactViewport(): void {
    const isAggressiveCompact = this.aggressiveCompactMediaQuery?.matches === true;
    if (isAggressiveCompact === this.aggressiveCompactViewport()) {
      return;
    }

    this.aggressiveCompactViewport.set(isAggressiveCompact);
    this.queueBattlefieldZoomReflow();
  }

  private destroyAggressiveCompactViewport(): void {
    this.aggressiveCompactMediaQuery?.removeEventListener('change', this.handleAggressiveCompactChange);
    this.aggressiveCompactMediaQuery = null;
  }

  scrollFloatingContentToBottom(): void {
    this.gameLogPanel?.scrollToBottom();
    for (const feed of this.autoScrollFeeds?.toArray() ?? []) {
      feed.nativeElement.scrollTop = feed.nativeElement.scrollHeight;
    }
  }

  handleTableClick(event: MouseEvent): void {
    this.store.handleTableClick(event);

    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.player-sidebar')) {
      this.closeOpponentsDrawer();
    }
  }

  toggleOpponentsDrawer(event: MouseEvent): void {
    event.stopPropagation();
    this.opponentsDrawerOpen.update((open) => !open);
  }

  closeOpponentsDrawer(): void {
    if (this.opponentsDrawerOpen()) {
      this.opponentsDrawerOpen.set(false);
    }
  }

  openFloatingTab(tab: FloatingPanelTab): void {
    this.store.activeFloatingTab.set(tab);
    this.markFloatingTabRead(tab);
    queueMicrotask(() => this.queueFloatingContentScrollToBottom());
  }

  chatMessageKey(message: ChatMessage, index: number): string {
    return this.chatReadState.messageKey(message, index);
  }

  isChatMessageHighlighted(message: ChatMessage, index: number): boolean {
    return this.highlightedChatMessageKeys().includes(this.chatMessageKey(message, index));
  }

  isChatMessageEvaporating(message: ChatMessage, index: number): boolean {
    return this.fadingChatMessageKeys().includes(this.chatMessageKey(message, index));
  }

  chatAuthorColor(userId: string): string {
    const palette = ['#f97316', '#22c55e', '#38bdf8', '#f472b6', '#a78bfa', '#facc15', '#fb7185', '#2dd4bf'];
    let hash = 0;
    for (const character of userId) {
      hash = (hash * 31 + character.charCodeAt(0)) % palette.length;
    }

    return palette[hash];
  }

  isOwnChatMessage(message: ChatMessage): boolean {
    const currentPlayer = this.store.currentPlayer();
    const currentUserId = currentPlayer?.state.user.id ?? currentPlayer?.id ?? null;

    return currentUserId !== null && message.userId === currentUserId;
  }

  chatReactionCount(message: ChatMessage, reaction: ChatReactionType): number {
    return message.reactions?.[reaction]?.length ?? 0;
  }

  chatReactionUsers(message: ChatMessage, reaction: ChatReactionType): string {
    return message.reactions?.[reaction]?.map((entry) => entry.displayName).join(', ') ?? '';
  }

  canReactToChatMessage(message: ChatMessage): boolean {
    return this.isChatMessageReactable(message, this.chatReactionClockMs());
  }

  private isChatMessageReactable(message: ChatMessage, nowMs: number): boolean {
    if (!message.id || this.isOwnChatMessage(message)) {
      return false;
    }

    const createdAtMs = Date.parse(message.createdAt);
    return Number.isFinite(createdAtMs) && nowMs - createdAtMs <= CHAT_REACTION_WINDOW_MS;
  }

  hasOwnChatReaction(message: ChatMessage, reaction: ChatReactionType): boolean {
    const currentPlayer = this.store.currentPlayer();
    const currentUserId = currentPlayer?.state.user.id ?? currentPlayer?.id ?? null;

    return currentUserId
      ? message.reactions?.[reaction]?.some((entry) => entry.userId === currentUserId) === true
      : false;
  }

  hasAnyChatReaction(message: ChatMessage): boolean {
    return this.chatReactionOptions.some((reaction) => this.chatReactionCount(message, reaction.type) > 0);
  }

  shouldShowChatReactionUsers(message: ChatMessage, reaction: ChatReactionType): boolean {
    return this.chatReactionCount(message, reaction) > 0;
  }

  toggleChatReaction(event: MouseEvent, message: ChatMessage, reaction: ChatReactionType): void {
    event.stopPropagation();
    if (!this.isChatMessageReactable(message, Date.now())) {
      return;
    }

    void this.store.toggleChatReaction(message.id, reaction);
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
    this.queueBattlefieldReflow();
  }

  setBattlefieldZoom(percent: number): void {
    this.battlefieldZoom.setZoomPercent(percent);
    this.queueBattlefieldZoomReflow();
  }

  resetBattlefieldZoom(): void {
    this.battlefieldZoom.resetZoom();
    this.queueBattlefieldZoomReflow();
  }

  requestUnsupportedViewportLeave(event: MouseEvent): void {
    event.stopPropagation();
    this.requestTableExit('leave');
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
          void this.drawToHand(current.id);
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
          void this.toggleSelectedCardTapped(selected);
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

  startBattlefieldPointerDrag(event: PointerEvent, playerId: string, card: GameCardInstance): void {
    const source = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (source) {
      this.battlefieldDragStartRects.set(card.instanceId, this.motionRect(source.getBoundingClientRect()));
    }

    this.store.startBattlefieldPointerDrag(event, playerId, card);
  }

  @HostListener('window:pointerup', ['$event'])
  handlePointerUp(event: PointerEvent): void {
    this.store.endFloatingDrag();

    if (!this.store.hasActivePointerDrag()) {
      return;
    }

    if (this.store.pointerDragPreview()) {
      const handDropTargetPlayerId = this.pointerHandDropTargetPlayerId(event);
      const draggingInstanceId = this.store.draggingCardInstanceId();
      if (handDropTargetPlayerId) {
        const draggedCards = this.battlefieldDragCardsForMotion(draggingInstanceId);
        const allDraggedCardsEvaporate = draggedCards.length > 0
          && draggedCards.every((card) => this.cardEvaporatesOutsideBattlefield(card, 'hand'));
        const sourceRect = draggingInstanceId ? this.battlefieldDragStartRects.get(draggingInstanceId) ?? null : null;
        this.animateGhostToHand({
          sourceElement: this.dragPreviewElement(),
          sourceInstanceId: draggingInstanceId,
          sourceRect,
          targetPlayerId: handDropTargetPlayerId,
        });
        this.clearBattlefieldDragStartRect(draggingInstanceId);
        if (allDraggedCardsEvaporate) {
          void this.store.endCardPointerDrag(event);
          return;
        }

        void this.animateHandLayoutAfterAction(() => this.store.endCardPointerDrag(event));
        return;
      }

      const zoneDropTarget = this.pointerZonePileDropTarget(event);
      if (zoneDropTarget) {
        this.animateGhostToDropZone({
          sourceElement: this.dragPreviewElement(),
          sourceInstanceId: draggingInstanceId,
          sourceRect: draggingInstanceId ? this.battlefieldDragStartRects.get(draggingInstanceId) ?? null : null,
          targetPlayerId: zoneDropTarget.playerId,
          targetZone: zoneDropTarget.zone,
        });
      }

      this.clearBattlefieldDragStartRect(draggingInstanceId);
      void this.store.endCardPointerDrag(event);
      return;
    }

    void this.store.endCardPointerDrag(event);
  }

  @HostListener('window:pointercancel', ['$event'])
  handlePointerCancel(event: PointerEvent): void {
    this.store.endFloatingDrag();
    this.clearBattlefieldDragStartRect(this.store.draggingCardInstanceId());
    void this.store.cancelCardPointerDrag(event);
  }

  isLibraryMenu(menu: GameContextMenu): boolean {
    return menu.zone === 'library' && !menu.card;
  }

  isHandContextMenuOpenForPlayer(playerId: string): boolean {
    const menu = this.store.contextMenu();

    return menu?.playerId === playerId && menu.zone === 'hand';
  }

  private async drawToHand(playerId: string, count = 1): Promise<void> {
    await this.animateHandLayoutAfterAction(() => this.store.draw(playerId, count));
  }

  private async moveTopFromLibrary(request: MoveTopNumberActionRequest, count: number): Promise<void> {
    const movesToHand = request.toZone === 'hand';

    const action = () => this.store.moveTop(request.playerId, request.toZone, count, {
      targetPlayerId: request.targetPlayerId,
      position: request.position,
    });

    if (!movesToHand) {
      await action();
      return;
    }

    await this.animateHandLayoutAfterAction(action);
  }

  private async moveCardFromMenu(menu: GameContextMenu, toZone: GameZoneName, options: { position?: 'top' | 'bottom' } = {}): Promise<void> {
    const modalMotion = this.menuCardMotion(menu, menu.playerId, { kind: 'zone', zone: toZone }, { fromFixedZoneModalOnly: true });
    if (toZone === 'library' && !options.position) {
      this.pendingCardMotion.set(modalMotion);
      await this.store.moveCard(menu, toZone, options);
      if (!this.store.pendingLibraryMove()) {
        this.pendingCardMotion.set(null);
      }
      return;
    }

    if (toZone !== 'hand' || menu.zone === 'hand' || !menu.card || this.cardEvaporatesOutsideBattlefield(menu.card, toZone)) {
      this.animateCardMotion(modalMotion);
      await this.store.moveCard(menu, toZone, options);
      return;
    }

    this.animateGhostToHand({
      sourceInstanceId: menu.card.instanceId,
      sourceRect: menu.sourceRect,
      targetPlayerId: menu.playerId,
    });
    await this.animateHandLayoutAfterAction(() => this.store.moveCard(menu, toZone, options));
  }

  private async giveCardFromMenu(
    menu: GameContextMenu,
    targetPlayerId: string,
    destination: 'battlefield' | 'hand',
  ): Promise<void> {
    if (destination === 'hand' && menu.zone === 'hand') {
      this.openHandCardGiveDialog(menu, targetPlayerId);
      return;
    }

    const giveMotion = this.menuCardMotion(menu, targetPlayerId, { kind: 'player' });
    if (destination === 'battlefield') {
      this.pendingCardMotion.set(giveMotion);
      await this.store.giveCardToPlayer(menu, targetPlayerId, destination);
      if (!this.store.pendingBattlefieldMove()) {
        this.pendingCardMotion.set(null);
      }
      return;
    }

    this.animateCardMotion(giveMotion);
    await this.store.giveCardToPlayer(menu, targetPlayerId, destination);
  }

  private menuCardMotion(
    menu: GameContextMenu,
    targetPlayerId: string,
    target: PendingCardMotionTarget,
    options: { fromFixedZoneModalOnly?: boolean } = {},
  ): PendingCardMotion | null {
    if (!menu.card || options.fromFixedZoneModalOnly && !menu.fromFixedZoneModal) {
      return null;
    }

    return {
      sourceInstanceId: menu.card.instanceId,
      sourceRect: menu.sourceRect ?? null,
      targetPlayerId,
      target,
    };
  }

  private animateCardMotion(motion: PendingCardMotion | null): void {
    if (!motion) {
      return;
    }

    if (motion.target.kind === 'player') {
      this.animateGhostToPlayer({
        sourceInstanceId: motion.sourceInstanceId,
        sourceRect: motion.sourceRect,
        targetPlayerId: motion.targetPlayerId,
      });
      return;
    }

    if (motion.target.zone === 'hand') {
      this.animateGhostToHand({
        sourceInstanceId: motion.sourceInstanceId,
        sourceRect: motion.sourceRect,
        targetPlayerId: motion.targetPlayerId,
      });
      return;
    }

    this.animateGhostToDropZone({
      sourceInstanceId: motion.sourceInstanceId,
      sourceRect: motion.sourceRect,
      targetPlayerId: motion.targetPlayerId,
      targetZone: motion.target.zone,
    });
  }

  private handleRealtimePatchAnimation(event: GameTableRealtimePatchAnimationEvent): void {
    const rotationAnimations = this.realtimePatchRotationAnimationsFor(event);

    if (!event.isLocalPatch) {
      this.playRealtimeMoveGhosts(event);
    }

    if (rotationAnimations.length > 0 || !event.isLocalPatch) {
      window.requestAnimationFrame(() => {
        if (this.destroyed) {
          return;
        }

        for (const playAnimation of rotationAnimations) {
          playAnimation();
        }

        if (!event.isLocalPatch) {
          this.playRealtimePatchArrivalAnimations(event);
        }
      });
    }
  }

  private realtimePatchRotationAnimationsFor(event: GameTableRealtimePatchAnimationEvent): Array<() => void> {
    if (event.isLocalPatch) {
      return [];
    }

    const animations: Array<() => void> = [];

    for (const operation of event.patch.operations) {
      switch (operation.op) {
        case 'card.state.set':
          this.collectRealtimeCardStateAnimation(event.previousSnapshot, operation, animations);
          break;
        case 'cards.state.set':
          this.collectRealtimeCardsStateAnimations(event.previousSnapshot, operation, animations);
          break;
      }
    }

    return animations;
  }

  private collectRealtimeCardStateAnimation(
    snapshot: GameSnapshot,
    operation: Extract<GameSnapshotPatchOperation, { op: 'card.state.set' }>,
    animations: Array<() => void>,
  ): void {
    if (!this.shouldAnimateFocusedBattlefield(operation.playerId, operation.zone)) {
      return;
    }

    const card = snapshot.players[operation.playerId]?.zones[operation.zone]?.find((candidate) => candidate.instanceId === operation.instanceId) ?? null;
    if (!card || !this.hasRealtimeRotationStateChange(card, operation)) {
      return;
    }

    animations.push(this.motion.prepareCardRotationFlip(operation.instanceId));
  }

  private collectRealtimeCardsStateAnimations(
    snapshot: GameSnapshot,
    operation: Extract<GameSnapshotPatchOperation, { op: 'cards.state.set' }>,
    animations: Array<() => void>,
  ): void {
    if (!this.shouldAnimateFocusedBattlefield(operation.playerId, operation.zone)) {
      return;
    }

    for (const state of operation.cards) {
      const card = snapshot.players[operation.playerId]?.zones[operation.zone]?.find((candidate) => candidate.instanceId === state.instanceId) ?? null;
      if (card && this.hasRealtimeRotationStateChange(card, state)) {
        animations.push(this.motion.prepareCardRotationFlip(state.instanceId));
      }
    }
  }

  private hasRealtimeRotationStateChange(
    card: GameCardInstance,
    state: Pick<Extract<GameSnapshotPatchOperation, { op: 'card.state.set' }>, 'tapped' | 'rotation'>,
  ): boolean {
    return state.tapped !== undefined && card.tapped !== state.tapped
      || state.rotation !== undefined && card.rotation !== state.rotation;
  }

  private playRealtimeMoveGhosts(event: GameTableRealtimePatchAnimationEvent): void {
    for (const operation of event.patch.operations) {
      if (operation.op === 'card.move') {
        this.playRealtimeCardMoveGhost(operation);
      }
    }
  }

  private playRealtimeCardMoveGhost(operation: Extract<GameSnapshotPatchOperation, { op: 'card.move' }>): void {
    if (!this.shouldAnimateVisibleRemoteMoveSource(operation.from.playerId, operation.from.zone)) {
      return;
    }

    if (!this.cardFromSnapshot(operation.from.playerId, operation.from.zone, operation.instanceId)) {
      return;
    }

    if (operation.to.playerId !== operation.from.playerId) {
      this.animateGhostToPlayer({
        sourceInstanceId: operation.instanceId,
        targetPlayerId: operation.to.playerId,
      });
      return;
    }

    if (operation.to.zone === 'hand') {
      this.animateGhostToHand({
        sourceInstanceId: operation.instanceId,
        targetPlayerId: operation.to.playerId,
      });
      return;
    }

    this.animateGhostToDropZone({
      sourceInstanceId: operation.instanceId,
      targetPlayerId: operation.to.playerId,
      targetZone: operation.to.zone,
    });
  }

  private shouldAnimateVisibleRemoteMoveSource(playerId: string, zone: GameZoneName): boolean {
    return zone === 'battlefield'
      || zone === 'hand'
      || this.store.dockZones.includes(zone);
  }

  private playRealtimePatchArrivalAnimations(event: GameTableRealtimePatchAnimationEvent): void {
    const punchCardIds = new Set<string>();

    for (const operation of event.patch.operations) {
      switch (operation.op) {
        case 'card.move':
          if (this.shouldAnimateFocusedBattlefield(operation.to.playerId, operation.to.zone)) {
            punchCardIds.add(operation.instanceId);
          }
          break;
        case 'card.create':
          if (this.shouldAnimateFocusedBattlefield(operation.playerId, operation.zone)) {
            punchCardIds.add(operation.card.instanceId);
          }
          break;
        case 'card.counters.set':
        case 'card.stats.set':
          if (this.shouldAnimateFocusedBattlefield(operation.playerId, operation.zone)) {
            punchCardIds.add(operation.instanceId);
          }
          break;
        case 'card.state.set':
          if (operation.counters !== undefined && this.shouldAnimateFocusedBattlefield(operation.playerId, operation.zone)) {
            punchCardIds.add(operation.instanceId);
          }
          break;
      }
    }

    if (punchCardIds.size === 0) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (this.destroyed) {
        return;
      }

      for (const instanceId of punchCardIds) {
        this.motion.punchCard(instanceId, 'damage');
      }
    });
  }

  private shouldAnimateFocusedBattlefield(playerId: string, zone: GameZoneName): boolean {
    return zone === 'battlefield' && this.store.focusedPlayer()?.id === playerId;
  }

  private realtimeBattlefieldCardSelector(instanceId: string): string {
    return `[data-zone="battlefield"][data-card-instance-id="${this.cssEscape(instanceId)}"]`;
  }

  private cssEscape(value: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }

    return value.replace(/["\\]/g, '\\$&');
  }

  private async animateHandLayoutAfterAction(
    action: () => Promise<void>,
    options: { readonly freezeHand?: boolean } = {},
  ): Promise<void> {
    const handCardSelector = '[data-zone="hand"][data-card-instance-id]';
    const playFlip = options.freezeHand === undefined
      ? this.motion.prepareHandDropHandoff(handCardSelector)
      : this.motion.prepareHandDropHandoff(handCardSelector, options);

    try {
      await action();
    } catch (error) {
      playFlip();
      throw error;
    }

    this.changeDetectorRef.detectChanges();
    playFlip();
  }

  private async animateHandReorderAfterAction(action: () => Promise<void>): Promise<void> {
    const handCardSelector = '[data-zone="hand"][data-card-instance-id]';
    const handRoot = this.gameScreen?.nativeElement ?? null;
    const playFlip = handRoot?.isConnected
      ? this.motion.prepareHandLayoutFlip(handRoot, handCardSelector)
      : this.motion.prepareCardFlip(handCardSelector, { freezeHand: false });

    try {
      await action();
    } catch (error) {
      playFlip();
      throw error;
    }

    this.changeDetectorRef.detectChanges();
    playFlip();
  }

  private handDragPayload(event: DragEvent): HandDragPayload | null {
    const raw = event.dataTransfer?.getData('application/json');
    if (!raw) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);

      return this.isHandDragPayload(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private isHandDragPayload(value: unknown): value is HandDragPayload {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const payload = value as Record<string, unknown>;
    const playerId = payload['playerId'];
    const zone = payload['zone'];
    const instanceId = payload['instanceId'];
    const instanceIds = payload['instanceIds'];

    return typeof playerId === 'string'
      && this.isGameZoneName(zone)
      && typeof instanceId === 'string'
      && (instanceIds === undefined || Array.isArray(instanceIds) && instanceIds.every((id) => typeof id === 'string'));
  }

  private isGameZoneName(value: unknown): value is GameZoneName {
    return typeof value === 'string' && this.moveZones.includes(value as GameZoneName);
  }

  private dragPayloadInstanceId(payload: HandDragPayload | null): string | null {
    return payload?.instanceId ?? null;
  }

  private dragPayloadCards(payload: HandDragPayload): readonly GameCardInstance[] {
    const instanceIds = payload.instanceIds?.length ? payload.instanceIds : [payload.instanceId];

    return instanceIds
      .map((instanceId) => this.cardFromSnapshot(payload.playerId, payload.zone, instanceId))
      .filter((card): card is GameCardInstance => Boolean(card));
  }

  private battlefieldDragCardsForMotion(instanceId: string | null): readonly GameCardInstance[] {
    if (!instanceId) {
      return [];
    }

    const selectedBattlefieldCards = this.store.selectedCards()
      .filter((selection) => selection.zone === 'battlefield')
      .map((selection) => selection.card);
    if (selectedBattlefieldCards.some((card) => card.instanceId === instanceId)) {
      return selectedBattlefieldCards;
    }

    const card = this.battlefieldCardFromSnapshot(instanceId);

    return card ? [card] : [];
  }

  private battlefieldCardFromSnapshot(instanceId: string): GameCardInstance | null {
    const players = this.store.snapshot()?.players ?? {};
    for (const player of Object.values(players)) {
      const card = player.zones.battlefield.find((candidate) => candidate.instanceId === instanceId);
      if (card) {
        return card;
      }
    }

    return null;
  }

  private cardFromSnapshot(playerId: string, zone: GameZoneName, instanceId: string): GameCardInstance | null {
    return this.store.snapshot()?.players[playerId]?.zones[zone]?.find((card) => card.instanceId === instanceId) ?? null;
  }

  private cardEvaporatesOutsideBattlefield(card: GameCardInstance | null, targetZone: DropZoneTarget): boolean {
    return targetZone !== 'battlefield'
      && targetZone !== 'mana'
      && (card?.isToken === true || card?.isTokenCopy === true);
  }

  private animateGhostToHand(options: HandGhostOptions): void {
    const targetPlayerId = options.targetPlayerId ?? this.store.handPlayer()?.id ?? null;
    if (!targetPlayerId) {
      return;
    }

    const handTarget = this.dropZoneTargetElement(targetPlayerId, 'hand');
    if (!handTarget) {
      return;
    }

    const ghostTarget = this.handGhostTarget(targetPlayerId) ?? { element: handTarget };
    if (!options.sourceElement && !options.sourceInstanceId) {
      ghostTarget.cleanup?.();
      this.motion.impactZone(handTarget);
      return;
    }

    if (options.sourceElement) {
      this.motion.throwElementGhost(options.sourceElement, ghostTarget.element, {
        scaleToTarget: true,
        rotate: -6,
        sourceRect: options.sourceRect,
        onComplete: ghostTarget.cleanup,
      });
      this.motion.impactZone(handTarget);
      return;
    }

    if (options.sourceInstanceId) {
      this.motion.throwGhost(options.sourceInstanceId, ghostTarget.element, {
        scaleToTarget: true,
        rotate: -6,
        sourceRect: options.sourceRect,
        onComplete: ghostTarget.cleanup,
      });
    }
    this.motion.impactZone(handTarget);
  }

  private motionRect(rect: DOMRect): MotionSourceRect {
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  private clearBattlefieldDragStartRect(instanceId: string | null): void {
    if (instanceId) {
      this.battlefieldDragStartRects.delete(instanceId);
    }
  }

  private animateDropToDropZone(
    sourceInstanceId: string | null,
    payload: HandDragPayload | null,
    targetPlayerId: string,
    targetZone: DropZoneTarget,
    dropEvent?: DragEvent,
  ): void {
    if (!sourceInstanceId) {
      return;
    }

    if (targetZone !== 'mana' && payload && payload.playerId === targetPlayerId && payload.zone === targetZone) {
      return;
    }

    this.animateGhostToDropZone({
      sourceInstanceId,
      targetPlayerId,
      targetZone,
      dropEvent,
    });
  }

  private animateGhostToDropZone(options: ZoneGhostOptions): void {
    const sourceInstanceId = options.sourceInstanceId;
    if (!options.sourceElement && !sourceInstanceId) {
      return;
    }

    const targetZone = options.targetZone;
    const target = this.dropZoneTargetElement(options.targetPlayerId, targetZone);
    if (!target) {
      return;
    }

    const battlefieldTarget = options.battlefieldPosition
      ? this.dropZoneTargetElement(options.targetPlayerId, 'battlefield') ?? target
      : target;
    const usesBattlefieldPointTarget = targetZone === 'battlefield' || options.battlefieldPosition;
    const ghostTarget = usesBattlefieldPointTarget
      ? this.createBattlefieldDropGhostTarget(battlefieldTarget, options.dropEvent, options.battlefieldPosition)
      : { element: target };

    const ghostOptions = {
      scaleToTarget: !usesBattlefieldPointTarget,
      rotate: -6,
      sourceRect: options.sourceRect,
      onComplete: ghostTarget.cleanup,
    };

    if (options.sourceElement) {
      this.motion.throwElementGhost(options.sourceElement, ghostTarget.element, ghostOptions);
    } else if (sourceInstanceId) {
      this.motion.throwGhost(sourceInstanceId, ghostTarget.element, ghostOptions);
    }
    window.requestAnimationFrame(() => this.motion.impactZone(target));
  }

  private animateDropToPlayer(
    targetPlayerId: string,
    sourceInstanceId: string | null,
    payload: HandDragPayload | null,
  ): void {
    if (!sourceInstanceId || (payload && payload.playerId === targetPlayerId)) {
      return;
    }

    this.animateGhostToPlayer({ sourceInstanceId, targetPlayerId });
  }

  private animateGhostToPlayer(options: PlayerGhostOptions): void {
    if (!options.sourceElement && !options.sourceInstanceId) {
      return;
    }

    const target = this.playerDropTargetElement(options.targetPlayerId);
    if (!target) {
      return;
    }

    const ghostOptions = {
      scaleToTarget: true,
      rotate: -6,
      sourceRect: options.sourceRect,
    };

    if (options.sourceElement) {
      this.motion.throwElementGhost(options.sourceElement, target, ghostOptions);
    } else if (options.sourceInstanceId) {
      this.motion.throwGhost(options.sourceInstanceId, target, ghostOptions);
    }
    window.requestAnimationFrame(() => this.motion.impactZone(target));
  }

  private dropZoneTargetElement(playerId: string, zone: DropZoneTarget): HTMLElement | null {
    return this.resolveDropTargetElement(`[data-game-drop-zone][data-player-id="${playerId}"][data-zone="${zone}"]`);
  }

  private createBattlefieldDropGhostTarget(
    battlefieldTarget: HTMLElement,
    dropEvent?: DragEvent,
    battlefieldPosition?: { readonly x: number; readonly y: number },
  ): { element: HTMLElement; cleanup?: () => void } {
    const rect = battlefieldTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { element: battlefieldTarget };
    }

    const targetPoint = battlefieldPosition
      ? {
          x: rect.left + battlefieldPosition.x,
          y: rect.top + battlefieldPosition.y,
        }
      : dropEvent
        ? { x: dropEvent.clientX, y: dropEvent.clientY }
        : null;
    if (!targetPoint || !Number.isFinite(targetPoint.x) || !Number.isFinite(targetPoint.y)) {
      return { element: battlefieldTarget };
    }

    const clampedX = Math.min(Math.max(targetPoint.x, rect.left), rect.right);
    const clampedY = Math.min(Math.max(targetPoint.y, rect.top), rect.bottom);
    const element = document.createElement('span');

    element.style.position = 'fixed';
    element.style.left = `${clampedX}px`;
    element.style.top = `${clampedY}px`;
    element.style.width = '2px';
    element.style.height = '2px';
    element.style.transform = 'translate(-50%, -50%)';
    // Motion service ignores fully transparent targets (opacity === 0).
    // Keep it visually invisible but still eligible as animation destination.
    element.style.opacity = '0.001';
    element.style.pointerEvents = 'none';
    element.style.zIndex = '-1';
    document.body.appendChild(element);

    return {
      element,
      cleanup: () => element.remove(),
    };
  }

  private handGhostTarget(playerId: string): { element: HTMLElement; cleanup?: () => void } | null {
    const host = this.gameScreen?.nativeElement;
    if (!host) {
      return null;
    }

    const handArea = host.querySelector<HTMLElement>(`[data-testid="hand-area"][data-player-id="${playerId}"]`);
    if (!handArea || !this.isDropTargetVisible(handArea)) {
      return null;
    }

    const slot = Array.from(handArea.querySelectorAll<HTMLElement>('.hand-drop-slot'))
      .find((element) => this.isDropTargetVisible(element));
    if (slot) {
      return { element: slot };
    }

    const preview = this.store.handDropPreview();
    if (preview?.playerId !== playerId) {
      return null;
    }

    const handCards = Array.from(handArea.querySelectorAll<HTMLElement>('[data-zone="hand"][data-card-instance-id]'));
    const targetCard = handCards.find((element) => element.dataset['cardInstanceId'] === preview.targetInstanceId);
    if (!targetCard || !this.isDropTargetVisible(targetCard)) {
      return null;
    }

    const element = this.createVirtualHandSlotTarget(handArea, handCards, targetCard, preview.placement);

    return { element, cleanup: () => element.remove() };
  }

  private createVirtualHandSlotTarget(
    handArea: HTMLElement,
    handCards: readonly HTMLElement[],
    targetCard: HTMLElement,
    placement: 'before' | 'after',
  ): HTMLElement {
    const targetRect = targetCard.getBoundingClientRect();
    const rowStep = this.handRowStepPx(handCards, targetRect.width);
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const slotCenterX = targetCenterX + (placement === 'after' ? rowStep / 2 : -rowStep / 2);
    const element = document.createElement('span');

    element.className = 'hand-ghost-slot-target';
    element.style.position = 'fixed';
    element.style.left = `${slotCenterX - targetRect.width / 2}px`;
    element.style.top = `${targetRect.top}px`;
    element.style.width = `${targetRect.width}px`;
    element.style.height = `${targetRect.height}px`;
    element.style.opacity = '0';
    element.style.pointerEvents = 'none';
    element.style.zIndex = '-1';
    handArea.appendChild(element);

    return element;
  }

  private handRowStepPx(handCards: readonly HTMLElement[], fallbackWidth: number): number {
    const centers = handCards
      .map((element) => {
        const rect = element.getBoundingClientRect();

        return rect.width > 0 ? rect.left + rect.width / 2 : null;
      })
      .filter((center): center is number => center !== null)
      .sort((left, right) => left - right);
    const distances = centers
      .slice(1)
      .map((center, index) => center - centers[index]!)
      .filter((distance) => distance > 1);

    return distances[0] ?? Math.max(1, fallbackWidth - 10);
  }

  private playerDropTargetElement(playerId: string): HTMLElement | null {
    return this.resolveDropTargetElement(`[data-player-drop-target="${playerId}"]`);
  }

  private resolveDropTargetElement(selector: string): HTMLElement | null {
    const host = this.gameScreen?.nativeElement;
    if (!host) {
      return null;
    }

    return Array.from(host.querySelectorAll<HTMLElement>(selector))
      .find((element) => this.isDropTargetVisible(element)) ?? null;
  }

  private isDropTargetVisible(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0';
  }

  private dragPreviewElement(): HTMLElement | null {
    return this.gameScreen?.nativeElement.querySelector<HTMLElement>('.drag-card-preview') ?? null;
  }

  private zonePointerDragPreviewElement(): HTMLElement | null {
    return this.gameScreen?.nativeElement.querySelector<HTMLElement>('.zone-floating-card') ?? null;
  }

  private handPointerDragPreviewElement(): HTMLElement | null {
    return this.gameScreen?.nativeElement.querySelector<HTMLElement>('.hand-floating-card') ?? null;
  }

  private pointerHandDropTargetPlayerId(event: PointerEvent): string | null {
    const activeDropTarget = this.store.activeDropTarget();
    if (!activeDropTarget || activeDropTarget.zone !== 'hand') {
      return null;
    }

    for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
      const target = element.closest<HTMLElement>('[data-game-drop-zone][data-zone="hand"]');
      const playerId = target?.dataset['playerId'];
      if (playerId && playerId === activeDropTarget.playerId) {
        return playerId;
      }
    }

    return null;
  }

  private pointerZonePileDropTarget(event: PointerEvent): { playerId: string; zone: GameZoneName } | null {
    const activeDropTarget = this.store.activeDropTarget();
    if (!activeDropTarget || activeDropTarget.zone === 'hand' || activeDropTarget.zone === 'battlefield') {
      return null;
    }

    for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
      const target = element.closest<HTMLElement>('[data-game-drop-zone]');
      const playerId = target?.dataset['playerId'];
      const zone = target?.dataset['zone'];
      if (playerId === activeDropTarget.playerId && zone === activeDropTarget.zone) {
        return activeDropTarget;
      }
    }

    return null;
  }

  private queueBattlefieldReflow(): void {
    if (this.battlefieldReflowFrame !== null) {
      return;
    }

    this.battlefieldReflowFrame = window.requestAnimationFrame(() => {
      this.battlefieldReflowFrame = null;
      if (this.destroyed) {
        return;
      }
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

  private queueBattlefieldZoomReflow(): void {
    this.queueBattlefieldReflow();
    this.clearQueuedBattlefieldZoomReflow();
    this.battlefieldZoomReflowFrame = window.requestAnimationFrame(() => {
      this.battlefieldZoomReflowFrame = null;
      if (this.destroyed) {
        return;
      }
      this.changeDetectorRef.detectChanges();
      this.queueBattlefieldReflow();
    });
  }

  private clearQueuedBattlefieldZoomReflow(): void {
    if (this.battlefieldZoomReflowFrame === null) {
      return;
    }

    window.cancelAnimationFrame(this.battlefieldZoomReflowFrame);
    this.battlefieldZoomReflowFrame = null;
  }

  isZoneOnlyMenu(menu: GameContextMenu): boolean {
    return !menu.card && menu.zone !== 'library';
  }

  handleContextMenuAction(action: ContextMenuAction, menu: GameContextMenu): void {
    this.store.clearCardPreview();
    const current = this.store.currentPlayer();

    switch (action.type) {
      case 'drawMine':
        if (current) void this.drawToHand(current.id);
        this.store.closeContextMenu();
        return;
      case 'draw7Mine':
        if (current) void this.drawToHand(current.id, 7);
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
      case 'openDebug':
        this.openDebugTab();
        return;
      case 'openChat':
        this.openFloatingTab('chat');
        this.store.closeContextMenu();
        return;
      case 'openLog':
        this.openFloatingTab('log');
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
        void this.drawToHand(menu.playerId);
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
      case 'selectAllZoneCards':
        this.store.selectAllZoneCards(menu.playerId, menu.zone);
        return;
      case 'tapCard':
        void this.tapCardFromMenu(menu);
        return;
      case 'addManaFromCard':
        this.openManaActionDialog(menu);
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
        this.openGameplayCardSearchModal(menu.playerId, 'token');
        return;
      case 'createMonarch':
        void this.createMonarch(menu.playerId);
        return;
      case 'removeMonarch':
        void this.removeMonarch();
        return;
      case 'giveMonarchToPlayer':
        void this.createMonarch(action.targetPlayerId);
        return;
      case 'createInitiative':
        void this.createInitiative(menu.playerId);
        return;
      case 'removeInitiative':
        void this.removeInitiative();
        return;
      case 'giveInitiativeToPlayer':
        void this.createInitiative(action.targetPlayerId);
        return;
      case 'createDayNight':
        void this.createDayNightFromMenu();
        return;
      case 'createTheRing':
        void this.createTheRing(menu.playerId);
        return;
      case 'createCitysBlessing':
        void this.createCitysBlessing(menu.playerId);
        return;
      case 'removeCitysBlessing':
        this.requestCitysBlessingRemoval(menu.playerId, 'context-menu');
        return;
      case 'setDayNightMode':
        void this.setDayNightMode(action.mode);
        return;
      case 'removeDayNight':
        void this.removeDayNight();
        return;
      case 'openGameplayCardSearch':
        this.openGameplayCardSearchModal(menu.playerId, action.kind);
        return;
      case 'addVenture':
        void this.addVentureFromMenu(menu, action.kind);
        return;
      case 'rollDice':
        this.openRollModal();
        return;
      case 'showManaPool':
        this.store.showManaPool(menu.playerId);
        this.store.closeContextMenu();
        return;
      case 'resetManaPool':
        this.store.resetManaPool(menu.playerId);
        this.store.closeContextMenu();
        return;
      case 'tokenCopy':
        void this.store.tokenCopy(menu);
        return;
      case 'drawArrow':
        this.openArrowTargetDialog(menu);
        return;
      case 'equipCard':
        this.store.startAttachmentFrom(menu);
        return;
      case 'unequipCard':
        void this.store.removeAttachment(menu);
        return;
      case 'unequipAttachedCards':
        void this.store.removeAttachmentsFromTarget(menu);
        return;
      case 'addToStack':
        void this.store.addToStack(menu);
        return;
      case 'removeStack':
        void this.store.removeLandStack(menu);
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
        const giveDestination = action.zone ?? (menu.zone === 'hand' ? 'hand' : 'battlefield');
        void this.giveCardFromMenu(menu, action.targetPlayerId, giveDestination);
        return;
      case 'moveCard':
        if (menu.zone === 'library' && action.zone === 'hand' && menu.card) {
          this.openLibraryCardMoveToHandDialog(menu);
          return;
        }
        void this.moveCardFromMenu(menu, action.zone, { position: action.position });
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
        void this.drawToHand(request.playerId, value);
        return;
      case 'moveTop':
        void this.moveTopFromLibrary(request, value);
        return;
      case 'viewTop':
        void this.store.viewTopLibrary(request.playerId, value);
        return;
    }
  }

  updateManaActionDialog(change: ManaActionDialogValueChange): void {
    this.manaActionDialog.update((request) => request ? {
      ...request,
      selectedColor: change.color ?? request.selectedColor,
      amount: change.amount ?? request.amount,
    } : request);
  }

  confirmManaActionDialog(dialogAdditions: readonly ManaAddition[] = []): void {
    const request = this.manaActionDialog();
    this.manaActionDialog.set(null);
    if (!request || request.suggestion.manualOnly) {
      return;
    }

    const additions = dialogAdditions.length > 0
      ? dialogAdditions
      : request.suggestion.additions.length > 0
      ? request.suggestion.additions
      : request.selectedColor
        ? [{ color: request.selectedColor, amount: request.amount }]
        : [];

    if (additions.length > 0) {
      this.addManaFromCardAfterComet(request.menu.playerId, request.menu.card ?? undefined, additions, {
        x: request.menu.x,
        y: request.menu.y,
      });
    }
  }

  cancelManaActionDialog(): void {
    this.manaActionDialog.set(null);
  }

  onZoneDoubleClick(playerId: string, zone: GameZoneName): void {
    if (zone === 'library') {
      void this.drawToHand(playerId);
    }
  }

  async handleBattlefieldCardDoubleClicked(event: BattlefieldCardDoubleClickEvent): Promise<void> {
    if (isGameplayCardTapLocked(event.card)) {
      return;
    }

    this.store.clearCardPreview();
    this.lockTapAnimation(event.card.instanceId);
    const animateRotation = this.motion.prepareCardRotationFlip(event.card.instanceId, {
      onComplete: () => this.unlockTapAnimation(event.card.instanceId),
    });
    const automaticManaSuggestion = this.store.automaticTapManaSuggestion(event.playerId, 'battlefield', event.card);
    const automaticManaDialogSuggestion = this.nonFixedAutomaticTapManaSuggestion(automaticManaSuggestion);
    const tapManaIntentSuggestion = this.store.tapManaIntentSuggestion(event.playerId, 'battlefield', event.card);

    try {
      await this.store.toggleTapped(event.playerId, 'battlefield', event.card, { addAutomaticMana: false });
      window.requestAnimationFrame(() => animateRotation());
      this.addAutomaticFixedManaAfterComet(event.playerId, event.card, automaticManaSuggestion, {
        x: event.event.clientX,
        y: event.event.clientY,
      });
      this.openAutomaticTapManaDialog(event.playerId, 'battlefield', event.card, automaticManaDialogSuggestion);
      this.openTapManaIntentDialog(event.playerId, 'battlefield', event.card, tapManaIntentSuggestion, event.event);
    } catch (error) {
      this.unlockTapAnimation(event.card.instanceId);
      throw error;
    }
  }

  private async tapCardFromMenu(menu: GameContextMenu): Promise<void> {
    const automaticManaSuggestion = menu.card && this.store.selectedCards().length <= 1
      ? this.store.automaticTapManaSuggestion(menu.playerId, menu.zone, menu.card)
      : null;
    const automaticManaDialogSuggestion = this.nonFixedAutomaticTapManaSuggestion(automaticManaSuggestion);
    const tapManaIntentSuggestion = menu.card && this.store.selectedCards().length <= 1
      ? this.store.tapManaIntentSuggestion(menu.playerId, menu.zone, menu.card)
      : null;

    await this.store.tapCard(menu, { addAutomaticMana: false });
    if (menu.card) {
      this.addAutomaticFixedManaAfterComet(menu.playerId, menu.card, automaticManaSuggestion, { x: menu.x, y: menu.y });
      this.openAutomaticTapManaDialog(menu.playerId, menu.zone, menu.card, automaticManaDialogSuggestion);
      this.openTapManaIntentDialog(menu.playerId, menu.zone, menu.card, tapManaIntentSuggestion, undefined, { x: menu.x, y: menu.y });
    }
  }

  private async toggleSelectedCardTapped(selected: SelectedCard): Promise<void> {
    const automaticManaSuggestion = this.store.automaticTapManaSuggestion(selected.playerId, selected.zone, selected.card);
    const automaticManaDialogSuggestion = this.nonFixedAutomaticTapManaSuggestion(automaticManaSuggestion);
    const tapManaIntentSuggestion = this.store.tapManaIntentSuggestion(selected.playerId, selected.zone, selected.card);

    await this.store.toggleTapped(selected.playerId, selected.zone, selected.card, { addAutomaticMana: false });
    this.addAutomaticFixedManaAfterComet(selected.playerId, selected.card, automaticManaSuggestion);
    this.openAutomaticTapManaDialog(selected.playerId, selected.zone, selected.card, automaticManaDialogSuggestion);
    this.openTapManaIntentDialog(selected.playerId, selected.zone, selected.card, tapManaIntentSuggestion);
  }

  private nonFixedAutomaticTapManaSuggestion(suggestion: ManaSourceSuggestion | null): ManaSourceSuggestion | null {
    if (!suggestion || suggestion.kind === 'fixed') {
      return null;
    }

    return suggestion;
  }

  private addAutomaticFixedManaAfterComet(
    playerId: string,
    card: GameCardInstance,
    suggestion: ManaSourceSuggestion | null,
    fallbackPosition?: ViewportPoint,
  ): void {
    if (suggestion?.kind !== 'fixed' || suggestion.additions.length === 0) {
      return;
    }

    this.addManaFromCardAfterComet(playerId, card, suggestion.additions, fallbackPosition);
  }

  private openAutomaticTapManaDialog(
    playerId: string,
    zone: GameZoneName,
    card: GameCardInstance,
    suggestion: ManaSourceSuggestion | null,
  ): void {
    if (!suggestion) {
      return;
    }

    const position = zone === 'battlefield' ? this.tapManaIntentPosition(card) : null;
    this.manaActionDialog.set({
      menu: {
        x: position?.x ?? 0,
        y: position?.y ?? 0,
        kind: 'card',
        playerId,
        zone,
        card,
      },
      suggestion,
      selectedColor: suggestion.colors[0] ?? null,
      amount: suggestion.amount > 0 ? suggestion.amount : 1,
      position,
    });
  }

  private openTapManaIntentDialog(
    playerId: string,
    zone: GameZoneName,
    card: GameCardInstance,
    suggestion: ManaSourceSuggestion | null,
    event?: MouseEvent,
    fallbackPosition?: { x: number; y: number },
  ): void {
    if (!suggestion || this.manaActionDialog()) {
      return;
    }

    const position = this.tapManaIntentPosition(card, event, fallbackPosition);
    this.openManaActionDialogFor({
      x: position.x,
      y: position.y,
      kind: 'card',
      playerId,
      zone,
      card,
    }, suggestion);
  }

  private tapManaIntentPosition(
    card: GameCardInstance,
    event?: MouseEvent,
    fallbackPosition?: { x: number; y: number },
  ): { x: number; y: number } {
    const cardElement = this.battlefieldCardElement(card.instanceId, event);
    const bounds = cardElement?.getBoundingClientRect();
    const x = bounds ? bounds.left + bounds.width / 2 : fallbackPosition?.x ?? event?.clientX ?? window.innerWidth / 2;
    const y = bounds ? bounds.top + this.tappedCardTopOffset(bounds) : fallbackPosition?.y ?? event?.clientY ?? window.innerHeight / 2;

    return {
      x: Math.max(64, Math.min(window.innerWidth - 64, x)),
      y: Math.max(48, y),
    };
  }

  private battlefieldCardElement(instanceId: string, event?: MouseEvent): HTMLElement | null {
    const target = event?.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>('[data-zone="battlefield"][data-card-instance-id]')
      : null;
    if (target?.dataset['cardInstanceId'] === instanceId) {
      return target;
    }

    return document.querySelector<HTMLElement>(this.realtimeBattlefieldCardSelector(instanceId));
  }

  private tappedCardTopOffset(bounds: DOMRect): number {
    return Math.max(0, (bounds.height - bounds.width) / 2);
  }

  private addManaFromCardAfterComet(
    playerId: string,
    card: GameCardInstance | undefined,
    additions: readonly ManaAddition[],
    fallbackPosition?: ViewportPoint,
  ): void {
    if (additions.length === 0) {
      return;
    }

    if (!this.canAnimateManaComets(playerId)) {
      this.store.addMana(playerId, additions);
      return;
    }

    const pendingTargetColors = this.showPendingManaTargetColors(playerId, additions);
    this.changeDetectorRef.detectChanges();

    window.requestAnimationFrame(() => {
      const source = this.manaCometSourcePoint(card, fallbackPosition);
      if (!source) {
        this.finishManaCometAdd(playerId, additions, pendingTargetColors);
        return;
      }

      const animated = this.manaComets.animateFromSource(
        source,
        additions,
        () => this.finishManaCometAdd(playerId, additions, pendingTargetColors),
      );
      if (!animated) {
        this.finishManaCometAdd(playerId, additions, pendingTargetColors);
      }
    });
  }

  private showPendingManaTargetColors(playerId: string, additions: readonly ManaAddition[]): readonly ManaPoolColor[] {
    const colors = Array.from(new Set(additions.map((addition) => addition.color)));
    if (colors.length === 0) {
      return [];
    }

    this.pendingManaPoolColorCounts.update((current) => {
      const playerCounts = { ...(current[playerId] ?? {}) };
      for (const color of colors) {
        playerCounts[color] = (playerCounts[color] ?? 0) + 1;
      }

      return { ...current, [playerId]: playerCounts };
    });

    return colors;
  }

  private finishManaCometAdd(
    playerId: string,
    additions: readonly ManaAddition[],
    pendingTargetColors: readonly ManaPoolColor[],
  ): void {
    this.store.addMana(playerId, additions);
    this.hidePendingManaTargetColors(playerId, pendingTargetColors);
  }

  private hidePendingManaTargetColors(playerId: string, colors: readonly ManaPoolColor[]): void {
    if (colors.length === 0) {
      return;
    }

    this.pendingManaPoolColorCounts.update((current) => {
      const currentPlayerCounts = current[playerId];
      if (!currentPlayerCounts) {
        return current;
      }

      const nextPlayerCounts: Partial<Record<ManaPoolColor, number>> = { ...currentPlayerCounts };
      for (const color of colors) {
        const nextCount = (nextPlayerCounts[color] ?? 0) - 1;
        if (nextCount > 0) {
          nextPlayerCounts[color] = nextCount;
        } else {
          delete nextPlayerCounts[color];
        }
      }

      if (Object.keys(nextPlayerCounts).length === 0) {
        const remaining: Record<string, Readonly<Partial<Record<ManaPoolColor, number>>>> = { ...current };
        delete remaining[playerId];
        return remaining;
      }

      return { ...current, [playerId]: nextPlayerCounts };
    });
  }

  private canAnimateManaComets(playerId: string): boolean {
    return this.store.focusedPlayer()?.id === playerId
      && this.canControlPlayer(playerId)
      && !this.store.isManaPoolHidden(playerId);
  }

  private manaCometSourcePoint(card: GameCardInstance | undefined, fallbackPosition?: ViewportPoint): ViewportPoint | null {
    const bounds = card ? this.battlefieldCardElement(card.instanceId)?.getBoundingClientRect() : null;
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      return {
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      };
    }

    return fallbackPosition ?? null;
  }

  private lockTapAnimation(instanceId: string): void {
    this.tapAnimationLockedCardIds.update((current) => new Set([...current, instanceId]));
  }

  private unlockTapAnimation(instanceId: string): void {
    this.tapAnimationLockedCardIds.update((current) => {
      if (!current.has(instanceId)) {
        return current;
      }

      const next = new Set(current);
      next.delete(instanceId);

      return next;
    });
  }

  async handleHandCardPointerMoved(event: HandCardPointerMovedEvent): Promise<void> {
    const sourceElement = this.handPointerDragPreviewElement();
    if (event.toZone === 'hand') {
      this.animateGhostToHand({
        sourceElement,
        sourceInstanceId: event.movedInstanceId,
        targetPlayerId: event.targetPlayerId,
      });
    } else {
      this.animateGhostToDropZone({
        sourceElement,
        sourceInstanceId: event.movedInstanceId,
        targetPlayerId: event.targetPlayerId,
        targetZone: event.rawZone === 'mana' ? 'mana' : event.toZone,
      });
    }

    await this.store.moveHandCardByPointer(
      event.playerId,
      event.targetPlayerId,
      event.movedInstanceId,
      event.toZone,
      event.position,
      event.rawZone,
    );
  }

  handleZoneDrop(event: ZoneDropEvent): void {
    const payload = this.handDragPayload(event.event);
    if (payload) {
      const sourceInstanceId = this.dragPayloadInstanceId(payload);
      this.animateDropToDropZone(sourceInstanceId, payload, event.playerId, event.zone, event.event);
    }
    void this.store.dropOnZone(event.event, event.playerId, event.zone);
  }

  handleZonePointerDragStarted(event: ZonePointerDragStartedEvent): void {
    this.store.closeContextMenu();
    this.store.beginZonePointerDrag(event.card.instanceId);
  }

  async handleZonePointerDropped(event: ZonePointerDroppedEvent): Promise<void> {
    this.store.updatePointerDropTarget(null);
    if (!event.moved || !event.request) {
      this.store.endZonePointerDrag();
      return;
    }

    const sourceElement = this.zonePointerDragPreviewElement();
    if (event.request.toZone === 'hand') {
      this.animateGhostToHand({
        sourceElement,
        sourceInstanceId: event.request.instanceId,
        targetPlayerId: event.request.targetPlayerId,
      });
    } else {
      this.animateGhostToDropZone({
        sourceElement,
        sourceInstanceId: event.request.instanceId,
        targetPlayerId: event.request.targetPlayerId,
        targetZone: event.request.rawZone === 'mana' ? 'mana' : event.request.toZone,
        battlefieldPosition: event.request.toZone === 'battlefield' ? event.request.position : undefined,
      });
    }

    await this.store.moveZoneCardByPointer(event.request);
  }

  handleManaLaneDrop(event: ManaLaneDropEvent): void {
    const payload = this.handDragPayload(event.event);
    if (payload) {
      const sourceInstanceId = this.dragPayloadInstanceId(payload);
      this.animateDropToDropZone(sourceInstanceId, payload, event.playerId, 'mana');
    }
    void this.store.dropOnManaLane(event.event, event.playerId);
  }

  handlePlayerDrop(event: PlayerDropEvent): void {
    const payload = this.handDragPayload(event.event);
    if (payload) {
      const sourceInstanceId = this.dragPayloadInstanceId(payload);
      this.animateDropToPlayer(event.playerId, sourceInstanceId, payload);
    }
    void this.store.dropOnPlayer(event.event, event.playerId);
  }

  handleNativeDragStart(event: DragEvent): void {
    const source = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[draggable="true"]') : null;
    if (source) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  }

  async handleHandDropped(event: HandDroppedEvent): Promise<void> {
    const payload = this.handDragPayload(event.event);
    const dropOnHand = () => this.store.dropOnHand(event.event, event.playerId);

    if (payload?.zone === 'hand') {
      await dropOnHand();
      return;
    }

    const payloadCards = payload ? this.dragPayloadCards(payload) : [];
    if (payloadCards.length > 0 && payloadCards.every((card) => this.cardEvaporatesOutsideBattlefield(card, 'hand'))) {
      this.animateGhostToHand({
        sourceElement: this.dragPreviewElement(),
        sourceInstanceId: payload?.instanceId ?? this.store.draggingCardInstanceId(),
        targetPlayerId: event.playerId,
      });
      await dropOnHand();
      return;
    }

    this.animateGhostToHand({
      sourceElement: this.dragPreviewElement(),
      sourceInstanceId: payload?.instanceId ?? this.store.draggingCardInstanceId(),
      targetPlayerId: event.playerId,
    });
    await this.animateHandLayoutAfterAction(dropOnHand);
  }

  async handleHandCardPointerReordered(event: HandCardPointerReorderedEvent): Promise<void> {
    await this.animateHandReorderAfterAction(() => this.store.reorderHandCard(
      event.playerId,
      event.movedInstanceId,
      event.targetInstanceId,
      event.placement,
    ));
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

    this.animateCardMotion(this.menuCardMotion(request.menu, request.targetPlayerId, { kind: 'player' }));
    void this.store.giveHandCardToPlayer(request.menu, request.targetPlayerId);
  }

  async confirmLibraryCardMoveToHand(reveal: boolean): Promise<void> {
    const request = this.libraryCardMoveToHandDialog();
    this.libraryCardMoveToHandDialog.set(null);
    if (!request) {
      return;
    }

    this.animateGhostToHand({
      sourceInstanceId: request.menu.card?.instanceId ?? null,
      sourceRect: request.menu.sourceRect,
      targetPlayerId: request.menu.playerId,
    });
    await this.animateHandLayoutAfterAction(
      () => this.store.moveLibraryCardToHand(request.menu, reveal),
    );
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

  async createSelectedGameplayCard(selection: GameplayCardSearchSelection): Promise<void> {
    const request = this.gameplayCardSearchRequest();
    if (!request || this.gameplayCardSearchPending() || request.kind !== selection.kind) {
      return;
    }

    if (selection.kind === 'dungeon') {
      const currentDungeonName = this.activeDungeonName(request.playerId);
      if (currentDungeonName !== null) {
        this.pendingDungeonReplacement.set({
          playerId: request.playerId,
          card: selection.card,
          currentDungeonName,
        });
        this.gameplayCardSearchRequest.set(null);
        return;
      }
    }

    this.gameplayCardSearchPending.set(true);
    try {
      await this.createGameplayCardOnBattlefield(request.playerId, selection.card, selection.kind === 'token' ? selection.quantity : 1);
      this.gameplayCardSearchRequest.set(null);
    } finally {
      this.gameplayCardSearchPending.set(false);
    }
  }

  closeGameplayCardSearchModal(): void {
    if (this.gameplayCardSearchPending()) {
      return;
    }

    this.gameplayCardSearchRequest.set(null);
  }

  async confirmDungeonReplacement(): Promise<void> {
    const request = this.pendingDungeonReplacement();
    if (!request || this.dungeonReplacementPending()) {
      return;
    }

    this.dungeonReplacementPending.set(true);
    try {
      await this.createGameplayCardOnBattlefield(request.playerId, request.card, 1);
      this.pendingDungeonReplacement.set(null);
    } finally {
      this.dungeonReplacementPending.set(false);
    }
  }

  cancelDungeonReplacement(): void {
    if (this.dungeonReplacementPending()) {
      return;
    }

    this.pendingDungeonReplacement.set(null);
  }

  confirmCitysBlessingRemoval(): void {
    const request = this.pendingCitysBlessingRemoval();
    this.pendingCitysBlessingRemoval.set(null);
    if (!request) {
      return;
    }

    void this.removeCitysBlessing(request.playerId);
  }

  cancelCitysBlessingRemoval(): void {
    this.pendingCitysBlessingRemoval.set(null);
  }

  private async createGameplayCardOnBattlefield(playerId: string, card: Card, quantity: number): Promise<void> {
    await this.store.createToken(
      playerId,
      card,
      quantity,
      { position: GAMEPLAY_CARD_SEARCH_BATTLEFIELD_POSITION },
    );
  }

  private async createMonarch(playerId: string): Promise<void> {
    if (!this.store.players().some((player) => player.id === playerId)) {
      this.store.error.set('Could not find target player for monarch.');
      this.store.closeContextMenu();
      return;
    }

    const card = await this.specialMechanicTokenCardRef(MONARCH_SEARCH_QUERY);
    await this.store.createHelper('monarch', playerId, card ? { card } : {});
  }

  private async createInitiative(playerId: string): Promise<void> {
    if (!this.store.players().some((player) => player.id === playerId)) {
      this.store.error.set('Could not find target player for initiative.');
      this.store.closeContextMenu();
      return;
    }

    if (this.initiativeOwnerPlayerId() === playerId) {
      this.store.closeContextMenu();
      return;
    }

    const card = await this.specialMechanicTokenCardRef(INITIATIVE_SEARCH_QUERY);
    await this.store.createHelper('initiative', playerId, card ? { card } : {});
  }

  private async createTheRing(playerId: string): Promise<void> {
    if (!this.store.players().some((player) => player.id === playerId)) {
      this.store.error.set('Could not find target player for The Ring.');
      this.store.closeContextMenu();
      return;
    }

    await this.createGameplayCardOnBattlefield(playerId, THE_RING_FALLBACK_CARD, 1);
  }

  private async removeMonarch(): Promise<void> {
    const entity = this.store.specialEntities().find((candidate) => candidate.template === 'monarch') ?? null;
    if (!entity) {
      this.store.closeContextMenu();
      return;
    }

    await this.store.removeHelper(entity.id);
  }

  private async removeInitiative(): Promise<void> {
    const entity = this.store.specialEntities().find((candidate) => candidate.template === 'initiative') ?? null;
    if (!entity) {
      this.store.closeContextMenu();
      return;
    }

    await this.store.removeHelper(entity.id);
  }

  openRollModal(): void {
    this.store.closeContextMenu();
    this.rollModalOpen.set(true);
  }

  closeRollModal(): void {
    this.rollModalOpen.set(false);
  }

  async recordRollResult(result: RollResult): Promise<void> {
    this.closeRollModal();
    await this.store.recordDiceRoll({
      kind: result.kind,
    });
  }

  openDebugTab(): void {
    const gameId = this.store.gameId();
    this.store.closeContextMenu();
    if (!gameId) {
      return;
    }

    window.open(`/games/${encodeURIComponent(gameId)}/debug`, '_blank', 'noopener');
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

  closeDisconnectVoteModal(): void {
    this.disconnectVote.closeModal();
  }

  async voteDisconnectWait(): Promise<void> {
    await this.disconnectVote.vote('wait');
  }

  async voteDisconnectExpel(): Promise<void> {
    await this.disconnectVote.vote('expel');
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
    const movedCount = Array.isArray(instanceIds) ? instanceIds.length : 1;

    return movedCount > 1
      ? `Donde quieres poner estas ${movedCount} cartas?`
      : 'Donde quieres poner esta carta?';
  }

  updateLibraryMoveRandomOrder(event: Event): void {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    this.libraryMoveRandomOrder.set(input?.checked ?? false);
  }

  confirmPendingBattlefieldMove(): void {
    const motion = this.pendingCardMotion();
    this.pendingCardMotion.set(null);
    this.animateCardMotion(motion);
    void this.store.confirmPendingBattlefieldMove();
  }

  cancelPendingBattlefieldMove(): void {
    this.pendingCardMotion.set(null);
    void this.store.cancelPendingBattlefieldMove();
  }

  confirmPendingLibraryMove(position: 'top' | 'bottom'): void {
    const pendingMove = this.store.pendingLibraryMove();
    const randomOrder = pendingMove
      ? this.pendingLibraryMoveSupportsRandomOrder(pendingMove) && this.libraryMoveRandomOrder()
      : false;

    const motion = this.pendingCardMotion();
    this.pendingCardMotion.set(null);
    this.libraryMoveRandomOrder.set(false);
    this.animateCardMotion(motion);
    void this.store.confirmPendingLibraryMove(position, randomOrder);
  }

  cancelPendingLibraryMove(): void {
    this.pendingCardMotion.set(null);
    this.libraryMoveRandomOrder.set(false);
    void this.store.cancelPendingLibraryMove();
  }

  focusPlayerBattlefield(playerId: string): void {
    const focused = this.store.focusPlayer(playerId);
    if (focused) {
      this.refreshFocusedPlayerView(playerId);
      this.reapplyFollowActiveTurnPlayerIfNeeded(playerId);
    }
  }

  focusOpponentFromSidebar(playerId: string): void {
    if (this.followActiveTurnPlayer()) {
      this.updateFollowActiveTurnPlayer(false);
    }

    this.focusPlayerBattlefield(playerId);
    this.closeOpponentsDrawer();
  }

  handleOpponentMiniBattlefieldCardClick(event: {
    event: MouseEvent;
    playerId: string;
    card: GameCardInstance;
    forceOpenLeft?: boolean;
  }): void {
    event.event.preventDefault();
    event.event.stopPropagation();
    this.focusOpponentFromSidebar(event.playerId);
  }

  returnToCurrentPlayerBattlefield(): void {
    const currentPlayer = this.store.currentPlayer();
    if (!currentPlayer) {
      return;
    }
    if (this.followActiveTurnPlayer()) {
      this.updateFollowActiveTurnPlayer(false);
    }

    this.focusPlayerBattlefield(currentPlayer.id);
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
      title: 'game.numberAction.drawCards.title',
      description: 'game.numberAction.drawCards.description',
      defaultValue: 1,
      min: 1,
      confirmLabel: 'game.numberAction.drawCards.confirm',
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

  private openGameplayCardSearchModal(playerId: string, kind: GameplayCardSearchKind): void {
    this.store.closeContextMenu();
    this.gameplayCardSearchRequest.set({ playerId, kind });
  }

  private async createDayNightFromMenu(): Promise<void> {
    if (this.specialEntityState.dayNight()) {
      await this.setOrCreateDayNightMode('day');
      return;
    }

    await this.createDayNight('day');
  }

  private async setOrCreateDayNightMode(mode: 'day' | 'night'): Promise<void> {
    const entity = this.specialEntityState.dayNight();
    if (!entity) {
      await this.createDayNight(mode);
      return;
    }

    const card = entity.card ? null : await this.dayNightCardRef();
    await this.store.updateHelper(entity.id, {
      ...entity.state,
      mode,
    }, card ? { card } : {});
  }

  private async createDayNight(mode: 'day' | 'night'): Promise<void> {
    const card = await this.dayNightCardRef();
    await this.store.createHelper('day_night', null, {
      ...(card ? { card } : {}),
      state: {
        mode,
        positions: this.initialDayNightPositions(),
      },
    });
  }

  private async setDayNightMode(mode: 'day' | 'night'): Promise<void> {
    const entity = this.specialEntityState.dayNight();
    if (!entity) {
      this.store.closeContextMenu();
      return;
    }

    await this.store.updateHelper(entity.id, {
      ...entity.state,
      mode,
    });
  }

  private async removeDayNight(): Promise<void> {
    const entity = this.specialEntityState.dayNight();
    if (!entity) {
      this.store.closeContextMenu();
      return;
    }

    await this.store.removeHelper(entity.id);
  }

  private async createCitysBlessing(playerId: string): Promise<void> {
    if (!this.store.players().some((player) => player.id === playerId)) {
      this.store.error.set("Could not find target player for city's blessing.");
      this.store.closeContextMenu();
      return;
    }

    const card = await this.specialMechanicTokenCardRef(CITYS_BLESSING_SEARCH_QUERY);
    await this.store.createHelper('citys_blessing', playerId, card ? { card } : {});
  }

  private async removeCitysBlessing(playerId: string): Promise<void> {
    const entity = this.specialEntityState.playerEntity(playerId, 'citys_blessing');
    if (!entity) {
      this.store.closeContextMenu();
      return;
    }

    await this.store.removeHelper(entity.id);
  }

  private initialDayNightPositions(): Record<string, GameCardPosition> {
    return Object.fromEntries(
      this.store.players().map((player) => [player.id, DAY_NIGHT_FIXED_BATTLEFIELD_POSITION]),
    );
  }

  private async dayNightCardRef(): Promise<GameSpecialEntity['card'] | null> {
    try {
      const response = await firstValueFrom(this.cardsApi.search(DAY_NIGHT_SEARCH_QUERY, 1, 8, { gameplayKind: 'token' }));
      const card = response.data.find((candidate) => candidate.name === DAY_NIGHT_SEARCH_QUERY && candidate.layout === 'double_faced_token')
        ?? response.data.find((candidate) => candidate.name === DAY_NIGHT_SEARCH_QUERY)
        ?? null;

      return card ? this.gameplayCardRef(card) : null;
    } catch {
      return null;
    }
  }

  private async specialMechanicTokenCardRef(name: string): Promise<GameSpecialEntity['card'] | null> {
    const card = await this.specialMechanicTokenCard(name);

    return card ? this.gameplayCardRef(card) : null;
  }

  private async specialMechanicTokenCard(name: string, preferredLayout?: string): Promise<Card | null> {
    try {
      const response = await firstValueFrom(this.cardsApi.search(name, 1, SPECIAL_MECHANIC_CARD_SEARCH_LIMIT, { gameplayKind: 'token' }));
      const normalizedName = name.toLowerCase();
      const normalizedPreferredLayout = preferredLayout?.toLowerCase() ?? null;
      const card = response.data.find((candidate) =>
        candidate.name.toLowerCase() === normalizedName
        && (normalizedPreferredLayout ? candidate.layout === normalizedPreferredLayout : candidate.layout === 'token'),
      )
        ?? response.data.find((candidate) => candidate.name.toLowerCase() === normalizedName)
        ?? response.data[0]
        ?? null;

      return card;
    } catch {
      return null;
    }
  }

  private async addVentureFromMenu(menu: GameContextMenu, kind: VentureCardKind): Promise<void> {
    if (!menu.card || menu.zone !== 'battlefield' || !this.store.canControlPlayer(menu.playerId)) {
      this.store.closeContextMenu();
      return;
    }

    if (kind === 'initiative') {
      await this.createInitiative(menu.playerId);
      return;
    }

    if (!this.hasActiveDungeon(menu.playerId)) {
      this.openGameplayCardSearchModal(menu.playerId, 'dungeon');
      return;
    }

    this.store.closeContextMenu();
  }

  private hasActiveDungeon(playerId: string): boolean {
    return this.activeDungeonName(playerId) !== null;
  }

  private activeDungeonName(playerId: string): string | null {
    const player = this.store.players().find((candidate) => candidate.id === playerId);
    const dungeon = (player?.state.zones.battlefield ?? []).find((card) => isDungeonCard(card));

    return dungeon?.name ?? null;
  }

  showHelperPreview(entity: GameSpecialEntity): void {
    const previewCard = this.specialEntityState.helperPreviewCard(entity);
    if (!previewCard) {
      return;
    }

    this.store.showCardPreview(previewCard, entity.ownerPlayerId ?? undefined, 'command');
  }

  handleHelperContextRequest(request: { event: MouseEvent; entity: GameSpecialEntity }): void {
    const { entity } = request;
    if (entity.template !== 'citys_blessing' || !entity.ownerPlayerId || !this.canControlPlayer(entity.ownerPlayerId)) {
      return;
    }

    this.requestCitysBlessingRemoval(entity.ownerPlayerId, 'pill');
  }

  private requestCitysBlessingRemoval(playerId: string, source: PendingCitysBlessingRemovalRequest['source']): void {
    this.pendingCitysBlessingRemoval.set({ playerId, source });
  }

  private gameplayCardRef(card: Card): NonNullable<GameSpecialEntity['card']> {
    return {
      scryfallId: card.scryfallId,
      name: card.name,
      imageUris: card.imageUris,
      cardFaces: card.cardFaces,
      typeLine: card.typeLine,
      oracleText: card.oracleText,
      layout: card.layout,
    };
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
      title: 'game.numberAction.moveTopCards.title',
      description: 'game.numberAction.moveTopCards.description',
      defaultValue: 1,
      min: 1,
      confirmLabel: 'game.numberAction.moveTopCards.confirm',
    });
  }

  private openViewTopLibraryDialog(playerId: string): void {
    this.store.closeContextMenu();
    this.numberActionDialog.set({
      kind: 'viewTop',
      playerId,
      title: 'game.numberAction.viewTopCards.title',
      description: 'game.numberAction.viewTopCards.description',
      defaultValue: 1,
      min: 1,
      confirmLabel: 'game.numberAction.viewTopCards.confirm',
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
    const instanceIds = this.store.zoneCardInstanceIds(menu.playerId, menu.zone);
    if (instanceIds.length <= 0) {
      return;
    }

    if (toZone === 'library') {
      this.zoneMoveAllLibraryDialog.set({ playerId: menu.playerId, fromZone: menu.zone, count: instanceIds.length });
      return;
    }

    if (toZone === 'hand' && menu.zone !== 'hand') {
      this.animateGhostToHand({
        sourceInstanceId: instanceIds[0] ?? null,
        targetPlayerId: targetPlayerId ?? menu.playerId,
      });
      void this.animateHandLayoutAfterAction(() => this.store.moveAllZoneCards(menu.playerId, menu.zone, toZone, { targetPlayerId }));
      return;
    }

    void this.store.moveAllZoneCards(menu.playerId, menu.zone, toZone, { targetPlayerId });
  }

  private openHandCardGiveDialog(menu: GameContextMenu, targetPlayerId: string): void {
    if (!menu.card || menu.zone !== 'hand') {
      return;
    }

    const selected = this.store.selectedCards();
    const validSelection = selected.length > 1
      && selected.some((item) => item.card.instanceId === menu.card?.instanceId)
      && selected.every((item) => item.playerId === menu.playerId && item.zone === 'hand');

    this.store.closeContextMenu();
    this.handCardGiveDialog.set({
      menu,
      targetPlayerId,
      targetPlayerName: this.playerName(targetPlayerId),
      cardName: validSelection ? `${selected.length} cards` : menu.card.name,
    });
  }

  private playerName(playerId: string): string {
    return this.store.players().find((player) => player.id === playerId)?.state.user.displayName || playerId;
  }

  private sortOpponentSidebarPlayers(players: readonly PlayerView[]): PlayerView[] {
    return players
      .map((player, index) => ({
        player,
        index,
        defeated: playerIsDefeated(player),
      }))
      .sort((left, right) => {
        if (left.defeated !== right.defeated) {
          return left.defeated ? 1 : -1;
        }

        return left.index - right.index;
      })
      .map(({ player }) => player);
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

  private openManaActionDialog(menu: GameContextMenu): void {
    if (!menu.card) {
      return;
    }

    const suggestion = this.store.manaSourceSuggestion(menu.playerId, menu.card);
    if (suggestion.kind === 'none' || suggestion.manualOnly) {
      this.store.closeContextMenu();
      return;
    }

    this.openManaActionDialogFor(menu, suggestion);
  }

  private openManaActionDialogFor(menu: GameContextMenu, suggestion: ManaSourceSuggestion): void {
    this.store.closeContextMenu();
    const position = menu.card && menu.zone === 'battlefield'
      ? this.tapManaIntentPosition(menu.card, undefined, { x: menu.x, y: menu.y })
      : null;
    this.manaActionDialog.set({
      menu,
      suggestion,
      selectedColor: suggestion.colors[0] ?? null,
      amount: suggestion.amount > 0 ? suggestion.amount : 1,
      position,
    });
  }

  private syncFollowActiveTurnPlayer(activePlayerId: string | null | undefined): void {
    if (!this.followActiveTurnPlayer()) {
      this.lastFocusedTurnPlayerId = null;
      return;
    }

    if (!activePlayerId) {
      return;
    }

    const focusedPlayerId = this.store.focusedPlayer()?.id ?? null;
    if (activePlayerId === this.lastFocusedTurnPlayerId && focusedPlayerId === activePlayerId) {
      return;
    }

    this.lastFocusedTurnPlayerId = activePlayerId;
    this.focusPlayerBattlefield(activePlayerId);
  }

  private syncFloatingUnreadState(): void {
    const chatKey = this.latestChatKey();
    const logKey = this.latestLogKey();
    const activeTab = this.store.activeFloatingTab();

    this.syncChatUnreadState(activeTab, chatKey);

    this.syncLogUnreadState(activeTab, logKey);

    this.markFloatingTabRead(activeTab);
  }

  private markFloatingTabRead(tab: FloatingPanelTab): void {
    if (tab === 'chat') {
      this.markChatRead();
      return;
    }

    this.fadeHighlightedLogEntryIds();
    this.unreadLog.set(false);
    this.lastObservedLogKey = this.latestLogKey();
    this.lastObservedLogEntryId = this.store.eventLog().at(-1)?.id ?? null;
  }

  private syncChatUnreadState(activeTab: FloatingPanelTab, chatKey: string): void {
    if (this.lastObservedChatKey === null) {
      this.lastObservedChatKey = chatKey;
      this.syncInitialChatReadState(activeTab);
      return;
    }

    this.lastObservedChatKey = chatKey;
    if (activeTab === 'chat') {
      return;
    }

    const unreadMessageKey = this.latestUnreadChatMessageKey();
    const unreadMessageKeys = this.unreadChatMessageKeys();
    this.unreadChat.set(unreadMessageKeys.length > 0);
    if (unreadMessageKey && unreadMessageKey !== this.lastUnreadChatNotificationKey) {
      this.lastUnreadChatNotificationKey = unreadMessageKey;
      this.addHighlightedChatMessageKeys(unreadMessageKeys);
      this.notificationSound.playChatMessage();
    }
  }

  private syncInitialChatReadState(activeTab: FloatingPanelTab): void {
    if (activeTab === 'chat') {
      this.markChatRead();
      return;
    }

    const context = this.chatReadContext();
    if (!context) {
      return;
    }

    if (!this.chatReadState.hasStoredReadKey(context)) {
      this.chatReadState.markRead(context);
      return;
    }

    const unreadMessageKey = this.chatReadState.latestUnreadMessageKey(context);
    this.unreadChat.set(unreadMessageKey !== null);
    this.lastUnreadChatNotificationKey = unreadMessageKey;
  }

  private markChatRead(): void {
    this.fadeHighlightedChatMessageKeys();
    this.unreadChat.set(false);
    this.lastObservedChatKey = this.latestChatKey();
    this.lastUnreadChatNotificationKey = null;

    const context = this.chatReadContext();
    if (context) {
      this.chatReadState.markRead(context);
    }
  }

  private latestUnreadChatMessageKey(): string | null {
    const context = this.chatReadContext();

    return context ? this.chatReadState.latestUnreadMessageKey(context) : null;
  }

  private unreadChatMessageKeys(): string[] {
    const context = this.chatReadContext();

    return context ? this.chatReadState.unreadMessageKeys(context) : [];
  }

  private syncLogUnreadState(activeTab: FloatingPanelTab, logKey: string): void {
    const previousLatestLogEntryId = this.lastObservedLogEntryId;
    const latestLogEntryId = this.store.eventLog().at(-1)?.id ?? null;

    if (this.lastObservedLogKey === null) {
      this.lastObservedLogKey = logKey;
      this.lastObservedLogEntryId = latestLogEntryId;
      return;
    }

    if (logKey === this.lastObservedLogKey) {
      return;
    }

    this.lastObservedLogKey = logKey;
    this.lastObservedLogEntryId = latestLogEntryId;
    if (activeTab !== 'log') {
      this.unreadLog.set(true);
      this.addHighlightedLogEntryIds(this.newLogEntryIdsAfter(previousLatestLogEntryId));
      this.notificationSound.playGameLogMessage();
    }
  }

  private newLogEntryIdsAfter(previousLatestLogEntryId: string | null): string[] {
    const entries = this.store.eventLog();
    if (!previousLatestLogEntryId) {
      return entries.map((entry) => entry.id);
    }

    const previousIndex = entries.findIndex((entry) => entry.id === previousLatestLogEntryId);

    return entries.slice(previousIndex + 1).map((entry) => entry.id);
  }

  private chatReadContext(): GameTableChatReadContext | null {
    const gameId = this.store.gameId();
    const currentPlayer = this.store.currentPlayer();
    const snapshot = this.store.snapshot();
    if (!gameId || !currentPlayer || !snapshot) {
      return null;
    }

    return {
      gameId,
      currentPlayerId: currentPlayer.id,
      currentUserId: currentPlayer.state.user.id,
      messages: snapshot.chat,
    };
  }

  private addHighlightedChatMessageKeys(keys: readonly string[]): void {
    if (keys.length === 0) {
      return;
    }

    const highlighted = new Set(this.highlightedChatMessageKeys());
    const fading = new Set(this.fadingChatMessageKeys());
    for (const key of keys) {
      highlighted.add(key);
      fading.delete(key);
      this.clearChatHighlightTimer(key);
    }

    this.highlightedChatMessageKeys.set([...highlighted]);
    this.fadingChatMessageKeys.set([...fading]);
  }

  private fadeHighlightedChatMessageKeys(): void {
    const keys = this.highlightedChatMessageKeys().filter((key) => !this.fadingChatMessageKeys().includes(key));
    if (keys.length === 0) {
      return;
    }

    this.fadingChatMessageKeys.update((current) => [...new Set([...current, ...keys])]);
    for (const key of keys) {
      this.clearChatHighlightTimer(key);
      this.chatHighlightTimers.set(key, window.setTimeout(() => this.removeHighlightedChatMessageKey(key), 3000));
    }
  }

  private removeHighlightedChatMessageKey(key: string): void {
    this.clearChatHighlightTimer(key);
    this.highlightedChatMessageKeys.update((keys) => keys.filter((candidate) => candidate !== key));
    this.fadingChatMessageKeys.update((keys) => keys.filter((candidate) => candidate !== key));
  }

  private clearChatHighlightTimer(key: string): void {
    const timer = this.chatHighlightTimers.get(key);
    if (timer === undefined) {
      return;
    }

    window.clearTimeout(timer);
    this.chatHighlightTimers.delete(key);
  }

  private addHighlightedLogEntryIds(ids: readonly string[]): void {
    if (ids.length === 0) {
      return;
    }

    const highlighted = new Set(this.highlightedLogEntryIds());
    const fading = new Set(this.fadingLogEntryIds());
    for (const id of ids) {
      highlighted.add(id);
      fading.delete(id);
      this.clearLogHighlightTimer(id);
    }

    this.highlightedLogEntryIds.set([...highlighted]);
    this.fadingLogEntryIds.set([...fading]);
  }

  private fadeHighlightedLogEntryIds(): void {
    const ids = this.highlightedLogEntryIds().filter((id) => !this.fadingLogEntryIds().includes(id));
    if (ids.length === 0) {
      return;
    }

    this.fadingLogEntryIds.update((current) => [...new Set([...current, ...ids])]);
    for (const id of ids) {
      this.clearLogHighlightTimer(id);
      this.logHighlightTimers.set(id, window.setTimeout(() => this.removeHighlightedLogEntryId(id), 3000));
    }
  }

  private removeHighlightedLogEntryId(id: string): void {
    this.clearLogHighlightTimer(id);
    this.highlightedLogEntryIds.update((ids) => ids.filter((candidate) => candidate !== id));
    this.fadingLogEntryIds.update((ids) => ids.filter((candidate) => candidate !== id));
  }

  private clearLogHighlightTimer(id: string): void {
    const timer = this.logHighlightTimers.get(id);
    if (timer === undefined) {
      return;
    }

    window.clearTimeout(timer);
    this.logHighlightTimers.delete(id);
  }

  private clearMessageHighlightTimers(): void {
    for (const timer of this.chatHighlightTimers.values()) {
      window.clearTimeout(timer);
    }
    this.chatHighlightTimers.clear();

    for (const timer of this.logHighlightTimers.values()) {
      window.clearTimeout(timer);
    }
    this.logHighlightTimers.clear();
  }

  private latestChatKey(): string {
    const messages = this.store.snapshot()?.chat ?? [];
    const latest = messages.at(-1);

    return latest ? `${messages.length}:${latest.id ?? latest.createdAt}:${latest.userId}:${latest.message}` : '0';
  }

  private latestLogKey(): string {
    const entries = this.store.eventLog();
    const latest = entries.at(-1);

    return latest ? `${entries.length}:${latest.id}` : '0';
  }

  private refreshFocusedPlayerView(playerId: string): void {
    this.store.hideCardPreview();
    this.queueBattlefieldZoomReflow();
    queueMicrotask(() => {
      if (!this.destroyed && this.store.focusedPlayer()?.id === playerId) {
        this.queueBattlefieldZoomReflow();
      }
    });
    window.requestAnimationFrame(() => {
      if (!this.destroyed && this.store.focusedPlayer()?.id === playerId) {
        this.queueBattlefieldZoomReflow();
      }
    });
  }

  private reapplyFollowActiveTurnPlayerIfNeeded(focusedPlayerId: string): void {
    const activePlayerId = this.store.snapshot()?.turn.activePlayerId ?? null;
    if (!this.followActiveTurnPlayer() || !activePlayerId || activePlayerId === focusedPlayerId) {
      return;
    }

    this.syncFollowActiveTurnPlayer(activePlayerId);
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
