import { Injectable } from '@angular/core';
import { GameCommandType, GameSnapshot } from '../../../../core/models/game.model';
import { PlayerView } from '../state/core/game-table-snapshot-selectors';
import { playerIsActiveForTurn } from '../utils/game-player-defeat';

export interface GameTableTurnActionContext {
  snapshot(): GameSnapshot | null;
  players(): PlayerView[];
  phases(): string[];
  command(type: GameCommandType, payload: Record<string, unknown>): Promise<void>;
}

@Injectable()
export class GameTableTurnActionsService {
  async changeTurnPlayer(context: GameTableTurnActionContext, activePlayerId: string): Promise<void> {
    await context.command('turn.changed', { activePlayerId });
  }

  async changePhase(context: GameTableTurnActionContext, phase: string): Promise<void> {
    await context.command('turn.changed', { phase });
  }

  async changeTurnNumber(context: GameTableTurnActionContext, number: string | number): Promise<void> {
    await context.command('turn.changed', { number: Number(number) });
  }

  async advanceTurnPhase(context: GameTableTurnActionContext): Promise<void> {
    const snapshot = context.snapshot();
    if (!snapshot) {
      return;
    }

    const phases = context.phases();
    const currentIndex = Math.max(0, phases.indexOf(snapshot.turn.phase));
    const nextPhase = phases[currentIndex + 1];
    if (nextPhase) {
      await context.command('turn.changed', { phase: nextPhase });
      return;
    }

		const players = this.turnEligiblePlayers(context.players(), snapshot.turnOrder);
		if (players.length <= 1) { return; }
    const activeIndex = players.findIndex((player) => player.id === snapshot.turn.activePlayerId);
    const nextPlayer = players[(activeIndex + 1) % players.length] ?? players[0];
    const nextNumber = this.nextTurnNumber(snapshot.turn.number, activeIndex, nextPlayer ? players.indexOf(nextPlayer) : -1);
    await context.command('turn.changed', {
      activePlayerId: nextPlayer?.id ?? snapshot.turn.activePlayerId,
      phase: phases[0],
      number: nextNumber,
    });
  }

  async passTurn(context: GameTableTurnActionContext): Promise<void> {
    const snapshot = context.snapshot();
    if (!snapshot) {
      return;
    }

		const players = this.turnEligiblePlayers(context.players(), snapshot.turnOrder);
		if (players.length <= 1) { return; }
    const activeIndex = players.findIndex((player) => player.id === snapshot.turn.activePlayerId);
    const nextPlayer = players[(activeIndex + 1) % players.length] ?? players[0];
    const nextNumber = this.nextTurnNumber(snapshot.turn.number, activeIndex, nextPlayer ? players.indexOf(nextPlayer) : -1);
    await context.command('turn.changed', {
      activePlayerId: nextPlayer?.id ?? snapshot.turn.activePlayerId,
      phase: context.phases()[0] ?? snapshot.turn.phase,
      number: nextNumber,
    });
  }

  private turnEligiblePlayers(players: PlayerView[], turnOrder: string[] | undefined): PlayerView[] {
		const byId = new Map(players.map((player) => [player.id, player]));
		const ordered = (turnOrder ?? players.map((player) => player.id))
			.map((playerId) => byId.get(playerId))
			.filter((player): player is PlayerView => Boolean(player));
		return ordered.filter((player) => playerIsActiveForTurn(player));
  }

  private nextTurnNumber(currentNumber: number, activeIndex: number, nextIndex: number): number {
    if (activeIndex < 0 || nextIndex < 0) {
      return currentNumber;
    }

    return nextIndex <= activeIndex ? currentNumber + 1 : currentNumber;
  }
}
