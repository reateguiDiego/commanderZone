import { Injectable, signal } from '@angular/core';
import type { CardFace, CardImageUris } from '../../../../../core/models/card.model';
import type {
  ChatMessage,
  ChatReactions,
  GameArrow,
  GameAttachment,
  GameBattlefieldStack,
  GameTokenGroupView,
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
	presence?: GameSnapshot['presence'];
	disconnectCooldowns?: GameSnapshot['disconnectCooldowns'];
	winnerPlayerId?: string | null;
	resultState?: string | null;
	finishedReason?: string | null;
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
  colorIdentity: string[];
  backgroundName: string | null;
  sleevesName: string | null;
  concededAt?: string | null;
  mulligan?: GamePlayerMulliganState;
  playTopLibraryRevealed?: boolean;
	libraryVisibilityEpoch?: number;
	libraryWindow?: GamePlayerState['libraryWindow'];
	eliminationReason?: GamePlayerState['eliminationReason'];
	eliminatedAtVersion?: number | null;
	sourcePlayerId?: string | null;
	commanderInstanceId?: string | null;
}

export interface GameTableNormalizedV2RelationsState {
  arrows: Record<string, GameArrow>;
  attachments: Record<string, GameAttachment>;
  battlefieldStacks: Record<string, GameBattlefieldStack>;
  tokenGroupsById: Record<string, GameTokenGroupView>;
  specialEntities: Record<string, GameSpecialEntity>;
  indexes: {
    arrowsBySource: Record<string, string[]>;
    arrowsByTarget: Record<string, string[]>;
    attachmentsByEquipment: Record<string, string[]>;
    attachmentsByTarget: Record<string, string[]>;
    battlefieldStacksByMember: Record<string, string[]>;
    tokenGroupIdByMemberRef: Record<string, string>;
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
	turnOrder: string[];
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

    let snapshot: GameSnapshot;
    try {
      snapshot = hydrateGameSnapshotFromV2State(result.state);
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

  const relations = createRelationsState(
    bootstrap.relations.arrows,
    bootstrap.relations.attachments,
    bootstrap.relations.specialEntities,
    bootstrap.relations.battlefieldStacks ?? [],
    bootstrap.relations.tokenGroups ?? [],
  );
  const stack = createStackState(bootstrap.relations.stack);
  const chat = createChatState(bootstrap.chat, bootstrap.chatCursor ?? null);
  const log = createLogState(bootstrap.eventLog, bootstrap.logCursor ?? null);

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
		disconnectVote: normalizeDisconnectVote(bootstrap.game.disconnectVote),
		rematch: normalizeRematch(bootstrap.game.rematch),
		presence: bootstrap.game.presence ? structuredClone(bootstrap.game.presence) : {},
		disconnectCooldowns: bootstrap.game.disconnectCooldowns ? structuredClone(bootstrap.game.disconnectCooldowns) : {},
      lastDiceResult: null,
		winnerPlayerId: bootstrap.game.winnerPlayerId ?? null,
		resultState: bootstrap.game.resultState ?? null,
		finishedReason: bootstrap.game.finishedReason ?? null,
    },
    players: Object.fromEntries(
      Object.entries(bootstrap.players).map(([playerId, player]) => [playerId, normalizePlayer(player)]),
    ),
    sharedCounters: Object.fromEntries(
      Object.entries(bootstrap.sharedCounters ?? {}).map(([scope, counters]) => [scope, { ...counters }]),
    ),
    turn: { ...bootstrap.turn },
		turnOrder: [...(bootstrap.turnOrder ?? Object.keys(bootstrap.players))],
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

export function hydrateGameSnapshotFromV2State(state: GameTableNormalizedV2State): GameSnapshot {
  const players = Object.fromEntries(
    Object.entries(state.players).map(([playerId, player]) => [playerId, hydratePlayerState(state, playerId, player)]),
  ) as Record<string, GamePlayerState>;

  return {
    version: state.lastAppliedVersion,
    ownerId: state.game.ownerId ?? undefined,
    gamePhase: (state.game.gamePhase as GameSnapshot['gamePhase']) ?? undefined,
		turnOrder: [...state.turnOrder],
		winnerPlayerId: state.game.winnerPlayerId ?? null,
		resultState: (state.game.resultState as GameSnapshot['resultState']) ?? null,
		finishedReason: state.game.finishedReason ?? null,
    players,
    counters: Object.fromEntries(
      Object.entries(state.sharedCounters).map(([scope, counters]) => [scope, { ...counters }]),
    ),
    turn: { ...state.turn },
    stack: state.stack.order
      .map((stackId) => hydrateStackItem(state, state.stack.byId[stackId]))
      .filter((item): item is NonNullable<typeof item> => item !== null),
    arrows: Object.values(state.relations.arrows),
    attachments: Object.values(state.relations.attachments),
    battlefieldStacks: Object.values(state.relations.battlefieldStacks),
    tokenGroups: Object.values(state.relations.tokenGroupsById),
    specialEntities: Object.values(state.relations.specialEntities),
    chat: state.chat.order.map((id) => state.chat.byId[id]).filter((message): message is ChatMessage => Boolean(message)),
    eventLog: state.log.order.map((id) => state.log.byId[id]).filter((entry): entry is GameLogEntry => Boolean(entry)),
    rematch: normalizeRematch(state.game.rematch) ?? undefined,
    disconnectVote: normalizeDisconnectVote(state.game.disconnectVote),
		presence: state.game.presence ?? {},
		disconnectCooldowns: state.game.disconnectCooldowns ?? {},
    createdAt: state.game.createdAt ?? new Date(0).toISOString(),
    updatedAt: state.game.updatedAt ?? undefined,
  };
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

function applySameVersionPatch(
  state: GameTableNormalizedV2State,
  patch: PatchEnvelopeV2,
): GameTableNormalizedV2ApplyInternalResult {
  let nextState = state;
  for (const operation of patch.ops) {
    const result = applySameVersionOperation(nextState, operation);
    if (result.status === 'failed') {
      return { status: 'resync_required', state, reason: result.reason };
    }

    nextState = result.state;
  }

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
    case 'private.cards.materialize':
    case 'private.cards.conceal':
      return applyOperationPreservingZoneCounts(state, operation, [{ playerId: operation.playerId, zone: operation.zone }]);
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
    operation.op === 'chat.message.add' || operation.op === 'chat.reaction.set',
  );
}

function isSameVersionVisibilityMergePatch(patch: PatchEnvelopeV2): boolean {
  return typeof patch.ackClientActionId === 'string'
    && patch.ackClientActionId.trim() !== ''
    && patch.ops.length > 0
    && patch.ops.every(isSameVersionVisibilityMergeOperation);
}

function isSameVersionVisibilityMergeOperation(operation: GameplayPatchV2Operation): boolean {
  switch (operation.op) {
    case 'version.advance':
    case 'zone.cards.add':
    case 'zone.cards.remove':
    case 'zone.cards.move':
    case 'zone.cards.batchMove':
    case 'private.cards.materialize':
    case 'private.cards.conceal':
    case 'zone.count.set':
    case 'library.count.set':
    case 'library.top.revealed':
    case 'library.top.viewed':
    case 'library.window.invalidated':
    case 'library.epoch.set':
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
    case 'card.field.set':
    case 'card.counters.patch':
    case 'card.stats.override.set':
    case 'card.stats.override.clear':
    case 'eventLog.append':
    case 'token.group.set':
    case 'token.group.remove':
      return true;
    default:
      return false;
  }
}

type OperationApplyResult =
  | { status: 'applied'; state: GameTableNormalizedV2State }
  | { status: 'failed'; reason: Exclude<GameTableNormalizedV2ApplyFailureReason, 'version_gap' | 'missing_state'> };

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

		case 'player.elimination.set':
			return updatePlayer(state, operation.playerId, (player) => ({
				...player,
				eliminationReason: operation.eliminationReason,
				eliminatedAtVersion: operation.eliminatedAtVersion,
				sourcePlayerId: operation.sourcePlayerId ?? null,
				commanderInstanceId: operation.commanderInstanceId ?? null,
			}));

    case 'turn.set':
      return {
        status: 'applied',
        state: { ...state, turn: { ...operation.turn } },
      };

		case 'turn.order.set':
			return { status: 'applied', state: { ...state, turnOrder: [...operation.turnOrder] } };

		case 'game.result.set':
			return { status: 'applied', state: { ...state, game: {
				...state.game,
				winnerPlayerId: operation.winnerPlayerId ?? null,
				resultState: operation.resultState ?? null,
				finishedReason: operation.finishedReason ?? null,
			} } };

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

    case 'card.field.set':
      return setCardFieldsAtZone(state, operation);

    case 'card.counters.patch':
      return updateInstanceAtZone(state, operation.playerId, operation.zone, operation.instanceId, (instance) => ({
        ...instance,
        counters: { ...operation.counters },
        ...(operation.power !== undefined ? { power: operation.power } : {}),
        ...(operation.toughness !== undefined ? { toughness: operation.toughness } : {}),
      }));

    case 'card.stats.override.set':
    case 'card.stats.override.clear': {
      const instance = state.instances[operation.instanceId];
      if (!instance) {
        return { status: 'failed', reason: 'target_not_found' };
      }
      const manualOverrides = { ...(instance.manualOverrides ?? {}) };
      if (operation.override === null) {
        delete manualOverrides[operation.faceKey];
      } else {
        manualOverrides[operation.faceKey] = { ...operation.override };
      }
      return {
        status: 'applied',
        state: {
          ...state,
          instances: {
            ...state.instances,
            [operation.instanceId]: { ...instance, manualOverrides },
          },
        },
      };
    }

    case 'private.cards.materialize':
      return materializePrivateCards(
        state,
        operation.playerId,
        operation.zone,
        operation.entries,
        operation.staticCards ?? {},
      );

    case 'private.cards.conceal':
      return concealPrivateCards(state, operation.playerId, operation.zone, operation.entries);

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

    case 'zone.reordered':
      return reorderZoneByIds(state, operation.playerId, operation.zone, operation.instanceIds);

    case 'zone.random_card.selected':
      return { status: 'applied', state };

    case 'library.count.set':
      return setZoneCount(state, operation.playerId, 'library', operation.count);

    case 'library.top.revealed':
      return revealLibraryTop(state, operation.playerId, operation.cards, operation.staticCards ?? {});

    case 'library.top.viewed': {
      const revealed = revealLibraryTop(state, operation.playerId, operation.cards, operation.staticCards ?? {});
      if (revealed.status === 'failed') {
        return revealed;
      }
      return setLibraryWindow(revealed.state, operation.playerId, {
        windowId: operation.windowId,
        expectedEpoch: operation.expectedEpoch,
        openedAtVersion: operation.openedAtVersion,
        status: operation.status,
      });
    }

    case 'library.window.invalidated':
      return invalidateLibraryWindow(state, operation);

    case 'library.epoch.set':
      return setLibraryEpoch(state, operation.playerId, operation.epoch);

    case 'library.revealed.set':
      return revealLibraryTop(state, operation.playerId, operation.cards, operation.staticCards ?? {});

    case 'library.play_top_revealed.set':
      return setPlayTopLibraryRevealed(state, operation.playerId, operation.enabled);

    case 'library.top.hidden':
      return clearKnownLibraryOrder(state, operation.playerId);

    case 'library.top.reordered':
      return reorderLibraryTop(state, operation.playerId, operation.instanceIds);

    case 'library.top.moved':
      return moveKnownLibraryTopToBottom(state, operation.playerId, operation.instanceIds);

    case 'library.shuffled':
      return clearKnownLibraryOrder(state, operation.playerId);

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
        mulligan: mergeMulliganPrivateStatePatch(
          player.mulligan,
          operation.state,
          operation.hand?.length ?? operation.state.handSize ?? player.handCount,
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

    case 'cards.position.set': {
      const zoneInstances = state.zones[operation.playerId]?.[operation.zone] ?? [];
      const uniqueIds = new Set(operation.positions.map((entry) => entry.instanceId));
      if (
        uniqueIds.size !== operation.positions.length
        || operation.positions.some((entry) => !zoneInstances.includes(entry.instanceId) || !state.instances[entry.instanceId])
      ) {
        return { status: 'failed', reason: 'target_not_found' };
      }

      let next = state;
      for (const entry of operation.positions) {
        const result = applyOperation(next, {
          op: 'card.field.set',
          playerId: operation.playerId,
          zone: operation.zone,
          instanceId: entry.instanceId,
          position: entry.position,
        });
        if (result.status !== 'applied') {
          return result;
        }
        next = result.state;
      }

      return { status: 'applied', state: next };
    }

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
    case 'attachment.set':
      return addRelation(state, 'attachment', operation.attachment);

    case 'attachment.remove':
      return removeRelation(state, 'attachment', operation.id);

    case 'attachment.order.set':
      return setAttachmentOrder(state, operation.attachedToInstanceId, operation.orderedAttachmentIds);

    case 'battlefield.stack.set':
      return setBattlefieldStack(state, operation.stack);

    case 'battlefield.stack.remove':
      return removeBattlefieldStack(state, operation.id);

    case 'token.group.set':
      return setTokenGroup(state, operation.group);

    case 'token.group.remove':
      return removeTokenGroup(state, operation.groupId);

    case 'battlefield.stack.order.set':
      return setBattlefieldStackOrder(state, operation.stackId, operation.rootInstanceId, operation.orderedInstanceIds);

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
            disconnectVote: disconnectVotePayload(operation),
          },
        },
      };

	case 'player.presence.set':
		return {
			status: 'applied',
			state: { ...state, game: { ...state.game, presence: { ...(state.game.presence ?? {}), [operation.playerId]: { ...operation.presence } } } },
		};

	case 'disconnect.cooldown.set': {
		const cooldowns = { ...(state.game.disconnectCooldowns ?? {}) };
		if (operation.cooldown) {
			cooldowns[operation.targetPlayerId] = { ...operation.cooldown };
		} else {
			delete cooldowns[operation.targetPlayerId];
		}
		return { status: 'applied', state: { ...state, game: { ...state.game, disconnectCooldowns: cooldowns } } };
	}

    case 'rematch.set':
      return {
        status: 'applied',
        state: {
          ...state,
          game: {
            ...state.game,
            rematch: normalizeRematch(operation.rematch),
          },
        },
      };

    default:
      return { status: 'failed', reason: 'invalid_operation' };
  }
}

