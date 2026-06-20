import { Injectable, computed, inject, signal } from '@angular/core';
import { GameCardInstance, GamePhase, GamePlayerMulliganState, GameSnapshot } from '../../../../../core/models/game.model';
import {
  GameplayMulliganCompletedMessage,
  GameplayMulliganErrorMessage,
  GameplayMulliganPrivateStateMessage,
  GameplayMulliganPublicPlayerState,
  GameplayMulliganPublicStateMessage,
} from '../../../../../core/models/game-realtime.model';
import { GameTableCoreState } from '../core/game-table-core.state';

@Injectable()
export class GameTableMulliganState {
  private readonly core = inject(GameTableCoreState);

  readonly publicState = signal<GameplayMulliganPublicStateMessage | null>(null);
  readonly privateState = signal<GameplayMulliganPrivateStateMessage | null>(null);
  readonly pendingAction = signal(false);
  readonly error = signal<GameplayMulliganErrorMessage['error'] | null>(null);
  readonly completed = signal(false);
  readonly gamePhase = computed<GamePhase | null>(() =>
    this.publicState()?.gamePhase
      ?? (this.completed() ? 'PLAYING' : null)
      ?? this.core.snapshot()?.gamePhase
      ?? null,
  );

  syncSnapshot(snapshot: GameSnapshot | null): void {
    if (snapshot === null || snapshot.gamePhase === 'PLAYING') {
      this.publicState.set(null);
      this.privateState.set(null);
      this.pendingAction.set(false);
      this.error.set(null);
      this.completed.set(snapshot?.gamePhase === 'PLAYING');
      return;
    }

    this.completed.set(false);
  }

  beginAction(): boolean {
    if (this.pendingAction()) {
      return false;
    }

    this.pendingAction.set(true);
    this.error.set(null);
    return true;
  }

  failAction(message: string): void {
    this.pendingAction.set(false);
    this.error.set({ code: 'CLIENT_SEND_FAILED', message, retryable: true });
  }

  handlePublicState(message: GameplayMulliganPublicStateMessage): void {
    if (!samePublicState(this.publicState(), message)) {
      this.publicState.set(message);
    }
    this.completed.set(message.gamePhase === 'PLAYING');
    this.core.snapshot.update((snapshot) => snapshot ? this.mergePublicState(snapshot, message) : snapshot);
  }

  handlePrivateState(message: GameplayMulliganPrivateStateMessage): void {
    if (!samePrivateState(this.privateState(), message)) {
      this.privateState.set(message);
    }
    this.pendingAction.set(false);
    this.error.set(null);
    this.core.snapshot.update((snapshot) => snapshot ? this.mergePrivateState(snapshot, message) : snapshot);
  }

  handleError(message: GameplayMulliganErrorMessage): void {
    this.pendingAction.set(false);
    this.error.set(message.error);
  }

  handleCompleted(message: GameplayMulliganCompletedMessage): void {
    this.pendingAction.set(false);
    this.completed.set(true);
    this.core.snapshot.update((snapshot) => snapshot ? {
      ...snapshot,
      version: Math.max(snapshot.version, message.version),
      gamePhase: 'PLAYING',
    } : snapshot);
  }

  private mergePublicState(snapshot: GameSnapshot, message: GameplayMulliganPublicStateMessage): GameSnapshot {
    const players = { ...snapshot.players };
    let playersChanged = false;
    for (const playerState of message.players) {
      const currentPlayer = players[playerState.playerId];
      if (!currentPlayer) {
        continue;
      }

      const zoneCounts = currentPlayer.zoneCounts ? {
        ...currentPlayer.zoneCounts,
        hand: playerState.handCount,
      } : undefined;
      const mulligan = this.mergePublicPlayerMulligan(currentPlayer.mulligan, playerState);
      const handCountChanged = currentPlayer.handCount !== playerState.handCount;
      const zoneCountChanged = Boolean(zoneCounts) && currentPlayer.zoneCounts?.hand !== playerState.handCount;
      const mulliganChanged = !sameMulliganState(currentPlayer.mulligan, mulligan);
      if (!handCountChanged && !zoneCountChanged && !mulliganChanged) {
        continue;
      }

      playersChanged = true;
      players[playerState.playerId] = {
        ...currentPlayer,
        handCount: playerState.handCount,
        ...(zoneCounts ? { zoneCounts } : {}),
        mulligan,
      };
    }

    const nextVersion = Math.max(snapshot.version, message.version);
    const nextGamePhase = message.gamePhase ?? snapshot.gamePhase;
    if (!playersChanged && nextVersion === snapshot.version && nextGamePhase === snapshot.gamePhase) {
      return snapshot;
    }

    return {
      ...snapshot,
      version: nextVersion,
      gamePhase: nextGamePhase,
      ...(playersChanged ? { players } : {}),
    };
  }

