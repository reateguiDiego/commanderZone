import type {
  GameCardInstance,
  GameCompactCardRef,
  GameCardPosition,
  GameCommand,
  GamePhase,
  GameSpecialEntity,
  GameSpecialEntityCardRef,
  GameEvent,
  GamePlayerMulliganState,
  GameSnapshot,
  MulliganPlayerStatus,
  GameZoneName,
} from './game.model';
import type { CommandEnvelopeV2, PatchEnvelopeV2 } from './game-v2.model';

export type RealtimeGameCommand<TPayload extends Record<string, unknown> = Record<string, unknown>> =
  Omit<GameCommand<TPayload>, 'clientActionId'> & {
    clientActionId: string;
    baseVersion: number;
  };

export type GameplayClientMessage =
  | GameplayCommandClientMessage
  | GameplayCommandV2ClientMessage
  | GameplayPingMessage
  | GameplayMulliganTakeClientMessage
  | GameplayMulliganKeepClientMessage
  | GameplayMulliganScryConfirmClientMessage;

export interface GameplayCommandClientMessage {
  kind: 'command';
  gameId: string;
  messageId: string;
  command: RealtimeGameCommand;
}

export interface GameplayCommandV2ClientMessage extends CommandEnvelopeV2 {
  kind: 'command.v2';
  messageId: string;
}

export interface GameplayPingMessage {
  kind: 'ping';
  gameId?: string;
  messageId: string;
  sentAt: string;
}

export interface GameplayMulliganTakeClientMessage {
  kind: 'mulligan.take';
  gameId: string;
  messageId: string;
}

export interface GameplayMulliganKeepClientMessage {
  kind: 'mulligan.keep';
  gameId: string;
  messageId: string;
  bottomCardInstanceIds?: string[];
}

export interface GameplayMulliganScryConfirmClientMessage {
  kind: 'mulligan.scry.confirm';
  gameId: string;
  messageId: string;
  destination: 'TOP' | 'BOTTOM';
}

export type GameplayServerMessage =
  | GameplayCommandAckMessage
  | GameplayGamePatchMessage
  | GameplayPatchV2Message
  | GameplayResyncRequiredMessage
  | GameplayErrorMessage
  | GameplayPongMessage
  | GameplayConnectionStateMessage
  | GameplayConnectionJoinedMessage
  | GameplayConnectionLeftMessage
  | GameplayPlayerPresenceChangedMessage
  | GameplayMulliganPublicStateMessage
  | GameplayMulliganPrivateStateMessage
  | GameplayMulliganErrorMessage
  | GameplayMulliganCompletedMessage;

export interface GameplayGamePatchMessage {
  kind: 'game_patch';
  gameId: string;
  baseVersion: number;
  version: number;
  operations: GameSnapshotPatchOperation[];
  event?: GameEvent;
  clientActionId?: string;
}

export interface GameplayPatchV2Message extends PatchEnvelopeV2 {
  kind: 'patch.v2';
}

export type GameplayCommandAckStatus = 'rejected' | 'duplicate' | 'resync_required';

export interface GameplayCommandAckMessage {
  kind: 'command_ack';
  gameId: string;
  messageId?: string;
  clientActionId: string;
  status: GameplayCommandAckStatus;
  version: number;
  error?: GameplayErrorPayload;
}

export interface GameplayResyncRequiredMessage {
  kind: 'resync_required';
  gameId: string;
  currentVersion: number;
  reason: GameplayResyncReason;
  clientActionId?: string;
}

export type GameplayResyncReason = 'version_gap' | 'stale_base_version' | 'permission_changed' | 'projection_unavailable';

export interface GameplayErrorMessage {
  kind: 'error';
  gameId?: string;
  messageId?: string;
  clientActionId?: string;
  error: GameplayErrorPayload;
}

export interface GameplayPongMessage {
  kind: 'pong';
  gameId?: string;
  messageId: string;
  serverTime: string;
}

export interface GameplayConnectionStateMessage {
  kind: 'connection_state';
  gameId: string;
  connectionId: string;
  status: 'connected';
  serverTime: string;
}

export interface GameplayConnectionJoinedMessage {
  kind: 'connection_joined';
  gameId: string;
  connection: GameplayConnectionPresence;
}

export interface GameplayConnectionLeftMessage {
  kind: 'connection_left';
  gameId: string;
  connection: GameplayConnectionPresence;
  leftAt: string;
}

export interface GameplayPlayerPresenceChangedMessage {
  kind: 'player_presence_changed';
  gameId: string;
  playerId: string;
  displayName: string;
  status: 'online' | 'offline';
  changedAt: string;
}

export interface GameplayMulliganPublicPlayerState {
  playerId: string;
  displayName?: string | null;
  avatarType?: string | null;
  avatarPreset?: string | null;
  avatarImageData?: string | null;
  avatarInitialLetter?: string | null;
  handCount: number;
  mulligansTaken: number;
  effectiveMulligans: number;
  status: MulliganPlayerStatus;
  ready: boolean;
}