function disconnectVotePayload(operation: GameplayPatchV2Operation): GameDisconnectVoteState | null {
  const payload = operation as {
    disconnectVote?: GameDisconnectVoteState | null;
    data?: { disconnectVote?: GameDisconnectVoteState | null };
  };

  return normalizeDisconnectVote(payload.disconnectVote ?? payload.data?.disconnectVote ?? null);
}

function normalizeDisconnectVote(vote: GameDisconnectVoteState | null | undefined): GameDisconnectVoteState | null {
  if (!vote?.targetPlayerId || !vote.status) {
    return null;
  }

  const votes = { ...(vote.votes ?? vote.votesByPlayerId ?? {}) };
  return { ...vote, votes, votesByPlayerId: { ...(vote.votesByPlayerId ?? votes) } };
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

  const visibleCards = zone === 'battlefield' && state.game.viewerId === playerId
    ? cards.filter((card) => !isOpaqueBattlefieldShell(card, playerId))
    : cards;
  if (visibleCards.length === 0) {
    return { status: 'applied', state };
  }

  const nextInstances = { ...state.instances };
  const nextStaticCards = { ...state.staticCards };
  const insertedIds: string[] = [];
  for (const card of visibleCards) {
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

function isOpaqueBattlefieldShell(
  card: BootstrapInstanceV2 | LegacyCardPatchPayload,
  playerId: string,
): boolean {
  return card.hidden === true
    && card.faceDown === true
    && typeof card.instanceId === 'string'
    && card.instanceId.startsWith(`${playerId}-hidden-battlefield-`);
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
  const removalIds = new Set(instanceIds);
  const knownRemovalCount = currentZone.filter((instanceId) => removalIds.has(instanceId)).length;
  const removedZone = removeIds(currentZone, instanceIds);
  const normalizedPrivateZone = normalizeOpaqueHandOrdinals(state.instances, playerId, zone, removedZone);

  return {
    status: 'applied',
    state: {
      ...state,
      instances: normalizedPrivateZone.instances,
      relations: remapProjectedRelationsForInstanceChanges(
        state.relations,
        Object.fromEntries(instanceIds.map((instanceId) => [instanceId, null])),
        normalizedPrivateZone.instances,
      ),
      zones: {
        ...state.zones,
        [playerId]: {
          ...playerZones,
          [zone]: normalizedPrivateZone.instanceIds,
        },
      },
      zoneCounts: {
        ...state.zoneCounts,
        [playerId]: {
          ...playerZoneCounts,
          [zone]: knownRemovalCount === 0 ? playerZoneCounts[zone] : normalizedPrivateZone.instanceIds.length,
        },
      },
    },
  };
}

function normalizeRematch(rematch: GameRematchState | null | undefined): GameRematchState | null {
  if (!rematch) {
    return null;
  }

  return { ...rematch, votes: { ...(rematch.votes ?? {}) } };
}

function normalizeOpaqueHandOrdinals(
  instances: Record<string, BootstrapInstanceV2>,
  playerId: string,
  zone: GameZoneName,
  instanceIds: string[],
): { instances: Record<string, BootstrapInstanceV2>; instanceIds: string[] } {
  if (zone !== 'hand') {
    return { instances, instanceIds };
  }

  const prefix = `${playerId}-hidden-hand-`;
  const replacements = instanceIds
    .map((instanceId, index) => ({ instanceId, replacementId: `${prefix}${index}`, instance: instances[instanceId] }))
    .filter(({ instanceId, replacementId, instance }) => instanceId.startsWith(prefix) && instance?.hidden === true && instanceId !== replacementId);
  if (replacements.length === 0) {
    return { instances, instanceIds };
  }

  const nextInstances = { ...instances };
  for (const { instanceId } of replacements) {
    delete nextInstances[instanceId];
  }
  for (const { replacementId, instance } of replacements) {
    nextInstances[replacementId] = {
      ...instance!,
      instanceId: replacementId,
      cardRef: `placeholder:${replacementId}`,
      zoneId: zoneId(playerId, zone),
    };
  }

  const replacementIds = new Map(replacements.map(({ instanceId, replacementId }) => [instanceId, replacementId]));
  return {
    instances: nextInstances,
    instanceIds: instanceIds.map((instanceId) => replacementIds.get(instanceId) ?? instanceId),
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
    };
  }

  const samePlayer = operation.from.playerId === operation.to.playerId;
  const sameZone = samePlayer && operation.from.zone === operation.to.zone;
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

  return {
    status: 'applied',
    state: {
      ...state,
      instances: nextInstances,
      staticCards: nextStaticCards,
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
    },
  };
}

function setLibraryWindow(
  state: GameTableNormalizedV2State,
  playerId: string,
  window: NonNullable<GamePlayerState['libraryWindow']>,
): OperationApplyResult {
  return updatePlayer(state, playerId, (player) => ({
    ...player,
    libraryVisibilityEpoch: window.expectedEpoch,
    libraryWindow: { ...window },
  }));
}

function setLibraryEpoch(
  state: GameTableNormalizedV2State,
  playerId: string,
  epoch: number,
): OperationApplyResult {
  return updatePlayer(state, playerId, (player) => ({
    ...player,
    libraryVisibilityEpoch: Math.max(0, Math.floor(epoch)),
  }));
}

function invalidateLibraryWindow(
  state: GameTableNormalizedV2State,
  operation: Extract<GameplayPatchV2Operation, { op: 'library.window.invalidated' }>,
): OperationApplyResult {
  return updatePlayer(state, operation.playerId, (player) => {
    const current = player.libraryWindow;
    return {
      ...player,
      libraryVisibilityEpoch: Math.max(0, Math.floor(operation.currentEpoch)),
      libraryWindow: current?.windowId === operation.windowId
        ? {
            ...current,
            status: operation.status,
            reason: operation.reason ?? null,
          }
        : current,
    };
  });
}

function materializePrivateCards(
  state: GameTableNormalizedV2State,
  playerId: string,
  zone: GameZoneName,
  entries: Extract<GameplayPatchV2Operation, { op: 'private.cards.materialize' }>['entries'],
  staticCards: Record<string, BootstrapStaticCardV2>,
): OperationApplyResult {
  const playerZones = state.zones[playerId];
  if (!playerZones || !isPlaceholderPrivateZone(zone) || entries.length === 0) {
    return { status: 'failed', reason: 'invalid_operation' };
  }

  const nextZone = [...(playerZones[zone] ?? [])];
  const nextInstances = { ...state.instances };
  const nextStaticCards = { ...state.staticCards };
  const materializedIds = new Set<string>();
  const relationRefReplacements: Record<string, string | null> = {};

  for (const entry of entries) {
    const instanceId = entry.card.instanceId?.trim();
    if (!instanceId || !Number.isInteger(entry.index) || entry.index < 0 || materializedIds.has(instanceId)) {
      return { status: 'failed', reason: 'invalid_operation' };
    }
    materializedIds.add(instanceId);

    if (nextZone.includes(instanceId)) {
      continue;
    }

    const placeholderId = entry.placeholderId?.trim() ?? '';
    const placeholderIndex = placeholderId ? nextZone.indexOf(placeholderId) : -1;
    if (zone === 'hand' && placeholderIndex < 0) {
      return { status: 'failed', reason: 'target_not_found' };
    }

    const normalized = normalizeIncomingCard(entry.card, playerId, zone, staticCards, {
      instances: nextInstances,
      staticCards: nextStaticCards,
    });
    if (normalized.staticCard) {
      nextStaticCards[normalized.staticCard.cardRef] = mergeStaticCard(
        nextStaticCards[normalized.staticCard.cardRef],
        normalized.staticCard,
      );
    }
    nextInstances[instanceId] = completeInstanceIdentity(
      { ...normalized.instance, hidden: false },
      nextStaticCards[normalized.instance.cardRef],
    );

    if (placeholderIndex >= 0) {
      nextZone.splice(placeholderIndex, 1, instanceId);
      delete nextInstances[placeholderId];
      relationRefReplacements[placeholderId] = instanceId;
    } else {
      nextZone.splice(Math.min(entry.index, nextZone.length), 0, instanceId);
    }
  }

  return {
    status: 'applied',
    state: {
      ...state,
      instances: nextInstances,
      staticCards: nextStaticCards,
      relations: remapProjectedRelationsForInstanceChanges(
        state.relations,
        relationRefReplacements,
        nextInstances,
      ),
      zones: {
        ...state.zones,
        [playerId]: {
          ...playerZones,
          [zone]: nextZone,
        },
      },
    },
  };
}

function concealPrivateCards(
  state: GameTableNormalizedV2State,
  playerId: string,
  zone: GameZoneName,
  entries: Extract<GameplayPatchV2Operation, { op: 'private.cards.conceal' }>['entries'],
): OperationApplyResult {
  const playerZones = state.zones[playerId];
  if (!playerZones || !isPlaceholderPrivateZone(zone) || entries.length === 0) {
    return { status: 'failed', reason: 'invalid_operation' };
  }
  if (state.game.viewerId === playerId) {
    return { status: 'applied', state };
  }

  const nextZone = [...(playerZones[zone] ?? [])];
  const nextInstances = { ...state.instances };
  const removedCardRefs = new Set<string>();
  const relationRefReplacements: Record<string, string | null> = {};

  for (const entry of entries) {
    const instanceId = entry.instanceId?.trim() ?? '';
    const placeholderId = entry.placeholderId.trim();
    const removeWithoutPlaceholder = zone === 'library' && placeholderId.length === 0;
    if ((!instanceId && !placeholderId) || (!placeholderId && !removeWithoutPlaceholder) || !Number.isInteger(entry.index) || entry.index < 0) {
      return { status: 'failed', reason: 'invalid_operation' };
    }

    const indexedInstanceId = !instanceId && entry.index < nextZone.length ? nextZone[entry.index] ?? '' : '';
    const targetInstanceId = instanceId || indexedInstanceId;
    const realIndex = instanceId ? nextZone.indexOf(instanceId) : entry.index;
    const placeholderIndex = placeholderId ? nextZone.indexOf(placeholderId) : -1;
    if (realIndex < 0 || realIndex >= nextZone.length || !targetInstanceId) {
      if (placeholderIndex >= 0) {
        continue;
      }
      const removed = targetInstanceId ? nextInstances[targetInstanceId] : undefined;
      if (!removed) {
        return { status: 'failed', reason: 'target_not_found' };
      }
      if (removed.cardRef) {
        removedCardRefs.add(removed.cardRef);
      }
      delete nextInstances[targetInstanceId];
      if (placeholderId) {
        const insertIndex = Math.min(entry.index, nextZone.length);
        nextZone.splice(insertIndex, 0, placeholderId);
        nextInstances[placeholderId] = hiddenPlaceholderInstance(playerId, zone, placeholderId, removed);
      }
      relationRefReplacements[targetInstanceId] = placeholderId || null;
      continue;
    }

    if (nextZone[realIndex] === placeholderId) {
      continue;
    }
    const removed = nextInstances[targetInstanceId];
    if (removed?.cardRef) {
      removedCardRefs.add(removed.cardRef);
    }
    delete nextInstances[targetInstanceId];

    if (placeholderIndex >= 0 || !placeholderId) {
      nextZone.splice(realIndex, 1);
    } else {
      nextZone.splice(realIndex, 1, placeholderId);
      nextInstances[placeholderId] = hiddenPlaceholderInstance(playerId, zone, placeholderId, removed);
    }
    relationRefReplacements[targetInstanceId] = placeholderId || null;
  }

  const nextStaticCards = { ...state.staticCards };
  const retainedCardRefs = new Set(Object.values(nextInstances).map((instance) => instance.cardRef));
  for (const cardRef of removedCardRefs) {
    if (!retainedCardRefs.has(cardRef)) {
      delete nextStaticCards[cardRef];
    }
  }

  return {
    status: 'applied',
    state: {
      ...state,
      instances: nextInstances,
      staticCards: nextStaticCards,
      relations: remapProjectedRelationsForInstanceChanges(
        state.relations,
        relationRefReplacements,
        nextInstances,
      ),
      zones: {
        ...state.zones,
        [playerId]: {
          ...playerZones,
          [zone]: nextZone,
        },
      },
    },
  };
}

function remapProjectedRelationsForInstanceChanges(
  relations: GameTableNormalizedV2RelationsState,
  replacements: Record<string, string | null>,
  instances: Record<string, BootstrapInstanceV2>,
): GameTableNormalizedV2RelationsState {
  if (Object.keys(replacements).length === 0) {
    return relations;
  }

  const remap = (instanceId: string): string | null => (
    Object.prototype.hasOwnProperty.call(replacements, instanceId)
      ? replacements[instanceId]
      : instanceId
  );
  const sameVisibility = (instanceIds: string[]): boolean => {
    const resolved = instanceIds.map((instanceId) => instances[instanceId]);
    return resolved.every(Boolean)
      && resolved.every((instance) => Boolean(instance?.hidden) === Boolean(resolved[0]?.hidden));
  };

  const arrows = Object.values(relations.arrows).flatMap((arrow) => {
    const fromInstanceId = remap(arrow.fromInstanceId);
    const toInstanceId = remap(arrow.toInstanceId);
    const touched = fromInstanceId !== arrow.fromInstanceId || toInstanceId !== arrow.toInstanceId;
    if (!touched) {
      return [arrow];
    }
    if (!fromInstanceId || !toInstanceId || !sameVisibility([fromInstanceId, toInstanceId])) {
      return [];
    }
    return [{ ...arrow, fromInstanceId, toInstanceId }];
  });
  const attachments = Object.values(relations.attachments).flatMap((attachment) => {
    const equipmentInstanceId = remap(attachment.equipmentInstanceId);
    const attachedToInstanceId = remap(attachment.attachedToInstanceId);
    const touched = equipmentInstanceId !== attachment.equipmentInstanceId
      || attachedToInstanceId !== attachment.attachedToInstanceId;
    if (!touched) {
      return [attachment];
    }
    if (!equipmentInstanceId || !attachedToInstanceId || !sameVisibility([equipmentInstanceId, attachedToInstanceId])) {
      return [];
    }
    return [{ ...attachment, equipmentInstanceId, attachedToInstanceId }];
  });
  const battlefieldStacks = Object.values(relations.battlefieldStacks).flatMap((stack) => {
    const rootInstanceId = remap(stack.rootInstanceId);
    const orderedMemberIds = stack.orderedMemberIds.map(remap);
    const touched = rootInstanceId !== stack.rootInstanceId
      || orderedMemberIds.some((instanceId, index) => instanceId !== stack.orderedMemberIds[index]);
    if (!touched) {
      return [stack];
    }
    if (!rootInstanceId || orderedMemberIds.some((instanceId) => !instanceId)) {
      return [];
    }
    const safeMemberIds = orderedMemberIds as string[];
    if (!sameVisibility([rootInstanceId, ...safeMemberIds])) {
      return [];
    }
    return [{ ...stack, rootInstanceId, orderedMemberIds: safeMemberIds }];
  });
  const tokenGroups = Object.values(relations.tokenGroupsById).flatMap((group) => {
    const rootRef = remap(group.rootRef);
    const memberRefs = group.memberRefs?.map(remap);
    const touched = rootRef !== group.rootRef
      || memberRefs?.some((memberRef, index) => memberRef !== group.memberRefs?.[index]);
    if (!touched) {
      return [group];
    }
    if (!rootRef || !memberRefs || memberRefs.some((memberRef) => !memberRef)) {
      return [];
    }
    const safeMemberRefs = memberRefs as string[];
    if (!safeMemberRefs.includes(rootRef) || !sameVisibility(safeMemberRefs)) {
      return [];
    }
    return [{ ...group, rootRef, memberRefs: safeMemberRefs }];
  });

  return createRelationsState(
    arrows,
    attachments,
    Object.values(relations.specialEntities),
    battlefieldStacks,
    tokenGroups,
  );
}

function hiddenPlaceholderInstance(
  playerId: string,
  zone: GameZoneName,
  instanceId: string,
  previous?: BootstrapInstanceV2,
): BootstrapInstanceV2 {
  return {
    instanceId,
    cardRef: `placeholder:${instanceId}`,
    zoneId: zoneId(playerId, zone),
    ownerId: previous?.ownerId ?? playerId,
    controllerId: previous?.controllerId ?? playerId,
    hidden: true,
    faceDown: true,
    tapped: previous?.tapped ?? false,
    ...(previous?.rotation !== undefined ? { rotation: previous.rotation } : {}),
    ...(previous?.position != null ? { position: { ...previous.position } } : {}),
    counters: { ...(previous?.counters ?? {}) },
    revealedTo: [],
  };
}

function isPlaceholderPrivateZone(zone: GameZoneName): zone is 'hand' | 'library' | 'battlefield' {
  return zone === 'hand' || zone === 'library' || zone === 'battlefield';
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
): OperationApplyResult {
  const playerZones = state.zones[playerId];
  if (!playerZones) {
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
          library: [],
        },
      },
    },
  };
}

