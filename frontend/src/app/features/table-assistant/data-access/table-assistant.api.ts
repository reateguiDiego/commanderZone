import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api/api.config';
import { withoutGlobalLoading } from '../../../core/loading/loading-context';
import { Room } from '../../../core/models/room.model';
import {
  TableAssistantRoomState,
  TableAssistantTimerMode,
  TableAssistantTrackerId,
  TableAssistantUseMode,
} from '../models/table-assistant.models';

export interface TableAssistantRoomResource {
  id: string;
  tableAssistantId: string;
  room: Room;
  state: TableAssistantRoomState;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TableAssistantRoomResponse {
  tableAssistantRoom: TableAssistantRoomResource;
}

export interface TableAssistantActionResponse extends TableAssistantRoomResponse {
  applied: boolean;
}

export type TableAssistantRealtimeEventType =
  | 'room.created'
  | 'action.applied'
  | 'participant.joined'
  | 'participant.left'
  | 'state.requested'
  | 'sync.error'
  | 'friend.invited'
  | 'invitation.accepted'
  | 'invitation.declined'
  | 'invitation.expired';

export interface TableAssistantRealtimeEvent {
  roomId: string;
  type: TableAssistantRealtimeEventType;
  state: TableAssistantRoomState;
  version: number;
  payload: Record<string, unknown>;
}

export interface CreateTableAssistantRoomRequest {
  mode: TableAssistantUseMode;
  playerCount: number;
  initialLife: number;
  players: Array<{ name: string; color: string }>;
  phasesEnabled: boolean;
  timerMode: TableAssistantTimerMode;
  timerDurationSeconds: number;
  skipEliminatedPlayers: boolean;
  activeTrackerIds: TableAssistantTrackerId[];
}

export interface TableAssistantBackendAction {
  type:
    | 'life.changed'
    | 'life.set'
    | 'commander-damage.changed'
    | 'turn.passed'
    | 'turn.reverted'
    | 'phase.passed'
    | 'timer.started'
    | 'timer.paused'
    | 'timer.resumed'
    | 'timer.reset'
    | 'player.elimination.changed'
    | 'tracker.changed'
    | 'participant.assigned';
  payload: Record<string, unknown>;
  clientActionId: string;
}

@Injectable({ providedIn: 'root' })
export class TableAssistantApi {
  private readonly http = inject(HttpClient);

  create(payload: CreateTableAssistantRoomRequest): Observable<TableAssistantRoomResponse> {
    return this.http.post<TableAssistantRoomResponse>(`${API_BASE_URL}/table-assistant/rooms`, payload);
  }

  get(roomId: string): Observable<TableAssistantRoomResponse> {
    return this.http.get<TableAssistantRoomResponse>(`${API_BASE_URL}/table-assistant/rooms/${roomId}`);
  }

  join(roomId: string, deviceId?: string): Observable<TableAssistantRoomResponse> {
    return this.http.post<TableAssistantRoomResponse>(`${API_BASE_URL}/table-assistant/rooms/${roomId}/join`, {
      ...(deviceId ? { deviceId } : {}),
    }, {
      context: withoutGlobalLoading(),
    });
  }

  action(roomId: string, action: TableAssistantBackendAction): Observable<TableAssistantActionResponse> {
    return this.http.post<TableAssistantActionResponse>(`${API_BASE_URL}/table-assistant/rooms/${roomId}/actions`, action, {
      context: withoutGlobalLoading(),
    });
  }
}