export interface GameplayMulliganPublicStateMessage {
  kind: 'mulligan.public_state';
  gameId: string;
  version: number;
  gamePhase?: GamePhase | null;
  players: GameplayMulliganPublicPlayerState[];
  messageId?: string;
}

export interface GameplayMulliganPrivateStateMessage {
  kind: 'mulligan.private_state';
  gameId: string;
  version: number;
  playerId: string;
  hand: GameplayMulliganPrivateCard[];
  handSize?: number;
  mulligan: Required<Pick<
    GamePlayerMulliganState,
    | 'mulligansTaken'
    | 'effectiveMulligans'
    | 'drawCount'
    | 'bottomSelectionCount'
    | 'finalHandSize'
    | 'needsBottomSelection'
    | 'bottomOrderMode'
    | 'needsScryAfterKeep'
    | 'canTakeAnotherMulligan'
    | 'status'
    | 'ready'
  >> & Pick<GamePlayerMulliganState, 'rule'>;
  scryCard?: GameplayMulliganPrivateCard;
  visibility?: 'private' | `player:${string}`;
  staticCards?: Record<string, unknown>;
  ops?: GameplayMulliganSemanticOperation[];
  messageId?: string;
}

export type GameplayMulliganPrivateCard = GameCompactCardRef | GameCardInstance;

export type GameplayMulliganSemanticOperation =
  | { op: 'mulligan.status.set'; playerId: string; status: MulliganPlayerStatus; ready?: boolean; handCount?: number; effectiveMulligans?: number }
  | { op: 'mulligan.player.choice.set'; playerId: string; choice: 'take' | 'keep' | 'scry_top' | 'scry_bottom'; effectiveMulligans?: number }
  | { op: 'mulligan.private_state.set'; playerId: string; state: GameplayMulliganPrivateStateMessage['mulligan']; hand?: GameplayMulliganPrivateCard[]; scryCard?: GameplayMulliganPrivateCard }
  | { op: 'mulligan.hand.replace_private'; playerId: string; hand: GameplayMulliganPrivateCard[]; staticCards?: Record<string, unknown> }
  | { op: 'mulligan.hand.count.set'; playerId: string; count: number }
  | { op: 'mulligan.bottom.required.set'; playerId: string; count: number; orderMode?: GamePlayerMulliganState['bottomOrderMode'] }
  | { op: 'mulligan.bottom.confirmed'; playerId: string; count: number }
  | { op: 'mulligan.scry.available.set'; playerId: string; available: boolean; card?: GameplayMulliganPrivateCard }
  | { op: 'mulligan.scry.confirmed'; playerId: string; destination: 'TOP' | 'BOTTOM' }
  | { op: 'mulligan.completed' }
  | { op: 'game.phase.set'; phase: GamePhase };

export interface GameplayMulliganErrorMessage {
  kind: 'mulligan.error';
  gameId: string;
  messageId?: string;
  version?: number;
  error: GameplayErrorPayload;
}

export interface GameplayMulliganCompletedMessage {
  kind: 'mulligan.completed';
  gameId: string;
  version: number;
  event?: GameEvent;
  messageId?: string;
}

export interface GameplayConnectionPresence {
  connectionId: string;
  gameId: string;
  userId: string;
  displayName: string;
  connectedAt: string;
}

export interface GameplayErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  conflict?: GameplayVersionConflict;
}

export interface GameplayVersionConflict {
  commandBaseVersion: number;
  currentVersion: number;
  delta: number;
  classification: 'concurrent_write' | 'stale_client';
}

