<?php

namespace App\Application\Deck;

final class CardAnalysisTaxonomy
{
    /**
     * @var list<string>
     */
    private const ROLES = [
        'land',
        'ramp',
        'fast_mana',
        'burst_mana',
        'mana_fixing',
        'draw',
        'card_selection',
        'tutor',
        'spot_removal',
        'creature_removal',
        'artifact_removal',
        'enchantment_removal',
        'board_wipe',
        'hard_board_wipe',
        'pseudo_wipe',
        'mass_bounce',
        'artifact_wipe',
        'enchantment_wipe',
        'graveyard_wipe',
        'asymmetric_wipe',
        'modal_wipe',
        'conditional_wipe',
        'overloaded_wipe',
        'answers_indestructible',
        'counterspell',
        'protection',
        'recursion',
        'reanimation',
        'graveyard_hate',
        'stax',
        'tax',
        'sacrifice_outlet',
        'token_maker',
        'payoff',
        'enabler',
        'wincon',
        'combo_piece',
        'ritual',
        'cost_reducer',
        'discard',
        'lifegain',
        'extra_turn',
        'extra_combat',
        'combat_finisher',
    ];

    /**
     * @var list<string>
     */
    private const CONDITIONS = [
        'requires_commander_on_battlefield',
        'requires_low_curve',
        'requires_artifact_density',
        'requires_enchantment_density',
        'requires_creature_density',
        'requires_small_creatures_or_tokens',
        'requires_token_makers',
        'requires_graveyard_targets',
        'requires_discard_outlets',
        'requires_sacrifice_outlets',
        'requires_life_total_support',
        'requires_spell_density',
        'requires_instant_density',
        'requires_equipment_or_auras',
        'requires_swamp_density',
        'requires_legendary_permanents',
        'requires_combo_plan',
        'symmetrical_stax_risk',
    ];

    /**
     * @return list<string>
     */
    public static function roles(): array
    {
        return self::ROLES;
    }

    /**
     * @return list<string>
     */
    public static function conditions(): array
    {
        return self::CONDITIONS;
    }

    public static function normalizeRole(mixed $role): ?string
    {
        $normalized = self::normalize($role);

        return $normalized !== null && in_array($normalized, self::ROLES, true) ? $normalized : null;
    }

    public static function normalizeCondition(mixed $condition): ?string
    {
        $normalized = self::normalize($condition);

        return $normalized !== null && in_array($normalized, self::CONDITIONS, true) ? $normalized : null;
    }

    public static function assertRole(mixed $role): string
    {
        $normalized = self::normalizeRole($role);
        if ($normalized === null) {
            throw new \InvalidArgumentException(sprintf('Unsupported card analysis role: %s', self::valueLabel($role)));
        }

        return $normalized;
    }

    public static function assertCondition(mixed $condition): string
    {
        $normalized = self::normalizeCondition($condition);
        if ($normalized === null) {
            throw new \InvalidArgumentException(sprintf('Unsupported card analysis condition: %s', self::valueLabel($condition)));
        }

        return $normalized;
    }

    private static function normalize(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $normalized = mb_strtolower(trim((string) $value));

        return $normalized !== '' ? $normalized : null;
    }

    private static function valueLabel(mixed $value): string
    {
        return is_scalar($value) ? (string) $value : get_debug_type($value);
    }
}
