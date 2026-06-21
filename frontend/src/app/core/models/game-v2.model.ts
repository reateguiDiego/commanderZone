import type { CardFace, CardImageUris } from './card.model';
import type {
  ChatMessage,
  ChatReactions,
  GameArrow,
  GameAttachment,
  GameCardPosition,
  GameDisconnectVoteState,
  GameLogEntry,
  GamePowerToughnessValue,
  GameRematchState,
  GameSpecialEntity,
  GameTurn,
  GameZoneName,
} from './game.model';
import type { User } from './user.model';

export type GameplayV2Visibility = 'public' | `player:${string}` | `group:${number}`;

export interface CommandEnvelopeV2 {
  gameId: string;
  baseVersion: number;
  clientActionId: string;
  type: string;
  payload: Record<string, unknown>;
  sentAt?: string | null;
  client?: Record<string, unknown> | null;
}

export interface PatchEnvelopeV2 {
  gameId: string;
  version: number;
  visibility: GameplayV2Visibility;
  ops: GameplayPatchV2Operation[];
  ackClientActionId?: string | null;
}

export interface EventPayloadV2 {
  gameId: string;
  version: number;
  type: string;
  payload: Record<string, unknown>;
  createdBy: string | null;
  clientActionId?: string | null;
  createdAt: string;
}

