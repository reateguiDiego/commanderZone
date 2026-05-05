import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../core/api/games.api';
import { GameCommandType, GameSnapshot } from '../../../core/models/game.model';

@Injectable()
export class GameTableCommandService {
  private readonly gamesApi = inject(GamesApi);

  async send(gameId: string, type: GameCommandType, payload: Record<string, unknown>): Promise<GameSnapshot> {
    const response = await firstValueFrom(this.gamesApi.command({
      type,
      payload,
      clientActionId: this.clientActionId(),
    }, gameId));

    return response.snapshot;
  }

  private clientActionId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `action-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
