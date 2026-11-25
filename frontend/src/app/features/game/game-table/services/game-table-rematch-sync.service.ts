import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { RoomsApi } from '../../../../core/api/rooms.api';
import { GameControlPlaneState } from '../../../../core/models/game.model';

const CONTROL_PLANE_SYNC_INTERVAL_MS = 3_000;

export interface GameTableRematchSyncHandlers {
  applyControlPlane(controlPlane: GameControlPlaneState): void;
  navigateToRooms(): void;
  navigateToWaitingRoom(roomId: string): void;
}

@Injectable()
export class GameTableRematchSyncService {
  private readonly gamesApi = inject(GamesApi);
  private readonly roomsApi = inject(RoomsApi);

  /**
   * Recovers rematch state while the finished-game prompt is available.
   * Mercure remains the fast path; this compact control-plane request covers
   * missed events and detects when the source room has returned to waiting.
   */
  watch(
    gameId: string,
    playerIds: readonly string[],
    afterRevision: number,
    handlers: GameTableRematchSyncHandlers,
  ): () => void {
    let active = true;
    let roomId: string | null = null;
    let revision = afterRevision;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const stop = (): void => {
      active = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const scheduleNextSync = (): void => {
      if (active && timer === null) {
        timer = setTimeout(() => {
          timer = null;
          if (roomId === null) {
            void initialize();
          } else {
            void syncControlPlane();
          }
        }, CONTROL_PLANE_SYNC_INTERVAL_MS);
      }
    };

    const reconcileRoom = async (): Promise<boolean> => {
      if (!active || roomId === null) {
        return false;
      }

      try {
        const { room } = await firstValueFrom(this.roomsApi.current(true));
        if (!active) {
          return true;
        }
        if (room === null || room.id !== roomId) {
          handlers.navigateToRooms();
          stop();
          return true;
        }
        if (room.status === 'waiting' && room.gameId === null) {
          handlers.navigateToWaitingRoom(room.id);
          stop();
          return true;
        }
      } catch {
        // A transient room lookup failure should not interrupt vote recovery.
      }

      return false;
    };

    const syncControlPlane = async (): Promise<void> => {
      if (!active) {
        return;
      }

      try {
        const response = await firstValueFrom(this.gamesApi.controlPlane(gameId, revision));
        if (!active) {
          return;
        }

        const controlPlane = response?.controlPlane;
        if (controlPlane) {
          revision = Math.max(revision, controlPlane.controlPlaneRevision);
          handlers.applyControlPlane(controlPlane);

          const allPlayersVoted = playerIds.length > 0
            && playerIds.every((playerId) => controlPlane.rematch.votes[playerId]?.vote !== undefined);
          if (allPlayersVoted && await reconcileRoom()) {
            return;
          }
        }
      } catch (error) {
        if (isNotFound(error) && await reconcileRoom()) {
          return;
        }
      }

      scheduleNextSync();
    };

    const initialize = async (): Promise<void> => {
      if (!active) {
        return;
      }

      try {
        const { room } = await firstValueFrom(this.roomsApi.current(true));
        if (!active) {
          return;
        }
        if (room === null) {
          handlers.navigateToRooms();
          stop();
          return;
        }

        if (room.status === 'waiting' && room.gameId === null) {
          handlers.navigateToWaitingRoom(room.id);
          stop();
          return;
        }
        if (room.gameId !== gameId) {
          handlers.navigateToRooms();
          stop();
          return;
        }

        roomId = room.id;
        await syncControlPlane();
      } catch {
        scheduleNextSync();
      }
    };

    void initialize();

    return stop;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 404;
}