export interface BootstrapGameV2 {
  id: string;
  status: string;
  version: number;
  viewerId: string;
  ownerId?: string | null;
  gamePhase?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface BootstrapPlayerV2 {
  playerId: string;
  user: User | null;
  displayName: string;
  life: number;
  status: string;
  handCount: number;
  zoneIds: string[];
  zoneCounts: Partial<Record<GameZoneName, number>>;
  commanderDamage: Record<string, number>;
  counters: Record<string, number>;
  deckName?: string | null;
}

export interface BootstrapZoneV2 {
  zoneId: string;
  playerId: string;
  name: GameZoneName;
  instanceIds: string[];
}

export interface CardTokenMetaV2 {
  isCopy?: boolean;
  templateCardKey?: string;
  templateCardVersion?: string;
  templateScryfallId?: string;
  copiedFromInstanceId?: string;
  copiedFromCardKey?: string;
  copiedValues?: Record<string, unknown>;
  mutableOverrides?: Record<string, unknown>;
  flags?: Record<string, boolean>;
}

export interface BootstrapInstanceV2 {
  instanceId: string;
  cardRef: string;
  cardKey?: string;
  cardVersion?: string;
  zoneId: string;
  ownerId?: string | null;
  controllerId?: string | null;
  hidden?: boolean;
  faceDown?: boolean;
  tapped?: boolean;
  position?: GameCardPosition | null;
  rotation?: number | null;
  counters?: Record<string, number>;
  power?: GamePowerToughnessValue;
  toughness?: GamePowerToughnessValue;
  loyalty?: number | string | null;
  defense?: number | string | null;
  saga?: number | null;
  activeFaceIndex?: number | null;
  revealedTo?: string[];
  isToken?: boolean;
  isTokenCopy?: boolean;
  isCommander?: boolean;
  tokenMeta?: CardTokenMetaV2;
}

export interface BootstrapStaticCardV2 {
  cardRef: string;
  cardKey?: string;
  cardVersion?: string;
  scryfallId?: string | null;
  name?: string | null;
  imageUris?: CardImageUris | null;
  cardFaces?: CardFace[];
  typeLine?: string | null;
  manaCost?: string | null;
  colorIdentity?: string[];
  defaultPower?: GamePowerToughnessValue;
  defaultToughness?: GamePowerToughnessValue;
  defaultLoyalty?: number | string | null;
  defaultDefense?: number | string | null;
  hasRulings?: boolean;
}

export interface BootstrapStackItemV2 {
  stackId?: string;
  id?: string;
  kind: string;
  sourceInstanceId?: string | null;
  cardRef?: string | null;
  cardKey?: string | null;
  controllerId?: string | null;
  text?: string | null;
  createdAt?: string | null;
}

export interface BootstrapRelationsV2 {
  stack: BootstrapStackItemV2[];
  arrows: GameArrow[];
  attachments: GameAttachment[];
  specialEntities: GameSpecialEntity[];
}

export interface BootstrapV2 {
  game: BootstrapGameV2;
  players: Record<string, BootstrapPlayerV2>;
  zones: Record<string, BootstrapZoneV2>;
  instances: Record<string, BootstrapInstanceV2>;
  zoneCounts: Record<string, number>;
  relations: BootstrapRelationsV2;
  turn: GameTurn;
  staticCards: Record<string, BootstrapStaticCardV2>;
  chatCursor?: string | null;
  logCursor?: string | null;
  rulesVersion?: string;
  cardCatalogVersion?: string;
  payloadBytes?: number;
}

export interface LegacyCardPatchPayload {
  instanceId: string;
  ownerId?: string;
  controllerId?: string;
  scryfallId?: string;
  name?: string;
  imageUris?: Record<string, string>;
  cardFaces?: CardFace[];
  hasRulings?: boolean;
  typeLine?: string | null;
  manaCost?: string | null;
  colorIdentity?: string[];
  power?: GamePowerToughnessValue;
  toughness?: GamePowerToughnessValue;
  loyalty?: number | string | null;
  defense?: number | string | null;
  saga?: number | null;
  defaultPower?: GamePowerToughnessValue;
  defaultToughness?: GamePowerToughnessValue;
  defaultLoyalty?: number | string | null;
  defaultDefense?: number | string | null;
  tapped?: boolean;
  faceDown?: boolean;
  activeFaceIndex?: number | null;
  hidden?: boolean;
  revealedTo?: string[];
  position?: GameCardPosition | null;
  rotation?: number | null;
  counters?: Record<string, number>;
  zone?: GameZoneName;
  isToken?: boolean;
  isTokenCopy?: boolean;
  isCommander?: boolean;
  tokenMeta?: CardTokenMetaV2;
}

export interface GameplayZoneCardsMoveV2 {
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
  card?: BootstrapInstanceV2 | LegacyCardPatchPayload;
  staticCard?: BootstrapStaticCardV2 | null;
}

export type GameplayPatchV2Operation =
  | {
      op: 'player.life.set';
      playerId: string;
      value: number;
    }
  | {
      op: 'turn.set';
      turn: GameTurn;
    }
  | {
      op: 'dice.result';
      playerId?: string;
      kind?: string;
      result: number | string;
      createdAt?: string;
    }
  | {
      op: 'card.field.set';
      playerId: string;
      zone: GameZoneName;
      instanceId: string;
      tapped?: boolean;
      rotation?: number;
      faceDown?: boolean;
      hidden?: boolean;
      revealedTo?: string[];
      counters?: Record<string, number>;
      dungeonMarker?: { x: number; y: number } | null;
      position?: GameCardPosition | null;
      power?: GamePowerToughnessValue;
      toughness?: GamePowerToughnessValue;
      loyalty?: number | string | null;
      defense?: number | string | null;
      saga?: number | null;
    }
  | {
      op: 'card.counters.patch';
      playerId: string;
      zone: GameZoneName;
      instanceId: string;
      counters: Record<string, number>;
    }
  | {
      op: 'zone.cards.add';
      playerId: string;
      zone: GameZoneName;
      index?: number;
      cards: Array<BootstrapInstanceV2 | LegacyCardPatchPayload>;
      staticCards?: Record<string, BootstrapStaticCardV2>;
    }
  | {
      op: 'zone.cards.remove';
      playerId: string;
      zone: GameZoneName;
      instanceIds: string[];
    }
  | ({
      op: 'zone.cards.move';
    } & GameplayZoneCardsMoveV2)
  | {
      op: 'zone.cards.batchMove';
      moves: GameplayZoneCardsMoveV2[];
    }
  | {
      op: 'zone.count.set';
      playerId: string;
      zone: GameZoneName;
      count: number;
    }
  | {
      op: 'library.top.revealed';
      playerId: string;
      count?: number;
      cards: Array<BootstrapInstanceV2 | LegacyCardPatchPayload>;
      staticCards?: Record<string, BootstrapStaticCardV2>;
    }
  | {
      op: 'stack.add';
      item: BootstrapStackItemV2;
    }
  | {
      op: 'stack.remove';
      stackId: string;
    }
  | {
      op: 'relation.add';
      kind: 'arrow' | 'attachment';
      relation: GameArrow | GameAttachment;
    }
  | {
      op: 'relation.remove';
      kind: 'arrow' | 'attachment';
      id: string;
    }
  | {
      op: 'chat.message.add';
      message: ChatMessage;
    }
  | {
      op: 'chat.reaction.set';
      messageId: string;
      reactions: ChatReactions;
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
      cards: LegacyCardPatchPayload[];
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
      card?: LegacyCardPatchPayload;
    }
  | {
      op: 'card.remove';
      playerId: string;
      zone: GameZoneName;
      instanceId: string;
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
      counters?: Record<string, number>;
      dungeonMarker?: { x: number; y: number } | null;
    }
  | {
      op: 'card.position.set';
      playerId: string;
      zone: GameZoneName;
      instanceId: string;
      position: GameCardPosition | null;
    }
  | {
      op: 'card.stats.set';
      playerId: string;
      zone: GameZoneName;
      instanceId: string;
      power?: GamePowerToughnessValue;
      toughness?: GamePowerToughnessValue;
      loyalty?: number | string | null;
      defense?: number | string | null;
      saga?: number | null;
    }
  | {
      op: 'card.counters.set';
      playerId: string;
      zone: GameZoneName;
      instanceId: string;
      counters: Record<string, number>;
    }
  | {
      op: 'stack.item.add';
      item: BootstrapStackItemV2;
    }
  | {
      op: 'stack.item.remove';
      id: string;
    }
  | {
      op: 'arrow.add';
      arrow: GameArrow;
    }
  | {
      op: 'arrow.remove';
      id: string;
    }
  | {
      op: 'attachment.add';
      attachment: GameAttachment;
    }
  | {
      op: 'attachment.remove';
      id: string;
    }
  | {
      op: 'chat.append';
      entries: ChatMessage[];
    }
  | {
      op: 'chat.message.set';
      message: ChatMessage;
    }
  | {
      op: 'eventLog.append';
      entries: GameLogEntry[];
    }
  | {
      op: 'player.status.set';
      playerId: string;
      status: 'active' | 'conceded';
      concededAt?: string | null;
    }
  | {
      op: 'disconnect.vote.set';
      disconnectVote: GameDisconnectVoteState | null;
    }
  | {
      op: 'rematch.set';
      rematch: GameRematchState | null;
    };
