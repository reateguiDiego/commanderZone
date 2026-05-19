import { computed, Injectable } from '@angular/core';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { OpponentCardsTargetCard, OpponentCardsTargetRole } from '../../models/opponent-cards-target-card.model';
import { OpponentTargetingPill } from '../../models/opponent-targeting-pill.model';
import { GameTableBattlefieldState } from '../battlefield/game-table-battlefield.state';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTablePlayersStore } from '../players/game-table-players.store';
import { PlayerView } from '../core/game-table-snapshot-selectors';

interface TargetCardBuildEntry {
  readonly card: GameCardInstance;
  readonly source: boolean;
  readonly target: boolean;
  readonly sortValues: readonly number[];
}

@Injectable()
export class GameTableOpponentTargetsState {
  readonly opponentTargetingPills = computed<ReadonlyMap<string, OpponentTargetingPill>>(() => this.buildOpponentTargetingPills());
  readonly opponentCardsTargetCards = computed<ReadonlyMap<string, readonly OpponentCardsTargetCard[]>>(() => this.buildOpponentCardsTargetCards());

  constructor(
    private readonly battlefieldState: GameTableBattlefieldState,
    private readonly core: GameTableCoreState,
    private readonly playersStore: GameTablePlayersStore,
  ) {}

  private buildOpponentTargetingPills(): ReadonlyMap<string, OpponentTargetingPill> {
    const snapshot = this.core.snapshot();
    const currentPlayerId = this.playersStore.currentPlayer()?.id;
    if (!snapshot || !currentPlayerId || snapshot.arrows.length === 0) {
      return new Map();
    }

    const battlefieldCardOwners = new Map<string, string>();
    for (const [playerId, player] of Object.entries(snapshot.players)) {
      for (const card of player.zones.battlefield) {
        battlefieldCardOwners.set(card.instanceId, playerId);
      }
    }

    const outgoingTargetCounts = new Map<string, number>();
    for (const arrow of snapshot.arrows) {
      const sourcePlayerId = battlefieldCardOwners.get(arrow.fromInstanceId);
      const targetPlayerId = battlefieldCardOwners.get(arrow.toInstanceId);
      if (!sourcePlayerId || !targetPlayerId || sourcePlayerId === targetPlayerId) {
        continue;
      }

      if (sourcePlayerId === currentPlayerId && targetPlayerId !== currentPlayerId) {
        outgoingTargetCounts.set(targetPlayerId, (outgoingTargetCounts.get(targetPlayerId) ?? 0) + 1);
      }
    }

    const pills = new Map<string, OpponentTargetingPill>();
    for (const [targetPlayerId, count] of outgoingTargetCounts) {
      const target = this.playersStore.players().find((player) => player.id === targetPlayerId) ?? null;
      const label = count > 1 ? 'multiple' : this.targetingPlayerLabel(target);
      pills.set(targetPlayerId, {
        direction: 'outgoing',
        text: `Objetivo: ${label}`,
        title: count > 1 ? 'Tienes multiples objetivos en este battlefield.' : `${label} es el objetivo de una de tus flechas.`,
      });
    }

    for (const arrow of snapshot.arrows) {
      const sourcePlayerId = battlefieldCardOwners.get(arrow.fromInstanceId);
      const targetPlayerId = battlefieldCardOwners.get(arrow.toInstanceId);
      if (!sourcePlayerId || !targetPlayerId || sourcePlayerId === targetPlayerId) {
        continue;
      }

      if (targetPlayerId === currentPlayerId && sourcePlayerId !== currentPlayerId) {
        const source = this.playersStore.players().find((player) => player.id === sourcePlayerId) ?? null;
        const label = this.targetingPlayerLabel(source);
        pills.set(sourcePlayerId, {
          direction: 'incoming',
          text: `Objetivo de ${label}`,
          title: `Una de tus cartas es objetivo de ${label}.`,
        });
      }
    }

    return pills;
  }

  private buildOpponentCardsTargetCards(): ReadonlyMap<string, readonly OpponentCardsTargetCard[]> {
    const snapshot = this.core.snapshot();
    if (!snapshot || snapshot.arrows.length === 0) {
      return new Map();
    }

    const battlefieldCards = new Map<string, { playerId: string; card: GameCardInstance; position: { x: number; y: number } }>();
    for (const [playerId, player] of Object.entries(snapshot.players)) {
      for (const card of player.zones.battlefield) {
        battlefieldCards.set(card.instanceId, {
          playerId,
          card,
          position: this.battlefieldState.cardPosition(card) ?? { x: 0, y: 0 },
        });
      }
    }

    const focusByPlayer = new Map<string, Map<string, TargetCardBuildEntry>>();
    const markCard = (
      playerId: string,
      card: GameCardInstance,
      role: OpponentCardsTargetRole,
      counterpartPosition: { x: number; y: number },
    ): void => {
      const playerFocus = focusByPlayer.get(playerId) ?? new Map<string, TargetCardBuildEntry>();
      const entry = playerFocus.get(card.instanceId) ?? { card, source: false, target: false, sortValues: [] };

      playerFocus.set(card.instanceId, {
        card,
        source: entry.source || role === 'source',
        target: entry.target || role === 'target',
        sortValues: [...entry.sortValues, this.cardsTargetSortValue(counterpartPosition)],
      });
      focusByPlayer.set(playerId, playerFocus);
    };

    for (const arrow of snapshot.arrows) {
      const source = battlefieldCards.get(arrow.fromInstanceId);
      const target = battlefieldCards.get(arrow.toInstanceId);
      if (source) {
        markCard(source.playerId, source.card, 'source', target?.position ?? source.position);
      }
      if (target) {
        markCard(target.playerId, target.card, 'target', source?.position ?? target.position);
      }
    }

    const targetCardsByPlayer = new Map<string, readonly OpponentCardsTargetCard[]>();
    for (const [playerId, player] of Object.entries(snapshot.players)) {
      const playerFocus = focusByPlayer.get(playerId);
      if (!playerFocus) {
        continue;
      }

      const focusCards = player.zones.battlefield
        .map((card) => playerFocus.get(card.instanceId))
        .filter((entry): entry is TargetCardBuildEntry => Boolean(entry))
        .sort((left, right) => this.averageSortValue(left.sortValues) - this.averageSortValue(right.sortValues))
        .map((entry) => ({
          card: entry.card,
          role: this.cardsTargetRole(entry.source, entry.target),
        }));

      if (focusCards.length > 0) {
        targetCardsByPlayer.set(playerId, focusCards);
      }
    }

    return targetCardsByPlayer;
  }

  private cardsTargetSortValue(position: { x: number; y: number }): number {
    return position.x + position.y * 0.05;
  }

  private averageSortValue(values: readonly number[]): number {
    if (values.length === 0) {
      return 0;
    }

    return values.reduce((total, value) => total + value, 0) / values.length;
  }

  private cardsTargetRole(source: boolean, target: boolean): OpponentCardsTargetRole {
    if (source && target) {
      return 'both';
    }

    return source ? 'source' : 'target';
  }

  private targetingPlayerLabel(player: PlayerView | null): string {
    return this.playersStore.deckLabel(player) || player?.state.user.displayName || player?.state.user.email || player?.id || 'ese jugador';
  }
}
