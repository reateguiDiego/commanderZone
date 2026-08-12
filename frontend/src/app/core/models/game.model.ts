import { User } from './user.model';
import { CardFace, CardImageUris } from './card.model';

export type GameZoneName = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command';
export type GameSpecialEntityTemplate = 'monarch' | 'initiative' | 'citys_blessing' | 'day_night' | 'the_ring' | 'emblem' | 'dungeon';
export type GameSpecialEntityScope = 'global' | 'player';
export type GameCardStatValue = number | string | null;
export type GamePowerToughnessValue = GameCardStatValue;
export type GamePrintedStatKind = 'NUMERIC' | 'FORMULA' | 'UNKNOWN_SYMBOLIC' | 'ABSENT';
export type GameStatsOverrideProvenance = 'manual' | 'token_creation' | 'copy_effect' | 'imported_legacy';
export interface GamePrintedStatsFace {
  faceKey: string;
  faceIndex: number;
  power: string | null;
  toughness: string | null;
  provenance?: 'printed' | 'token_creation' | 'copy_effect';
}
export interface GameManualStatsOverride {
  faceKey: string;
  faceIndex: number;
  power?: number | string;
  toughness?: number | string;
  provenance: GameStatsOverrideProvenance;
  updatedByPlayerId?: string | null;
  updatedAtVersion?: number | null;
}
export type GamePhase = 'MULLIGAN' | 'PLAYING' | 'FINISHED';
export type MulliganRule = 'LONDON' | 'VANCOUVER' | 'PARIS' | 'GENEROUS';
export type BottomOrderMode = 'NONE' | 'PLAYER_CHOSEN_ORDER' | 'RANDOM_SERVER_SIDE';
export type MulliganPlayerStatus = 'DECIDING' | 'BOTTOMING' | 'SCRYING' | 'READY';
export interface GameCardPixelPosition {
  x: number;
  y: number;
  unit?: 'px';
}

export interface GameCardRatioPosition {
  x: number;
  y: number;
  unit: 'ratio';
}

export type GameCardPosition = GameCardPixelPosition | GameCardRatioPosition;

export interface GameCardDungeonMarker {
  x: number;
  y: number;
}

export type GameCommandType =
  | 'game.concede'
  | 'game.close'
  | 'chat.message'
  | 'chat.reaction.toggled'
  | 'dice.rolled'
  | 'life.changed'
  | 'commander.damage.changed'
  | 'counter.changed'
  | 'card.counter.changed'
  | 'card.power_toughness.changed'
  | 'card.stats.override.set'
  | 'card.stats.override.clear'
  | 'card.moved'
  | 'cards.moved'
  | 'card.tapped'
  | 'cards.tapped.set'
  | 'card.position.changed'
  | 'card.dungeon_marker.changed'
  | 'cards.position.changed'
  | 'card.face_down.changed'
  | 'cards.face_down.set'
  | 'card.face.changed'
  | 'card.revealed'
  | 'hand.cards.reveal'
  | 'hand.cards.revoke'
  | 'card.token.created'
  | 'token.group.split'
  | 'token.group.merge'
  | 'token.group.remove_members'
  | 'token.group.dissolve'
  | 'token.group.state.set'
  | 'token.group.position.set'
  | 'token.group.move'
  | 'token.group.counter.changed'
  | 'token.group.power_toughness.set'
  | 'token.group.controller.changed'
  | 'card.token_copy.created'
  | 'card.controller.changed'
  | 'turn.changed'
  | 'battlefield.untap_all'
  | 'zone.changed'
  | 'zone.move_all'
  | 'zone.random_card.selected'
  | 'library.draw'
  | 'library.draw_many'
  | 'library.shuffle'
  | 'library.move_top'
  | 'library.reveal_top'
  | 'library.reveal'
  | 'library.view'
  | 'library.selection.move'
  | 'library.top.play_face_down'
  | 'library.play_top_revealed'
  | 'library.reorder_top'
  | 'stack.card_added'
  | 'stack.item_removed'
  | 'arrow.created'
  | 'arrow.removed'
  | 'attachment.created'
  | 'attachment.removed'
  | 'attachment.reordered'
  | 'battlefield.stack.created'
  | 'battlefield.stack.member_added'
  | 'battlefield.stack.member_removed'
  | 'battlefield.stack.reordered'
  | 'battlefield.stack.dissolved'
  | 'helper.created'
  | 'helper.updated'
  | 'helper.removed'
  | 'disconnect.vote';

