import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { RematchVoteResponse } from '../../../../core/models/api-responses.model';
import { GameControlPlaneState, GameRematchVote } from '../../../../core/models/game.model';

interface PendingRematchAttempt {
  readonly gameId: string;
  readonly vote: GameRematchVote;
  readonly clientActionId: string;
  readonly previousActionId: string | null;
}

/**
 * Owns control-plane vote idempotency at the UI edge. A failed network request
 * keeps its action id so the next user retry can be deduplicated server-side.
 */
@Injectable()
export class GameTableRematchVoteService {
  private readonly gamesApi = inject(GamesApi);
  private readonly acceptedActionIds = new Map<string, string>();
  private retryAttempt: PendingRematchAttempt | null = null;

  async submit(gameId: string, vote: GameRematchVote): Promise<RematchVoteResponse> {
    const attempt = this.attemptFor(gameId, vote);

    try {
      const response = await firstValueFrom(this.gamesApi.rematchVote(gameId, {
        vote,
        clientActionId: attempt.clientActionId,
        previousActionId: attempt.previousActionId,
      }));
      const acceptedActionId = response.clientActionId ?? attempt.clientActionId;
      this.acceptedActionIds.set(gameId, acceptedActionId);
      this.retryAttempt = null;

      return response;
    } catch (error) {
      if (this.isSemanticConflict(error)) {
        // The backend projection is authoritative; a stale intent must never
        // be retried automatically with its old action id.
        this.retryAttempt = null;
      }

      throw error;
    }
  }

  controlPlaneFromError(error: unknown): GameControlPlaneState | null {
    if (!(error instanceof HttpErrorResponse) || !this.isSemanticConflict(error)) {
      return null;
    }

    const body = error.error;
    if (!isRecord(body)) {
      return null;
    }

    return isControlPlaneState(body['controlPlane']) ? body['controlPlane'] : null;
  }

  /**
   * Seeds the client-side predecessor from any authoritative projection
   * (Mercure, bootstrap, ACK or stale conflict). This makes a later user
   * change safe even if their original vote came from another browser tab.
   */
  acceptControlPlane(gameId: string, currentPlayerId: string | null, controlPlane: GameControlPlaneState): void {
    if (!gameId || !currentPlayerId) {
      return;
    }

    const clientActionId = controlPlane.rematch.votes[currentPlayerId]?.clientActionId;
    if (typeof clientActionId === 'string' && clientActionId.trim() !== '') {
      this.acceptedActionIds.set(gameId, clientActionId);
    }
  }

  private attemptFor(gameId: string, vote: GameRematchVote): PendingRematchAttempt {
    if (this.retryAttempt?.gameId === gameId && this.retryAttempt.vote === vote) {
      return this.retryAttempt;
    }

    const attempt: PendingRematchAttempt = {
      gameId,
      vote,
      clientActionId: this.clientActionId(),
      previousActionId: this.acceptedActionIds.get(gameId) ?? null,
    };
    this.retryAttempt = attempt;

    return attempt;
  }

  private isSemanticConflict(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status === 409;
  }

  private clientActionId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `rematch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function isControlPlaneState(value: unknown): value is GameControlPlaneState {
  return isRecord(value)
    && typeof value['controlPlaneRevision'] === 'number'
    && typeof value['status'] === 'string'
    && isRecord(value['rematch'])
    && isRecord(value['rematch']['votes']);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
