import { Injectable, computed, inject, signal } from '@angular/core';
import { GameCardInstance, GameCompactCardRef, GamePhase, GamePlayerMulliganState, GameSnapshot } from '../../../../../core/models/game.model';
import {
  GameplayMulliganCompletedMessage,
  GameplayMulliganErrorMessage,
  GameplayMulliganPrivateCard,
  GameplayMulliganPrivateStateMessage,
  GameplayMulliganPublicPlayerState,
  GameplayMulliganPublicStateMessage,
  GameplayPatchV2Message,
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
    const compactMessage = compactPublicStateMessage(message);
    if (!samePublicState(this.publicState(), compactMessage)) {
      this.publicState.set(compactMessage);
    }
    this.completed.set(compactMessage.gamePhase === 'PLAYING');
    this.core.snapshot.update((snapshot) => snapshot ? this.mergePublicState(snapshot, compactMessage) : snapshot);
  }

  handlePrivateState(message: GameplayMulliganPrivateStateMessage): void {
    const compactMessage = compactPrivateStateMessage(message);
    if (!samePrivateState(this.privateState(), compactMessage)) {
      this.privateState.set(compactMessage);
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

  handlePatchV2Applied(message: GameplayPatchV2Message, snapshot: GameSnapshot): void {
    if (!message.ops.some((operation) => operation.op.startsWith('mulligan.') || operation.op === 'game.phase.set')) {
      return;
    }

    this.publicState.set(null);
    this.privateState.set(null);
    this.pendingAction.set(false);
    this.error.set(null);
    this.completed.set(snapshot.gamePhase === 'PLAYING');
  }

  privateHandFor(playerId: string | null): readonly GameCardInstance[] | null {
    const privateState = this.privateState();
    if (!playerId || privateState?.playerId !== playerId) {
      return null;
    }

    const currentHand = this.core.snapshot()?.players[playerId]?.zones.hand ?? [];
    return resolveMulliganHand(privateState.hand, currentHand, playerId);
  }

  privateScryCardFor(playerId: string | null): GameCardInstance | null {
    const privateState = this.privateState();
    if (!playerId || privateState?.playerId !== playerId || !privateState.scryCard) {
      return null;
    }

    const currentHand = this.core.snapshot()?.players[playerId]?.zones.hand ?? [];
    return resolveMulliganCard(privateState.scryCard, currentHand, playerId, 'library');
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

    const hand = resolveMulliganHand(message.hand, currentPlayer.zones.hand, message.playerId);
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
      ...(message.scryCard ? { scryCard: resolveMulliganCard(message.scryCard, currentPlayer.zones.library, message.playerId, 'library') } : {}),
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
    && sameCompactCards(current.hand, next.hand)
    && sameMulliganState(current.mulligan, next.mulligan)
    && sameOptionalCompactCard(current.scryCard, next.scryCard);
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
    && sameOptionalCardInstanceByIdentity(current.scryCard, next.scryCard);
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

function sameCompactCards(
  current: readonly GameplayMulliganPrivateCard[],
  next: readonly GameplayMulliganPrivateCard[],
): boolean {
  if (current.length !== next.length) {
    return false;
  }

  return current.every((card, index) => sameCompactCard(card, next[index]));
}

function sameOptionalCompactCard(
  current: GameplayMulliganPrivateCard | undefined,
  next: GameplayMulliganPrivateCard | undefined,
): boolean {
  if (!current || !next) {
    return current === next;
  }

  return sameCompactCard(current, next);
}

function sameCompactCard(current: GameplayMulliganPrivateCard, next: GameplayMulliganPrivateCard): boolean {
  return current.instanceId === next.instanceId
    && cardKeyOf(current) === cardKeyOf(next)
    && cardVersionOf(current) === cardVersionOf(next)
    && current.hidden === next.hidden
    && current.tapped === next.tapped;
}

function sameOptionalCardInstanceByIdentity(
  current: GameCardInstance | undefined,
  next: GameCardInstance | undefined,
): boolean {
  if (!current || !next) {
    return current === next;
  }

  return current.instanceId === next.instanceId
    && current.name === next.name
    && current.scryfallId === next.scryfallId
    && current.hidden === next.hidden
    && current.tapped === next.tapped
    && current.zone === next.zone;
}

function compactPublicStateMessage(message: GameplayMulliganPublicStateMessage): GameplayMulliganPublicStateMessage {
  return {
    ...message,
    players: message.players.map((player) => ({
      ...player,
      avatarImageData: undefined,
    })),
  };
}

function compactPrivateStateMessage(message: GameplayMulliganPrivateStateMessage): GameplayMulliganPrivateStateMessage {
  return {
    ...message,
    hand: message.hand.map(compactMulliganCard),
    ...(message.scryCard ? { scryCard: compactMulliganCard(message.scryCard) } : {}),
  };
}

function compactMulliganCard(card: GameplayMulliganPrivateCard): GameCompactCardRef {
  return {
    instanceId: card.instanceId,
    ...(cardKeyOf(card) ? { cardKey: cardKeyOf(card) } : {}),
    ...(cardVersionOf(card) ? { cardVersion: cardVersionOf(card) } : {}),
    ...(card.hidden !== undefined ? { hidden: card.hidden } : {}),
    ...(card.tapped !== undefined ? { tapped: card.tapped } : {}),
    ...(card.zone !== undefined ? { zone: card.zone } : {}),
  };
}

function resolveMulliganHand(
  cards: readonly GameplayMulliganPrivateCard[],
  currentHand: readonly GameCardInstance[],
  playerId: string,
): GameCardInstance[] {
  return cards.map((card) => resolveMulliganCard(card, currentHand, playerId, 'hand'));
}

function resolveMulliganCard(
  card: GameplayMulliganPrivateCard,
  currentCards: readonly GameCardInstance[],
  playerId: string,
  zone: GameCardInstance['zone'],
): GameCardInstance {
  if (isFullCardInstance(card)) {
    return { ...card, zone };
  }

  const current = currentCards.find((candidate) => candidate.instanceId === card.instanceId);
  if (current) {
    return { ...current, zone };
  }

  return {
    instanceId: card.instanceId,
    ownerId: playerId,
    controllerId: playerId,
    name: card.name?.trim() || card.cardKey?.trim() || 'Card',
    tapped: card.tapped ?? false,
    hidden: card.hidden ?? false,
    zone,
  };
}

function isFullCardInstance(card: GameplayMulliganPrivateCard): card is GameCardInstance {
  return typeof (card as GameCardInstance).name === 'string'
    && typeof (card as GameCardInstance).tapped === 'boolean';
}

function cardKeyOf(card: GameplayMulliganPrivateCard): string | null {
  return typeof (card as GameCompactCardRef).cardKey === 'string'
    ? ((card as GameCompactCardRef).cardKey ?? null)
    : null;
}

function cardVersionOf(card: GameplayMulliganPrivateCard): string | null {
  return typeof (card as GameCompactCardRef).cardVersion === 'string'
    ? ((card as GameCompactCardRef).cardVersion ?? null)
    : null;
}
