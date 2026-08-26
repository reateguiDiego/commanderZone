import { Injectable, signal } from '@angular/core';
import type { CardFace, CardImageUris } from '../../../../../core/models/card.model';
import type {
  ChatMessage,
  ChatReactions,
  GameArrow,
  GameAttachment,
  GameCompactCardRef,
  GameCardDungeonMarker,
  GameCardInstance,
  GameControlPlaneState,
  GameDisconnectVotes,
  GameLogEntry,
  GameMulliganConfig,
  GamePlayerMulliganState,
  GamePlayerState,
  GameRematchState,
  GameSnapshot,
  GameSpecialEntity,
  GameTurn,
  GameZoneName,
} from '../../../../../core/models/game.model';
import type {
  BootstrapInstanceV2,
  BootstrapPlayerV2,
  BootstrapStackItemV2,
  BootstrapStaticCardV2,
  BootstrapV2,
  GameplayPatchV2Operation,
  LegacyCardPatchPayload,
  PatchEnvelopeV2,
} from '../../../../../core/models/game-v2.model';

type ZoneMap = Record<GameZoneName, string[]>;
type ZoneCountMap = Record<GameZoneName, number>;

export interface GameTableNormalizedV2GameState {
  id: string;
  status: string;
  controlPlaneRevision: number;
  winnerPlayerId: string | null;
  finishedAt: string | null;
  finishReason: string | null;
  allDisconnectedSince: string | null;
  nextLifecycleAt: string | null;
  viewerId: string;
  ownerId: string | null;
  version: number;
  gamePhase: string | null;
  mulligan: GameMulliganConfig | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastDiceResult?: {
    playerId?: string;
    kind?: string;
    result: number | string;
    createdAt?: string;
  } | null;
  disconnectVotes: GameDisconnectVotes;
  rematch?: GameRematchState | null;
}

export interface GameTableNormalizedV2PlayerState {
  playerId: string;
  user: BootstrapPlayerV2['user'];
  displayName: string;
  life: number;
  isOnline?: boolean;
  status: string;
  handCount: number;
  zoneCounts: Partial<Record<GameZoneName, number>>;
  commanderDamage: Record<string, number>;
  counters: Record<string, number>;
  deckName: string | null;
  colorIdentity: string[];
  backgroundName: string | null;
  sleevesName: string | null;
  concededAt?: string | null;
  mulligan?: GamePlayerMulliganState;
  playTopLibraryRevealed?: boolean;
  topLibraryRevealMarker?: boolean;
  topLibraryRevealedTo?: string[];
  revealedLibraryTo?: string[];
  libraryShuffleRevision?: number;
  libraryTopRevealEpoch?: number;
  revealedHandIndexes?: number[];
}

export interface GameTableNormalizedV2RelationsState {
  arrows: Record<string, GameArrow>;
  attachments: Record<string, GameAttachment>;
  specialEntities: Record<string, GameSpecialEntity>;
  indexes: {
    arrowsBySource: Record<string, string[]>;
    arrowsByTarget: Record<string, string[]>;
    attachmentsByEquipment: Record<string, string[]>;
    attachmentsByTarget: Record<string, string[]>;
  };
}

export interface GameTableNormalizedV2ChatState {
  byId: Record<string, ChatMessage>;
  order: string[];
  cursor: string | null;
}

export interface GameTableNormalizedV2LogState {
  byId: Record<string, GameLogEntry>;
  order: string[];
  cursor: string | null;
}

export interface GameTableNormalizedV2StackState {
  byId: Record<string, BootstrapStackItemV2>;
  order: string[];
}

export interface GameTableNormalizedV2State {
  game: GameTableNormalizedV2GameState;
  players: Record<string, GameTableNormalizedV2PlayerState>;
  sharedCounters: Record<string, Record<string, number>>;
  turn: GameTurn;
  instances: Record<string, BootstrapInstanceV2>;
  zones: Record<string, ZoneMap>;
  zoneCounts: Record<string, ZoneCountMap>;
  relations: GameTableNormalizedV2RelationsState;
  stack: GameTableNormalizedV2StackState;
  staticCards: Record<string, BootstrapStaticCardV2>;
  chat: GameTableNormalizedV2ChatState;
  log: GameTableNormalizedV2LogState;
  lastAppliedVersion: number;
  pendingOptimisticActions: Record<string, { createdAt: string }>;
}

export type GameTableNormalizedV2ApplyFailureReason = 'version_gap' | 'target_not_found' | 'invalid_operation' | 'missing_state';

export type GameTableNormalizedV2ApplyResult =
  | { status: 'applied'; state: GameTableNormalizedV2State; snapshot: GameSnapshot }
  | { status: 'ignored'; state: GameTableNormalizedV2State; snapshot: GameSnapshot; reason: 'duplicate_or_late_version' }
  | { status: 'resync_required'; state: GameTableNormalizedV2State | null; snapshot: GameSnapshot | null; reason: GameTableNormalizedV2ApplyFailureReason };

type GameTableNormalizedV2ApplyInternalResult =
  | { status: 'applied'; state: GameTableNormalizedV2State }
  | { status: 'ignored'; state: GameTableNormalizedV2State; reason: 'duplicate_or_late_version' }
  | { status: 'resync_required'; state: GameTableNormalizedV2State; reason: GameTableNormalizedV2ApplyFailureReason };

interface NormalizeIncomingCardContext {
  instances: Record<string, BootstrapInstanceV2>;
  staticCards: Record<string, BootstrapStaticCardV2>;
}

const ZONE_NAMES: readonly GameZoneName[] = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];

@Injectable()
export class GameTableNormalizedV2Store {
  readonly state = signal<GameTableNormalizedV2State | null>(null);
  private readonly snapshotProjector = new GameTableSnapshotProjector();

  clear(): void {
    this.state.set(null);
    this.snapshotProjector.clear();
  }

  applyBootstrap(bootstrap: BootstrapV2): GameSnapshot {
    this.snapshotProjector.clear();
    const nextState = createGameTableNormalizedV2State(bootstrap, this.state()?.pendingOptimisticActions ?? {});
    this.state.set(nextState);

    return this.snapshotProjector.hydrate(nextState);
  }

  applyPatch(patch: PatchEnvelopeV2): GameTableNormalizedV2ApplyResult {
    const currentState = this.state();
    if (!currentState) {
      return { status: 'resync_required', state: null, snapshot: null, reason: 'missing_state' };
    }

    const result = applyPatchEnvelopeV2(currentState, patch);
    if (result.status === 'resync_required') {
      return { ...result, snapshot: null };
    }

    let snapshot: GameSnapshot;
    try {
      snapshot = this.snapshotProjector.hydrate(result.state);
    } catch (error) {
      console.warn('[CommanderZone normalized v2] snapshot hydration failed after patch.v2', error);
      return { status: 'resync_required', state: currentState, snapshot: null, reason: 'invalid_operation' };
    }

    this.state.set(result.state);
    return {
      ...result,
      snapshot,
    };
  }

  mergeStaticCards(staticCards: Record<string, BootstrapStaticCardV2>): GameSnapshot | null {
    const currentState = this.state();
    const entries = Object.entries(staticCards);
    if (!currentState || entries.length === 0) {
      return null;
    }

    const nextStaticCards = { ...currentState.staticCards };
    for (const [cardRef, staticCard] of entries) {
      nextStaticCards[cardRef] = mergeStaticCard(nextStaticCards[cardRef], staticCard);
    }

    const nextState = { ...currentState, staticCards: nextStaticCards };
    this.state.set(nextState);

    return this.snapshotProjector.hydrate(nextState);
  }

  prependLogEntries(entries: readonly GameLogEntry[], maximumEntries = 250): GameSnapshot | null {
    const currentState = this.state();
    if (!currentState || entries.length === 0) {
      return null;
    }

    const log = mergeLogEntries(currentState.log, entries, maximumEntries, 'oldest');
    const nextState = { ...currentState, log };
    this.state.set(nextState);

    return this.snapshotProjector.hydrate(nextState);
  }

  appendLogEntries(entries: readonly GameLogEntry[], maximumEntries = 250): GameSnapshot | null {
    const currentState = this.state();
    if (!currentState || entries.length === 0) {
      return null;
    }

    const log = mergeLogEntries(currentState.log, entries, maximumEntries, 'newest');
    const nextState = { ...currentState, log };
    this.state.set(nextState);

    return this.snapshotProjector.hydrate(nextState);
  }

  replaceLogEntries(entries: readonly GameLogEntry[]): GameSnapshot | null {
    const currentState = this.state();
    if (!currentState) {
      return null;
    }

    const nextState = { ...currentState, log: createLogState(entries, null) };
    this.state.set(nextState);

    return this.snapshotProjector.hydrate(nextState);
  }

  prependChatMessages(entries: readonly ChatMessage[], maximumEntries = 250): GameSnapshot | null {
    const currentState = this.state();
    if (!currentState || entries.length === 0) {
      return null;
    }

    const nextState = { ...currentState, chat: mergeChatMessages(currentState.chat, entries, maximumEntries, 'oldest') };
    this.state.set(nextState);

    return this.snapshotProjector.hydrate(nextState);
  }

  appendChatMessages(entries: readonly ChatMessage[], maximumEntries = 250): GameSnapshot | null {
    const currentState = this.state();
    if (!currentState || entries.length === 0) {
      return null;
    }

    const nextState = { ...currentState, chat: mergeChatMessages(currentState.chat, entries, maximumEntries, 'newest') };
    this.state.set(nextState);

    return this.snapshotProjector.hydrate(nextState);
  }

  replaceChatMessages(entries: readonly ChatMessage[]): GameSnapshot | null {
    const currentState = this.state();
    if (!currentState) {
      return null;
    }

    const nextState = { ...currentState, chat: createChatState(entries, null) };
    this.state.set(nextState);

    return this.snapshotProjector.hydrate(nextState);
  }

  /** Applies Symfony control-plane state without advancing a Go gameplay version. */
  applyControlPlane(controlPlane: GameControlPlaneState): GameSnapshot | null {
    const currentState = this.state();
    if (!currentState) {
      return null;
    }

    const nextState: GameTableNormalizedV2State = {
      ...currentState,
      game: {
        ...currentState.game,
        controlPlaneRevision: controlPlane.controlPlaneRevision,
        status: controlPlane.status,
        winnerPlayerId: controlPlane.winnerPlayerId,
        finishedAt: controlPlane.finishedAt,
        finishReason: controlPlane.finishReason,
        allDisconnectedSince: controlPlane.allDisconnectedSince,
        nextLifecycleAt: controlPlane.nextLifecycleAt,
        ownerId: controlPlane.ownerId,
        rematch: cloneRematchState(controlPlane.rematch),
      },
    };
    this.state.set(nextState);

    return this.snapshotProjector.hydrate(nextState);
  }
}

export function createGameTableNormalizedV2State(
  bootstrap: BootstrapV2,
  pendingOptimisticActions: Record<string, { createdAt: string }> = {},
): GameTableNormalizedV2State {
  const zones = Object.fromEntries(
    Object.keys(bootstrap.players).map((playerId) => [playerId, emptyZones()]),
  ) as Record<string, ZoneMap>;
  const zoneCounts = Object.fromEntries(
    Object.keys(bootstrap.players).map((playerId) => [playerId, emptyZoneCounts()]),
  ) as Record<string, ZoneCountMap>;

  for (const zone of Object.values(bootstrap.zones)) {
    zones[zone.playerId] ??= emptyZones();
    // Runtime snapshots store libraries with the top card at the tail. The
    // normalized client state keeps its known library top at index zero so
    // bootstrap and realtime reveal/reorder patches share one invariant.
    zones[zone.playerId][zone.name] = zone.name === 'library'
      ? [...zone.instanceIds].reverse()
      : [...zone.instanceIds];
    zoneCounts[zone.playerId] ??= emptyZoneCounts();
    zoneCounts[zone.playerId][zone.name] = Math.max(0, bootstrap.zoneCounts[zone.zoneId] ?? zone.instanceIds.length);
  }

  const relations = createRelationsState(bootstrap.relations.arrows, bootstrap.relations.attachments, bootstrap.relations.specialEntities);
  const stack = createStackState(bootstrap.relations.stack);
  const chat = createChatState(bootstrap.chat, bootstrap.chatCursor ?? null);
  const log = createLogState(bootstrap.eventLog, bootstrap.logCursor ?? null);
  const controlPlane = bootstrap.game.controlPlane;

  return {
    game: {
      id: bootstrap.game.id,
      status: controlPlane?.status ?? bootstrap.game.status,
      controlPlaneRevision: controlPlane?.controlPlaneRevision ?? bootstrap.game.controlPlaneRevision ?? 0,
      winnerPlayerId: controlPlane?.winnerPlayerId ?? bootstrap.game.winnerPlayerId ?? null,
      finishedAt: controlPlane?.finishedAt ?? bootstrap.game.finishedAt ?? null,
      finishReason: controlPlane?.finishReason ?? bootstrap.game.finishReason ?? null,
      allDisconnectedSince: controlPlane?.allDisconnectedSince ?? bootstrap.game.allDisconnectedSince ?? null,
      nextLifecycleAt: controlPlane?.nextLifecycleAt ?? bootstrap.game.nextLifecycleAt ?? null,
      viewerId: bootstrap.game.viewerId,
      ownerId: controlPlane?.ownerId ?? bootstrap.game.ownerId ?? null,
      version: bootstrap.game.version,
      gamePhase: bootstrap.game.gamePhase ?? null,
      mulligan: bootstrap.game.mulligan ?? null,
      createdAt: bootstrap.game.createdAt ?? null,
      updatedAt: bootstrap.game.updatedAt ?? null,
      disconnectVotes: cloneDisconnectVotes(bootstrap.game.disconnectVotes ?? {}),
      rematch: controlPlane?.rematch ?? bootstrap.game.rematch ?? null,
      lastDiceResult: null,
    },
    players: Object.fromEntries(
      Object.entries(bootstrap.players).map(([playerId, player]) => [playerId, normalizePlayer(player)]),
    ),
    sharedCounters: Object.fromEntries(
      Object.entries(bootstrap.sharedCounters ?? {}).map(([scope, counters]) => [scope, { ...counters }]),
    ),
    turn: { ...bootstrap.turn },
    instances: Object.fromEntries(
      Object.entries(bootstrap.instances).map(([instanceId, instance]) => [instanceId, normalizeInstance(instance)]),
    ),
    zones,
    zoneCounts,
    relations,
    stack,
    staticCards: Object.fromEntries(
      Object.entries(bootstrap.staticCards).map(([cardRef, card]) => [cardRef, normalizeStaticCard(card)]),
    ),
    chat,
    log,
    lastAppliedVersion: bootstrap.game.version,
    pendingOptimisticActions: { ...pendingOptimisticActions },
  };
}

interface HydratedCardProjection {
  readonly instance: BootstrapInstanceV2;
  readonly staticCard: BootstrapStaticCardV2 | undefined;
  readonly zone: GameZoneName;
  readonly card: GameCardInstance | null;
}

interface HydratedZoneProjection {
  readonly instanceIds: readonly string[];
  readonly cards: GameCardInstance[];
}