function moveKnownLibraryTopToBottom(
  state: GameTableNormalizedV2State,
  playerId: string,
  instanceIds: string[],
): OperationApplyResult {
  const playerZones = state.zones[playerId];
  if (!playerZones) {
    return { status: 'failed', reason: 'target_not_found' };
  }
  const currentLibrary = playerZones.library ?? [];
  if (instanceIds.some((instanceId, index) => currentLibrary[index] !== instanceId)) {
    return { status: 'failed', reason: 'target_not_found' };
  }
  const moved = new Set(instanceIds);

  return {
    status: 'applied',
    state: {
      ...state,
      zones: {
        ...state.zones,
        [playerId]: {
          ...playerZones,
          library: [...currentLibrary.filter((instanceId) => !moved.has(instanceId)), ...instanceIds],
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
          [stackId]: { ...state.stack.byId[stackId], ...item, stackId, id: stackId },
        },
        order: state.stack.order.includes(stackId) ? state.stack.order : [...state.stack.order, stackId],
      },
    },
  };
}

function removeStackItem(state: GameTableNormalizedV2State, stackId: string): OperationApplyResult {
  if (!state.stack.byId[stackId]) {
    return { status: 'applied', state };
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
  const referencedIds = kind === 'arrow'
    ? [(relation as GameArrow).fromInstanceId, (relation as GameArrow).toInstanceId]
    : [(relation as GameAttachment).equipmentInstanceId, (relation as GameAttachment).attachedToInstanceId];
  if (referencedIds.some((instanceId) => state.relations.indexes.tokenGroupIdByMemberRef[instanceId])) {
    return { status: 'failed', reason: 'invalid_operation' };
  }
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
          Object.values(state.relations.battlefieldStacks),
          Object.values(state.relations.tokenGroupsById),
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
        Object.values(state.relations.battlefieldStacks),
        Object.values(state.relations.tokenGroupsById),
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
          Object.values(state.relations.battlefieldStacks),
          Object.values(state.relations.tokenGroupsById),
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
        Object.values(state.relations.battlefieldStacks),
        Object.values(state.relations.tokenGroupsById),
      ),
    },
  };
}

