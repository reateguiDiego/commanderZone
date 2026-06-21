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
  GameDisconnectVoteState,
  GameLogEntry,
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
  viewerId: string;
  ownerId: string | null;
  version: number;
  gamePhase: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastDiceResult?: {
    playerId?: string;
    kind?: string;
    result: number | string;
    createdAt?: string;
  } | null;
  disconnectVote?: GameDisconnectVoteState | null;
  rematch?: GameRematchState | null;
}

export interface GameTableNormalizedV2PlayerState {
  playerId: string;
  user: BootstrapPlayerV2['user'];
  displayName: string;
  life: number;
  status: string;
  handCount: number;
  zoneCounts: Partial<Record<GameZoneName, number>>;
  commanderDamage: Record<string, number>;
  counters: Record<string, number>;
  deckName: string | null;
  concededAt?: string | null;
  mulligan?: GamePlayerMulliganState;
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

const ZONE_NAMES: readonly GameZoneName[] = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];

@Injectable()
export class GameTableNormalizedV2Store {
  readonly state = signal<GameTableNormalizedV2State | null>(null);

  clear(): void {
    this.state.set(null);
  }

  applyBootstrap(bootstrap: BootstrapV2): GameSnapshot {
    const nextState = createGameTableNormalizedV2State(bootstrap, this.state()?.pendingOptimisticActions ?? {});
    this.state.set(nextState);

    return hydrateGameSnapshotFromV2State(nextState);
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

    this.state.set(result.state);
    return {
      ...result,
      snapshot: hydrateGameSnapshotFromV2State(result.state),
    };
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
    zones[zone.playerId][zone.name] = [...zone.instanceIds];
    zoneCounts[zone.playerId] ??= emptyZoneCounts();
    zoneCounts[zone.playerId][zone.name] = Math.max(0, bootstrap.zoneCounts[zone.zoneId] ?? zone.instanceIds.length);
  }

  const relations = createRelationsState(bootstrap.relations.arrows, bootstrap.relations.attachments, bootstrap.relations.specialEntities);
  const stack = createStackState(bootstrap.relations.stack);