interface HydratedPlayerProjection {
  readonly source: GameTableNormalizedV2PlayerState;
  readonly zoneCounts: ZoneCountMap;
  readonly zones: GamePlayerState['zones'];
  readonly player: GamePlayerState;
}

/**
 * Projects the normalized runtime state into the legacy snapshot shape while
 * preserving references for unchanged players, zones and card instances.
 * The view still receives a fresh root snapshot for the new version, but
 * OnPush card components no longer receive new inputs for unrelated patches.
 */
export class GameTableSnapshotProjector {
  private readonly cardProjections = new Map<string, HydratedCardProjection>();
  private readonly zoneProjections = new Map<string, HydratedZoneProjection>();
  private readonly playerProjections = new Map<string, HydratedPlayerProjection>();
  private playersSource: GameTableNormalizedV2State['players'] | null = null;
  private playerZonesSource: GameTableNormalizedV2State['zones'] | null = null;
  private playerZoneCountsSource: GameTableNormalizedV2State['zoneCounts'] | null = null;
  private playerInstancesSource: GameTableNormalizedV2State['instances'] | null = null;
  private playerStaticCardsSource: GameTableNormalizedV2State['staticCards'] | null = null;
  private players: Record<string, GamePlayerState> | null = null;
  private sharedCountersSource: GameTableNormalizedV2State['sharedCounters'] | null = null;
  private sharedCounters: Record<string, Record<string, number>> | null = null;
  private turnSource: GameTurn | null = null;
  private turn: GameTurn | null = null;
  private stackSource: GameTableNormalizedV2State['stack'] | null = null;
  private stackInstancesSource: GameTableNormalizedV2State['instances'] | null = null;
  private stackStaticCardsSource: GameTableNormalizedV2State['staticCards'] | null = null;
  private stack: GameSnapshot['stack'] | null = null;
  private arrowsSource: GameTableNormalizedV2State['relations']['arrows'] | null = null;
  private arrows: GameArrow[] | null = null;
  private attachmentsSource: GameTableNormalizedV2State['relations']['attachments'] | null = null;
  private attachments: GameAttachment[] | null = null;
  private specialEntitiesSource: GameTableNormalizedV2State['relations']['specialEntities'] | null = null;
  private specialEntities: GameSpecialEntity[] | null = null;
  private chatSource: GameTableNormalizedV2State['chat'] | null = null;
  private chat: ChatMessage[] | null = null;
  private logSource: GameTableNormalizedV2State['log'] | null = null;
  private log: GameLogEntry[] | null = null;
  private disconnectVotesSource: GameDisconnectVotes | null = null;
  private disconnectVotes: GameDisconnectVotes | null = null;
  private rematchSource: GameRematchState | null = null;
  private rematch: GameRematchState | null = null;

  clear(): void {
    this.cardProjections.clear();
    this.zoneProjections.clear();
    this.playerProjections.clear();
    this.playersSource = null;
    this.playerZonesSource = null;
    this.playerZoneCountsSource = null;
    this.playerInstancesSource = null;
    this.playerStaticCardsSource = null;
    this.players = null;
    this.sharedCountersSource = null;
    this.sharedCounters = null;
    this.turnSource = null;
    this.turn = null;
    this.stackSource = null;
    this.stackInstancesSource = null;
    this.stackStaticCardsSource = null;
    this.stack = null;
    this.arrowsSource = null;
    this.arrows = null;
    this.attachmentsSource = null;
    this.attachments = null;
    this.specialEntitiesSource = null;
    this.specialEntities = null;
    this.chatSource = null;
    this.chat = null;
    this.logSource = null;
    this.log = null;
    this.disconnectVotesSource = null;
    this.disconnectVotes = null;
    this.rematchSource = null;
    this.rematch = null;
  }

  hydrate(state: GameTableNormalizedV2State): GameSnapshot {
    return {
      version: state.lastAppliedVersion,
      controlPlaneRevision: state.game.controlPlaneRevision,
      ownerId: state.game.ownerId ?? undefined,
      status: state.game.status,
      winnerPlayerId: state.game.winnerPlayerId,
      finishedAt: state.game.finishedAt,
      finishReason: state.game.finishReason,
      allDisconnectedSince: state.game.allDisconnectedSince,
      nextLifecycleAt: state.game.nextLifecycleAt,
      gamePhase: (state.game.gamePhase as GameSnapshot['gamePhase']) ?? undefined,
      mulligan: state.game.mulligan ?? undefined,
      players: this.hydratePlayers(state),
      counters: this.hydrateSharedCounters(state.sharedCounters),
      turn: this.hydrateTurn(state.turn),
      stack: this.hydrateStack(state),
      arrows: this.hydrateArrows(state.relations.arrows),
      attachments: this.hydrateAttachments(state.relations.attachments),
      specialEntities: this.hydrateSpecialEntities(state.relations.specialEntities),
      chat: this.hydrateChat(state.chat),
      eventLog: this.hydrateLog(state.log),
      rematch: this.hydrateRematch(state.game.rematch),
      disconnectVotes: this.hydrateDisconnectVotes(state.game.disconnectVotes),
      createdAt: state.game.createdAt ?? new Date(0).toISOString(),
      updatedAt: state.game.updatedAt ?? undefined,
    };
  }

  private hydratePlayers(state: GameTableNormalizedV2State): Record<string, GamePlayerState> {
    if (
      this.playersSource === state.players
      && this.playerZonesSource === state.zones
      && this.playerZoneCountsSource === state.zoneCounts
      && this.playerInstancesSource === state.instances
      && this.playerStaticCardsSource === state.staticCards
      && this.players
    ) {
      return this.players;
    }

    const entries = Object.entries(state.players).map(([playerId, player]) => [
      playerId,
      this.hydratePlayer(state, playerId, player),
    ] as const);
    if (this.players && this.samePlayerEntries(entries, this.players)) {
      this.recordPlayerSources(state);
      return this.players;
    }

    this.recordPlayerSources(state);
    this.players = Object.fromEntries(entries);
    return this.players;
  }

  private recordPlayerSources(state: GameTableNormalizedV2State): void {
    this.playersSource = state.players;
    this.playerZonesSource = state.zones;
    this.playerZoneCountsSource = state.zoneCounts;
    this.playerInstancesSource = state.instances;
    this.playerStaticCardsSource = state.staticCards;
  }

  private hydratePlayer(
    state: GameTableNormalizedV2State,
    playerId: string,
    player: GameTableNormalizedV2PlayerState,
  ): GamePlayerState {
    const cached = this.playerProjections.get(playerId);
    const zones = cached && this.canReusePlayerZones(state)
      ? cached.zones
      : this.hydratePlayerZones(state, playerId);
    const zoneCounts = state.zoneCounts[playerId] ?? emptyZoneCounts();
    if (cached && cached.source === player && cached.zoneCounts === zoneCounts && cached.zones === zones) {
      return cached.player;
    }

    const hydratedPlayer = hydratePlayerState(state, playerId, player, zones);
    this.playerProjections.set(playerId, { source: player, zoneCounts, zones, player: hydratedPlayer });
    return hydratedPlayer;
  }

  private canReusePlayerZones(state: GameTableNormalizedV2State): boolean {
    return this.playerZonesSource === state.zones
      && this.playerInstancesSource === state.instances
      && this.playerStaticCardsSource === state.staticCards;
  }

  private hydratePlayerZones(state: GameTableNormalizedV2State, playerId: string): GamePlayerState['zones'] {
    const library = this.hydrateZone(state, playerId, 'library');
    const hand = this.hydrateZone(state, playerId, 'hand');
    const battlefield = this.hydrateZone(state, playerId, 'battlefield');
    const graveyard = this.hydrateZone(state, playerId, 'graveyard');
    const exile = this.hydrateZone(state, playerId, 'exile');
    const command = this.hydrateZone(state, playerId, 'command');
    const cached = this.playerProjections.get(playerId)?.zones;
    if (
      cached
      && cached.library === library
      && cached.hand === hand
      && cached.battlefield === battlefield
      && cached.graveyard === graveyard
      && cached.exile === exile
      && cached.command === command
    ) {
      return cached;
    }

    return { library, hand, battlefield, graveyard, exile, command };
  }

  private hydrateZone(
    state: GameTableNormalizedV2State,
    playerId: string,
    zone: GameZoneName,
  ): GameCardInstance[] {
    const instanceIds = state.zones[playerId]?.[zone] ?? [];
    const cacheKey = `${playerId}:${zone}`;
    const cached = this.zoneProjections.get(cacheKey);
    if (cached && cached.instanceIds === instanceIds && this.zoneCardsMatch(state, instanceIds, zone, cached.cards)) {
      return cached.cards;
    }

    const cards = instanceIds
      .map((instanceId) => this.hydrateCard(state, instanceId, zone))
      .filter(isCardInstance);
    this.zoneProjections.set(cacheKey, { instanceIds, cards });
    return cards;
  }

  private zoneCardsMatch(
    state: GameTableNormalizedV2State,
    instanceIds: readonly string[],
    zone: GameZoneName,
    cards: GameCardInstance[],
  ): boolean {
    let cardIndex = 0;
    for (const instanceId of instanceIds) {
      const card = this.hydrateCard(state, instanceId, zone);
      if (!card) {
        continue;
      }
      if (cards[cardIndex] !== card) {
        return false;
      }
      cardIndex += 1;
    }

    return cardIndex === cards.length;
  }

  private hydrateCard(
    state: GameTableNormalizedV2State,
    instanceId: string,
    zone: GameZoneName,
  ): GameCardInstance | null {
    const instance = state.instances[instanceId];
    if (!instance) {
      return null;
    }

    const staticCard = state.staticCards[instance.cardRef];
    const cached = this.cardProjections.get(instanceId);
    if (cached && cached.instance === instance && cached.staticCard === staticCard && cached.zone === zone) {
      return cached.card;
    }

    const card = hydrateCardInstance(state, instanceId, zone);
    this.cardProjections.set(instanceId, { instance, staticCard, zone, card });
    return card;
  }

  private hydrateSharedCounters(source: GameTableNormalizedV2State['sharedCounters']): Record<string, Record<string, number>> {
    if (this.sharedCountersSource === source && this.sharedCounters) {
      return this.sharedCounters;
    }

    this.sharedCountersSource = source;
    this.sharedCounters = Object.fromEntries(Object.entries(source).map(([scope, counters]) => [scope, { ...counters }]));
    return this.sharedCounters;
  }

  private hydrateTurn(source: GameTurn): GameTurn {
    if (this.turnSource === source && this.turn) {
      return this.turn;
    }

    this.turnSource = source;
    this.turn = { ...source };
    return this.turn;
  }

  private hydrateStack(state: GameTableNormalizedV2State): GameSnapshot['stack'] {
    if (
      this.stackSource === state.stack
      && this.stackInstancesSource === state.instances
      && this.stackStaticCardsSource === state.staticCards
      && this.stack
    ) {
      return this.stack;
    }

    this.stackSource = state.stack;
    this.stackInstancesSource = state.instances;
    this.stackStaticCardsSource = state.staticCards;
    this.stack = state.stack.order
      .map((stackId) => hydrateStackItem(state, state.stack.byId[stackId]))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    return this.stack;
  }

  private hydrateArrows(source: GameTableNormalizedV2State['relations']['arrows']): GameArrow[] {
    if (this.arrowsSource === source && this.arrows) {
      return this.arrows;
    }
    this.arrowsSource = source;
    this.arrows = Object.values(source);
    return this.arrows;
  }

  private hydrateAttachments(source: GameTableNormalizedV2State['relations']['attachments']): GameAttachment[] {
    if (this.attachmentsSource === source && this.attachments) {
      return this.attachments;
    }
    this.attachmentsSource = source;
    this.attachments = Object.values(source);
    return this.attachments;
  }

  private hydrateSpecialEntities(source: GameTableNormalizedV2State['relations']['specialEntities']): GameSpecialEntity[] {
    if (this.specialEntitiesSource === source && this.specialEntities) {
      return this.specialEntities;
    }
    this.specialEntitiesSource = source;
    this.specialEntities = Object.values(source);
    return this.specialEntities;
  }

  private hydrateChat(source: GameTableNormalizedV2State['chat']): ChatMessage[] {
    if (this.chatSource === source && this.chat) {
      return this.chat;
    }
    this.chatSource = source;
    this.chat = source.order.map((id) => source.byId[id]).filter((message): message is ChatMessage => Boolean(message));
    return this.chat;
  }

  private hydrateLog(source: GameTableNormalizedV2State['log']): GameLogEntry[] {
    if (this.logSource === source && this.log) {
      return this.log;
    }
    this.logSource = source;
    this.log = source.order.map((id) => source.byId[id]).filter((entry): entry is GameLogEntry => Boolean(entry));
    return this.log;
  }

  private hydrateDisconnectVotes(source: GameDisconnectVotes): GameDisconnectVotes {
    if (this.disconnectVotesSource === source && this.disconnectVotes) {
      return this.disconnectVotes;
    }
    this.disconnectVotesSource = source;
    this.disconnectVotes = cloneDisconnectVotes(source);
    return this.disconnectVotes;
  }

  private hydrateRematch(source: GameRematchState | null | undefined): GameRematchState | undefined {
    if (!source) {
      return undefined;
    }
    if (this.rematchSource === source && this.rematch) {
      return this.rematch;
    }
    this.rematchSource = source;
    this.rematch = cloneRematchState(source);
    return this.rematch;
  }

  private samePlayerEntries(
    entries: ReadonlyArray<readonly [string, GamePlayerState]>,
    players: Record<string, GamePlayerState>,
  ): boolean {
    const playerIds = Object.keys(players);
    return entries.length === playerIds.length && entries.every(([playerId, player]) => players[playerId] === player);
  }
}

export function hydrateGameSnapshotFromV2State(state: GameTableNormalizedV2State): GameSnapshot {
  return new GameTableSnapshotProjector().hydrate(state);
}

export function applyPatchEnvelopeV2(
  state: GameTableNormalizedV2State,
  patch: PatchEnvelopeV2,
): GameTableNormalizedV2ApplyInternalResult {
  if (patch.version <= state.lastAppliedVersion) {
    if (
      patch.version === state.lastAppliedVersion
      && (isSameVersionStreamPatch(patch) || isSameVersionVisibilityMergePatch(patch))
    ) {
      return applySameVersionPatch(state, patch);
    }

    return { status: 'ignored', state, reason: 'duplicate_or_late_version' };
  }

  if (patch.version !== state.lastAppliedVersion + 1) {
      return { status: 'resync_required', state, reason: 'version_gap' };
  }

  let nextState = state;
  for (const operation of patch.ops) {
    const result = applyOperation(nextState, normalizePatchOperation(operation));
    if (result.status === 'failed') {
      return { status: 'resync_required', state, reason: result.reason };
    }

    nextState = result.state;
  }

  nextState = recordLibraryShuffleRevisions(nextState, patch.ops, patch.version);

  nextState = {
    ...nextState,
    game: {
      ...nextState.game,
      version: patch.version,
    },
    lastAppliedVersion: patch.version,
    pendingOptimisticActions: patch.ackClientActionId
      ? omitKey(nextState.pendingOptimisticActions, patch.ackClientActionId)
      : nextState.pendingOptimisticActions,
  };

  return { status: 'applied', state: nextState };
}

