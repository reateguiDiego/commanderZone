const PLAYER_NAME_COLORS = [
  'var(--cz-primary)',
  'var(--cz-secondary)',
  'var(--cz-success)',
  'var(--cz-danger)',
  'var(--cz-info)',
  'hsl(24 95% 65%)',
] as const;

interface GamePlayerColorIdentity {
  readonly id: string;
}

export function gamePlayerNameColor(
  playerId: string | null | undefined,
  players: readonly GamePlayerColorIdentity[] = [],
): string {
  const identity = playerId?.trim();
  if (!identity) {
    return '';
  }

  const playerIndex = players.findIndex((player) => player.id.trim() === identity);
  if (playerIndex >= 0) {
    return PLAYER_NAME_COLORS[playerIndex % PLAYER_NAME_COLORS.length];
  }

  let hash = 0;
  for (const character of identity) {
    hash = (hash * 31 + character.charCodeAt(0)) % PLAYER_NAME_COLORS.length;
  }

  return PLAYER_NAME_COLORS[hash];
}
