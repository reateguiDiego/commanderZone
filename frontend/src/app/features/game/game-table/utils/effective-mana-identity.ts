import { ManaPoolColor } from './mana-source-detector';

export const CANONICAL_IDENTITY_MANA_COLORS = ['W', 'U', 'B', 'R', 'G'] as const;

/**
 * The game snapshot already exposes the frozen, combined commander identity.
 * The helper only canonicalizes that public value and always appends colorless.
 */
export function resolveManaHelperColors(
  colorIdentity: readonly string[] | null | undefined,
): readonly ManaPoolColor[] {
  const identity = new Set(
    (colorIdentity ?? [])
      .filter((color): color is string => typeof color === 'string')
      .map((color) => color.trim().toUpperCase())
      .filter((color) => CANONICAL_IDENTITY_MANA_COLORS.includes(color as typeof CANONICAL_IDENTITY_MANA_COLORS[number])),
  );

  return [
    ...CANONICAL_IDENTITY_MANA_COLORS.filter((color) => identity.has(color)),
    'C',
  ];
}
