const PLAYER_NAME_COLORS = [
  'var(--cz-primary)',
  'var(--cz-secondary)',
  'var(--cz-success)',
  'var(--cz-warning)',
  'var(--cz-danger)',
  'color-mix(in srgb, var(--cz-accent) 64%, var(--cz-primary))',
] as const;

export function gamePlayerNameColor(playerId: string | null | undefined): string {
  const identity = playerId?.trim();
  if (!identity) {
    return '';
  }

  let hash = 0;
  for (const character of identity) {
    hash = (hash * 31 + character.charCodeAt(0)) % PLAYER_NAME_COLORS.length;
  }

  return PLAYER_NAME_COLORS[hash];
}