export type GameSnapshotPatchOperation =
  | {
      op: 'card.position.set';
      playerId: string;
      zone: GameZoneName;
      instanceId: string;
      position: GameCardPosition;
    }
  | {
      op: 'cards.position.set';
      playerId: string;
      zone: GameZoneName;
      positions: Array<{
        instanceId: string;
        position: GameCardPosition;
      }>;
    }
  | {
      op: 'card.move';
      instanceId: string;
      from: {
        playerId: string;
        zone: GameZoneName;
      };
      to: {
        playerId: string;
        zone: GameZoneName;
        index?: number;
      };
      card?: GameCardInstance;
      zoneCounts?: Partial<Record<GameZoneName, number>>;
    }
  | {
      op: 'card.remove';
      playerId: string;
      zone: GameZoneName;
      instanceId: string;
      zoneCounts?: Partial<Record<GameZoneName, number>>;
    }
  | {
      op: 'card.state.set';
      playerId: string;
      zone: GameZoneName;
      instanceId: string;
      tapped?: boolean;
      rotation?: number;
      faceDown?: boolean;
      hidden?: boolean;
      revealedTo?: string[];
      counters?: GameCardInstance['counters'];
      dungeonMarker?: GameCardInstance['dungeonMarker'];
    }
  | {
      op: 'card.projection.set';
      playerId: string;
      zone: GameZoneName;
      instanceId: string;
      card: GameCardInstance;
    }
  | {
      op: 'card.counters.set';
      playerId: string;
      zone: GameZoneName;
      instanceId: string;
      counters: GameCardInstance['counters'];
    }
    | {
        op: 'card.stats.set';
        playerId: string;
        zone: GameZoneName;
        instanceId: string;
        power?: GameCardInstance['power'];
        toughness?: GameCardInstance['toughness'];
        loyalty?: GameCardInstance['loyalty'];
        defense?: GameCardInstance['defense'];
        saga?: GameCardInstance['saga'];
      }
  | {
      op: 'cards.state.set';
      playerId: string;
      zone: GameZoneName;
      cards: Array<{
        instanceId: string;
        tapped?: boolean;
        rotation?: number;
        faceDown?: boolean;
        hidden?: boolean;
        revealedTo?: string[];
      }>;
    }
  | {
      op: 'card.create';
      playerId: string;
      zone: GameZoneName;
      card: GameCardInstance;
      index?: number;
    }
  | {
      op: 'zone.counts.set';
      playerId: string;
      counts: Partial<Record<GameZoneName, number>>;
    }
  | {
      op: 'zone.visible.set';
      playerId: string;
      zone: GameZoneName;
      cards: GameCardInstance[];
    }
  | {
      op: 'player.life.set';
      playerId: string;
      value: number;
    }
  | {
      op: 'game.counters.set';
      scope: string;
      counters: Record<string, number>;
    }
  | {
      op: 'player.counters.set';
      playerId: string;
      counters: Record<string, number>;
    }
  | {
      op: 'player.commanderDamage.set';
      playerId: string;
      commanderDamage: Record<string, number>;
    }
  | {
      op: 'player.sleeves.set';
      playerId: string;
      sleevesName: string;
    }
  | {
      op: 'player.background.set';
      playerId: string;
      backgroundName: string;
    }
  | {
      op: 'player.library.visibility.set';
      playerId: string;
      playTopLibraryRevealed?: boolean;
      revealedLibraryTo?: string[];
    }
  | {
      op: 'player.status.set';
      playerId: string;
      status: GameSnapshot['players'][string]['status'];
      concededAt?: GameSnapshot['players'][string]['concededAt'];
    }
  | {
      op: 'stack.item.add';
      item: GameSnapshot['stack'][number];
    }
  | {
      op: 'stack.item.remove';
      id: string;
    }
  | {
      op: 'stack.set';
      stack: GameSnapshot['stack'];
    }
  | {
      op: 'arrow.add';
      arrow: GameSnapshot['arrows'][number];
    }
  | {
      op: 'arrow.remove';
      id: string;
    }
  | {
      op: 'arrows.set';
      arrows: GameSnapshot['arrows'];
    }
  | {
      op: 'attachment.add';
      attachment: NonNullable<GameSnapshot['attachments']>[number];
    }
  | {
      op: 'attachment.remove';
      id: string;
    }
  | {
      op: 'attachments.set';
      attachments: NonNullable<GameSnapshot['attachments']>;
    }
  | {
      op: 'rematch.set';
      rematch: GameSnapshot['rematch'] | null;
    }
  | {
      op: 'specialEntity.add';
      entity: GameSpecialEntity;
    }
  | {
      op: 'specialEntity.update';
      entityId: string;
      state: Record<string, unknown>;
      entity?: GameSpecialEntity;
    }
  | {
      op: 'specialEntity.remove';
      entityId: string;
    }
  | {
      op: 'specialEntities.set';
      specialEntities: GameSpecialEntity[];
    }
  | {
      op: 'chat.append';
      entries: GameSnapshot['chat'];
    }
  | {
      op: 'chat.message.set';
      message: GameSnapshot['chat'][number];
    }
  | {
      op: 'eventLog.append';
      entries: GameSnapshot['eventLog'];
    }
  | {
      op: 'turn.set';
      turn: GameSnapshot['turn'];
    }
  | {
      op: 'game.phase.set';
      phase: GamePhase;
    }
  | {
      op: 'game.status.set';
      status: string;
      phase?: GamePhase;
    }
  | {
      op: 'timer.set';
      timer: GameSnapshot['timer'];
    }
  | {
      op: 'disconnect.vote.set';
      disconnectVote: GameSnapshot['disconnectVote'];
    };

export type GamePatchDecision = 'apply' | 'ignore' | 'resync';

export function getGamePatchDecision(snapshotVersion: number, patch: Pick<GameplayGamePatchMessage, 'baseVersion' | 'version'>): GamePatchDecision {
  if (patch.version <= snapshotVersion) {
    return 'ignore';
  }

  if (patch.baseVersion !== snapshotVersion) {
    return 'resync';
  }

  if (patch.version !== snapshotVersion + 1) {
    return 'resync';
  }

  return 'apply';
}