export interface GameCardInstance {
  instanceId: string;
  ownerId?: string;
  controllerId?: string;
  scryfallId?: string;
  name: string;
  imageUris?: Record<string, string>;
  cardFaces?: CardFace[];
  hasRulings?: boolean;
  typeLine?: string | null;
  layout?: string | null;
  manaCost?: string | null;
  oracleText?: string | null;
  colorIdentity?: string[];
  power?: GamePowerToughnessValue;
  toughness?: GamePowerToughnessValue;
  loyalty?: GameCardStatValue;
  defense?: GameCardStatValue;
  saga?: number | null;
  defaultPower?: GamePowerToughnessValue;
  defaultToughness?: GamePowerToughnessValue;
  printedStats?: Record<string, GamePrintedStatsFace>;
  manualOverrides?: Record<string, GameManualStatsOverride>;
  defaultLoyalty?: GameCardStatValue;
  defaultDefense?: GameCardStatValue;
  tapped: boolean;
  faceDown?: boolean;
  activeFaceIndex?: number;
  hidden?: boolean;
  revealedTo?: string[];
  position?: GameCardPosition;
  dungeonMarker?: GameCardDungeonMarker | null;
  rotation?: number;
  counters?: Record<string, number>;
  zone?: GameZoneName;
  isToken?: boolean;
  isTokenCopy?: boolean;
  isCommander?: boolean;
}

export interface GameCompactCardRef {
  instanceId: string;
  cardKey?: string | null;
  printId?: string | null;
  cardVersion?: string | null;
  language?: string | null;
  viewerVisibility?: string | null;
  name?: string | null;
  hidden?: boolean;
  tapped?: boolean;
  zone?: GameZoneName;
}

export type GameZones = Record<GameZoneName, GameCardInstance[]>;
export type GameZoneCounts = Record<GameZoneName, number>;

export interface GameMulliganConfig {
  rule: MulliganRule;
  firstMulliganFree: boolean;
}

export interface GamePlayerMulliganState {
  rule?: MulliganRule;
  mulligansTaken: number;
  effectiveMulligans: number;
  drawCount?: number;
  bottomSelectionCount?: number;
  finalHandSize?: number;
  needsBottomSelection?: boolean;
  bottomOrderMode?: BottomOrderMode;
  needsScryAfterKeep?: boolean;
  canTakeAnotherMulligan?: boolean;
  status: MulliganPlayerStatus;
  ready: boolean;
  handCount?: number;
  scryCard?: GameCardInstance;
}

export interface GamePlayerState {
  user: User;
  status?: 'active' | 'defeated' | 'conceded';
  concededAt?: string | null;
	eliminationReason?: 'life' | 'commander_damage' | 'concede' | 'expelled' | null;
	eliminatedAtVersion?: number | null;
	sourcePlayerId?: string | null;
	commanderInstanceId?: string | null;
  deckName?: string | null;
  colorIdentity?: string[];
  backgroundName?: string;
  sleevesName?: string;
  playTopLibraryRevealed?: boolean;
  revealedLibraryTo?: string[];
  libraryVisibilityEpoch?: number;
  libraryWindow?: GameLibraryWindowState | null;
  life: number;
  zones: GameZones;
  zoneCounts?: GameZoneCounts;
  handCount?: number;
  mulligan?: GamePlayerMulliganState;
  commanderDamage: Record<string, number>;
  counters: Record<string, number>;
}

export interface GameTurn {
  activePlayerId: string | null;
  phase: string;
  number: number;
}

export type ChatReactionType = 'like' | 'dislike' | 'love' | 'laugh' | 'angry' | 'vomit' | 'cry';

export interface ChatReactionEntry {
  userId: string;
  displayName: string;
  createdAt: string;
}

export type ChatReactions = Partial<Record<ChatReactionType, ChatReactionEntry[]>>;

export interface ChatMessage {
  id?: string;
  userId: string;
  displayName: string;
  message: string;
  targetPlayerId?: string | null;
  targetDisplayName?: string | null;
  createdAt: string;
  reactions?: ChatReactions;
}

export interface GameLogEntry {
  id: string;
  type: string;
  message?: string;
  version?: number;
  createdAt?: string;
  actorId?: string | null;
  displayName?: string | null;
  i18nKey?: string;
  params?: Record<string, unknown>;
  refs?: {
    players?: Record<string, {
      id: string;
      displayName: string;
    }>;
    cards?: Record<string, {
      instanceId?: string;
      cardKey?: string;
      cardRef?: string;
      name?: string;
      visibility: 'public' | 'hidden';
    }>;
  };
  visibility?: 'public' | 'private' | 'group';
  cardNames?: string[];
  cardInstanceId?: string;
  cardPlayerId?: string;
  cardZone?: GameZoneName;
}

export interface GameStackItem {
  id: string;
  kind: string;
  card?: GameCardInstance;
  createdAt: string;
}

export interface GameArrow {
  id: string;
  ownerId?: string;
  fromInstanceId: string;
  toInstanceId: string;
  color: string;
  createdAt: string;
}

export interface GameAttachment {
  id: string;
  relationType?: 'attachment';
  ownerId?: string;
  ownerPlayerId?: string;
  equipmentInstanceId: string;
  attachedToInstanceId: string;
  order?: number;
  effectVersion?: number;
  createdAtVersion?: number;
  createdAt: string;
}

export interface GameLibraryWindowState {
  windowId: string;
  expectedEpoch: number;
  openedAtVersion: number;
  status: 'active' | 'consumed' | 'stale' | 'closed';
  reason?: string | null;
}