function applySameVersionPatch(
  state: GameTableNormalizedV2State,
  patch: PatchEnvelopeV2,
): GameTableNormalizedV2ApplyInternalResult {
  let nextState = state;
  for (const operation of patch.ops) {
    const result = applySameVersionOperation(nextState, normalizePatchOperation(operation));
    if (result.status === 'failed') {
      return { status: 'resync_required', state, reason: result.reason };
    }

    nextState = result.state;
  }

  nextState = recordLibraryShuffleRevisions(nextState, patch.ops, patch.version);

  return {
    status: 'applied',
    state: {
      ...nextState,
      pendingOptimisticActions: patch.ackClientActionId
        ? omitKey(nextState.pendingOptimisticActions, patch.ackClientActionId)
        : nextState.pendingOptimisticActions,
    },
  };
}

function applySameVersionOperation(
  state: GameTableNormalizedV2State,
  operation: GameplayPatchV2Operation,
): OperationApplyResult {
  switch (operation.op) {
    case 'zone.cards.add':
    case 'zone.cards.remove':
      return applyOperationPreservingZoneCounts(state, operation, [{ playerId: operation.playerId, zone: operation.zone }]);
    case 'zone.cards.move':
      return applyOperationPreservingZoneCounts(state, operation, [
        { playerId: operation.from.playerId, zone: operation.from.zone },
        { playerId: operation.to.playerId, zone: operation.to.zone },
      ]);
    case 'zone.cards.batchMove':
      return applyOperationPreservingZoneCounts(
        state,
        operation,
        operation.moves.flatMap((move) => [
          { playerId: move.from.playerId, zone: move.from.zone },
          { playerId: move.to.playerId, zone: move.to.zone },
        ]),
      );
    default:
      return applyOperation(state, operation);
  }
}

function applyOperationPreservingZoneCounts(
  state: GameTableNormalizedV2State,
  operation: GameplayPatchV2Operation,
  targets: Array<{ playerId: string; zone: GameZoneName }>,
): OperationApplyResult {
  const preservedCounts = zoneCountsForTargets(state, targets);
  const result = applyOperation(state, operation);
  if (result.status === 'failed') {
    return result;
  }

  return {
    status: 'applied',
    state: restoreZoneCountsForTargets(result.state, preservedCounts),
  };
}