function setAttachmentOrder(
  state: GameTableNormalizedV2State,
  targetInstanceId: string,
  orderedAttachmentIds: readonly string[],
): OperationApplyResult {
  const targetAttachments = Object.values(state.relations.attachments)
    .filter((attachment) => attachment.attachedToInstanceId === targetInstanceId);
  if (!sameIdSet(targetAttachments.map((attachment) => attachment.id), orderedAttachmentIds)) {
    return { status: 'failed', reason: 'invalid_operation' };
  }
  const order = new Map(orderedAttachmentIds.map((id, index) => [id, index + 1]));
  const attachments = Object.values(state.relations.attachments).map((attachment) => ({
    ...attachment,
    order: attachment.attachedToInstanceId === targetInstanceId ? order.get(attachment.id) : attachment.order,
  }));

  return {
    status: 'applied',
    state: {
      ...state,
      relations: createRelationsState(
        Object.values(state.relations.arrows),
        attachments,
        Object.values(state.relations.specialEntities),
        Object.values(state.relations.battlefieldStacks),
        Object.values(state.relations.tokenGroupsById),
      ),
    },
  };
}

function setBattlefieldStack(state: GameTableNormalizedV2State, stack: GameBattlefieldStack): OperationApplyResult {
  const members = [...stack.orderedMemberIds];
  if (!validBattlefieldStack(stack.rootInstanceId, members)) {
    return { status: 'failed', reason: 'invalid_operation' };
  }
  const memberSet = new Set(members);
  if (members.some((memberId) => state.relations.indexes.tokenGroupIdByMemberRef[memberId])) {
    return { status: 'failed', reason: 'invalid_operation' };
  }
  const conflicts = Object.values(state.relations.battlefieldStacks)
    .some((candidate) => candidate.id !== stack.id && candidate.orderedMemberIds.some((id) => memberSet.has(id)));
  if (conflicts) {
    return { status: 'failed', reason: 'invalid_operation' };
  }
  const stacks = [
    ...Object.values(state.relations.battlefieldStacks).filter((candidate) => candidate.id !== stack.id),
    { ...stack, orderedMemberIds: members },
  ];
  return {
    status: 'applied',
    state: {
      ...state,
      relations: createRelationsState(
        Object.values(state.relations.arrows),
        Object.values(state.relations.attachments),
        Object.values(state.relations.specialEntities),
        stacks,
        Object.values(state.relations.tokenGroupsById),
      ),
    },
  };
}

