import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom, tap } from 'rxjs';
import { GamesApi } from '../../../../../core/api/games.api';
import { RoomsApi } from '../../../../../core/api/rooms.api';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTableUiState } from '../core/game-table-ui.state';

@Injectable()
export class GameTableGameActionsStore {
  constructor(
    private readonly core: GameTableCoreState,
    private readonly gamesApi: GamesApi,
    private readonly roomsApi: RoomsApi,
    private readonly router: Router,
    private readonly uiState: GameTableUiState,
  ) {}

  resetViewerControlAccess(): void {
    this.core.viewerCanControlTable.set(false);
    this.core.currentRoomId.set(null);
    this.core.currentDeckId.set(null);
  }

  async refreshViewerControlAccess(): Promise<void> {
    const gameId = this.core.gameId();
    if (!gameId) {
      this.resetViewerControlAccess();
      return;
    }

    try {
      await firstValueFrom(this.roomsApi.current(true).pipe(
        tap((response) => {
          const matchesGame = response.room?.gameId === gameId;
          this.core.viewerCanControlTable.set(matchesGame && response.viewerRole !== null);
          this.core.currentRoomId.set(matchesGame ? response.room?.id ?? null : null);
          this.core.currentDeckId.set(matchesGame ? response.player?.deckId ?? null : null);
        }),
      ));
    } catch {
      this.resetViewerControlAccess();
    }
  }

  async recordLeaveRoomVote(): Promise<void> {
    const gameId = this.core.gameId();
    if (!gameId) {
      return;
    }

    await firstValueFrom(this.gamesApi.rematchVote(gameId, 'leave'));
  }

  async leaveCurrentRoom(): Promise<void> {
    let roomId = this.core.currentRoomId();
    if (!roomId) {
      const current = await firstValueFrom(this.roomsApi.current(true));
      roomId = current.room?.id ?? null;
    }
    if (!roomId) {
      return;
    }

    try {
      await firstValueFrom(this.roomsApi.leave(roomId, true));
    } catch (error) {
      if (!this.isStaleRoomMembershipError(error)) {
        throw error;
      }
    } finally {
      this.resetViewerControlAccess();
    }
  }

  async copyGameId(): Promise<void> {
    await navigator.clipboard?.writeText(this.core.gameId());
    this.uiState.closeContextMenu();
  }

  async navigateToRooms(): Promise<void> {
    await this.router.navigate(['/rooms']);
  }

  async navigateToRoomsWithLoadError(): Promise<void> {
    await this.router.navigate(['/rooms'], {
      state: {
        toast: 'Could not load game.',
      },
    });
  }

  async navigateToWaitingRoom(roomId: string): Promise<void> {
    await this.router.navigate(['/rooms', roomId, 'waiting']);
  }

  private isStaleRoomMembershipError(error: unknown): boolean {
    if (!(error instanceof HttpErrorResponse)) {
      return false;
    }

    if (error.status === 404) {
      return true;
    }

    if (error.status !== 403) {
      return false;
    }

    return this.errorMessage(error).toLowerCase().includes('only room players can leave');
  }

  private errorMessage(error: HttpErrorResponse): string {
    const response = error.error as { error?: unknown; detail?: unknown; message?: unknown } | null;
    if (response && typeof response === 'object') {
      for (const key of ['error', 'detail', 'message'] as const) {
        if (typeof response[key] === 'string' && response[key].trim() !== '') {
          return response[key];
        }
      }
    }

    return error.message ?? '';
  }
}