function zoneCountsForTargets(
  state: GameTableNormalizedV2State,
  targets: Array<{ playerId: string; zone: GameZoneName }>,
): Array<{ playerId: string; zone: GameZoneName; count: number }> {
  const seen = new Set<string>();
  const counts: Array<{ playerId: string; zone: GameZoneName; count: number }> = [];
  for (const target of targets) {
    const key = `${target.playerId}:${target.zone}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    const count = state.zoneCounts[target.playerId]?.[target.zone];
    if (typeof count === 'number') {
      counts.push({ ...target, count });
    }
  }

  return counts;
}

function restoreZoneCountsForTargets(
  state: GameTableNormalizedV2State,
  counts: Array<{ playerId: string; zone: GameZoneName; count: number }>,
): GameTableNormalizedV2State {
  let nextZoneCounts = state.zoneCounts;
  for (const item of counts) {
    const playerZoneCounts = nextZoneCounts[item.playerId];
    if (!playerZoneCounts) {
      continue;
    }

    nextZoneCounts = {
      ...nextZoneCounts,
      [item.playerId]: {
        ...playerZoneCounts,
        [item.zone]: item.count,
      },
    };
  }

  return nextZoneCounts === state.zoneCounts ? state : { ...state, zoneCounts: nextZoneCounts };
}

function isSameVersionStreamPatch(patch: PatchEnvelopeV2): boolean {
  return patch.ops.length > 0 && patch.ops.every((operation) =>
    operation.op === 'chat.message.add'
    || operation.op === 'chat.reaction.set'
    // Runtime emits the public card patch first and the durable activity-log
    // patch immediately after it at the same gameplay version. Log entries
    // are keyed and merged idempotently, so this must not be discarded.
    || operation.op === 'eventLog.append',
  );
}

function isSameVersionVisibilityMergePatch(patch: PatchEnvelopeV2): boolean {
  if (patch.ops.length === 0) {
    return false;
  }

  // Public reveal markers can be delivered independently from a private
  // identity/audience patch at the same version. They are scalar, idempotent
  // UI state, so they must not require the command acknowledgement.
  if (patch.ops.every(isIdempotentVisibilityOperation)) {
    return true;
  }

  return typeof patch.ackClientActionId === 'string'
    && patch.ackClientActionId.trim() !== ''
    && patch.ops.every(isSameVersionVisibilityMergeOperation);
}

function isIdempotentVisibilityOperation(operation: GameplayPatchV2Operation): boolean {
  return (operation.op === 'zone.cards.remove' && operation.zone === 'library')
    // A selected viewer can receive this removal after the public version
    // carrier for a one-off top reveal. It is idempotent and must be merged
    // even though the acknowledgement belongs only to the acting player.
    || operation.op === 'hand.reveal_marker.set'
    || operation.op === 'hand.reveal_marker.clear'
    || operation.op === 'library.top.reveal_marker.set'
    // The selected opponent can receive this private identity patch after the
    // public version carrier. It has no side effects beyond replacing the
    // visible top-card identities, so merging it at the same version is safe.
    || operation.op === 'library.top.revealed'
    // Full-library identity is sent only to the selected audience. It may
    // arrive after the public version carrier on that recipient, so it must be
    // mergeable without the actor's acknowledgement.
    || operation.op === 'library.revealed.set';
}

function isSameVersionVisibilityMergeOperation(operation: GameplayPatchV2Operation): boolean {
  switch (operation.op) {
    case 'version.advance':
    case 'card.field.set':
    case 'zone.cards.add':
    case 'zone.cards.remove':
    case 'zone.cards.move':
    case 'zone.cards.batchMove':
    case 'zone.count.set':
    case 'library.count.set':
    case 'hand.reveal_marker.set':
    case 'hand.reveal_marker.clear':
    case 'library.top.reveal_marker.set':
    case 'library.top.reveal_audience.set':
    case 'library.top.revealed':
    case 'library.top.viewed':
    case 'library.revealed.set':
    case 'library.play_top_revealed.set':
    case 'library.top.hidden':
    case 'library.top.reordered':
    case 'library.top.moved':
    case 'library.shuffled':
    case 'game.counters.set':
    case 'mulligan.status.set':
    case 'mulligan.private_state.set':
    case 'mulligan.hand.replace_private':
    case 'mulligan.hand.count.set':
    case 'mulligan.bottom.required.set':
    case 'mulligan.scry.available.set':
    case 'mulligan.completed':
    case 'game.phase.set':
    case 'eventLog.append':
      return true;
    default:
      return false;
  }
}

type OperationApplyResult =
  | { status: 'applied'; state: GameTableNormalizedV2State }
  | { status: 'failed'; reason: Exclude<GameTableNormalizedV2ApplyFailureReason, 'version_gap' | 'missing_state'> };

type GameplayPatchV2WireOperation = GameplayPatchV2Operation & {
  data?: Record<string, unknown>;
};

function normalizePatchOperation(operation: GameplayPatchV2Operation): GameplayPatchV2Operation {
  const data = (operation as GameplayPatchV2WireOperation).data;
  if (!data || Array.isArray(data)) {
    return operation;
  }

  return {
    ...data,
    op: operation.op,
  } as GameplayPatchV2Operation;
}

function recordLibraryShuffleRevisions(
  state: GameTableNormalizedV2State,
  operations: readonly GameplayPatchV2Operation[],
  revision: number,
): GameTableNormalizedV2State {
  const shuffledPlayerIds = new Set(
    operations
      .map(normalizePatchOperation)
      .filter((operation): operation is Extract<GameplayPatchV2Operation, { op: 'library.shuffled' }> => operation.op === 'library.shuffled')
      .map((operation) => operation.playerId),
  );

  let players = state.players;
  for (const playerId of shuffledPlayerIds) {
    const player = players[playerId];
    if (!player || player.libraryShuffleRevision === revision) {
      continue;
    }

    players = {
      ...players,
      [playerId]: {
        ...player,
        libraryShuffleRevision: revision,
      },
    };
  }

  return players === state.players ? state : { ...state, players };
}

function applyOperation(state: GameTableNormalizedV2State, operation: GameplayPatchV2Operation): OperationApplyResult {
  switch (operation.op) {
    case 'version.advance':
      return { status: 'applied', state };

    case 'game.counters.set':
      return {
        status: 'applied',
        state: {
          ...state,
          sharedCounters: {
            ...state.sharedCounters,
            [operation.scope]: { ...operation.counters },
          },
        },
      };

    case 'player.life.set':
      return updatePlayer(state, operation.playerId, (player) => ({ ...player, life: operation.value }));

    case 'player.counters.set':
      return updatePlayer(state, operation.playerId, (player) => ({
        ...player,
        counters: { ...operation.counters },
      }));

    case 'player.commanderDamage.set':
      return updatePlayer(state, operation.playerId, (player) => ({
        ...player,
        commanderDamage: { ...operation.commanderDamage },
      }));

    case 'player.status.set':
      return updatePlayer(state, operation.playerId, (player) => ({
        ...player,
        status: operation.status,
        ...(operation.concededAt !== undefined ? { concededAt: operation.concededAt } : {}),
      }));

    case 'player.presence.set':
      return updatePlayer(state, operation.playerId, (player) => ({ ...player, isOnline: operation.isOnline }));

    case 'turn.set':
      return {
        status: 'applied',
        state: { ...state, turn: { ...operation.turn } },
      };

    case 'dice.result': {
      const diceResult = operation.result ?? operation.value;
      return {
        status: 'applied',
        state: {
          ...state,
          game: {
            ...state.game,
            lastDiceResult: {
              playerId: operation.playerId,
              kind: operation.kind,
              result: diceResult ?? '',
              createdAt: operation.createdAt,
            },
          },
        },
      };
    }

    case 'card.field.set': {
      const result = updateInstanceAtZone(state, operation.playerId, operation.zone, operation.instanceId, (instance) => ({
        ...instance,
        ...(operation.tapped !== undefined ? { tapped: operation.tapped } : {}),
        ...(operation.rotation !== undefined ? { rotation: operation.rotation } : {}),
        ...(operation.faceDown !== undefined ? { faceDown: operation.faceDown } : {}),
        ...(operation.hidden !== undefined ? { hidden: operation.hidden } : {}),
        ...(operation.faceDown === false && operation.hidden === false && operation.cardKey
          ? { staticCardPending: !operation.staticCard }
          : {}),
        ...(operation.cardKey !== undefined && operation.cardKey !== null ? { cardKey: operation.cardKey, cardRef: operation.cardKey } : {}),
        ...(operation.printId !== undefined && operation.printId !== null ? { printId: operation.printId } : {}),
        ...(operation.cardVersion !== undefined && operation.cardVersion !== null ? { cardVersion: operation.cardVersion } : {}),
        ...(operation.language !== undefined && operation.language !== null ? { language: operation.language } : {}),
        ...(operation.viewerVisibility !== undefined && operation.viewerVisibility !== null ? { viewerVisibility: operation.viewerVisibility } : {}),
        ...(operation.controllerId !== undefined ? { controllerId: operation.controllerId } : {}),
        ...(operation.revealedTo !== undefined ? { revealedTo: Array.isArray(operation.revealedTo) ? [...operation.revealedTo] : [] } : {}),
        ...(operation.revealMarker !== undefined ? { revealMarker: operation.revealMarker } : {}),
        ...(operation.counters !== undefined ? { counters: { ...operation.counters } } : {}),
        ...(operation.dungeonMarker !== undefined ? { dungeonMarker: operation.dungeonMarker } : {}),
        ...(operation.activeFaceIndex !== undefined ? { activeFaceIndex: operation.activeFaceIndex } : {}),
        ...(operation.position !== undefined ? { position: operation.position } : {}),
        ...(operation.power !== undefined ? { power: operation.power } : {}),
        ...(operation.toughness !== undefined ? { toughness: operation.toughness } : {}),
        ...(operation.loyalty !== undefined ? { loyalty: operation.loyalty } : {}),
        ...(operation.defense !== undefined ? { defense: operation.defense } : {}),
        ...(operation.saga !== undefined ? { saga: operation.saga } : {}),
        ...(operation.staticCard ? { staticCardPending: false } : {}),
      }));
      if (result.status === 'failed' || !operation.staticCard) {
        return result;
      }
      return {
        status: 'applied',
        state: {
          ...result.state,
          staticCards: {
            ...result.state.staticCards,
            [operation.staticCard.cardRef]: mergeStaticCard(result.state.staticCards[operation.staticCard.cardRef], operation.staticCard),
          },
        },
      };
    }

    case 'hand.reveal_marker.set':
      return updatePlayer(state, operation.playerId, (player) => ({
        ...player,
        revealedHandIndexes: setRevealedHandIndex(player.revealedHandIndexes, operation.index, operation.revealed),
      }));

    case 'hand.reveal_marker.clear':
      return updatePlayer(state, operation.playerId, (player) => ({
        ...player,
        revealedHandIndexes: clearRevealedHandIndexes(player.revealedHandIndexes, operation.indexes),
      }));

    case 'card.counters.patch':
      return updateInstanceAtZone(state, operation.playerId, operation.zone, operation.instanceId, (instance) => ({
        ...instance,
        counters: { ...operation.counters },
        ...(operation.power !== undefined ? { power: operation.power } : {}),
        ...(operation.toughness !== undefined ? { toughness: operation.toughness } : {}),
      }));

    case 'zone.cards.add':
      return addCardsToZone(state, operation.playerId, operation.zone, operation.cards, operation.index, operation.staticCards ?? {});

    case 'zone.cards.remove':
      return removeCardsFromZone(state, operation.playerId, operation.zone, operation.instanceIds, operation.sourceIndexes);

    case 'zone.cards.move':
      return moveOneCard(state, operation);

    case 'zone.cards.batchMove': {
      let nextState = state;
      for (const move of operation.moves) {
        const result = moveOneCard(nextState, { op: 'zone.cards.move', ...move });
        if (result.status === 'failed') {
          return result;
        }
        nextState = result.state;
      }
      return { status: 'applied', state: nextState };
    }

    case 'zone.count.set':
      return setZoneCount(state, operation.playerId, operation.zone, operation.count);

    case 'zone.reordered':
      return reorderZoneByIds(state, operation.playerId, operation.zone, operation.instanceIds);

    case 'zone.random_card.selected':
      return { status: 'applied', state };

    case 'library.count.set':
      return setZoneCount(state, operation.playerId, 'library', operation.count);

    case 'library.top.reveal_marker.set':
      return updatePlayer(state, operation.playerId, (player) => ({ ...player, topLibraryRevealMarker: operation.revealed }));

    case 'library.top.reveal_audience.set':
      return updatePlayer(state, operation.playerId, (player) => ({
        ...player,
        topLibraryRevealedTo: Array.isArray(operation.revealedTo) ? [...operation.revealedTo] : [],
      }));

    case 'library.top.revealed':
      return revealLibraryTop(state, operation.playerId, operation.cards, operation.staticCards ?? {}, operation.epoch);

    case 'library.top.viewed':
      return revealLibraryTop(state, operation.playerId, operation.cards, operation.staticCards ?? {});

    case 'library.revealed.set': {
      const result = revealLibraryTop(state, operation.playerId, operation.cards, operation.staticCards ?? {});
      if (result.status === 'failed' || operation.revealedTo === undefined) {
        return result;
      }
      const player = result.state.players[operation.playerId];
      return !player ? result : {
        status: 'applied',
        state: {
          ...result.state,
          players: {
            ...result.state.players,
            [operation.playerId]: { ...player, revealedLibraryTo: [...operation.revealedTo] },
          },
        },
      };
    }

    case 'player.library.visibility.set':
      return setPlayerLibraryVisibility(state, operation);

    case 'library.play_top_revealed.set':
      return setPlayTopLibraryRevealed(state, operation.playerId, operation.enabled);

    case 'library.top.hidden':
      return clearKnownLibraryOrder(state, operation.playerId);

    case 'library.top.reordered':
      return reorderLibraryTop(state, operation.playerId, operation.instanceIds);

    case 'library.top.moved':
      return clearKnownLibraryOrder(state, operation.playerId);

    case 'library.shuffled':
      return clearKnownLibraryOrder(state, operation.playerId, operation.visibilityEpoch);

    case 'stack.add':
    case 'stack.item.add':
      return addStackItem(state, operation.item);

    case 'stack.remove':
      return removeStackItem(state, operation.stackId);

    case 'stack.item.remove':
      return removeStackItem(state, operation.id);

    case 'relation.add':
      return addRelation(state, operation.kind, operation.relation);

    case 'relation.remove':
      return removeRelation(state, operation.kind, operation.id);

    case 'helper.add':
    case 'helper.update':
      return upsertHelper(state, operation.entity);

    case 'helper.remove':
      return removeHelper(state, operation.id);

    case 'chat.message.add':
      return upsertChatMessage(state, operation.message, true);

    case 'chat.reaction.set':
      return setChatReactions(state, operation.messageId, operation.reactions);

    case 'mulligan.status.set': {
      const base = operation.handCount === undefined
        ? { status: 'applied' as const, state }
        : setMulliganHandCount(state, operation.playerId, operation.handCount);
      if (base.status === 'failed') {
        return base;
      }

      return updatePlayer(base.state, operation.playerId, (player) => ({
        ...player,
        mulligan: {
          ...emptyMulliganState(),
          ...player.mulligan,
          ...(operation.mulligansTaken !== undefined ? { mulligansTaken: operation.mulligansTaken } : {}),
          ...(operation.effectiveMulligans !== undefined ? { effectiveMulligans: operation.effectiveMulligans } : {}),
          status: operation.status,
          ready: operation.ready ?? player.mulligan?.ready ?? operation.status === 'READY',
          handCount: operation.handCount ?? player.mulligan?.handCount ?? player.handCount,
        },
      }));
    }

    case 'mulligan.private_state.set': {
      const patch = mulliganPrivateStatePatch(operation);
      let nextState = updatePlayer(state, operation.playerId, (player) => ({
        ...player,
        mulligan: mergeMulliganPrivateStatePatch(
          player.mulligan,
          patch,
          operation.hand?.length ?? patch.handSize ?? player.handCount,
          operation.scryCard ? compactRefToLegacyCard(operation.scryCard, operation.playerId, 'library') : undefined,
        ),
      }));
      if (nextState.status === 'failed' || !operation.hand) {
        return nextState;
      }

      return replacePrivateMulliganHand(nextState.state, operation.playerId, operation.hand, operation.staticCards ?? {});
    }

    case 'mulligan.hand.replace_private':
      return replacePrivateMulliganHand(state, operation.playerId, operation.hand, operation.staticCards ?? {});

    case 'mulligan.hand.count.set':
      return setMulliganHandCount(state, operation.playerId, operation.count);

    case 'mulligan.bottom.required.set':
      return updatePlayer(state, operation.playerId, (player) => ({
        ...player,
        mulligan: {
          ...emptyMulliganState(),
          ...player.mulligan,
          bottomSelectionCount: operation.count,
          needsBottomSelection: operation.count > 0,
          bottomOrderMode: (operation.orderMode as GamePlayerMulliganState['bottomOrderMode']) ?? player.mulligan?.bottomOrderMode ?? 'NONE',
        },
      }));

    case 'mulligan.bottom.confirmed':
      return updatePlayer(state, operation.playerId, (player) => ({
        ...player,
        mulligan: {
          ...emptyMulliganState(),
          ...player.mulligan,
          bottomSelectionCount: 0,
          needsBottomSelection: false,
          handCount: Math.max(0, player.handCount - operation.count),
        },
      }));

    case 'mulligan.scry.available.set':
      return updatePlayer(state, operation.playerId, (player) => ({
        ...player,
        mulligan: {
          ...emptyMulliganState(),
          ...player.mulligan,
          needsScryAfterKeep: operation.available,
          status: operation.available ? 'SCRYING' : player.mulligan?.status ?? 'DECIDING',
          ...(operation.card ? { scryCard: compactRefToLegacyCard(operation.card, operation.playerId, 'library') } : {}),
        },
      }));

    case 'mulligan.scry.confirmed':
      return updatePlayer(state, operation.playerId, (player) => {
        const { scryCard: _scryCard, ...mulligan } = {
          ...emptyMulliganState(),
          ...player.mulligan,
          status: 'READY' as const,
          ready: true,
          needsScryAfterKeep: false,
        };
        void _scryCard;

        return {
          ...player,
          mulligan,
        };
      });

    case 'mulligan.completed':
      return {
        status: 'applied',
        state: {
          ...state,
          game: {
            ...state.game,
            gamePhase: 'PLAYING',
          },
        },
      };

    case 'game.phase.set':
      return {
        status: 'applied',
        state: {
          ...state,
          game: {
            ...state.game,
            gamePhase: operation.phase,
          },
        },
      };

    case 'game.status.set':
      return {
        status: 'applied',
        state: {
          ...state,
          game: {
            ...state.game,
            status: operation.status,
            ...(operation.winnerPlayerId !== undefined ? { winnerPlayerId: operation.winnerPlayerId } : {}),
            ...(operation.finishedAt !== undefined ? { finishedAt: operation.finishedAt } : {}),
            ...(operation.finishReason !== undefined ? { finishReason: operation.finishReason } : {}),
            ...(operation.phase !== undefined && operation.phase !== null ? { gamePhase: operation.phase } : {}),
          },
        },
      };

    case 'zone.counts.set': {
      let nextState = state;
      for (const zoneName of ZONE_NAMES) {
        const count = operation.counts[zoneName];
        if (count === undefined) {
          continue;
        }

        const result = setZoneCount(nextState, operation.playerId, zoneName, count);
        if (result.status === 'failed') {
          return result;
        }
        nextState = result.state;
      }
      return { status: 'applied', state: nextState };
    }

    case 'zone.visible.set':
      return operation.zone === 'library'
        ? revealLibraryTop(state, operation.playerId, operation.cards, {})
        : { status: 'applied', state };

    case 'card.move':
      return moveOneCard(state, {
        op: 'zone.cards.move',
        instanceId: operation.instanceId,
        from: operation.from,
        to: operation.to,
        card: operation.card,
      });

    case 'card.remove':
      return removeCardsFromZone(state, operation.playerId, operation.zone, [operation.instanceId]);

    case 'card.state.set':
      return applyOperation(state, {
        op: 'card.field.set',
        playerId: operation.playerId,
        zone: operation.zone,
        instanceId: operation.instanceId,
        tapped: operation.tapped,
        rotation: operation.rotation,
        faceDown: operation.faceDown,
        hidden: operation.hidden,
        revealedTo: operation.revealedTo,
        counters: operation.counters,
        dungeonMarker: operation.dungeonMarker as GameCardDungeonMarker | null | undefined,
      });

    case 'card.position.set':
      return applyOperation(state, {
        op: 'card.field.set',
        playerId: operation.playerId,
        zone: operation.zone,
        instanceId: operation.instanceId,
        position: operation.position,
      });

    case 'card.stats.set':
      return applyOperation(state, {
        op: 'card.field.set',
        playerId: operation.playerId,
        zone: operation.zone,
        instanceId: operation.instanceId,
        power: operation.power,
        toughness: operation.toughness,
        loyalty: operation.loyalty,
        defense: operation.defense,
        saga: operation.saga,
      });

    case 'card.counters.set':
      return applyOperation(state, {
        op: 'card.counters.patch',
        playerId: operation.playerId,
        zone: operation.zone,
        instanceId: operation.instanceId,
        counters: operation.counters,
      });

    case 'arrow.add':
      return addRelation(state, 'arrow', operation.arrow);

    case 'arrow.remove':
      return removeRelation(state, 'arrow', operation.id);

    case 'attachment.add':
      return addRelation(state, 'attachment', operation.attachment);

    case 'attachment.remove':
      return removeRelation(state, 'attachment', operation.id);

    case 'chat.append': {
      let nextState = state;
      for (const entry of operation.entries) {
        const result = upsertChatMessage(nextState, entry, true);
        if (result.status === 'failed') {
          return result;
        }
        nextState = result.state;
      }
      return { status: 'applied', state: nextState };
    }

    case 'chat.message.set':
      return upsertChatMessage(state, operation.message, false);

    case 'eventLog.append':
      return appendEventLogEntries(state, operation.entries);

    case 'disconnect.vote.set':
      return {
        status: 'applied',
        state: {
          ...state,
          game: {
            ...state.game,
            disconnectVotes: cloneDisconnectVotes(disconnectVotesPayload(operation)),
          },
        },
      };

    case 'rematch.set':
      return {
        status: 'applied',
        state: {
          ...state,
          game: {
            ...state.game,
            rematch: operation.rematch ?? null,
          },
        },
      };

    default:
      return { status: 'failed', reason: 'invalid_operation' };
  }
}

function disconnectVotesPayload(operation: GameplayPatchV2Operation): GameDisconnectVotes {
  const payload = operation as {
    disconnectVotes?: GameDisconnectVotes;
    data?: { disconnectVotes?: GameDisconnectVotes };
  };

  return payload.disconnectVotes ?? payload.data?.disconnectVotes ?? {};
}

function cloneRematchState(rematch: GameRematchState): GameRematchState {
  return {
    votes: Object.fromEntries(Object.entries(rematch.votes).map(([playerId, vote]) => [playerId, { ...vote }])),
    deadlineAt: rematch.deadlineAt ?? null,
  };
}

function cloneDisconnectVotes(votes: GameDisconnectVotes): GameDisconnectVotes {
  return Object.fromEntries(Object.entries(votes).map(([targetPlayerId, vote]) => [
    targetPlayerId,
    { ...vote, eligible: vote.eligible ? [...vote.eligible] : undefined, votes: { ...vote.votes } },
  ]));
}

function addCardsToZone(
  state: GameTableNormalizedV2State,
  playerId: string,
  zone: GameZoneName,
  cards: Array<BootstrapInstanceV2 | LegacyCardPatchPayload>,
  index?: number,
  staticCards?: Record<string, BootstrapStaticCardV2>,
): OperationApplyResult {
  const playerZones = state.zones[playerId];
  const playerZoneCounts = state.zoneCounts[playerId];
  if (!playerZones || !playerZoneCounts) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const nextInstances = { ...state.instances };
  const nextStaticCards = { ...state.staticCards };
  const insertedIds: string[] = [];
  for (const card of cards) {
    const normalized = normalizeIncomingCard(card, playerId, zone, staticCards ?? {}, {
      instances: nextInstances,
      staticCards: nextStaticCards,
    });
    const existing = nextInstances[normalized.instance.instanceId];
    const nextInstance = {
      ...normalized.instance,
      position: battlefieldPositionForZone(zone, normalized.instance.position, existing?.position),
      ...(existing && shouldPreserveExistingStaticIdentity(normalized.instance, normalized.staticCard, existing)
        ? {
            cardRef: existing.cardRef,
            cardKey: existing.cardKey,
            printId: existing.printId,
            cardVersion: existing.cardVersion,
            language: existing.language,
            viewerVisibility: existing.viewerVisibility,
          }
        : {}),
    };
    if (normalized.staticCard) {
      nextStaticCards[normalized.staticCard.cardRef] = mergeStaticCard(
        nextStaticCards[normalized.staticCard.cardRef],
        normalized.staticCard,
      );
    }
    nextInstances[normalized.instance.instanceId] = completeInstanceIdentity(
      nextInstance,
      nextStaticCards[nextInstance.cardRef],
    );
    insertedIds.push(normalized.instance.instanceId);
  }

  const currentZone = playerZones[zone] ?? [];
  const nextZone = insertAt(removeIds(currentZone, insertedIds), clampInsertIndex(index, currentZone.length), insertedIds);
  return {
    status: 'applied',
    state: {
      ...state,
      instances: nextInstances,
      staticCards: nextStaticCards,
      zones: {
        ...state.zones,
        [playerId]: {
          ...playerZones,
          [zone]: nextZone,
        },
      },
      zoneCounts: {
        ...state.zoneCounts,
        [playerId]: {
          ...playerZoneCounts,
          [zone]: nextZone.length,
        },
      },
    },
  };
}

function removeCardsFromZone(
  state: GameTableNormalizedV2State,
  playerId: string,
  zone: GameZoneName,
  instanceIds: string[],
  sourceIndexes?: number[],
): OperationApplyResult {
  const playerZones = state.zones[playerId];
  const playerZoneCounts = state.zoneCounts[playerId];
  if (!playerZones || !playerZoneCounts) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const currentZone = playerZones[zone] ?? [];
  const removalIds = new Set(instanceIds);
  for (const [removalOffset, instanceId] of instanceIds.entries()) {
    if (currentZone.includes(instanceId)) {
      continue;
    }

    const sourceIndex = sourceIndexes?.[removalOffset];
    if (typeof sourceIndex !== 'number' || !Number.isInteger(sourceIndex) || sourceIndex < 0) {
      continue;
    }

    const fallbackInstanceId = currentZone[sourceIndex];
    if (fallbackInstanceId) {
      removalIds.add(fallbackInstanceId);
    }
  }
  const knownRemovalCount = currentZone.filter((instanceId) => removalIds.has(instanceId)).length;
  const removedHandIndexes = zone === 'hand'
    ? currentZone.reduce<number[]>((indexes, instanceId, index) => {
        if (removalIds.has(instanceId)) {
          indexes.push(index);
        }
        return indexes;
      }, [])
    : [];
  const nextZone = removeIds(currentZone, [...removalIds]);
  const nextPlayers = rebaseHandRevealIndexes(state.players, playerId, removedHandIndexes);

  return {
    status: 'applied',
    state: {
      ...state,
      players: nextPlayers,
      zones: {
        ...state.zones,
        [playerId]: {
          ...playerZones,
          [zone]: nextZone,
        },
      },
      zoneCounts: {
        ...state.zoneCounts,
        [playerId]: {
          ...playerZoneCounts,
          [zone]: knownRemovalCount === 0 ? playerZoneCounts[zone] : nextZone.length,
        },
      },
    },
  };
}

function moveOneCard(
  state: GameTableNormalizedV2State,
  operation: {
    op: 'zone.cards.move';
    instanceId: string;
    from: { playerId: string; zone: GameZoneName };
    to: { playerId: string; zone: GameZoneName; index?: number };
    card?: BootstrapInstanceV2 | LegacyCardPatchPayload;
    staticCard?: BootstrapStaticCardV2 | null;
  },
): OperationApplyResult {
  const fromZones = state.zones[operation.from.playerId];
  const toZones = state.zones[operation.to.playerId];
  const fromCounts = state.zoneCounts[operation.from.playerId];
  const toCounts = state.zoneCounts[operation.to.playerId];
  if (!fromZones || !toZones || !fromCounts || !toCounts) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const sourceZone = fromZones[operation.from.zone] ?? [];
  const sourceContainsInstance = sourceZone.includes(operation.instanceId);
  const targetZone = toZones[operation.to.zone] ?? [];
  const targetContainsInstance = targetZone.includes(operation.instanceId);
  if (!sourceContainsInstance && !targetContainsInstance) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const nextInstances = { ...state.instances };
  let nextStaticCards = state.staticCards;
  if (operation.card) {
    const existing = nextInstances[operation.instanceId];
    const normalized = normalizeIncomingCard(
      operation.card,
      operation.to.playerId,
      operation.to.zone,
      operation.staticCard ? { [operation.staticCard.cardRef]: operation.staticCard } : {},
      {
        instances: nextInstances,
        staticCards: nextStaticCards,
      },
    );
    let nextInstance: BootstrapInstanceV2 = {
      ...normalized.instance,
      position: battlefieldPositionForZone(operation.to.zone, normalized.instance.position, existing?.position),
      ...(existing && shouldPreserveExistingStaticIdentity(normalized.instance, normalized.staticCard, existing)
        ? {
            cardRef: existing.cardRef,
            cardKey: existing.cardKey,
            printId: existing.printId,
            cardVersion: existing.cardVersion,
            language: existing.language,
            viewerVisibility: existing.viewerVisibility,
          }
        : {}),
      instanceId: operation.instanceId,
    };
    if (normalized.staticCard) {
      nextStaticCards = { ...state.staticCards };
      nextStaticCards[normalized.staticCard.cardRef] = mergeStaticCard(
        nextStaticCards[normalized.staticCard.cardRef],
        normalized.staticCard,
      );
    }
    nextInstance = completeInstanceIdentity(nextInstance, nextStaticCards[nextInstance.cardRef]);
    if (shouldClearRevealRecipientsAfterMove(operation)) {
      nextInstance = { ...nextInstance, revealedTo: undefined };
    }
    nextInstances[operation.instanceId] = nextInstance;
  } else {
    const existing = nextInstances[operation.instanceId];
    if (!existing) {
      return { status: 'failed', reason: 'target_not_found' };
    }
    nextInstances[operation.instanceId] = {
      ...existing,
      zoneId: zoneId(operation.to.playerId, operation.to.zone),
      position: battlefieldPositionForZone(operation.to.zone, existing.position, existing.position),
      ...(shouldClearRevealRecipientsAfterMove(operation) ? { revealedTo: undefined } : {}),
    };
  }

  const samePlayer = operation.from.playerId === operation.to.playerId;
  const sameZone = samePlayer && operation.from.zone === operation.to.zone;
  const sourceRemovalIndex = sourceZone.indexOf(operation.instanceId);
  const baseTargetZone = sameZone ? sourceZone : targetZone;
  const nextSourceZone = sourceContainsInstance
    ? sourceZone.filter((id) => id !== operation.instanceId)
    : sourceZone;
  const nextTargetZone = insertAt(
    baseTargetZone.filter((id) => id !== operation.instanceId),
    clampInsertIndex(operation.to.index, targetZone.length),
    [operation.instanceId],
  );
  const nextPlayerZones = samePlayer
    ? {
        ...fromZones,
        [operation.from.zone]: sameZone ? nextTargetZone : nextSourceZone,
        [operation.to.zone]: nextTargetZone,
      }
    : {
        ...fromZones,
        [operation.from.zone]: nextSourceZone,
      };
  const nextTargetPlayerZones = samePlayer
    ? nextPlayerZones
    : {
        ...toZones,
        [operation.to.zone]: nextTargetZone,
      };
  const nextPlayerCounts = samePlayer
    ? {
        ...fromCounts,
        [operation.from.zone]: sameZone ? nextTargetZone.length : nextSourceZone.length,
        [operation.to.zone]: nextTargetZone.length,
      }
    : {
        ...fromCounts,
        [operation.from.zone]: nextSourceZone.length,
      };
  const nextTargetPlayerCounts = samePlayer
    ? nextPlayerCounts
    : {
        ...toCounts,
        [operation.to.zone]: nextTargetZone.length,
      };
  const nextPlayers = operation.from.zone === 'hand' && sourceRemovalIndex >= 0 && !sameZone
    ? rebaseHandRevealIndexes(state.players, operation.from.playerId, [sourceRemovalIndex])
    : state.players;

  return {
    status: 'applied',
    state: {
      ...state,
      instances: nextInstances,
      staticCards: nextStaticCards,
      players: nextPlayers,
      zones: {
        ...state.zones,
        [operation.from.playerId]: nextPlayerZones,
        [operation.to.playerId]: nextTargetPlayerZones,
      },
      zoneCounts: {
        ...state.zoneCounts,
        [operation.from.playerId]: nextPlayerCounts,
        [operation.to.playerId]: nextTargetPlayerCounts,
      },
    },
  };
}

function shouldClearRevealRecipientsAfterMove(operation: {
  from: { zone: GameZoneName };
  to: { zone: GameZoneName };
  card?: Pick<BootstrapInstanceV2, 'revealedTo'> | LegacyCardPatchPayload;
}): boolean {
  if (operation.from.zone === 'hand' && operation.to.zone !== 'hand' && operation.to.zone !== 'library') {
    return true;
  }

  return operation.from.zone === 'library'
    && operation.to.zone !== 'library'
    && operation.card?.revealedTo === undefined;
}

function reorderZoneByIds(
  state: GameTableNormalizedV2State,
  playerId: string,
  zone: GameZoneName,
  instanceIds: string[],
): OperationApplyResult {
  const playerZones = state.zones[playerId];
  if (!playerZones) {
    return { status: 'failed', reason: 'target_not_found' };
  }
  const current = playerZones[zone] ?? [];
  if (!sameStringSet(current, instanceIds)) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  return {
    status: 'applied',
    state: {
      ...state,
      zones: {
        ...state.zones,
        [playerId]: {
          ...playerZones,
          [zone]: [...instanceIds],
        },
      },
    },
  };
}

function setZoneCount(
  state: GameTableNormalizedV2State,
  playerId: string,
  zone: GameZoneName,
  count: number,
): OperationApplyResult {
  const playerZoneCounts = state.zoneCounts[playerId];
  if (!playerZoneCounts) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  return {
    status: 'applied',
    state: {
      ...state,
      zoneCounts: {
        ...state.zoneCounts,
        [playerId]: {
          ...playerZoneCounts,
          [zone]: Math.max(0, count),
        },
      },
    },
  };
}

function revealLibraryTop(
  state: GameTableNormalizedV2State,
  playerId: string,
  cards: Array<BootstrapInstanceV2 | LegacyCardPatchPayload>,
  staticCards: Record<string, BootstrapStaticCardV2>,
  revealEpoch?: number,
): OperationApplyResult {
  const playerZones = state.zones[playerId];
  if (!playerZones) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const currentLibrary = playerZones.library ?? [];
  const nextInstances = { ...state.instances };
  const nextStaticCards = { ...state.staticCards };
  const topIds: string[] = [];

  for (const card of cards) {
    const normalized = normalizeIncomingCard(card, playerId, 'library', staticCards, {
      instances: nextInstances,
      staticCards: nextStaticCards,
    });
    if (normalized.staticCard) {
      nextStaticCards[normalized.staticCard.cardRef] = mergeStaticCard(
        nextStaticCards[normalized.staticCard.cardRef],
        normalized.staticCard,
      );
    }
    nextInstances[normalized.instance.instanceId] = completeInstanceIdentity(
      normalized.instance,
      nextStaticCards[normalized.instance.cardRef],
    );
    topIds.push(normalized.instance.instanceId);
  }

  const nextLibrary = [...topIds, ...currentLibrary.filter((id) => !topIds.includes(id))];
  return {
    status: 'applied',
    state: {
      ...state,
      instances: nextInstances,
      staticCards: nextStaticCards,
      zones: {
        ...state.zones,
        [playerId]: {
          ...playerZones,
          library: nextLibrary,
        },
      },
      ...(revealEpoch === undefined ? {} : {
        players: {
          ...state.players,
          [playerId]: {
            ...state.players[playerId],
            libraryTopRevealEpoch: revealEpoch,
          },
        },
      }),
    },
  };
}

function reorderLibraryTop(
  state: GameTableNormalizedV2State,
  playerId: string,
  instanceIds: string[],
): OperationApplyResult {
  const playerZones = state.zones[playerId];
  if (!playerZones) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const currentLibrary = playerZones.library ?? [];
  const requested = instanceIds.filter((id) => currentLibrary.includes(id));
  if (requested.length !== instanceIds.length) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  return {
    status: 'applied',
    state: {
      ...state,
      zones: {
        ...state.zones,
        [playerId]: {
          ...playerZones,
          library: [...requested, ...currentLibrary.filter((id) => !requested.includes(id))],
        },
      },
    },
  };
}

function clearKnownLibraryOrder(
  state: GameTableNormalizedV2State,
  playerId: string,
  preserveTopRevealEpoch?: number,
): OperationApplyResult {
  const playerZones = state.zones[playerId];
  if (!playerZones) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const player = state.players[playerId];
  const preservesCurrentTop = preserveTopRevealEpoch !== undefined
    && player?.libraryTopRevealEpoch === preserveTopRevealEpoch;

  return {
    status: 'applied',
    state: {
      ...state,
      zones: {
        ...state.zones,
        [playerId]: {
          ...playerZones,
          library: preservesCurrentTop ? playerZones.library.slice(0, 1) : [],
        },
      },
      ...(player ? {
        players: {
          ...state.players,
          [playerId]: {
            ...player,
            libraryTopRevealEpoch: preservesCurrentTop ? player.libraryTopRevealEpoch : undefined,
          },
        },
      } : {}),
    },
  };
}

function setPlayerLibraryVisibility(
  state: GameTableNormalizedV2State,
  operation: Extract<GameplayPatchV2Operation, { op: 'player.library.visibility.set' }>,
): OperationApplyResult {
  const player = state.players[operation.playerId];
  if (!player) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  return {
    status: 'applied',
    state: {
      ...state,
      players: {
        ...state.players,
        [operation.playerId]: {
          ...player,
          ...(operation.playTopLibraryRevealed === undefined ? {} : { playTopLibraryRevealed: operation.playTopLibraryRevealed }),
          ...(operation.revealedLibraryTo === undefined ? {} : { revealedLibraryTo: [...operation.revealedLibraryTo] }),
        },
      },
    },
  };
}

function setPlayTopLibraryRevealed(
  state: GameTableNormalizedV2State,
  playerId: string,
  enabled: boolean,
): OperationApplyResult {
  const player = state.players[playerId];
  if (!player) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  return {
    status: 'applied',
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          playTopLibraryRevealed: enabled,
        },
      },
    },
  };
}

function addStackItem(state: GameTableNormalizedV2State, item: BootstrapStackItemV2): OperationApplyResult {
  const stackId = stackItemId(item);
  if (!stackId) {
    return { status: 'failed', reason: 'invalid_operation' };
  }

  return {
    status: 'applied',
    state: {
      ...state,
      stack: {
        byId: {
          ...state.stack.byId,
          [stackId]: { ...item, stackId, id: stackId },
        },
        order: state.stack.order.includes(stackId) ? state.stack.order : [...state.stack.order, stackId],
      },
    },
  };
}

function removeStackItem(state: GameTableNormalizedV2State, stackId: string): OperationApplyResult {
  if (!state.stack.byId[stackId]) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  return {
    status: 'applied',
    state: {
      ...state,
      stack: {
        byId: omitKey(state.stack.byId, stackId),
        order: state.stack.order.filter((id) => id !== stackId),
      },
    },
  };
}

function addRelation(
  state: GameTableNormalizedV2State,
  kind: 'arrow' | 'attachment',
  relation: GameArrow | GameAttachment,
): OperationApplyResult {
  if (kind === 'arrow') {
    const arrow = relation as GameArrow;
    return {
      status: 'applied',
      state: {
        ...state,
        relations: createRelationsState(
          [...Object.values(state.relations.arrows).filter((entry) => entry.id !== arrow.id), arrow],
          Object.values(state.relations.attachments),
          Object.values(state.relations.specialEntities),
        ),
      },
    };
  }

  const attachment = relation as GameAttachment;
  return {
    status: 'applied',
    state: {
      ...state,
      relations: createRelationsState(
        Object.values(state.relations.arrows),
        [...Object.values(state.relations.attachments).filter((entry) => entry.id !== attachment.id), attachment],
        Object.values(state.relations.specialEntities),
      ),
    },
  };
}

function removeRelation(
  state: GameTableNormalizedV2State,
  kind: 'arrow' | 'attachment',
  id: string,
): OperationApplyResult {
  if (kind === 'arrow') {
    return {
      status: 'applied',
      state: {
        ...state,
        relations: createRelationsState(
          Object.values(state.relations.arrows).filter((entry) => entry.id !== id),
          Object.values(state.relations.attachments),
          Object.values(state.relations.specialEntities),
        ),
      },
    };
  }

  return {
    status: 'applied',
    state: {
      ...state,
      relations: createRelationsState(
        Object.values(state.relations.arrows),
        Object.values(state.relations.attachments).filter((entry) => entry.id !== id),
        Object.values(state.relations.specialEntities),
      ),
    },
  };
}

function upsertHelper(state: GameTableNormalizedV2State, entity: GameSpecialEntity): OperationApplyResult {
  return {
    status: 'applied',
    state: {
      ...state,
      relations: createRelationsState(
        Object.values(state.relations.arrows),
        Object.values(state.relations.attachments),
        [...Object.values(state.relations.specialEntities).filter((entry) => entry.id !== entity.id), entity],
      ),
    },
  };
}

function removeHelper(state: GameTableNormalizedV2State, id: string): OperationApplyResult {
  return {
    status: 'applied',
    state: {
      ...state,
      relations: createRelationsState(
        Object.values(state.relations.arrows),
        Object.values(state.relations.attachments),
        Object.values(state.relations.specialEntities).filter((entry) => entry.id !== id),
      ),
    },
  };
}

function upsertChatMessage(state: GameTableNormalizedV2State, message: ChatMessage, appendIfMissing: boolean): OperationApplyResult {
  const messageId = chatMessageId(message);
  const exists = Boolean(state.chat.byId[messageId]);

  return {
    status: 'applied',
    state: {
      ...state,
      chat: exists || !appendIfMissing
        ? {
            ...state.chat,
            byId: { ...state.chat.byId, [messageId]: { ...message } },
            cursor: message.id ?? message.createdAt,
          }
        : mergeChatMessages(state.chat, [message], 250, 'newest'),
    },
  };
}

function setChatReactions(state: GameTableNormalizedV2State, messageId: string, reactions: ChatReactions): OperationApplyResult {
  const existing = state.chat.byId[messageId];
  if (!existing) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  return {
    status: 'applied',
    state: {
      ...state,
      chat: {
        ...state.chat,
        byId: {
          ...state.chat.byId,
          [messageId]: {
            ...existing,
            reactions: structuredClone(reactions),
          },
        },
      },
    },
  };
}

function appendEventLogEntries(state: GameTableNormalizedV2State, entries: GameLogEntry[]): OperationApplyResult {
  return {
    status: 'applied',
    state: {
      ...state,
      log: mergeLogEntries(state.log, entries, 250, 'newest'),
    },
  };
}

function mergeChatMessages(
  current: GameTableNormalizedV2ChatState,
  incoming: readonly ChatMessage[],
  maximumEntries: number,
  retention: 'oldest' | 'newest',
): GameTableNormalizedV2ChatState {
  const byId = { ...current.byId };
  for (const message of incoming) {
    const id = chatMessageId(message);
    byId[id] = { ...message, id };
  }

  const order = Object.keys(byId).sort((leftId, rightId) => compareChatMessages(byId[leftId], byId[rightId]));
  const limit = Math.max(1, maximumEntries);
  const retainedOrder = retention === 'oldest' ? order.slice(0, limit) : order.slice(-limit);
  const retainedById = Object.fromEntries(retainedOrder.map((id) => [id, byId[id]])) as Record<string, ChatMessage>;

  return {
    byId: retainedById,
    order: retainedOrder,
    cursor: retainedById[retainedOrder.at(-1) ?? '']?.id ?? current.cursor,
  };
}

function compareChatMessages(left: ChatMessage | undefined, right: ChatMessage | undefined): number {
  return (left?.createdAt ?? '').localeCompare(right?.createdAt ?? '')
    || chatMessageId(left ?? emptyChatMessage).localeCompare(chatMessageId(right ?? emptyChatMessage));
}

const emptyChatMessage: ChatMessage = {
  userId: '',
  displayName: '',
  message: '',
  createdAt: '',
};

function mergeLogEntries(
  current: GameTableNormalizedV2LogState,
  incoming: readonly GameLogEntry[],
  maximumEntries: number,
  retention: 'oldest' | 'newest',
): GameTableNormalizedV2LogState {
  const byId = { ...current.byId };
  for (const entry of incoming) {
    byId[entry.id] = { ...entry };
  }

  const order = Object.keys(byId)
    .sort((leftId, rightId) => compareLogEntries(byId[leftId], byId[rightId]));
  const limit = Math.max(1, maximumEntries);
  const retainedOrder = retention === 'oldest'
    ? order.slice(0, limit)
    : order.slice(-limit);
  const retainedById = Object.fromEntries(
    retainedOrder.map((id) => [id, byId[id]]),
  ) as Record<string, GameLogEntry>;

  return {
    byId: retainedById,
    order: retainedOrder,
    cursor: retainedOrder.at(-1) ?? null,
  };
}

function compareLogEntries(left: GameLogEntry | undefined, right: GameLogEntry | undefined): number {
  const leftCreatedAt = left?.createdAt ?? '';
  const rightCreatedAt = right?.createdAt ?? '';

  return leftCreatedAt.localeCompare(rightCreatedAt) || (left?.id ?? '').localeCompare(right?.id ?? '');
}

const ACTIVITY_BOOTSTRAP_LIMIT = 50;

function createChatState(entries: readonly ChatMessage[] | undefined, fallbackCursor: string | null): GameTableNormalizedV2ChatState {
  return mergeChatMessages({ byId: {}, order: [], cursor: fallbackCursor }, entries ?? [], ACTIVITY_BOOTSTRAP_LIMIT, 'newest');
}

function createLogState(entries: readonly GameLogEntry[] | undefined, fallbackCursor: string | null): GameTableNormalizedV2LogState {
  const byId: Record<string, GameLogEntry> = {};
  const order: string[] = [];
  let cursor = fallbackCursor;
  for (const entry of entries ?? []) {
    byId[entry.id] = { ...entry };
    if (!order.includes(entry.id)) {
      order.push(entry.id);
    }
    cursor = entry.id;
  }

  const retainedOrder = order
    .sort((left, right) => compareLogEntries(byId[left], byId[right]))
    .slice(-ACTIVITY_BOOTSTRAP_LIMIT);
  const retainedIds = new Set(retainedOrder);

  for (const id of Object.keys(byId)) {
    if (!retainedIds.has(id)) {
      delete byId[id];
    }
  }

  return { byId, order: retainedOrder, cursor };
}

function replacePrivateMulliganHand(
  state: GameTableNormalizedV2State,
  playerId: string,
  hand: readonly GameCompactCardRef[],
  staticCards: Record<string, BootstrapStaticCardV2> = {},
): OperationApplyResult {
  const playerZones = state.zones[playerId];
  const playerZoneCounts = state.zoneCounts[playerId];
  const player = state.players[playerId];
  if (!playerZones || !playerZoneCounts || !player) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const nextInstances = { ...state.instances };
  const nextStaticCards = { ...state.staticCards };
  for (const card of hand) {
    const normalized = normalizeIncomingCard(compactRefToLegacyPatchPayload(card), playerId, 'hand', staticCards, {
      instances: nextInstances,
      staticCards: nextStaticCards,
    });
    if (normalized.staticCard) {
      nextStaticCards[normalized.staticCard.cardRef] = mergeStaticCard(
        nextStaticCards[normalized.staticCard.cardRef],
        normalized.staticCard,
      );
    }
    nextInstances[card.instanceId] = completeInstanceIdentity(
      normalized.instance,
      nextStaticCards[normalized.instance.cardRef],
    );
  }

  return {
    status: 'applied',
    state: {
      ...state,
      instances: nextInstances,
      staticCards: nextStaticCards,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          handCount: hand.length,
          zoneCounts: {
            ...player.zoneCounts,
            hand: hand.length,
          },
          mulligan: {
            ...emptyMulliganState(),
            ...player.mulligan,
            handCount: hand.length,
          },
        },
      },
      zones: {
        ...state.zones,
        [playerId]: {
          ...playerZones,
          hand: hand.map((card) => card.instanceId),
        },
      },
      zoneCounts: {
        ...state.zoneCounts,
        [playerId]: {
          ...playerZoneCounts,
          hand: hand.length,
        },
      },
    },
  };
}

function setMulliganHandCount(
  state: GameTableNormalizedV2State,
  playerId: string,
  count: number,
): OperationApplyResult {
  const player = state.players[playerId];
  const playerZoneCounts = state.zoneCounts[playerId];
  if (!player || !playerZoneCounts) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  return {
    status: 'applied',
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          handCount: count,
          zoneCounts: {
            ...player.zoneCounts,
            hand: count,
          },
          mulligan: {
            ...emptyMulliganState(),
            ...player.mulligan,
            handCount: count,
          },
        },
      },
      zoneCounts: {
        ...state.zoneCounts,
        [playerId]: {
          ...playerZoneCounts,
          hand: count,
        },
      },
    },
  };
}

function updatePlayer(
  state: GameTableNormalizedV2State,
  playerId: string,
  update: (player: GameTableNormalizedV2PlayerState) => GameTableNormalizedV2PlayerState,
): OperationApplyResult {
  const player = state.players[playerId];
  if (!player) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  return {
    status: 'applied',
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: update(player),
      },
    },
  };
}

function compactRefToLegacyPatchPayload(card: GameCompactCardRef): LegacyCardPatchPayload {
  return {
    instanceId: card.instanceId,
    cardKey: nonEmptyString(card.cardKey) ? card.cardKey : undefined,
    printId: nonEmptyString(card.printId) ? card.printId : undefined,
    cardVersion: nonEmptyString(card.cardVersion) ? card.cardVersion : undefined,
    language: nonEmptyString(card.language) ? card.language : undefined,
    viewerVisibility: nonEmptyString(card.viewerVisibility) ? card.viewerVisibility : undefined,
    name: nonEmptyString(card.name) ? card.name : undefined,
    hidden: card.hidden,
    tapped: card.tapped,
    zone: card.zone,
  };
}

function compactRefToLegacyCard(
  card: GameCompactCardRef,
  playerId: string,
  zone: GameZoneName,
): GameCardInstance {
  return {
    instanceId: card.instanceId,
    ownerId: playerId,
    controllerId: playerId,
    name: card.name?.trim() || card.cardKey?.trim() || 'Card',
    tapped: card.tapped ?? false,
    hidden: card.hidden ?? false,
    zone,
  };
}

function emptyMulliganState(): GamePlayerMulliganState {
  return {
    mulligansTaken: 0,
    effectiveMulligans: 0,
    status: 'DECIDING',
    ready: false,
  };
}

type MulliganPrivateStateOperation = Extract<
  GameplayPatchV2Operation,
  { op: 'mulligan.private_state.set' }
>;
type MulliganPrivateStatePatch = MulliganPrivateStateOperation['state'];
type FlatMulliganPrivateStateOperation = Omit<MulliganPrivateStateOperation, 'state'> & {
  state?: MulliganPrivateStatePatch;
} & Partial<MulliganPrivateStatePatch>;

function mulliganPrivateStatePatch(operation: MulliganPrivateStateOperation): MulliganPrivateStatePatch {
  const flatOperation = operation as FlatMulliganPrivateStateOperation;

  return flatOperation.state ?? flatOperation;
}

function mergeMulliganPrivateStatePatch(
  current: GamePlayerMulliganState | undefined,
  patch: MulliganPrivateStatePatch,
  handCount: number | undefined,
  scryCard: GameCardInstance | undefined,
): GamePlayerMulliganState {
  const next: GamePlayerMulliganState = {
    ...emptyMulliganState(),
    ...current,
  };

  if (patch.rule !== undefined) {
    next.rule = patch.rule as GamePlayerMulliganState['rule'];
  }
  if (patch.firstMulliganFree !== undefined) {
    next.firstMulliganFree = patch.firstMulliganFree;
  }
  if (patch.mulligansTaken !== undefined) {
    next.mulligansTaken = patch.mulligansTaken;
  }
  if (patch.effectiveMulligans !== undefined) {
    next.effectiveMulligans = patch.effectiveMulligans;
  }
  if (patch.drawCount !== undefined) {
    next.drawCount = patch.drawCount;
  }
  if (patch.bottomSelectionCount !== undefined) {
    next.bottomSelectionCount = patch.bottomSelectionCount;
  }
  if (patch.cardsToBottom !== undefined) {
    next.bottomSelectionCount = patch.cardsToBottom;
  }
  if (patch.finalHandSize !== undefined) {
    next.finalHandSize = patch.finalHandSize;
  }
  if (patch.needsBottomSelection !== undefined) {
    next.needsBottomSelection = patch.needsBottomSelection;
  }
  if (patch.bottomPending !== undefined) {
    next.needsBottomSelection = patch.bottomPending;
  }
  if (patch.bottomOrderMode !== undefined) {
    next.bottomOrderMode = patch.bottomOrderMode as GamePlayerMulliganState['bottomOrderMode'];
  }
  if (patch.needsScryAfterKeep !== undefined) {
    next.needsScryAfterKeep = patch.needsScryAfterKeep;
  }
  if (patch.scryPending !== undefined) {
    next.needsScryAfterKeep = patch.scryPending;
  }
  if (patch.canTakeAnotherMulligan !== undefined) {
    next.canTakeAnotherMulligan = patch.canTakeAnotherMulligan;
  }
  if (patch.status !== undefined) {
    next.status = patch.status;
  }
  if (patch.ready !== undefined) {
    next.ready = patch.ready;
  } else if (patch.status === 'READY') {
    next.ready = true;
  }
  if (handCount !== undefined) {
    next.handCount = handCount;
  }
  if (scryCard !== undefined) {
    next.scryCard = scryCard;
  }

  return next;
}

function updateInstanceAtZone(
  state: GameTableNormalizedV2State,
  playerId: string,
  zone: GameZoneName,
  instanceId: string,
  update: (instance: BootstrapInstanceV2) => BootstrapInstanceV2,
): OperationApplyResult {
  const playerZone = state.zones[playerId]?.[zone] ?? [];
  const instance = state.instances[instanceId];
  if (!playerZone.includes(instanceId) || !instance) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  return {
    status: 'applied',
    state: {
      ...state,
      instances: {
        ...state.instances,
        [instanceId]: update(instance),
      },
    },
  };
}

function hydratePlayerState(
  state: GameTableNormalizedV2State,
  playerId: string,
  player: GameTableNormalizedV2PlayerState,
  hydratedZones?: GamePlayerState['zones'],
): GamePlayerState {
  const zoneIds = state.zones[playerId] ?? emptyZones();
  const zoneCounts = state.zoneCounts[playerId] ?? emptyZoneCounts();
  const zones = hydratedZones ?? {
    library: zoneIds.library.map((id) => hydrateCardInstance(state, id, 'library')).filter(isCardInstance),
    hand: zoneIds.hand.map((id) => hydrateCardInstance(state, id, 'hand')).filter(isCardInstance),
    battlefield: zoneIds.battlefield.map((id) => hydrateCardInstance(state, id, 'battlefield')).filter(isCardInstance),
    graveyard: zoneIds.graveyard.map((id) => hydrateCardInstance(state, id, 'graveyard')).filter(isCardInstance),
    exile: zoneIds.exile.map((id) => hydrateCardInstance(state, id, 'exile')).filter(isCardInstance),
    command: zoneIds.command.map((id) => hydrateCardInstance(state, id, 'command')).filter(isCardInstance),
  };

  return {
    user: player.user ?? {
      id: playerId,
      email: '',
      displayName: player.displayName,
      roles: [],
    },
    status: player.status as GamePlayerState['status'],
    isOnline: player.isOnline,
    concededAt: player.concededAt ?? null,
    deckName: player.deckName ?? null,
    colorIdentity: [...player.colorIdentity],
    backgroundName: player.backgroundName ?? undefined,
    sleevesName: player.sleevesName ?? undefined,
    life: player.life,
    zones,
    zoneCounts,
    handCount: zoneCounts.hand ?? player.handCount,
    mulligan: player.mulligan ? { ...player.mulligan } : undefined,
    playTopLibraryRevealed: player.playTopLibraryRevealed,
    topLibraryRevealMarker: player.topLibraryRevealMarker,
    topLibraryRevealedTo: player.topLibraryRevealedTo ? [...player.topLibraryRevealedTo] : undefined,
    libraryShuffleRevision: player.libraryShuffleRevision,
    revealedHandIndexes: player.revealedHandIndexes ? [...player.revealedHandIndexes] : undefined,
    commanderDamage: { ...player.commanderDamage },
    counters: { ...player.counters },
  };
}

function hydrateCardInstance(
  state: GameTableNormalizedV2State,
  instanceId: string,
  zone: GameZoneName,
): GameCardInstance | null {
  const instance = state.instances[instanceId];
  if (!instance) {
    return null;
  }

  const staticCard = state.staticCards[instance.cardRef];
  assertRenderableIdentity(instance, staticCard, instanceId);
  return {
    instanceId,
    ownerId: instance.ownerId ?? undefined,
    controllerId: instance.controllerId ?? undefined,
    // Owners retain the private print identity for an explicit face-down
    // inspection, while public projections never contain these fields.
    scryfallId: staticCard?.scryfallId ?? instance.printId ?? instance.cardKey ?? undefined,
    name: staticCard?.name ?? 'Card',
    imageUris: toLegacyImageUris(staticCard?.imageUris),
    cardFaces: staticCard?.cardFaces ?? undefined,
    hasRulings: staticCard?.hasRulings ?? false,
    typeLine: staticCard?.typeLine ?? null,
    manaCost: staticCard?.manaCost ?? null,
    colorIdentity: staticCard?.colorIdentity ?? [],
    defaultPower: staticCard?.defaultPower ?? null,
    defaultToughness: staticCard?.defaultToughness ?? null,
    defaultLoyalty: staticCard?.defaultLoyalty ?? null,
    defaultDefense: staticCard?.defaultDefense ?? null,
    power: instance.power ?? staticCard?.defaultPower ?? null,
    toughness: instance.toughness ?? staticCard?.defaultToughness ?? null,
    loyalty: instance.loyalty ?? staticCard?.defaultLoyalty ?? null,
    defense: instance.defense ?? staticCard?.defaultDefense ?? null,
    saga: instance.saga ?? null,
    tapped: instance.tapped ?? false,
    faceDown: instance.faceDown ?? false,
    activeFaceIndex: instance.activeFaceIndex ?? undefined,
    dungeonMarker: instance.dungeonMarker ?? undefined,
    hidden: instance.hidden ?? false,
    revealedTo: instance.revealedTo ? [...instance.revealedTo] : undefined,
    revealMarker: instance.revealMarker ?? undefined,
    position: instance.position ?? undefined,
    rotation: instance.rotation ?? 0,
    counters: instance.counters ? { ...instance.counters } : undefined,
    zone,
    isToken: instance.isToken ?? false,
    isTokenCopy: instance.isTokenCopy ?? false,
    isCommander: instance.isCommander ?? false,
  };
}

function hydrateStackItem(state: GameTableNormalizedV2State, item: BootstrapStackItemV2 | undefined): GameSnapshot['stack'][number] | null {
  if (!item) {
    return null;
  }

  const id = stackItemId(item);
  if (!id) {
    return null;
  }

  let card: GameCardInstance | undefined;
  if (item.sourceInstanceId && state.instances[item.sourceInstanceId]) {
    card = hydrateCardInstance(state, item.sourceInstanceId, zoneNameFromZoneId(state.instances[item.sourceInstanceId].zoneId) ?? 'battlefield') ?? undefined;
  } else if (item.cardRef && state.staticCards[item.cardRef]) {
    const staticCard = state.staticCards[item.cardRef];
    card = {
      instanceId: item.sourceInstanceId ?? id,
      name: staticCard.name ?? 'Card',
      scryfallId: staticCard.scryfallId ?? undefined,
      imageUris: toLegacyImageUris(staticCard.imageUris),
      cardFaces: staticCard.cardFaces ?? undefined,
      typeLine: staticCard.typeLine ?? null,
      manaCost: staticCard.manaCost ?? null,
      colorIdentity: staticCard.colorIdentity ?? [],
      defaultPower: staticCard.defaultPower ?? null,
      defaultToughness: staticCard.defaultToughness ?? null,
      defaultLoyalty: staticCard.defaultLoyalty ?? null,
      defaultDefense: staticCard.defaultDefense ?? null,
      tapped: false,
    };
  }

  return {
    id,
    kind: item.kind,
    ...(card ? { card } : {}),
    createdAt: item.createdAt ?? new Date(0).toISOString(),
  };
}

function normalizePlayer(player: BootstrapPlayerV2): GameTableNormalizedV2PlayerState {
  return {
    playerId: player.playerId,
    user: player.user,
    displayName: player.displayName,
    life: player.life,
    isOnline: player.isOnline,
    status: player.status,
    handCount: player.handCount,
    zoneCounts: { ...player.zoneCounts },
    commanderDamage: { ...player.commanderDamage },
    counters: { ...player.counters },
    deckName: player.deckName ?? null,
    colorIdentity: player.colorIdentity ? [...player.colorIdentity] : [],
    backgroundName: player.backgroundName ?? null,
    sleevesName: player.sleevesName ?? null,
    playTopLibraryRevealed: player.playTopLibraryRevealed ?? false,
    topLibraryRevealMarker: player.topLibraryRevealMarker ?? false,
    topLibraryRevealedTo: player.topLibraryRevealedTo ? [...player.topLibraryRevealedTo] : [],
    revealedHandIndexes: player.revealedHandIndexes ? [...player.revealedHandIndexes] : [],
    mulligan: player.mulligan ? { ...player.mulligan } : undefined,
  };
}

function setRevealedHandIndex(indexes: readonly number[] | undefined, index: number, revealed: boolean): number[] {
  const current = new Set(indexes ?? []);
  if (revealed) {
    current.add(index);
  } else {
    current.delete(index);
  }

  return [...current].sort((left, right) => left - right);
}

function clearRevealedHandIndexes(indexes: readonly number[] | undefined, removedIndexes: readonly number[]): number[] {
  const removed = [...new Set(removedIndexes)].sort((left, right) => left - right);
  const current = indexes ?? [];
  if (removed.length === 0 || current.length === 0) {
    return [...current];
  }

  const rebased: number[] = [];
  let removedCursor = 0;
  for (const index of current) {
    while (removedCursor < removed.length && removed[removedCursor] < index) {
      removedCursor += 1;
    }
    if (removed[removedCursor] === index) {
      continue;
    }
    rebased.push(index - removedCursor);
  }

  return rebased;
}

function rebaseHandRevealIndexes(
  players: GameTableNormalizedV2State['players'],
  playerId: string,
  removedIndexes: readonly number[],
): GameTableNormalizedV2State['players'] {
  if (removedIndexes.length === 0) {
    return players;
  }

  const player = players[playerId];
  if (!player) {
    return players;
  }

  const nextIndexes = clearRevealedHandIndexes(player.revealedHandIndexes, removedIndexes);
  const currentIndexes = player.revealedHandIndexes ?? [];
  if (nextIndexes.length === currentIndexes.length && nextIndexes.every((index, position) => index === currentIndexes[position])) {
    return players;
  }

  return {
    ...players,
    [playerId]: {
      ...player,
      revealedHandIndexes: nextIndexes,
    },
  };
}

function normalizeInstance(instance: BootstrapInstanceV2): BootstrapInstanceV2 {
  return {
    ...instance,
    counters: instance.counters ? { ...instance.counters } : {},
    revealedTo: instance.revealedTo ? [...instance.revealedTo] : [],
    tokenMeta: instance.tokenMeta ? structuredClone(instance.tokenMeta) : undefined,
  };
}

function completeInstanceIdentity(
  instance: BootstrapInstanceV2,
  staticCard: BootstrapStaticCardV2 | undefined,
): BootstrapInstanceV2 {
  if (!staticCard) {
    return instance;
  }

  return {
    ...instance,
    cardKey: nonEmptyString(instance.cardKey) ? instance.cardKey : staticCard.cardKey,
    printId: nonEmptyString(instance.printId) ? instance.printId : staticCard.printId,
    cardVersion: nonEmptyString(instance.cardVersion) ? instance.cardVersion : staticCard.cardVersion,
    language: nonEmptyString(instance.language) ? instance.language : staticCard.language,
    viewerVisibility: nonEmptyString(instance.viewerVisibility) ? instance.viewerVisibility : staticCard.viewerVisibility,
  };
}

function battlefieldPositionForZone(
  zone: GameZoneName,
  incoming: BootstrapInstanceV2['position'],
  existing: BootstrapInstanceV2['position'],
): BootstrapInstanceV2['position'] {
  if (zone !== 'battlefield') {
    return null;
  }

  return incoming ?? existing ?? null;
}

function normalizeStaticCard(card: BootstrapStaticCardV2): BootstrapStaticCardV2 {
  return {
    ...card,
    imageUris: card.imageUris ? { ...card.imageUris } : undefined,
    cardFaces: card.cardFaces ? structuredClone(card.cardFaces) : [],
    colorIdentity: card.colorIdentity ? [...card.colorIdentity] : [],
  };
}

function mergeStaticCard(
  existing: BootstrapStaticCardV2 | undefined,
  incoming: BootstrapStaticCardV2,
): BootstrapStaticCardV2 {
  if (existing && !hasRenderableStaticContent(incoming) && isStaticIdentityCompatible(existing, incoming)) {
    return existing;
  }

  if (existing && !hasCompleteStaticIdentity(incoming) && isStaticIdentityCompatible(existing, incoming)) {
    return {
      ...existing,
      imageUris: incoming.imageUris ?? existing.imageUris,
      cardFaces: incoming.cardFaces && incoming.cardFaces.length > 0
        ? incoming.cardFaces
        : existing.cardFaces,
    };
  }

  if (!existing || !sameStaticIdentity(existing, incoming)) {
    return incoming;
  }

  return {
    ...existing,
    ...incoming,
    imageUris: incoming.imageUris ?? existing.imageUris,
    cardFaces: incoming.cardFaces && incoming.cardFaces.length > 0
      ? incoming.cardFaces
      : existing.cardFaces,
  };
}

function sameStaticIdentity(left: BootstrapStaticCardV2, right: BootstrapStaticCardV2): boolean {
  return left.cardKey === right.cardKey
    && left.printId === right.printId
    && left.cardVersion === right.cardVersion
    && left.language === right.language
    && left.viewerVisibility === right.viewerVisibility;
}

function hasCompleteStaticIdentity(card: BootstrapStaticCardV2): boolean {
  return [
    card.cardKey,
    card.printId,
    card.cardVersion,
    card.language,
    card.viewerVisibility,
  ].every(nonEmptyString);
}

function hasRenderableStaticContent(card: BootstrapStaticCardV2): boolean {
  const name = card.name?.trim() ?? '';
  return (name !== '' && name !== 'Card' && name !== 'Unknown Card')
    || Boolean(card.imageUris && Object.keys(card.imageUris).length > 0)
    || Boolean(card.cardFaces && card.cardFaces.length > 0);
}

function isStaticIdentityCompatible(existing: BootstrapStaticCardV2, incoming: BootstrapStaticCardV2): boolean {
  const incomingKeys = [incoming.cardRef, incoming.cardKey].filter(nonEmptyString);
  const existingKeys = [existing.cardRef, existing.cardKey].filter(nonEmptyString);

  return incomingKeys.length === 0
    || existingKeys.length === 0
    || incomingKeys.some((key) => existingKeys.includes(key));
}

function normalizeIncomingCard(
  card: BootstrapInstanceV2 | LegacyCardPatchPayload,
  playerId: string,
  zone: GameZoneName,
  staticCards: Record<string, BootstrapStaticCardV2>,
  context: NormalizeIncomingCardContext,
): { instance: BootstrapInstanceV2; staticCard: BootstrapStaticCardV2 | null } {
  if ('cardRef' in card && typeof card.cardRef === 'string') {
    const compact = {
      ...card,
      zoneId: 'zoneId' in card && typeof card.zoneId === 'string' ? card.zoneId : zoneId(playerId, zone),
    } as BootstrapInstanceV2;
    const staticCard = staticCardForIncomingKeys(
      [compact.cardRef, compact.cardKey, compact.tokenMeta?.copiedFromCardKey],
      staticCards,
      context.staticCards,
    );
    const instance = {
      ...normalizeInstance(compact),
      zoneId: zoneId(playerId, zone),
      ...(staticCard ? { cardRef: staticCard.cardRef } : {}),
    };

    return {
      instance,
      staticCard,
    };
  }

  const legacy = card as LegacyCardPatchPayload;
  const inferredCardRef = inferCardRefFromLegacyCard(legacy);
  const fallbackLanguage = fallbackLanguageForZone(zone);
  const existing = context.instances[legacy.instanceId];
  const cachedStaticCard = staticCardForLegacyPatch(legacy, existing, staticCards, context.staticCards);
  const cardRef = cachedStaticCard?.cardRef ?? inferredCardRef;
  const staticCard = cachedStaticCard
    ?? (!hasRenderableLegacyPayload(legacy) ? null
    : {
        cardRef,
        cardKey: legacy.cardKey ?? cardRef,
        printId: legacy.printId ?? legacy.scryfallId ?? legacy.cardKey ?? cardRef,
        cardVersion: legacy.cardVersion ?? 'legacy-snapshot-v1',
        language: legacy.language ?? fallbackLanguage,
        viewerVisibility: legacy.viewerVisibility ?? viewerVisibilityForZone(zone),
        scryfallId: legacy.scryfallId ?? null,
        name: legacy.name ?? fallbackStaticNameForZone(zone, legacy.hidden ?? false),
        imageUris: normalizeImageUris(legacy.imageUris),
        cardFaces: legacy.cardFaces ? structuredClone(legacy.cardFaces) : [],
        typeLine: legacy.typeLine ?? null,
        manaCost: legacy.manaCost ?? null,
        colorIdentity: legacy.colorIdentity ? [...legacy.colorIdentity] : [],
        defaultPower: legacy.defaultPower ?? null,
        defaultToughness: legacy.defaultToughness ?? null,
        defaultLoyalty: legacy.defaultLoyalty ?? null,
        defaultDefense: legacy.defaultDefense ?? null,
        hasRulings: legacy.hasRulings ?? false,
      } satisfies BootstrapStaticCardV2);

  return {
    instance: {
      instanceId: legacy.instanceId,
      cardRef,
      cardKey: legacy.cardKey ?? undefined,
      printId: legacy.printId ?? legacy.scryfallId ?? (staticCard ? undefined : legacy.cardKey ?? cardRef),
      cardVersion: legacy.cardVersion ?? (staticCard ? undefined : 'legacy-snapshot-v1'),
      language: legacy.language ?? (staticCard ? undefined : fallbackLanguage),
      viewerVisibility: legacy.viewerVisibility ?? (staticCard ? undefined : viewerVisibilityForZone(zone)),
      zoneId: zoneId(playerId, zone),
      ownerId: legacy.ownerId ?? playerId,
      controllerId: legacy.controllerId ?? playerId,
      hidden: legacy.hidden ?? false,
      faceDown: legacy.faceDown ?? false,
      tapped: legacy.tapped ?? false,
      position: legacy.position ?? null,
      rotation: legacy.rotation ?? 0,
      counters: legacy.counters ? { ...legacy.counters } : {},
      power: legacy.power ?? null,
      toughness: legacy.toughness ?? null,
      loyalty: legacy.loyalty ?? null,
      defense: legacy.defense ?? null,
      saga: legacy.saga ?? null,
      activeFaceIndex: legacy.activeFaceIndex ?? null,
      dungeonMarker: legacy.dungeonMarker ?? null,
      revealedTo: legacy.revealedTo ? [...legacy.revealedTo] : [],
      isToken: legacy.isToken ?? false,
      isTokenCopy: legacy.isTokenCopy ?? false,
      isCommander: legacy.isCommander ?? false,
      tokenMeta: legacy.tokenMeta ? structuredClone(legacy.tokenMeta) : undefined,
    },
    staticCard,
  };
}

function staticCardForLegacyPatch(
  legacy: LegacyCardPatchPayload,
  existing: BootstrapInstanceV2 | undefined,
  operationStaticCards: Record<string, BootstrapStaticCardV2>,
  cachedStaticCards: Record<string, BootstrapStaticCardV2>,
): BootstrapStaticCardV2 | null {
  const direct = staticCardForIncomingKeys(
    [legacy.cardRef, legacy.cardKey, legacy.tokenMeta?.copiedFromCardKey, legacy.scryfallId],
    operationStaticCards,
    cachedStaticCards,
  );
  if (direct) {
    return direct;
  }

  if (!existing) {
    return null;
  }

  const existingStaticCard = staticCardForIncomingKeys(
    [existing.cardRef, existing.cardKey],
    operationStaticCards,
    cachedStaticCards,
  );
  if (!existingStaticCard) {
    return null;
  }

  if (canReuseExistingInstanceStaticCard(legacy, existing, existingStaticCard)) {
    return existingStaticCard;
  }

  const incomingKeys = [legacy.cardRef, legacy.cardKey].filter(nonEmptyString);
  if (incomingKeys.length === 0) {
    return existingStaticCard;
  }

  const existingKeys = [
    existing.cardRef,
    existing.cardKey,
    existingStaticCard.cardRef,
    existingStaticCard.cardKey,
  ].filter(nonEmptyString);

  return incomingKeys.some((key) => existingKeys.includes(key)) ? existingStaticCard : null;
}

function canReuseExistingInstanceStaticCard(
  legacy: LegacyCardPatchPayload,
  existing: BootstrapInstanceV2,
  existingStaticCard: BootstrapStaticCardV2,
): boolean {
  const existingZone = zoneNameFromZoneId(existing.zoneId);
  return legacy.instanceId === existing.instanceId
    && ((existingZone === 'library' || existingZone === 'hand') || existing.isTokenCopy === true)
    && hasRenderableStaticContent(existingStaticCard);
}

function staticCardForIncomingKeys(
  keys: Array<string | null | undefined>,
  operationStaticCards: Record<string, BootstrapStaticCardV2>,
  cachedStaticCards: Record<string, BootstrapStaticCardV2>,
): BootstrapStaticCardV2 | null {
  const lookupKeys = staticLookupKeys(keys);
  if (lookupKeys.length === 0) {
    return null;
  }

  for (const source of [operationStaticCards, cachedStaticCards]) {
    for (const key of lookupKeys) {
      const card = source[key];
      if (card) {
        return normalizeStaticCard(card);
      }
    }

    for (const card of Object.values(source)) {
      const candidateKeys = staticLookupKeys([card.cardRef, card.cardKey, card.scryfallId, card.printId]);
      if (lookupKeys.some((key) => candidateKeys.includes(key))) {
        return normalizeStaticCard(card);
      }
    }
  }

  return null;
}

function staticLookupKeys(keys: Array<string | null | undefined>): string[] {
  const lookupKeys = new Set<string>();
  for (const key of keys) {
    if (!nonEmptyString(key)) {
      continue;
    }

    for (const alias of staticLookupAliases(key)) {
      lookupKeys.add(alias);
    }
  }

  return [...lookupKeys];
}

function staticLookupAliases(key: string): string[] {
  const trimmed = key.trim();
  const aliases = new Set<string>([trimmed]);
  const runtimeScryfallId = scryfallIdFromRuntimeCardKey(trimmed);
  if (runtimeScryfallId) {
    aliases.add(runtimeScryfallId);
    aliases.add(`${runtimeScryfallId}:card`);
    aliases.add(`${runtimeScryfallId}:token`);
  }

  const suffixedScryfallId = scryfallIdFromStaticRef(trimmed);
  if (suffixedScryfallId) {
    aliases.add(suffixedScryfallId);
  }

  return [...aliases];
}

function scryfallIdFromRuntimeCardKey(key: string): string | null {
  const parts = key.split(':');
  if (parts.length < 3 || parts[0] !== 'scryfall') {
    return null;
  }

  const scryfallId = parts[1]?.trim() ?? '';
  return scryfallId === '' ? null : scryfallId;
}

function scryfallIdFromStaticRef(key: string): string | null {
  const match = /^(.+):(card|token)$/.exec(key);
  const scryfallId = match?.[1]?.trim() ?? '';

  return scryfallId === '' ? null : scryfallId;
}

function hasRenderableLegacyPayload(card: LegacyCardPatchPayload): boolean {
  const name = card.name?.trim() ?? '';
  return (name !== '' && name !== 'Card' && name !== 'Unknown Card')
    || Boolean(card.imageUris && Object.keys(card.imageUris).length > 0)
    || Boolean(card.cardFaces && card.cardFaces.length > 0);
}

function shouldPreserveExistingStaticIdentity(
  incoming: BootstrapInstanceV2,
  incomingStaticCard: BootstrapStaticCardV2 | null,
  existing: BootstrapInstanceV2,
): boolean {
  if (hasRenderableIdentity(incoming, incomingStaticCard)) {
    if (incomingStaticCard !== null && !isSyntheticUnknownStaticCard(incomingStaticCard, incoming.instanceId)) {
      return false;
    }
    const incomingHasExplicitCardKey = typeof incoming.cardKey === 'string' && incoming.cardKey.trim().length > 0;
    if (incomingHasExplicitCardKey) {
      return false;
    }
  }

  if (!isIncomingIdentityCompatibleWithExisting(incoming, incomingStaticCard, existing)) {
    return false;
  }

  return typeof existing.cardRef === 'string' && existing.cardRef.trim().length > 0;
}

function hasRenderableIdentity(
  instance: BootstrapInstanceV2,
  staticCard: BootstrapStaticCardV2 | null,
): boolean {
  if (!staticCard) {
    return false;
  }

  const instanceIdentity = [
    instance.cardKey,
    instance.printId,
    instance.cardVersion,
    instance.language,
    instance.viewerVisibility,
  ];
  const staticIdentity = [
    staticCard.cardKey,
    staticCard.printId,
    staticCard.cardVersion,
    staticCard.language,
    staticCard.viewerVisibility,
  ];

  return [...instanceIdentity, ...staticIdentity].every((value) =>
    typeof value === 'string' && value.trim() !== '',
  ) && hasRenderableStaticContent(staticCard);
}

function isIncomingIdentityCompatibleWithExisting(
  incoming: BootstrapInstanceV2,
  incomingStaticCard: BootstrapStaticCardV2 | null,
  existing: BootstrapInstanceV2,
): boolean {
  const incomingKeys = [
    incoming.cardRef,
    incoming.cardKey,
    incomingStaticCard?.cardRef,
    incomingStaticCard?.cardKey,
  ].filter(nonEmptyString);
  const existingKeys = [
    existing.cardRef,
    existing.cardKey,
  ].filter(nonEmptyString);
  const hasExplicitIncomingKey = incomingKeys.some((key) => key !== `instance:${incoming.instanceId}`);

  if (incoming.instanceId === existing.instanceId && !hasExplicitIncomingKey) {
    return true;
  }

  return incomingKeys.length === 0
    || existingKeys.length === 0
    || incomingKeys.some((key) => existingKeys.includes(key));
}

function nonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isSyntheticUnknownStaticCard(staticCard: BootstrapStaticCardV2, instanceId: string): boolean {
  return staticCard.cardRef === `instance:${instanceId}`
    && (!staticCard.scryfallId || staticCard.scryfallId.trim() === '')
    && (!staticCard.name || staticCard.name === 'Unknown Card')
    && (!staticCard.typeLine || staticCard.typeLine.trim() === '')
    && (!staticCard.manaCost || staticCard.manaCost.trim() === '')
    && (!staticCard.imageUris || Object.keys(staticCard.imageUris).length === 0)
    && (!staticCard.cardFaces || staticCard.cardFaces.length === 0);
}

function assertRenderableIdentity(
  instance: BootstrapInstanceV2,
  staticCard: BootstrapStaticCardV2 | undefined,
  instanceId: string,
): void {
  if (instance.hidden === true) {
    return;
  }

  if (instance.faceDown === true) {
    return;
  }

  const requiredIdentity: Array<[string, string | null | undefined]> = [
    ['cardKey', instance.cardKey],
    ['printId', instance.printId],
    ['cardVersion', instance.cardVersion],
    ['language', instance.language],
    ['viewerVisibility', instance.viewerVisibility],
  ];
  const missingInstanceField = requiredIdentity.find(([, value]) => value === undefined || value === null || value.trim() === '');
  if (missingInstanceField) {
    throw new Error(`Identity contract violation: visible card ${instanceId} is missing ${missingInstanceField[0]} for ${instance.cardRef}.`);
  }

  // A face-up transition may arrive before its static-card cache update.
  // Keep that one valid identity renderable as a temporary Card placeholder
  // instead of rejecting the patch and forcing a snapshot resync.
  if (!staticCard && instance.staticCardPending === true) {
    return;
  }

  if (!staticCard) {
    throw new Error(`Identity contract violation: visible card ${instanceId} has no static card for ${instance.cardRef}.`);
  }

  const staticIdentity: Array<[string, string | null | undefined]> = [
    ['cardKey', staticCard.cardKey],
    ['printId', staticCard.printId],
    ['cardVersion', staticCard.cardVersion],
    ['language', staticCard.language],
    ['viewerVisibility', staticCard.viewerVisibility],
  ];
  const missingStaticField = staticIdentity.find(([, value]) => value === undefined || value === null || value.trim() === '');
  if (missingStaticField) {
    throw new Error(`Identity contract violation: static card ${staticCard.cardRef} is missing ${missingStaticField[0]}.`);
  }

  if (!hasRenderableStaticContent(staticCard)) {
    throw new Error(`Identity contract violation: visible card ${instanceId} has no renderable static card for ${instance.cardRef}.`);
  }
}

function createRelationsState(
  arrows: GameArrow[],
  attachments: GameAttachment[],
  specialEntities: GameSpecialEntity[],
): GameTableNormalizedV2RelationsState {
  const arrowsBySource: Record<string, string[]> = {};
  const arrowsByTarget: Record<string, string[]> = {};
  const attachmentsByEquipment: Record<string, string[]> = {};
  const attachmentsByTarget: Record<string, string[]> = {};

  for (const arrow of arrows) {
    appendIndex(arrowsBySource, arrow.fromInstanceId, arrow.id);
    appendIndex(arrowsByTarget, arrow.toInstanceId, arrow.id);
  }
  for (const attachment of attachments) {
    appendIndex(attachmentsByEquipment, attachment.equipmentInstanceId, attachment.id);
    appendIndex(attachmentsByTarget, attachment.attachedToInstanceId, attachment.id);
  }

  return {
    arrows: Object.fromEntries(arrows.map((arrow) => [arrow.id, { ...arrow }])),
    attachments: Object.fromEntries(attachments.map((attachment) => [attachment.id, { ...attachment }])),
    specialEntities: Object.fromEntries(specialEntities.map((entity) => [entity.id, { ...entity }])),
    indexes: {
      arrowsBySource,
      arrowsByTarget,
      attachmentsByEquipment,
      attachmentsByTarget,
    },
  };
}

function createStackState(items: BootstrapStackItemV2[]): GameTableNormalizedV2StackState {
  const byId: Record<string, BootstrapStackItemV2> = {};
  const order: string[] = [];
  for (const item of items) {
    const id = stackItemId(item);
    if (!id) {
      continue;
    }

    byId[id] = { ...item, stackId: id, id };
    order.push(id);
  }

  return { byId, order };
}

function emptyZones(): ZoneMap {
  return {
    library: [],
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    command: [],
  };
}

function emptyZoneCounts(): ZoneCountMap {
  return {
    library: 0,
    hand: 0,
    battlefield: 0,
    graveyard: 0,
    exile: 0,
    command: 0,
  };
}

function zoneId(playerId: string, zone: GameZoneName): string {
  return `${playerId}:${zone}`;
}

function zoneNameFromZoneId(value: string): GameZoneName | null {
  const parts = value.split(':');
  const zone = parts[1] ?? null;

  return zone && ZONE_NAMES.includes(zone as GameZoneName) ? (zone as GameZoneName) : null;
}

function inferCardRefFromLegacyCard(card: LegacyCardPatchPayload): string {
  const cardRef = typeof card.cardRef === 'string' ? card.cardRef.trim() : '';
  if (cardRef) {
    return cardRef;
  }

  const cardKey = typeof card.cardKey === 'string' ? card.cardKey.trim() : '';
  if (cardKey) {
    return cardKey;
  }

  const templateCardKey = typeof card.tokenMeta?.templateCardKey === 'string' ? card.tokenMeta.templateCardKey.trim() : '';
  if (templateCardKey) {
    return templateCardKey;
  }

  const copiedFromCardKey = typeof card.tokenMeta?.copiedFromCardKey === 'string' ? card.tokenMeta.copiedFromCardKey.trim() : '';
  if (copiedFromCardKey) {
    return copiedFromCardKey;
  }

  const scryfallId = typeof card.scryfallId === 'string' ? card.scryfallId.trim() : '';
  if (scryfallId) {
    const suffix = card.isToken || card.isTokenCopy ? ':token' : ':card';
    return `${scryfallId}${suffix}`;
  }

  return `instance:${card.instanceId}`;
}

function viewerVisibilityForZone(zone: GameZoneName): string {
  return zone === 'hand' || zone === 'library' ? 'private' : 'public';
}

function fallbackLanguageForZone(zone: GameZoneName): string | null {
  return zone === 'hand' || zone === 'library' ? 'en' : null;
}

function fallbackStaticNameForZone(zone: GameZoneName, hidden: boolean): string | null {
  return hidden || zone === 'hand' || zone === 'library' ? 'Card' : null;
}

function normalizeImageUris(imageUris: Record<string, string> | undefined): CardImageUris | undefined {
  if (!imageUris) {
    return undefined;
  }

  const normalized = { ...imageUris } as Partial<CardImageUris>;
  return Object.keys(normalized).length > 0 ? (normalized as CardImageUris) : undefined;
}

function toLegacyImageUris(imageUris: CardImageUris | null | undefined): Record<string, string> | undefined {
  if (!imageUris) {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(imageUris).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== ''),
  );

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function appendIndex(index: Record<string, string[]>, key: string, value: string): void {
  index[key] ??= [];
  if (!index[key].includes(value)) {
    index[key].push(value);
  }
}

function insertAt(items: string[], index: number, inserted: string[]): string[] {
  const next = [...items];
  next.splice(index, 0, ...inserted);
  return next;
}

function removeIds(items: string[], ids: string[]): string[] {
  const removeSet = new Set(ids);
  return items.filter((item) => !removeSet.has(item));
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const counts = new Map<string, number>();
  for (const item of left) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  for (const item of right) {
    counts.set(item, (counts.get(item) ?? 0) - 1);
  }
  return [...counts.values()].every((count) => count === 0);
}

function clampInsertIndex(index: number | undefined, currentLength: number): number {
  if (!Number.isInteger(index)) {
    return currentLength;
  }

  return Math.max(0, Math.min(currentLength, Number(index)));
}

function stackItemId(item: BootstrapStackItemV2): string | null {
  const value = item.stackId ?? item.id ?? null;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function chatMessageId(message: ChatMessage): string {
  return message.id?.trim() || `${message.userId}:${message.createdAt}:${message.message}`;
}

function omitKey<T extends Record<string, unknown>>(record: T, key: string): T {
  const { [key]: _ignored, ...rest } = record;
  return rest as T;
}

function isCardInstance(card: GameCardInstance | null): card is GameCardInstance {
  return card !== null;
}
