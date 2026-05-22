import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
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

  async refreshViewerControlAccess(): Promise<void> {
    const gameId = this.core.gameId();
    if (!gameId) {
      this.core.viewerCanControlTable.set(false);
      this.core.currentDeckId.set(null);
      return;
    }

    try {
      const response = await firstValueFrom(this.roomsApi.current(true));
      this.core.viewerCanControlTable.set(response.room?.gameId === gameId && response.viewerRole !== null);
      this.core.currentDeckId.set(response.room?.gameId === gameId ? response.player?.deckId ?? null : null);
    } catch {
      this.core.viewerCanControlTable.set(false);
      this.core.currentDeckId.set(null);
    }
  }

  async recordLeaveRoomVote(): Promise<void> {
    const gameId = this.core.gameId();
    if (!gameId) {
      return;
    }

    await firstValueFrom(this.gamesApi.rematchVote(gameId, 'leave'));
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
}