function removeBattlefieldStack(state: GameTableNormalizedV2State, stackId: string): OperationApplyResult {
  if (!state.relations.battlefieldStacks[stackId]) {
    return { status: 'applied', state };
  }
  return {
    status: 'applied',
    state: {
      ...state,
      relations: createRelationsState(
        Object.values(state.relations.arrows),
        Object.values(state.relations.attachments),
        Object.values(state.relations.specialEntities),
        Object.values(state.relations.battlefieldStacks).filter((stack) => stack.id !== stackId),
        Object.values(state.relations.tokenGroupsById),
      ),
    },
  };
}

function setTokenGroup(state: GameTableNormalizedV2State, incoming: GameTokenGroupView): OperationApplyResult {
  const memberRefs = incoming.memberRefs ? [...incoming.memberRefs] : undefined;
  const group: GameTokenGroupView = {
    ...incoming,
    ...(memberRefs ? { memberRefs } : {}),
    position: { ...incoming.position },
  };
  if (!validTokenGroupView(group)) {
    return { status: 'failed', reason: 'invalid_operation' };
  }
  const existing = state.relations.tokenGroupsById[group.groupId];
  if (existing && group.revision < existing.revision) {
    return { status: 'applied', state };
  }
  if (existing && group.revision === existing.revision) {
    return tokenGroupViewEqual(existing, group)
      ? { status: 'applied', state }
      : { status: 'failed', reason: 'invalid_operation' };
  }

  const refs = memberRefs ?? [group.rootRef];
  if (refs.some((ref) => !state.instances[ref])) {
    return { status: 'failed', reason: 'target_not_found' };
  }
  const memberSet = new Set(refs);
  const membershipConflict = Object.values(state.relations.tokenGroupsById).some((candidate) =>
    candidate.groupId !== group.groupId
      && (candidate.memberRefs ?? [candidate.rootRef]).some((ref) => memberSet.has(ref)),
  );
  const stackConflict = Object.values(state.relations.battlefieldStacks).some((stack) =>
    stack.orderedMemberIds.some((ref) => memberSet.has(ref)),
  );
  const binaryRelationConflict = Object.values(state.relations.arrows).some((arrow) =>
    memberSet.has(arrow.fromInstanceId) || memberSet.has(arrow.toInstanceId),
  ) || Object.values(state.relations.attachments).some((attachment) =>
    memberSet.has(attachment.equipmentInstanceId) || memberSet.has(attachment.attachedToInstanceId),
  );
  if (membershipConflict || stackConflict || binaryRelationConflict) {
    return { status: 'failed', reason: 'invalid_operation' };
  }

  return {
    status: 'applied',
    state: {
      ...state,
      relations: createRelationsState(
        Object.values(state.relations.arrows),
        Object.values(state.relations.attachments),
        Object.values(state.relations.specialEntities),
        Object.values(state.relations.battlefieldStacks),
        [...Object.values(state.relations.tokenGroupsById).filter((candidate) => candidate.groupId !== group.groupId), group],
      ),
    },
  };
}

