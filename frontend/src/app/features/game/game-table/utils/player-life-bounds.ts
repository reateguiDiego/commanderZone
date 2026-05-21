export const PLAYER_LIFE_MIN = -99;
export const PLAYER_LIFE_MAX = 499;

export function clampPlayerLife(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(PLAYER_LIFE_MAX, Math.max(PLAYER_LIFE_MIN, value));
}
