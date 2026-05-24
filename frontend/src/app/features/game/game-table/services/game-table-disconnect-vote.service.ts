import { Injectable, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom, Subscription } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { GameDisconnectVoteChoice } from '../../../../core/models/game.model';
import { GameplayServerMessage } from '../../../../core/models/game-realtime.model';
import { GameTableStore } from '../game-table.store';
import { GameTableContextStore } from '../state/core/game-table-context.store';
import { GameTableWebsocketGameplayService } from './game-table-websocket-gameplay.service';
import { GameTableWebsocketTransportService } from './game-table-websocket-transport.service';

export interface DisconnectVotePlayerView {
  readonly playerId: string;
  readonly displayName: string;
  readonly online: boolean;
  readonly vote: GameDisconnectVoteChoice | null;
}

@Injectable()
export class GameTableDisconnectVoteService implements OnDestroy {
  private readonly store = inject(GameTableStore);
  private readonly contexts = inject(GameTableContextStore);
  private readonly gamesApi = inject(GamesApi);
  private readonly websocket = inject(GameTableWebsocketGameplayService);
  private readonly transport = inject(GameTableWebsocketTransportService);

  private readonly onlineByPlayerId = signal<Record<string, boolean>>({});
  private readonly dismissedVoteKey = signal<string | null>(null);
  private readonly countdownTick = signal(0);
  private countdownTimer: number | null = null;
  private readonly subscriptions = new Subscription();

  readonly modalOpen = signal(false);
  readonly pending = signal(false);
  readonly error = signal<string | null>(null);

  readonly voteState = computed(() => this.store.snapshot()?.disconnectVote ?? null);
  readonly targetPlayerId = computed(() => this.voteState()?.targetPlayerId ?? null);
  readonly targetPlayerName = computed(() => {
    const targetPlayerId = this.targetPlayerId();
    const snapshot = this.store.snapshot();
    if (!targetPlayerId || !snapshot) {
      return null;
    }

    return snapshot.players[targetPlayerId]?.user.displayName ?? targetPlayerId;
  });
  readonly targetIsOnline = computed(() => {
    const targetPlayerId = this.targetPlayerId();
    if (!targetPlayerId) {
      return false;
    }

    return this.onlineByPlayerId()[targetPlayerId] === true;
  });
  readonly currentPlayerId = computed(() => this.store.currentPlayer()?.id ?? null);
  readonly currentVote = computed<GameDisconnectVoteChoice | null>(() => {
    const state = this.voteState();
    const currentPlayerId = this.currentPlayerId();
    if (!state || !currentPlayerId) {
      return null;
    }

    const vote = state.votes[currentPlayerId]?.vote;
    return vote === 'wait' || vote === 'expel' ? vote : null;
  });
  readonly canVote = computed(() => {
    const snapshot = this.store.snapshot();
    const state = this.voteState();
    const currentPlayerId = this.currentPlayerId();
    if (!snapshot || !state || !currentPlayerId || state.status !== 'open' || !state.targetPlayerId) {
      return false;
    }
    if (currentPlayerId === state.targetPlayerId) {
      return false;
    }
    if (snapshot.players[currentPlayerId]?.status === 'conceded') {
      return false;
    }

    return true;
  });
  readonly players = computed<DisconnectVotePlayerView[]>(() => {
    const snapshot = this.store.snapshot();
    const state = this.voteState();
    if (!snapshot || !state?.targetPlayerId) {
      return [];
    }

    const votes = state.votes;
    const onlineByPlayerId = this.onlineByPlayerId();

    return Object.entries(snapshot.players)
      .filter(([playerId]) => playerId !== state.targetPlayerId)
      .map(([playerId, player]) => {
        const vote = votes[playerId]?.vote;

        return {
          playerId,
          displayName: player.user.displayName,
          online: onlineByPlayerId[playerId] !== false,
          vote: vote === 'wait' || vote === 'expel' ? vote : null,
        };
      });
  });
  readonly countdownSeconds = computed(() => {
    this.countdownTick();
    const deadlineAt = this.voteState()?.deadlineAt;
    if (!deadlineAt || this.voteState()?.status !== 'open') {
      return null;
    }

    const deadlineMs = Date.parse(deadlineAt);
    if (!Number.isFinite(deadlineMs)) {
      return null;
    }

    return Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
  });

  constructor() {
    this.subscriptions.add(this.transport.messages$.subscribe((message) => this.consumePresenceMessage(message)));

    effect(() => {
      const canVote = this.canVote();
      const voteKey = this.voteKey();
      if (!canVote || !voteKey) {
        this.modalOpen.set(false);
        this.dismissedVoteKey.set(null);
        return;
      }
      if (this.dismissedVoteKey() === voteKey) {
        return;
      }

      this.modalOpen.set(true);
    });

    effect(() => {
      const open = this.modalOpen();
      const seconds = this.countdownSeconds();
      const running = open && seconds !== null && this.voteState()?.status === 'open';
      if (!running) {
        this.stopCountdown();
        return;
      }

      this.startCountdown();
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.stopCountdown();
  }

  openModal(): void {
    if (!this.canVote()) {
      return;
    }

    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.dismissedVoteKey.set(this.voteKey());
  }

  async vote(choice: GameDisconnectVoteChoice): Promise<void> {
    if (this.pending() || !this.canVote()) {
      return;
    }

    const targetPlayerId = this.targetPlayerId();
    const gameId = this.store.gameId();
    if (!targetPlayerId || !gameId) {
      return;
    }

    this.pending.set(true);
    this.error.set(null);
    try {
      const sent = await this.websocket.sendCommand(
        this.contexts.command().websocket(),
        'disconnect.vote',
        { targetPlayerId, vote: choice },
      );
      if (!sent) {
        await firstValueFrom(this.gamesApi.disconnectVote(gameId, targetPlayerId, choice));
        await this.store.refetch(true);
      }
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.pending.set(false);
    }
  }

  voteLabel(vote: GameDisconnectVoteChoice | null): string {
    if (vote === 'wait') {
      return 'Esperar';
    }
    if (vote === 'expel') {
      return 'Expulsar';
    }

    return 'Sin voto';
  }

  private consumePresenceMessage(message: GameplayServerMessage): void {
    if (message.kind !== 'player_presence_changed') {
      return;
    }

    this.onlineByPlayerId.update((current) => ({
      ...current,
      [message.playerId]: message.status === 'online',
    }));
  }

  private voteKey(): string | null {
    const state = this.voteState();
    if (!state || state.status !== 'open' || !state.targetPlayerId) {
      return null;
    }

    return `${state.targetPlayerId}:${state.openedAt ?? ''}:${state.deadlineAt ?? ''}`;
  }

  private startCountdown(): void {
    if (this.countdownTimer !== null) {
      return;
    }

    this.countdownTimer = window.setInterval(() => {
      this.countdownTick.update((tick) => tick + 1);
    }, 250);
  }

  private stopCountdown(): void {
    if (this.countdownTimer === null) {
      return;
    }

    window.clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  }

  private errorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'error' in error) {
      const response = (error as { error?: { error?: string; detail?: string } }).error;
      return response?.error ?? response?.detail ?? 'No se pudo guardar tu voto.';
    }

    return error instanceof Error ? error.message : 'No se pudo guardar tu voto.';
  }
}