function removeTokenGroup(state: GameTableNormalizedV2State, groupId: string): OperationApplyResult {
  if (!state.relations.tokenGroupsById[groupId]) {
    return { status: 'applied', state };
  }
  return {
    status: 'applied',
    state: {
      ...state,
      relations: createRelationsState(
        Object.values(state.relations.arrows),
        Object.values(state.relations.attachments),
        Object.values(state.relations.specialEntities),
        Object.values(state.relations.battlefieldStacks),
        Object.values(state.relations.tokenGroupsById).filter((candidate) => candidate.groupId !== groupId),
      ),
    },
  };
}

function validTokenGroupView(group: GameTokenGroupView): boolean {
  if (group.groupId.trim() === ''
    || group.rootRef.trim() === ''
    || group.quantity < 2
    || !Number.isInteger(group.quantity)
    || group.revision < 1
    || !Number.isInteger(group.revision)
    || group.effectVersion !== 1
    || !Number.isFinite(group.position.x)
    || !Number.isFinite(group.position.y)) {
    return false;
  }
  if (!group.memberRefs) {
    return true;
  }
  return group.memberRefs.length === group.quantity
    && new Set(group.memberRefs).size === group.memberRefs.length
    && group.memberRefs.includes(group.rootRef);
}

function tokenGroupViewEqual(left: GameTokenGroupView, right: GameTokenGroupView): boolean {
  return left.groupId === right.groupId
    && left.rootRef === right.rootRef
    && left.quantity === right.quantity
    && left.revision === right.revision
    && left.effectVersion === right.effectVersion
    && left.faceDown === right.faceDown
    && left.tapped === right.tapped
    && left.rotation === right.rotation
    && left.position.x === right.position.x
    && left.position.y === right.position.y
    && left.position.unit === right.position.unit
    && ((!left.memberRefs && !right.memberRefs)
      || Boolean(left.memberRefs && right.memberRefs
        && left.memberRefs.length === right.memberRefs.length
        && left.memberRefs.every((ref, index) => ref === right.memberRefs?.[index])));
}