/** Visual battlefield grouping; deliberately distinct from GameStackItem. */
export interface GameBattlefieldStack {
  id: string;
  relationType: 'battlefield_stack';
  rootInstanceId: string;
  orderedMemberIds: string[];
  stackKind: 'land' | 'generic';
  createdByPlayerId?: string | null;
  effectVersion: number;
  createdAtVersion?: number;
}

/** Viewer-safe authoritative token grouping; quantity is derived from canonical membership server-side. */
export interface GameTokenGroupView {
  groupId: string;
  rootRef: string;
  memberRefs?: string[];
  quantity: number;
  revision: number;
  position: GameCardRatioPosition;
  faceDown?: boolean;
  tapped?: boolean;
  rotation?: number;
  /** Present only when the viewer is authorized for the canonical root. */
  counters?: Record<string, number>;
  mutableStats?: Record<string, unknown>;
  controllerId?: string;
  effectVersion: 1;
}

export interface GameSpecialEntityCardRef {
  scryfallId: string;
  name: string;
  imageUris?: CardImageUris;
  cardFaces?: CardFace[];
  typeLine?: string | null;
  oracleText?: string | null;
  layout?: string | null;
}

export interface GameSpecialEntity {
  id: string;
  template: GameSpecialEntityTemplate;
  scope: GameSpecialEntityScope;
  ownerPlayerId: string | null;
  card: GameSpecialEntityCardRef | null;
  state: Record<string, unknown>;
  createdAt: string;
}

export type GameRematchVote = 'play_again' | 'leave';

export interface GameRematchVoteState {
  playerId: string;
  displayName: string;
  vote: GameRematchVote;
  votedAt: string;
}

export interface GameRematchState {
  votes: Record<string, GameRematchVoteState>;
}

export type GameDisconnectVoteChoice = 'wait' | 'expel';
export type GameDisconnectVoteStatus = 'open' | 'waiting' | 'passed' | 'rejected' | 'cancelled' | 'expired' | 'executed' | 'resolved_wait' | 'resolved_expel';

export interface GamePlayerPresenceState {
  playerId: string;
  connected: boolean;
  disconnectedAt?: string | null;
  lastSeenAt?: string | null;
  activeConnectionCount?: number;
}

export interface GameDisconnectCooldownState {
  targetPlayerId: string;
  voteId: string;
  reason: string;
  cooldownUntil: string;
}

export interface GameDisconnectVoteEntry {
  playerId: string;
  displayName: string;
  vote: GameDisconnectVoteChoice;
  decision?: GameDisconnectVoteChoice;
  votedAt: string;
}

export interface GameDisconnectVoteState {
	voteId?: string;
  targetPlayerId: string | null;
	openedByPlayerId?: string | null;
  status: GameDisconnectVoteStatus;
	eligibleVoterIds?: string[];
	requiredVotes?: number;
  openedAt: string | null;
	expiresAt?: string | null;
  deadlineAt: string | null;
	resolvedAt?: string | null;
  cooldownUntil: string | null;
	resolution?: string | null;
	effectVersion?: number;
  votes: Record<string, GameDisconnectVoteEntry>;
	votesByPlayerId?: Record<string, GameDisconnectVoteEntry>;
}

export interface GameSnapshot {
  version: number;
  ownerId?: string;
  gamePhase?: GamePhase;
  mulligan?: GameMulliganConfig;
  players: Record<string, GamePlayerState>;
  turn: GameTurn;
	turnOrder?: string[];
	winnerPlayerId?: string | null;
	resultState?: 'survivor' | 'no_active_players' | null;
	finishedReason?: 'last_active' | 'no_active_players' | string | null;
  timer?: {
    mode: 'none' | 'turn';
    status: 'idle' | 'running' | 'paused';
    durationSeconds: number | null;
    remainingSeconds: number | null;
  };
  stack: GameStackItem[];
  arrows: GameArrow[];
  attachments?: GameAttachment[];
  battlefieldStacks?: GameBattlefieldStack[];
  tokenGroups?: GameTokenGroupView[];
  specialEntities?: GameSpecialEntity[];
  chat: ChatMessage[];
  eventLog: GameLogEntry[];
  rematch?: GameRematchState;
  disconnectVote?: GameDisconnectVoteState | null;
	presence?: Record<string, GamePlayerPresenceState>;
	disconnectCooldowns?: Record<string, GameDisconnectCooldownState>;
  createdAt: string;
  updatedAt?: string;
  counters?: Record<string, Record<string, number>>;
}

export interface Game {
  id: string;
  status: 'active' | string;
  snapshot: GameSnapshot;
}

export interface GameEvent {
  id: string;
  type: GameCommandType | string;
  payload: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
}

export interface GameCommand<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  type: GameCommandType;
  payload: TPayload;
  clientActionId?: string;
}

export interface MercureGameEvent {
  gameId: string;
  event: GameEvent;
  version: number | null;
}

export interface GameZoneResponse {
  gameId: string;
  playerId: string;
  zone: GameZoneName;
  total: number;
  data: GameCardInstance[];
}