  private mergePrivateState(snapshot: GameSnapshot, message: GameplayMulliganPrivateStateMessage): GameSnapshot {
    const currentPlayer = snapshot.players[message.playerId];
    if (!currentPlayer) {
      return snapshot;
    }

    const hand = message.hand.map((card) => ({ ...card, zone: 'hand' as const }));
    const zones = {
      ...currentPlayer.zones,
      hand,
    };
    const zoneCounts = currentPlayer.zoneCounts ? {
      ...currentPlayer.zoneCounts,
      hand: hand.length,
    } : undefined;
    const { scryCard: _previousScryCard, ...currentMulligan } = currentPlayer.mulligan ?? {};
    const mulligan: GamePlayerMulliganState = {
      ...currentMulligan,
      ...message.mulligan,
      handCount: hand.length,
      ...(message.scryCard ? { scryCard: message.scryCard } : {}),
    };
    const nextVersion = Math.max(snapshot.version, message.version);
    const playerChanged = currentPlayer.handCount !== hand.length
      || !sameCardInstanceIds(currentPlayer.zones.hand, hand)
      || !sameMulliganState(currentPlayer.mulligan, mulligan);
    if (!playerChanged && nextVersion === snapshot.version) {
      return snapshot;
    }

    return {
      ...snapshot,
      version: nextVersion,
      players: {
        ...snapshot.players,
        [message.playerId]: {
          ...currentPlayer,
          zones,
          ...(zoneCounts ? { zoneCounts } : {}),
          handCount: hand.length,
          mulligan,
        },
      },
    };
  }

  private mergePublicPlayerMulligan(
    current: GamePlayerMulliganState | undefined,
    publicState: GameplayMulliganPublicPlayerState,
  ): GamePlayerMulliganState {
    return {
      ...current,
      mulligansTaken: publicState.mulligansTaken,
      effectiveMulligans: publicState.effectiveMulligans,
      status: publicState.status,
      ready: publicState.ready,
      handCount: publicState.handCount,
    };
  }
}

function samePublicState(
  current: GameplayMulliganPublicStateMessage | null,
  next: GameplayMulliganPublicStateMessage,
): boolean {
  if (!current) {
    return false;
  }

  return current.version === next.version
    && current.gamePhase === next.gamePhase
    && samePublicPlayers(current.players, next.players);
}

function samePublicPlayers(
  current: readonly GameplayMulliganPublicPlayerState[],
  next: readonly GameplayMulliganPublicPlayerState[],
): boolean {
  if (current.length !== next.length) {
    return false;
  }

  return current.every((player, index) => {
    const nextPlayer = next[index];

    return player.playerId === nextPlayer.playerId
      && player.displayName === nextPlayer.displayName
      && player.handCount === nextPlayer.handCount
      && player.mulligansTaken === nextPlayer.mulligansTaken
      && player.effectiveMulligans === nextPlayer.effectiveMulligans
      && player.status === nextPlayer.status
      && player.ready === nextPlayer.ready;
  });
}

function samePrivateState(
  current: GameplayMulliganPrivateStateMessage | null,
  next: GameplayMulliganPrivateStateMessage,
): boolean {
  if (!current) {
    return false;
  }

  return current.version === next.version
    && current.playerId === next.playerId
    && sameCardInstances(current.hand, next.hand)
    && sameMulliganState(current.mulligan, next.mulligan)
    && sameOptionalCardInstance(current.scryCard, next.scryCard);
}

function sameMulliganState(
  current: GamePlayerMulliganState | undefined,
  next: GamePlayerMulliganState | undefined,
): boolean {
  if (!current || !next) {
    return current === next;
  }

  return current.rule === next.rule
    && current.mulligansTaken === next.mulligansTaken
    && current.effectiveMulligans === next.effectiveMulligans
    && current.drawCount === next.drawCount
    && current.bottomSelectionCount === next.bottomSelectionCount
    && current.finalHandSize === next.finalHandSize
    && current.needsBottomSelection === next.needsBottomSelection
    && current.bottomOrderMode === next.bottomOrderMode
    && current.needsScryAfterKeep === next.needsScryAfterKeep
    && current.canTakeAnotherMulligan === next.canTakeAnotherMulligan
    && current.status === next.status
    && current.ready === next.ready
    && current.handCount === next.handCount
    && sameOptionalCardInstance(current.scryCard, next.scryCard);
}

function sameCardInstanceIds(
  current: readonly GameCardInstance[],
  next: readonly GameCardInstance[],
): boolean {
  if (current.length !== next.length) {
    return false;
  }

  return current.every((card, index) => card.instanceId === next[index].instanceId);
}

function sameCardInstances(
  current: readonly GameCardInstance[],
  next: readonly GameCardInstance[],
): boolean {
  if (!sameCardInstanceIds(current, next)) {
    return false;
  }

  return current.every((card, index) => stableCardString(card) === stableCardString(next[index]));
}

function stableCardString(card: GameCardInstance): string {
  return JSON.stringify(card);
}

function sameOptionalCardInstance(
  current: GameCardInstance | undefined,
  next: GameCardInstance | undefined,
): boolean {
  if (!current || !next) {
    return current === next;
  }

  return current.instanceId === next.instanceId
    && stableCardString(current) === stableCardString(next);
}