function setBattlefieldStackOrder(
  state: GameTableNormalizedV2State,
  stackId: string,
  rootInstanceId: string,
  orderedInstanceIds: readonly string[],
): OperationApplyResult {
  const stack = state.relations.battlefieldStacks[stackId];
  if (!stack || !sameIdSet(stack.orderedMemberIds, orderedInstanceIds) || !validBattlefieldStack(rootInstanceId, orderedInstanceIds)) {
    return { status: 'failed', reason: 'invalid_operation' };
  }
  return setBattlefieldStack(state, { ...stack, rootInstanceId, orderedMemberIds: [...orderedInstanceIds] });
}

function validBattlefieldStack(rootInstanceId: string, orderedMemberIds: readonly string[]): boolean {
  return orderedMemberIds.length >= 2
    && new Set(orderedMemberIds).size === orderedMemberIds.length
    && orderedMemberIds.includes(rootInstanceId);
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && left.every((id) => right.includes(id));
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
        Object.values(state.relations.battlefieldStacks),
        Object.values(state.relations.tokenGroupsById),
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
        Object.values(state.relations.battlefieldStacks),
        Object.values(state.relations.tokenGroupsById),
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

function createChatState(entries: readonly ChatMessage[] | undefined, fallbackCursor: string | null): GameTableNormalizedV2ChatState {
  const byId: Record<string, ChatMessage> = {};
  const order: string[] = [];
  let cursor = fallbackCursor;
  for (const entry of entries ?? []) {
    const id = chatMessageId(entry);
    byId[id] = { ...entry, id };
    if (!order.includes(id)) {
      order.push(id);
    }
    cursor = entry.id ?? entry.createdAt ?? cursor;
  }

  return { byId, order, cursor };
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

  return { byId, order, cursor };
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

type MulliganPrivateStatePatch = Extract<
  GameplayPatchV2Operation,
  { op: 'mulligan.private_state.set' }
>['state'];

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
		eliminationReason: player.eliminationReason ?? null,
		eliminatedAtVersion: player.eliminatedAtVersion ?? null,
		sourcePlayerId: player.sourcePlayerId ?? null,
		commanderInstanceId: player.commanderInstanceId ?? null,
    deckName: player.deckName ?? null,
    colorIdentity: [...player.colorIdentity],
    backgroundName: player.backgroundName ?? undefined,
    sleevesName: player.sleevesName ?? undefined,
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
    playTopLibraryRevealed: player.playTopLibraryRevealed,
    libraryVisibilityEpoch: Math.max(0, player.libraryVisibilityEpoch ?? 0),
    libraryWindow: player.libraryWindow ? { ...player.libraryWindow } : null,
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
    scryfallId: staticCard?.scryfallId ?? undefined,
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
    position: instance.position ?? undefined,
    rotation: instance.rotation ?? 0,
    counters: instance.counters ? { ...instance.counters } : undefined,
    printedStats: instance.printedStats ? structuredClone(instance.printedStats) : undefined,
    manualOverrides: instance.manualOverrides ? structuredClone(instance.manualOverrides) : undefined,
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
    colorIdentity: player.colorIdentity ? [...player.colorIdentity] : [],
    backgroundName: player.backgroundName ?? null,
    sleevesName: player.sleevesName ?? null,
    playTopLibraryRevealed: player.playTopLibraryRevealed ?? false,
    libraryVisibilityEpoch: Math.max(0, player.libraryVisibilityEpoch ?? 0),
    libraryWindow: null,
    mulligan: player.mulligan ? { ...player.mulligan } : undefined,
		eliminationReason: player.eliminationReason ?? null,
		eliminatedAtVersion: player.eliminatedAtVersion ?? null,
		sourcePlayerId: player.sourcePlayerId ?? null,
		commanderInstanceId: player.commanderInstanceId ?? null,
  };
}

