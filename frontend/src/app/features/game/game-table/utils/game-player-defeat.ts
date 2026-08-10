import { PlayerView } from '../state/core/game-table-snapshot-selectors';

export function playerIsDefeated(player: PlayerView): boolean {
  return player.state.status === 'conceded';
}

export function playerIsActiveForTurn(player: PlayerView): boolean {
  return player.state.status === 'active';
}
