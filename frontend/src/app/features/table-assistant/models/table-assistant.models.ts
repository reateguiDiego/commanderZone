import { FriendUser } from '../../../core/models/friendship.model';
import { RoomInviteStatus } from '../../../core/models/room-invite.model';
import { User } from '../../../core/models/user.model';

export type TableAssistantUseMode = 'single-device' | 'per-player-device';
export type TableAssistantRoomStatus = 'setup' | 'active' | 'closed';
export type TableAssistantParticipantRole = 'host' | 'player' | 'viewer';
export type TableAssistantTimerMode = 'none' | 'turn' | 'phase';
export type TableAssistantTimerStatus = 'idle' | 'running' | 'paused';
export type TableAssistantPermissionMode = 'everyone' | 'host-and-owner';
export type TableAssistantInvitationStatus = RoomInviteStatus | 'expired';

export type TableAssistantPhaseId =
  | 'untap'
  | 'upkeep'
  | 'draw'
  | 'main-1'
  | 'combat'
  | 'main-2'
  | 'end';

export type TableAssistantPlayerTrackerId =
  | 'poison'
  | 'commander-tax'
  | 'energy'
  | 'experience';

export type TableAssistantGlobalTrackerId =
  | 'monarch'
  | 'initiative'
  | 'storm';

export type TableAssistantTrackerId =
  | 'commander-damage'
  | TableAssistantPlayerTrackerId
  | TableAssistantGlobalTrackerId;

export interface TableAssistantTrackerDefinition {
  id: TableAssistantTrackerId;
  label: string;
  scope: 'player' | 'global' | 'special';
  defaultEnabled: boolean;
}

export interface TableAssistantPermissionPolicy {
  mode: TableAssistantPermissionMode;
  hostCanEditAll: boolean;
  playerCanEditOwnPanel: boolean;
  viewerCanEdit: boolean;
}

export interface TableAssistantSettings {
  initialLife: number;
  commanderDamageEnabled: boolean;
  turnTrackingEnabled: boolean;
  phasesEnabled: boolean;
  timerMode: TableAssistantTimerMode;
  skipEliminatedPlayers: boolean;
  permissionPolicy: TableAssistantPermissionPolicy;
  activeTrackerIds: TableAssistantTrackerId[];
}

export interface TableAssistantPlayer {
  id: string;
  name: string;
  color: string;
  seatIndex: number;
  turnOrder: number;
  life: number;
  startingLife: number;
  eliminated: boolean;
  assignedParticipantId: string | null;
  assignedUserId: string | null;
  trackers: Partial<Record<TableAssistantPlayerTrackerId, number>>;
}

export interface TableAssistantParticipant {
  id: string;
  role: TableAssistantParticipantRole;
  user: Pick<User, 'id' | 'displayName' | 'email'> | FriendUser | null;
  deviceId: string | null;
  assignedPlayerId: string | null;
  connected: boolean;
  joinedAt: string;
}

export interface TableAssistantInvitation {
  id: string;
  roomInviteId: string | null;
  invitedFriend: FriendUser;
  invitedByParticipantId: string;
  assignedPlayerId: string | null;
  status: TableAssistantInvitationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TableAssistantTurnState {
  activePlayerId: string | null;
  number: number;
  phaseId: TableAssistantPhaseId | null;
}

export interface TableAssistantTimerState {
  mode: TableAssistantTimerMode;
  status: TableAssistantTimerStatus;
  durationSeconds: number | null;
  remainingSeconds: number | null;
  startedAt: string | null;
}

export interface TableAssistantSharingState {
  code: string;
  inviteUrl: string | null;
}

export interface TableAssistantActionLogEntry {
  id: string;
  type: TableAssistantAction['type'];
  actorParticipantId: string | null;
  createdAt: string;
}

export interface TableAssistantRoomState {
  id: string;
  status: TableAssistantRoomStatus;
  mode: TableAssistantUseMode;
  hostParticipantId: string;
  players: TableAssistantPlayer[];
  participants: TableAssistantParticipant[];
  invitations: TableAssistantInvitation[];
  settings: TableAssistantSettings;
  turn: TableAssistantTurnState;
  timer: TableAssistantTimerState;
  sharing: TableAssistantSharingState;
  globalTrackers: Partial<Record<TableAssistantGlobalTrackerId, number>>;
  commanderDamage: Record<string, Record<string, number>>;
  actionLog: TableAssistantActionLogEntry[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type TableAssistantAction =
  | {
      type: 'life.changed';
      playerId: string;
      delta: number;
      actorParticipantId?: string | null;
      clientActionId?: string;
    }
  | {
      type: 'life.set';
      playerId: string;
      life: number;
      actorParticipantId?: string | null;
      clientActionId?: string;
    }
  | {
      type: 'commander-damage.changed';
      targetPlayerId: string;
      sourcePlayerId: string;
      delta: number;
      actorParticipantId?: string | null;
      clientActionId?: string;
    }
  | {
      type: 'turn.passed';
      actorParticipantId?: string | null;
      clientActionId?: string;
    }
  | {
      type: 'turn.reverted';
      activePlayerId: string;
      number: number;
      actorParticipantId?: string | null;
      clientActionId?: string;
    }
  | {
      type: 'phase.passed';
      actorParticipantId?: string | null;
      clientActionId?: string;
    }
  | {
      type: 'timer.started';
      durationSeconds: number;
      actorParticipantId?: string | null;
      clientActionId?: string;
    }
  | {
      type: 'timer.paused';
      remainingSeconds: number;
      actorParticipantId?: string | null;
      clientActionId?: string;
    }
  | {
      type: 'timer.resumed';
      remainingSeconds: number;
      actorParticipantId?: string | null;
      clientActionId?: string;
    }
  | {
      type: 'timer.reset';
      actorParticipantId?: string | null;
      clientActionId?: string;
    }
  | {
      type: 'game.reset';
      actorParticipantId?: string | null;
      clientActionId?: string;
    }
  | {
      type: 'player.elimination.changed';
      playerId: string;
      eliminated: boolean;
      actorParticipantId?: string | null;
      clientActionId?: string;
    }
  | {
      type: 'tracker.changed';
      trackerId: TableAssistantPlayerTrackerId | TableAssistantGlobalTrackerId;
      value: number;
      playerId?: string;
      actorParticipantId?: string | null;
      clientActionId?: string;
    }
  | {
      type: 'participant.assigned';
      participantId: string;
      playerId: string;
      actorParticipantId?: string | null;
      clientActionId?: string;
    };

export interface CreateTableAssistantRoomOptions {
  mode: TableAssistantUseMode;
  roomId?: string;
  roomCode?: string;
  inviteUrl?: string | null;
  hostUser?: Pick<User, 'id' | 'displayName' | 'email'> | null;
  hostDeviceId?: string | null;
  playerCount?: number;
  initialLife?: number;
  phasesEnabled?: boolean;
  timerMode?: TableAssistantTimerMode;
  timerDurationSeconds?: number | null;
  skipEliminatedPlayers?: boolean;
  activeTrackerIds?: TableAssistantTrackerId[];
  players?: Array<{ name?: string; color?: string }>;
  createdAt?: string;
}