function setCardFieldsAtZone(
  state: GameTableNormalizedV2State,
  operation: Extract<GameplayPatchV2Operation, { op: 'card.field.set' }>,
): OperationApplyResult {
  const playerZone = state.zones[operation.playerId]?.[operation.zone] ?? [];
  const instance = state.instances[operation.instanceId];
  if (!playerZone.includes(operation.instanceId) || !instance) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const nextCardRef = operation.cardKey?.trim() ?? '';
  let nextStaticCards = state.staticCards;
  if (nextCardRef && nextCardRef !== instance.cardRef && !state.staticCards[nextCardRef]) {
    const currentStaticCard = state.staticCards[instance.cardRef];
    if (currentStaticCard && hasRenderableStaticContent(currentStaticCard)) {
      nextStaticCards = {
        ...state.staticCards,
        [nextCardRef]: normalizeStaticCard({
          ...currentStaticCard,
          cardRef: nextCardRef,
          cardKey: nextCardRef,
        }),
      };
    }
  }

  return {
    status: 'applied',
    state: {
      ...state,
      staticCards: nextStaticCards,
      instances: {
        ...state.instances,
        [operation.instanceId]: {
          ...instance,
          ...(operation.tapped !== undefined ? { tapped: operation.tapped } : {}),
          ...(operation.rotation !== undefined ? { rotation: operation.rotation } : {}),
          ...(operation.faceDown !== undefined ? { faceDown: operation.faceDown } : {}),
          ...(operation.hidden !== undefined ? { hidden: operation.hidden } : {}),
          ...(nextCardRef ? { cardKey: nextCardRef, cardRef: nextCardRef } : {}),
          ...(operation.controllerId !== undefined ? { controllerId: operation.controllerId } : {}),
          ...(operation.revealedTo !== undefined ? { revealedTo: [...operation.revealedTo] } : {}),
          ...(operation.counters !== undefined ? { counters: { ...operation.counters } } : {}),
          ...(operation.dungeonMarker !== undefined ? { dungeonMarker: operation.dungeonMarker } : {}),
          ...(operation.activeFaceIndex !== undefined ? { activeFaceIndex: operation.activeFaceIndex } : {}),
          ...(operation.position !== undefined ? { position: operation.position } : {}),
          ...(operation.power !== undefined ? { power: operation.power } : {}),
          ...(operation.toughness !== undefined ? { toughness: operation.toughness } : {}),
          ...(operation.loyalty !== undefined ? { loyalty: operation.loyalty } : {}),
          ...(operation.defense !== undefined ? { defense: operation.defense } : {}),
          ...(operation.saga !== undefined ? { saga: operation.saga } : {}),
        },
      },
    },
  };
}

function normalizeInstance(instance: BootstrapInstanceV2): BootstrapInstanceV2 {
  return {
    ...instance,
    counters: instance.counters ? { ...instance.counters } : {},
    revealedTo: instance.revealedTo ? [...instance.revealedTo] : [],
    printedStats: instance.printedStats ? structuredClone(instance.printedStats) : undefined,
    manualOverrides: instance.manualOverrides ? structuredClone(instance.manualOverrides) : undefined,
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
      printedStats: legacy.printedStats ? structuredClone(legacy.printedStats) : undefined,
      manualOverrides: legacy.manualOverrides ? structuredClone(legacy.manualOverrides) : undefined,
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

  if (!staticCard) {
    throw new Error(`Identity contract violation: visible card ${instanceId} has no static card for ${instance.cardRef}.`);
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
  battlefieldStacks: GameBattlefieldStack[] = [],
  tokenGroups: GameTokenGroupView[] = [],
): GameTableNormalizedV2RelationsState {
  const arrowsBySource: Record<string, string[]> = {};
  const arrowsByTarget: Record<string, string[]> = {};
  const attachmentsByEquipment: Record<string, string[]> = {};
  const attachmentsByTarget: Record<string, string[]> = {};
  const battlefieldStacksByMember: Record<string, string[]> = {};
  const tokenGroupIdByMemberRef: Record<string, string> = {};
  const tokenGroupIds = new Set<string>();

  for (const arrow of arrows) {
    appendIndex(arrowsBySource, arrow.fromInstanceId, arrow.id);
    appendIndex(arrowsByTarget, arrow.toInstanceId, arrow.id);
  }
  for (const attachment of attachments) {
    appendIndex(attachmentsByEquipment, attachment.equipmentInstanceId, attachment.id);
    appendIndex(attachmentsByTarget, attachment.attachedToInstanceId, attachment.id);
  }
  for (const stack of battlefieldStacks) {
    for (const instanceId of stack.orderedMemberIds) {
      appendIndex(battlefieldStacksByMember, instanceId, stack.id);
    }
  }
  for (const group of tokenGroups) {
    if (!validTokenGroupView(group) || tokenGroupIds.has(group.groupId)) {
      throw new Error('TokenGroup normalized state invariant failed.');
    }
    tokenGroupIds.add(group.groupId);
    for (const memberRef of group.memberRefs ?? [group.rootRef]) {
      if (tokenGroupIdByMemberRef[memberRef] || battlefieldStacksByMember[memberRef]?.length) {
        throw new Error('TokenGroup membership is not exclusive.');
      }
      tokenGroupIdByMemberRef[memberRef] = group.groupId;
    }
  }

  return {
    arrows: Object.fromEntries(arrows.map((arrow) => [arrow.id, { ...arrow }])),
    attachments: Object.fromEntries(attachments.map((attachment) => [attachment.id, { ...attachment }])),
    battlefieldStacks: Object.fromEntries(battlefieldStacks.map((stack) => [stack.id, {
      ...stack,
      orderedMemberIds: [...stack.orderedMemberIds],
    }])),
    tokenGroupsById: Object.fromEntries(tokenGroups.map((group) => [group.groupId, {
      ...group,
      ...(group.memberRefs ? { memberRefs: [...group.memberRefs] } : {}),
      position: { ...group.position },
    }])),
    specialEntities: Object.fromEntries(specialEntities.map((entity) => [entity.id, { ...entity }])),
    indexes: {
      arrowsBySource,
      arrowsByTarget,
      attachmentsByEquipment,
      attachmentsByTarget,
      battlefieldStacksByMember,
      tokenGroupIdByMemberRef,
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
