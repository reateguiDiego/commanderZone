import { PlayerView } from '../state/core/game-table-snapshot-selectors';

export const COMMANDER_DAMAGE_DEFEAT_THRESHOLD = 21;

export function playerHasLethalCommanderDamage(player: PlayerView): boolean {
  return Object.values(player.state.commanderDamage ?? {})
    .some((damage) => Number(damage) >= COMMANDER_DAMAGE_DEFEAT_THRESHOLD);
}

export function playerIsDefeated(player: PlayerView): boolean {
  return player.state.status === 'conceded' || player.state.life <= 0 || playerHasLethalCommanderDamage(player);
}

export function playerIsActiveForTurn(player: PlayerView): boolean {
  return !playerIsDefeated(player);
}
