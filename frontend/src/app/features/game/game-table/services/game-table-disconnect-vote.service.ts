import { Injectable, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { GameDisconnectVoteChoice, GameDisconnectVoteState } from '../../../../core/models/game.model';
import { GameplayServerMessage } from '../../../../core/models/game-realtime.model';
import { GameTableStore } from '../game-table.store';
import { GameTableContextStore } from '../state/core/game-table-context.store';
import { gameTableErrorMessage } from '../state/core/game-table-error-message.util';
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
  private readonly websocket = inject(GameTableWebsocketGameplayService);
  private readonly transport = inject(GameTableWebsocketTransportService);

  private readonly dismissedVoteKeys = signal<ReadonlySet<string>>(new Set());
  private readonly countdownTick = signal(0);
  private countdownTimer: number | null = null;
  private readonly subscriptions = new Subscription();

  readonly modalOpen = signal(false);
  readonly pending = signal(false);
  readonly error = signal<string | null>(null);

  isPlayerOffline(playerId: string, userId = playerId): boolean {
    const snapshot = this.store.snapshot();
    const snapshotPlayer = snapshot?.players[playerId]
      ?? Object.values(snapshot?.players ?? {}).find((player) => player.user.id === userId);
    if (snapshotPlayer?.isOnline !== undefined) {
      return !snapshotPlayer.isOnline;
    }

    const onlineByPlayerId = this.transport.playerOnlineByPlayerId();
    const playerPresence = onlineByPlayerId[playerId];
    const userPresence = userId === playerId ? undefined : onlineByPlayerId[userId];
    const presence = playerPresence ?? userPresence;
    if (presence !== undefined) {
      return !presence;
    }

    const vote = snapshot?.disconnectVotes?.[playerId];
    return vote?.targetPlayerId === playerId && vote.status !== 'cancelled';
  }

  private readonly openVoteStates = computed(() => {
    return Object.values(this.store.snapshot()?.disconnectVotes ?? {})
      .filter((vote) => vote.status === 'open')
      .sort((left, right) => (left.openedAt ?? '').localeCompare(right.openedAt ?? ''));
  });
  private readonly visibleOpenVoteStates = computed(() => {
    const dismissedVoteKeys = this.dismissedVoteKeys();

    return this.openVoteStates().filter((vote) => {
      const voteKey = this.voteKeyFor(vote);
      return voteKey !== null && !dismissedVoteKeys.has(voteKey);
    });
  });
  readonly voteState = computed(() => {
    const currentPlayerId = this.currentPlayerId();
    if (!currentPlayerId) {
      return null;
    }

    return this.visibleOpenVoteStates()
      .find((vote) => vote.eligible?.includes(currentPlayerId)) ?? null;
  });
  /** Open vote visible to a conceded/spectating player without granting actions. */
  readonly passiveVoteState = computed(() => {
    if (this.voteState() !== null) {
      return null;
    }

    return this.visibleOpenVoteStates()[0] ?? null;
  });
  readonly visibleVoteState = computed(() => this.voteState() ?? this.passiveVoteState());
  readonly isPassive = computed(() => this.visibleVoteState() !== null && !this.canVote());
  readonly targetPlayerId = computed(() => this.visibleVoteState()?.targetPlayerId ?? null);
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

    return this.transport.playerOnlineByPlayerId()[targetPlayerId] === true;
  });
  readonly currentPlayerId = computed(() => this.store.currentPlayer()?.id ?? null);
  readonly currentVote = computed<GameDisconnectVoteChoice | null>(() => {
    const state = this.visibleVoteState();
    const currentPlayerId = this.currentPlayerId();
    if (!state || !currentPlayerId) {
      return null;
    }

    const vote = state.votes[currentPlayerId]?.vote;
    return vote === 'wait' || vote === 'expel' ? vote : null;
  });
  readonly voteFinished = computed(() => {
    const state = this.visibleVoteState();

    return state?.status === 'open' && this.countdownSeconds() === 0;
  });
  readonly canVote = computed(() => {
    const snapshot = this.store.snapshot();
    const state = this.voteState();
    const currentPlayerId = this.currentPlayerId();
    if (!snapshot || !state || !currentPlayerId || state.status !== 'open' || !state.targetPlayerId) {
      return false;
    }
    if (this.countdownSeconds() === 0) {
      return false;
    }
    if (currentPlayerId === state.targetPlayerId) {
      return false;
    }
    if (snapshot.players[currentPlayerId]?.status !== 'active' || !state.eligible?.includes(currentPlayerId)) {
      return false;
    }

    return true;
  });
  readonly players = computed<DisconnectVotePlayerView[]>(() => {
    const snapshot = this.store.snapshot();
    const state = this.visibleVoteState();
    if (!snapshot || !state?.targetPlayerId) {
      return [];
    }

    const votes = state.votes;
    const onlineByPlayerId = this.transport.playerOnlineByPlayerId();

    return Object.entries(snapshot.players)
      .filter(([playerId]) => playerId !== state.targetPlayerId && state.eligible?.includes(playerId))
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
    const state = this.visibleVoteState();
    const deadlineAt = state?.deadlineAt;
    if (!deadlineAt || state?.status !== 'open') {
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
      const visibleVote = this.visibleVoteState();
      if (!visibleVote) {
        this.modalOpen.set(false);
        if (this.openVoteStates().length === 0 && this.dismissedVoteKeys().size > 0) {
          this.dismissedVoteKeys.set(new Set());
        }
        return;
      }

      this.modalOpen.set(true);
    });

    effect(() => {
      const open = this.modalOpen();
      const seconds = this.countdownSeconds();
      const running = open && seconds !== null && seconds > 0 && this.visibleVoteState()?.status === 'open';
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
    const voteKey = this.voteKey();
    if (voteKey) {
      this.dismissedVoteKeys.update((current) => new Set([...current, voteKey]));
    }
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
        this.error.set('La conexión de juego no está disponible.');
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

  private voteKey(): string | null {
    return this.voteKeyFor(this.visibleVoteState());
  }

  private consumePresenceMessage(message: GameplayServerMessage): void {
    if (message.kind !== 'player_presence_changed') {
      return;
    }

    this.store.snapshot.update((snapshot) => {
      if (!snapshot) {
        return snapshot;
      }

      const playerId = Object.entries(snapshot.players)
        .find(([candidateId, player]) => candidateId === message.playerId || player.user.id === message.playerId)?.[0];
      if (!playerId) {
        return snapshot;
      }

      const player = snapshot.players[playerId]!;
      const isOnline = message.status === 'online';
      if (player.isOnline === isOnline) {
        return snapshot;
      }

      return {
        ...snapshot,
        players: {
          ...snapshot.players,
          [playerId]: { ...player, isOnline },
        },
      };
    });
  }

  private voteKeyFor(state: GameDisconnectVoteState | null): string | null {
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
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.countdownTimer === null) {
      return;
    }

    window.clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  }

  private errorMessage(error: unknown): string {
    const message = gameTableErrorMessage(error);
    return message === 'Action failed.' ? 'No se pudo guardar tu voto.' : message;
  }
}