  return {
    game: {
      id: bootstrap.game.id,
      status: bootstrap.game.status,
      viewerId: bootstrap.game.viewerId,
      ownerId: bootstrap.game.ownerId ?? null,
      version: bootstrap.game.version,
      gamePhase: bootstrap.game.gamePhase ?? null,
      createdAt: bootstrap.game.createdAt ?? null,
      updatedAt: bootstrap.game.updatedAt ?? null,
      disconnectVote: null,
      rematch: null,
      lastDiceResult: null,
    },
    players: Object.fromEntries(
      Object.entries(bootstrap.players).map(([playerId, player]) => [playerId, normalizePlayer(player)]),
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
    chat: {
      byId: {},
      order: [],
      cursor: bootstrap.chatCursor ?? null,
    },
    log: {
      byId: {},
      order: [],
      cursor: bootstrap.logCursor ?? null,
    },
    lastAppliedVersion: bootstrap.game.version,
    pendingOptimisticActions: { ...pendingOptimisticActions },
  };
}

export function hydrateGameSnapshotFromV2State(state: GameTableNormalizedV2State): GameSnapshot {
  const players = Object.fromEntries(
    Object.entries(state.players).map(([playerId, player]) => [playerId, hydratePlayerState(state, playerId, player)]),
  ) as Record<string, GamePlayerState>;

  return {
    version: state.lastAppliedVersion,
    ownerId: state.game.ownerId ?? undefined,
    gamePhase: (state.game.gamePhase as GameSnapshot['gamePhase']) ?? undefined,
    players,
    turn: { ...state.turn },
    stack: state.stack.order
      .map((stackId) => hydrateStackItem(state, state.stack.byId[stackId]))
      .filter((item): item is NonNullable<typeof item> => item !== null),
    arrows: Object.values(state.relations.arrows),
    attachments: Object.values(state.relations.attachments),
    specialEntities: Object.values(state.relations.specialEntities),
    chat: state.chat.order.map((id) => state.chat.byId[id]).filter((message): message is ChatMessage => Boolean(message)),
    eventLog: state.log.order.map((id) => state.log.byId[id]).filter((entry): entry is GameLogEntry => Boolean(entry)),
    rematch: state.game.rematch ?? undefined,
    disconnectVote: state.game.disconnectVote ?? null,
    createdAt: state.game.createdAt ?? new Date(0).toISOString(),
    updatedAt: state.game.updatedAt ?? undefined,
  };
}

export function applyPatchEnvelopeV2(
  state: GameTableNormalizedV2State,
  patch: PatchEnvelopeV2,
): GameTableNormalizedV2ApplyInternalResult {
  if (patch.version <= state.lastAppliedVersion) {
    return { status: 'ignored', state, reason: 'duplicate_or_late_version' };
  }

  if (patch.version !== state.lastAppliedVersion + 1) {
      return { status: 'resync_required', state, reason: 'version_gap' };
  }

  let nextState = state;
  for (const operation of patch.ops) {
    const result = applyOperation(nextState, operation);
    if (result.status === 'failed') {
      return { status: 'resync_required', state, reason: result.reason };
    }

    nextState = result.state;
  }

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

type OperationApplyResult =
  | { status: 'applied'; state: GameTableNormalizedV2State }
  | { status: 'failed'; reason: Exclude<GameTableNormalizedV2ApplyFailureReason, 'version_gap' | 'missing_state'> };

function applyOperation(state: GameTableNormalizedV2State, operation: GameplayPatchV2Operation): OperationApplyResult {
  switch (operation.op) {
    case 'player.life.set':
      return updatePlayer(state, operation.playerId, (player) => ({ ...player, life: operation.value }));

    case 'player.status.set':
      return updatePlayer(state, operation.playerId, (player) => ({
        ...player,
        status: operation.status,
        ...(operation.concededAt !== undefined ? { concededAt: operation.concededAt } : {}),
      }));

    case 'turn.set':
      return {
        status: 'applied',
        state: { ...state, turn: { ...operation.turn } },
      };

    case 'dice.result':
      return {
        status: 'applied',
        state: {
          ...state,
          game: {
            ...state.game,
            lastDiceResult: {
              playerId: operation.playerId,
              kind: operation.kind,
              result: operation.result,
              createdAt: operation.createdAt,
            },
          },
        },
      };

    case 'card.field.set':
      return updateInstanceAtZone(state, operation.playerId, operation.zone, operation.instanceId, (instance) => ({
        ...instance,
        ...(operation.tapped !== undefined ? { tapped: operation.tapped } : {}),
        ...(operation.rotation !== undefined ? { rotation: operation.rotation } : {}),
        ...(operation.faceDown !== undefined ? { faceDown: operation.faceDown } : {}),
        ...(operation.hidden !== undefined ? { hidden: operation.hidden } : {}),
        ...(operation.revealedTo !== undefined ? { revealedTo: [...operation.revealedTo] } : {}),
        ...(operation.counters !== undefined ? { counters: { ...operation.counters } } : {}),
        ...(operation.position !== undefined ? { position: operation.position } : {}),
        ...(operation.power !== undefined ? { power: operation.power } : {}),
        ...(operation.toughness !== undefined ? { toughness: operation.toughness } : {}),
        ...(operation.loyalty !== undefined ? { loyalty: operation.loyalty } : {}),
        ...(operation.defense !== undefined ? { defense: operation.defense } : {}),
        ...(operation.saga !== undefined ? { saga: operation.saga } : {}),
      }));

    case 'card.counters.patch':
      return updateInstanceAtZone(state, operation.playerId, operation.zone, operation.instanceId, (instance) => ({
        ...instance,
        counters: { ...operation.counters },
      }));

    case 'zone.cards.add':
      return addCardsToZone(state, operation.playerId, operation.zone, operation.cards, operation.index, operation.staticCards ?? {});

    case 'zone.cards.remove':
      return removeCardsFromZone(state, operation.playerId, operation.zone, operation.instanceIds);

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

    case 'library.top.revealed':
      return revealLibraryTop(state, operation.playerId, operation.cards, operation.staticCards ?? {});

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
          ...(operation.effectiveMulligans !== undefined ? { effectiveMulligans: operation.effectiveMulligans } : {}),
          status: operation.status,
          ready: operation.ready ?? player.mulligan?.ready ?? operation.status === 'READY',
          handCount: operation.handCount ?? player.mulligan?.handCount ?? player.handCount,
        },
      }));
    }

    case 'mulligan.private_state.set': {
      let nextState = updatePlayer(state, operation.playerId, (player) => ({
        ...player,
        mulligan: {
          ...emptyMulliganState(),
          ...player.mulligan,
          ...operation.state,
          bottomOrderMode: operation.state.bottomOrderMode as GamePlayerMulliganState['bottomOrderMode'],
          rule: operation.state.rule as GamePlayerMulliganState['rule'],
          handCount: operation.hand?.length ?? player.handCount,
          ...(operation.scryCard ? { scryCard: compactRefToLegacyCard(operation.scryCard, operation.playerId, 'library') } : {}),
        },
      }));
      if (nextState.status === 'failed' || !operation.hand) {
        return nextState;
      }

      return replacePrivateMulliganHand(nextState.state, operation.playerId, operation.hand);
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
            disconnectVote: operation.disconnectVote,
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
    const normalized = normalizeIncomingCard(card, playerId, zone, staticCards ?? {});
    nextInstances[normalized.instance.instanceId] = normalized.instance;
    if (normalized.staticCard) {
      nextStaticCards[normalized.staticCard.cardRef] = normalized.staticCard;
    }
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
): OperationApplyResult {
  const playerZones = state.zones[playerId];
  const playerZoneCounts = state.zoneCounts[playerId];
  if (!playerZones || !playerZoneCounts) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const currentZone = playerZones[zone] ?? [];
  const nextZone = removeIds(currentZone, instanceIds);
  const nextInstances = { ...state.instances };
  for (const instanceId of instanceIds) {
    delete nextInstances[instanceId];
  }

  return {
    status: 'applied',
    state: {
      ...state,
      instances: nextInstances,
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
  if (!sourceZone.includes(operation.instanceId)) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const targetZone = toZones[operation.to.zone] ?? [];
  const nextInstances = { ...state.instances };
  let nextStaticCards = state.staticCards;
  if (operation.card) {
    const normalized = normalizeIncomingCard(operation.card, operation.to.playerId, operation.to.zone, operation.staticCard ? { [operation.staticCard.cardRef]: operation.staticCard } : {});
    nextInstances[operation.instanceId] = {
      ...normalized.instance,
      instanceId: operation.instanceId,
    };
    if (normalized.staticCard) {
      nextStaticCards = { ...state.staticCards };
      nextStaticCards[normalized.staticCard.cardRef] = normalized.staticCard;
    }
  } else {
    const existing = nextInstances[operation.instanceId];
    if (!existing) {
      return { status: 'failed', reason: 'target_not_found' };
    }
    nextInstances[operation.instanceId] = {
      ...existing,
      zoneId: zoneId(operation.to.playerId, operation.to.zone),
    };
  }

  const nextSourceZone = sourceZone.filter((id) => id !== operation.instanceId);
  const nextTargetZone = insertAt(
    targetZone.filter((id) => id !== operation.instanceId),
    clampInsertIndex(operation.to.index, targetZone.length),
    [operation.instanceId],
  );

  return {
    status: 'applied',
    state: {
      ...state,
      instances: nextInstances,
      staticCards: nextStaticCards,
      zones: {
        ...state.zones,
        [operation.from.playerId]: {
          ...fromZones,
          [operation.from.zone]: nextSourceZone,
        },
        [operation.to.playerId]: {
          ...toZones,
          [operation.to.zone]: nextTargetZone,
        },
      },
      zoneCounts: {
        ...state.zoneCounts,
        [operation.from.playerId]: {
          ...fromCounts,
          [operation.from.zone]: nextSourceZone.length,
        },
        [operation.to.playerId]: {
          ...toCounts,
          [operation.to.zone]: nextTargetZone.length,
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
    const normalized = normalizeIncomingCard(card, playerId, 'library', staticCards);
    nextInstances[normalized.instance.instanceId] = normalized.instance;
    if (normalized.staticCard) {
      nextStaticCards[normalized.staticCard.cardRef] = normalized.staticCard;
    }
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

function upsertChatMessage(state: GameTableNormalizedV2State, message: ChatMessage, appendIfMissing: boolean): OperationApplyResult {
  const messageId = chatMessageId(message);
  const exists = Boolean(state.chat.byId[messageId]);

  return {
    status: 'applied',
    state: {
      ...state,
      chat: {
        byId: {
          ...state.chat.byId,
          [messageId]: { ...message },
        },
        order: exists || !appendIfMissing ? state.chat.order : [...state.chat.order, messageId],
        cursor: message.id ?? message.createdAt,
      },
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
  let byId = { ...state.log.byId };
  let order = [...state.log.order];
  let cursor = state.log.cursor;
  for (const entry of entries) {
    byId[entry.id] = { ...entry };
    if (!order.includes(entry.id)) {
      order.push(entry.id);
    }
    cursor = entry.id;
  }

  return {
    status: 'applied',
    state: {
      ...state,
      log: {
        byId,
        order,
        cursor,
      },
    },
  };
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
  for (const card of hand) {
    nextInstances[card.instanceId] = compactRefToBootstrapInstance(card, playerId, 'hand');
  }

  return {
    status: 'applied',
    state: {
      ...state,
      instances: nextInstances,
      staticCards: {
        ...state.staticCards,
        ...staticCards,
      },
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

function compactRefToBootstrapInstance(
  card: GameCompactCardRef,
  playerId: string,
  zone: GameZoneName,
): BootstrapInstanceV2 {
  const cardRef = card.cardKey?.trim() || `instance:${card.instanceId}`;

  return {
    instanceId: card.instanceId,
    cardRef,
    cardKey: card.cardKey ?? undefined,
    cardVersion: card.cardVersion ?? undefined,
    zoneId: zoneId(playerId, zone),
    ownerId: playerId,
    controllerId: playerId,
    hidden: card.hidden ?? false,
    tapped: card.tapped ?? false,
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
): GamePlayerState {
  const zones = state.zones[playerId] ?? emptyZones();
  const zoneCounts = state.zoneCounts[playerId] ?? emptyZoneCounts();

  return {
    user: player.user ?? {
      id: playerId,
      email: '',
      displayName: player.displayName,
      roles: [],
    },
    status: player.status as GamePlayerState['status'],
    concededAt: player.concededAt ?? null,
    deckName: player.deckName ?? null,
    life: player.life,
    zones: {
      library: zones.library.map((id) => hydrateCardInstance(state, id, 'library')).filter(isCardInstance),
      hand: zones.hand.map((id) => hydrateCardInstance(state, id, 'hand')).filter(isCardInstance),
      battlefield: zones.battlefield.map((id) => hydrateCardInstance(state, id, 'battlefield')).filter(isCardInstance),
      graveyard: zones.graveyard.map((id) => hydrateCardInstance(state, id, 'graveyard')).filter(isCardInstance),
      exile: zones.exile.map((id) => hydrateCardInstance(state, id, 'exile')).filter(isCardInstance),
      command: zones.command.map((id) => hydrateCardInstance(state, id, 'command')).filter(isCardInstance),
    },
    zoneCounts,
    handCount: zoneCounts.hand ?? player.handCount,
    mulligan: player.mulligan ? { ...player.mulligan } : undefined,
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
  return {
    instanceId,
    ownerId: instance.ownerId ?? undefined,
    controllerId: instance.controllerId ?? undefined,
    scryfallId: staticCard?.scryfallId ?? undefined,
    name: staticCard?.name ?? (instance.hidden ? 'Card' : 'Unknown Card'),
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
    hidden: instance.hidden ?? false,
    revealedTo: instance.revealedTo ? [...instance.revealedTo] : undefined,
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
    status: player.status,
    handCount: player.handCount,
    zoneCounts: { ...player.zoneCounts },
    commanderDamage: { ...player.commanderDamage },
    counters: { ...player.counters },
    deckName: player.deckName ?? null,
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

function normalizeStaticCard(card: BootstrapStaticCardV2): BootstrapStaticCardV2 {
  return {
    ...card,
    imageUris: card.imageUris ? { ...card.imageUris } : undefined,
    cardFaces: card.cardFaces ? structuredClone(card.cardFaces) : [],
    colorIdentity: card.colorIdentity ? [...card.colorIdentity] : [],
  };
}

function normalizeIncomingCard(
  card: BootstrapInstanceV2 | LegacyCardPatchPayload,
  playerId: string,
  zone: GameZoneName,
  staticCards: Record<string, BootstrapStaticCardV2>,
): { instance: BootstrapInstanceV2; staticCard: BootstrapStaticCardV2 | null } {
  if ('cardRef' in card && typeof card.cardRef === 'string') {
    return {
      instance: {
        ...normalizeInstance(card),
        zoneId: zoneId(playerId, zone),
      },
      staticCard: staticCards[card.cardRef] ? normalizeStaticCard(staticCards[card.cardRef]!) : null,
    };
  }

  const legacy = card as LegacyCardPatchPayload;
  const inferredCardRef = inferCardRefFromLegacyCard(legacy);
  const staticCard = (legacy.hidden && !legacy.scryfallId && !legacy.name)
    ? null
    : {
        cardRef: inferredCardRef,
        scryfallId: legacy.scryfallId ?? null,
        name: legacy.name ?? (legacy.hidden ? 'Card' : 'Unknown Card'),
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
      } satisfies BootstrapStaticCardV2;

  return {
    instance: {
      instanceId: legacy.instanceId,
      cardRef: inferredCardRef,
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
      revealedTo: legacy.revealedTo ? [...legacy.revealedTo] : [],
      isToken: legacy.isToken ?? false,
      isTokenCopy: legacy.isTokenCopy ?? false,
      isCommander: legacy.isCommander ?? false,
      tokenMeta: legacy.tokenMeta ? structuredClone(legacy.tokenMeta) : undefined,
    },
    staticCard,
  };
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
  const templateCardKey = typeof card.tokenMeta?.templateCardKey === 'string' ? card.tokenMeta.templateCardKey.trim() : '';
  if (templateCardKey) {
    return templateCardKey;
  }

  const scryfallId = typeof card.scryfallId === 'string' ? card.scryfallId.trim() : '';
  if (scryfallId) {
    const suffix = card.isToken || card.isTokenCopy ? ':token' : ':card';
    return `${scryfallId}${suffix}`;
  }

  return `instance:${card.instanceId}`;
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
