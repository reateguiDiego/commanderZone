<?php

namespace App\Application\Deck;

use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;

final class DeckBoardWipeAnalyzer
{
    private const COUNTER_KEYS = [
        'total',
        'hardTotal',
        'pseudoTotal',
        'creatureWipes',
        'hardCreatureWipes',
        'exileWipes',
        'destroyWipes',
        'sacrificeWipes',
        'bounceWipes',
        'massBounce',
        'damageWipes',
        'minusXMinusXWipes',
        'artifactWipes',
        'enchantmentWipes',
        'artifactEnchantmentWipes',
        'graveyardWipes',
        'nonlandPermanentWipes',
        'allPermanentWipes',
        'modalWipes',
        'conditionalWipes',
        'asymmetricalWipes',
        'oneSidedWipes',
        'overloadedWipes',
        'scalableWipes',
        'instantSpeedWipes',
        'permanentBasedWipes',
        'repeatableWipes',
        'combatOnlyWipes',
        'answersIndestructible',
        'getsAroundHexproof',
        'opponentCompensationWipes',
        'effectiveLowCostWipes',
        'selfPlanRiskWipes',
    ];

    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @param list<array{oracleId:string,name:string,quantity:int,section:string,analysisProfile:array<string,mixed>}> $resolvedCards
     * @param array{primary?:string,secondary?:list<string>} $archetypes
     * @return array<string,mixed>
     */
    public function analyze(array $resolvedCards, array $archetypes = []): array
    {
        $profiles = $this->profilesByOracleId($this->oracleIds($resolvedCards));
        $metrics = $this->emptyMetrics();
        $manaValueTotal = 0.0;
        $manaValueCount = 0;
        $strategy = $this->deckStrategy($resolvedCards, $archetypes);

        foreach ($resolvedCards as $card) {
            $oracleId = trim((string) ($card['oracleId'] ?? ''));
            if ($oracleId === '' || !isset($profiles[$oracleId])) {
                continue;
            }

            $profile = $profiles[$oracleId];
            if (!$this->boolValue($profile['is_board_wipe'] ?? false)) {
                continue;
            }

            $quantity = max(1, (int) ($card['quantity'] ?? 1));
            $methods = $this->jsonList($profile['wipe_method'] ?? []);
            $scope = $this->jsonList($profile['wipe_scope'] ?? []);
            $type = $this->stringValue($profile['board_wipe_type'] ?? null) ?? 'other';
            $symmetry = $this->stringValue($profile['symmetry_profile'] ?? null) ?? 'unknown';
            $isConditional = $type === 'conditional_wipe';
            $isPseudo = $this->boolValue($profile['is_pseudo_wipe'] ?? false)
                || $type === 'combat_only_wipe'
                || $isConditional
                || $this->hasMethod($methods, ['tap_freeze']);
            $isMassBounce = !$isPseudo
                && (in_array('bounce', $methods, true) || $this->stringValue($profile['mass_mode_type'] ?? null) === 'mass_bounce');
            $isHard = $this->isHardWipe($profile, $methods, $scope, $type, $isPseudo, $isMassBounce, $isConditional);
            $notes = $this->notes($profile, $methods, $scope, $symmetry, $strategy, $isHard, $isPseudo);

            $metrics['total'] += $quantity;
            $metrics['hardTotal'] += $isHard ? $quantity : 0;
            $metrics['pseudoTotal'] += $isPseudo ? $quantity : 0;
            $metrics['creatureWipes'] += $this->hasScope($scope, ['creatures', 'colored_permanents', 'all_permanents', 'nonland_permanents']) ? $quantity : 0;
            $metrics['hardCreatureWipes'] += $isHard && $this->hasScope($scope, ['creatures', 'colored_permanents', 'all_permanents', 'nonland_permanents']) ? $quantity : 0;
            $metrics['exileWipes'] += $this->hasMethod($methods, ['exile', 'graveyard_exile']) ? $quantity : 0;
            $metrics['destroyWipes'] += $this->hasMethod($methods, ['destroy']) ? $quantity : 0;
            $metrics['sacrificeWipes'] += $this->hasMethod($methods, ['sacrifice']) ? $quantity : 0;
            $metrics['bounceWipes'] += $this->hasMethod($methods, ['bounce']) ? $quantity : 0;
            $metrics['massBounce'] += $isMassBounce ? $quantity : 0;
            $metrics['damageWipes'] += $this->hasMethod($methods, ['damage']) ? $quantity : 0;
            $metrics['minusXMinusXWipes'] += $this->hasMethod($methods, ['minus_x_minus_x', 'reduce_power_toughness']) ? $quantity : 0;
            $metrics['artifactWipes'] += in_array('artifacts', $scope, true) ? $quantity : 0;
            $metrics['enchantmentWipes'] += in_array('enchantments', $scope, true) ? $quantity : 0;
            $metrics['artifactEnchantmentWipes'] += in_array('artifacts', $scope, true) && in_array('enchantments', $scope, true) ? $quantity : 0;
            $metrics['graveyardWipes'] += in_array('graveyards', $scope, true) ? $quantity : 0;
            $metrics['nonlandPermanentWipes'] += in_array('nonland_permanents', $scope, true) ? $quantity : 0;
            $metrics['allPermanentWipes'] += in_array('all_permanents', $scope, true) ? $quantity : 0;
            $metrics['modalWipes'] += $this->boolValue($profile['has_modes'] ?? false) ? $quantity : 0;
            $metrics['conditionalWipes'] += $isConditional ? $quantity : 0;
            $metrics['asymmetricalWipes'] += $this->isAsymmetrical($symmetry) ? $quantity : 0;
            $metrics['oneSidedWipes'] += in_array($symmetry, ['one_sided', 'opponents_only'], true) ? $quantity : 0;
            $metrics['overloadedWipes'] += $this->boolValue($profile['has_alternative_mass_mode'] ?? false) ? $quantity : 0;
            $metrics['scalableWipes'] += $this->boolValue($profile['is_scalable'] ?? false) ? $quantity : 0;
            $metrics['instantSpeedWipes'] += $this->boolValue($profile['is_instant_speed'] ?? false) ? $quantity : 0;
            $metrics['permanentBasedWipes'] += ($this->boolValue($profile['is_permanent_activated'] ?? false) || $this->boolValue($profile['is_triggered_wipe'] ?? false)) ? $quantity : 0;
            $metrics['repeatableWipes'] += $this->boolValue($profile['is_repeatable'] ?? false) ? $quantity : 0;
            $metrics['combatOnlyWipes'] += $type === 'combat_only_wipe' ? $quantity : 0;
            $metrics['answersIndestructible'] += $this->boolValue($profile['answers_indestructible'] ?? false) ? $quantity : 0;
            $metrics['getsAroundHexproof'] += $this->boolValue($profile['gets_around_hexproof_shroud'] ?? false) ? $quantity : 0;
            $metrics['opponentCompensationWipes'] += ($this->stringValue($profile['opponent_compensation'] ?? null) ?? 'none') !== 'none' ? $quantity : 0;
            $metrics['effectiveLowCostWipes'] += $this->effectiveLowCost($profile) ? $quantity : 0;
            $metrics['selfPlanRiskWipes'] += in_array('self_plan_risk', $notes, true) ? $quantity : 0;

            $manaValue = $this->floatOrNull($profile['mana_value'] ?? null);
            if ($manaValue !== null) {
                $manaValueTotal += $manaValue * $quantity;
                $manaValueCount += $quantity;
            }

            $metrics['details'][] = [
                'oracleId' => $oracleId,
                'deckCardId' => $this->nullableString($card['deckCardId'] ?? null),
                'cardId' => $this->nullableString($card['cardId'] ?? null),
                'name' => (string) ($card['name'] ?? $profile['name'] ?? 'Unknown card'),
                'imageUrl' => $this->nullableString($card['imageUrl'] ?? null),
                'quantity' => $quantity,
                'types' => $this->detailTypes($type, $isHard, $isPseudo, $isMassBounce, $isConditional),
                'methods' => $methods,
                'scope' => $scope,
                'symmetry' => $symmetry,
                'manaValue' => $manaValue,
                'effectiveCostMin' => $this->floatOrNull($profile['effective_cost_min'] ?? null),
                'isHardWipe' => $isHard,
                'isPseudoWipe' => $isPseudo,
                'isModal' => $this->boolValue($profile['has_modes'] ?? false),
                'isOverloaded' => $this->boolValue($profile['has_alternative_mass_mode'] ?? false),
                'isScalable' => $this->boolValue($profile['is_scalable'] ?? false),
                'answersIndestructible' => $this->boolValue($profile['answers_indestructible'] ?? false),
                'notes' => $notes,
            ];
        }

        $metrics['averageManaValue'] = $manaValueCount > 0 ? round($manaValueTotal / $manaValueCount, 2) : 0.0;

        return $metrics;
    }

    /**
     * @return array<string,mixed>
     */
    private function emptyMetrics(): array
    {
        $metrics = array_fill_keys(self::COUNTER_KEYS, 0);
        $metrics['averageManaValue'] = 0.0;
        $metrics['details'] = [];

        return $metrics;
    }

    /**
     * @param list<array<string,mixed>> $resolvedCards
     * @return list<string>
     */
    private function oracleIds(array $resolvedCards): array
    {
        $ids = [];
        foreach ($resolvedCards as $card) {
            $oracleId = trim((string) ($card['oracleId'] ?? ''));
            if ($oracleId !== '') {
                $ids[$oracleId] = true;
            }
        }

        return array_keys($ids);
    }

    /**
     * @param list<string> $oracleIds
     * @return array<string,array<string,mixed>>
     */
    private function profilesByOracleId(array $oracleIds): array
    {
        if ($oracleIds === []) {
            return [];
        }

        $profiles = [];
        foreach ($this->connection->executeQuery(
            'SELECT * FROM card_board_wipe_profile WHERE oracle_id IN (:oracle_ids)',
            ['oracle_ids' => $oracleIds],
            ['oracle_ids' => ArrayParameterType::STRING],
        )->iterateAssociative() as $row) {
            $profiles[(string) $row['oracle_id']] = $row;
        }

        return $profiles;
    }

    /**
     * @param array<string,mixed> $profile
     * @param list<string> $methods
     * @param list<string> $scope
     */
    private function isHardWipe(array $profile, array $methods, array $scope, string $type, bool $isPseudo, bool $isMassBounce, bool $isConditional): bool
    {
        if ($isPseudo || $isConditional || $isMassBounce || $type === 'combat_only_wipe') {
            return false;
        }

        if ($this->boolValue($profile['is_permanent_wipe'] ?? false) || in_array('all_permanents', $scope, true) || in_array('nonland_permanents', $scope, true)) {
            return true;
        }

        if (!$this->boolValue($profile['is_creature_wipe'] ?? false)) {
            return false;
        }

        return $this->hasMethod($methods, ['destroy', 'exile', 'sacrifice', 'minus_x_minus_x', 'shuffle', 'tuck', 'damage']);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function effectiveLowCost(array $profile): bool
    {
        $cost = $this->floatOrNull($profile['effective_cost_min'] ?? null);

        return $cost !== null && $cost <= 4.0;
    }

    /**
     * @param list<string> $scope
     */
    private function hasScope(array $scope, array $needles): bool
    {
        return array_intersect($scope, $needles) !== [];
    }

    /**
     * @param list<string> $methods
     * @param list<string> $needles
     */
    private function hasMethod(array $methods, array $needles): bool
    {
        return array_intersect($methods, $needles) !== [];
    }

    private function isAsymmetrical(string $symmetry): bool
    {
        return in_array($symmetry, ['asymmetrical', 'one_sided', 'opponents_only', 'semi_asymmetrical', 'controller_choice', 'each_player_chooses', 'creature_type_asymmetry'], true);
    }

    /**
     * @param list<array{analysisProfile:array<string,mixed>}> $resolvedCards
     * @param array{primary?:string,secondary?:list<string>} $archetypes
     * @return array{creatureHeavy:bool,token:bool,artifact:bool,enchantment:bool,graveyard:bool,control:bool,aristocrats:bool}
     */
    private function deckStrategy(array $resolvedCards, array $archetypes): array
    {
        $creatures = 0;
        $artifacts = 0;
        $enchantments = 0;
        $tokenSignals = 0;
        $graveyardSignals = 0;
        $roles = [];

        foreach ($resolvedCards as $card) {
            $profile = is_array($card['analysisProfile'] ?? null) ? $card['analysisProfile'] : [];
            $quantity = max(1, (int) ($card['quantity'] ?? 1));
            $types = is_array($profile['types'] ?? null) ? $profile['types'] : [];
            $creatures += ($types['creature'] ?? false) === true ? $quantity : 0;
            $artifacts += ($types['artifact'] ?? false) === true ? $quantity : 0;
            $enchantments += ($types['enchantment'] ?? false) === true ? $quantity : 0;

            foreach ($this->jsonList($profile['roles'] ?? []) as $role) {
                $roles[$role] = ($roles[$role] ?? 0) + $quantity;
            }
            foreach ($this->jsonList($profile['subroles'] ?? []) as $subrole) {
                if (in_array($subrole, ['token_maker', 'tokens'], true)) {
                    $tokenSignals += $quantity;
                }
            }
            foreach ($this->jsonList($profile['conditionKeys'] ?? []) as $condition) {
                if (str_contains($condition, 'graveyard')) {
                    $graveyardSignals += $quantity;
                }
            }
        }

        $primary = (string) ($archetypes['primary'] ?? '');
        $secondary = is_array($archetypes['secondary'] ?? null) ? $archetypes['secondary'] : [];
        $archetypeSet = array_fill_keys([$primary, ...$secondary], true);

        return [
            'creatureHeavy' => $creatures >= 25,
            'token' => ($roles['token_maker'] ?? 0) + $tokenSignals >= 5 || isset($archetypeSet['tokens']),
            'artifact' => $artifacts >= 15 || isset($archetypeSet['artifact']),
            'enchantment' => $enchantments >= 12 || isset($archetypeSet['enchantress']),
            'graveyard' => ($roles['recursion'] ?? 0) + ($roles['reanimation'] ?? 0) + $graveyardSignals >= 5 || isset($archetypeSet['graveyard']),
            'control' => isset($archetypeSet['control']),
            'aristocrats' => isset($archetypeSet['aristocrats']) || isset($archetypeSet['sacrifice']),
        ];
    }

    /**
     * @param array<string,mixed> $profile
     * @param list<string> $methods
     * @param list<string> $scope
     * @param array<string,bool> $strategy
     * @return list<string>
     */
    private function notes(array $profile, array $methods, array $scope, string $symmetry, array $strategy, bool $isHard, bool $isPseudo): array
    {
        $notes = [];
        if ($strategy['control'] && ($this->boolValue($profile['has_modes'] ?? false) || $this->effectiveLowCost($profile))) {
            $notes[] = 'control_friendly';
        }
        if ($isPseudo) {
            $notes[] = 'pseudo_wipe';
        }
        if ($isHard && $strategy['creatureHeavy'] && in_array($symmetry, ['symmetrical', 'semi_asymmetrical'], true) && in_array('creatures', $scope, true) && !$strategy['aristocrats']) {
            $notes[] = 'self_plan_risk';
        }
        if ($strategy['token'] && in_array('creatures', $scope, true) && $this->hasMethod($methods, ['destroy', 'damage', 'minus_x_minus_x'])) {
            $notes[] = 'self_plan_risk';
            $notes[] = 'token_plan_risk';
        }
        if ($strategy['artifact'] && in_array('artifacts', $scope, true) && in_array($symmetry, ['symmetrical', 'semi_asymmetrical'], true)) {
            $notes[] = 'self_plan_risk';
            $notes[] = 'artifact_plan_risk';
        }
        if ($strategy['enchantment'] && in_array('enchantments', $scope, true) && in_array($symmetry, ['symmetrical', 'semi_asymmetrical'], true)) {
            $notes[] = 'self_plan_risk';
            $notes[] = 'enchantment_plan_risk';
        }
        if ($strategy['graveyard'] && in_array('graveyards', $scope, true)) {
            $notes[] = 'self_plan_risk';
            $notes[] = 'graveyard_plan_risk';
        }
        if ($this->boolValue($profile['has_alternative_mass_mode'] ?? false)) {
            $notes[] = 'alternative_mass_mode';
        }
        if (($this->stringValue($profile['opponent_compensation'] ?? null) ?? 'none') !== 'none') {
            $notes[] = 'opponent_compensation';
        }

        return array_values(array_unique($notes));
    }

    /**
     * @return list<string>
     */
    private function detailTypes(string $type, bool $isHard, bool $isPseudo, bool $isMassBounce, bool $isConditional): array
    {
        $types = [$type];
        if ($isHard) {
            $types[] = 'hard_wipe';
        }
        if ($isPseudo) {
            $types[] = 'pseudo_wipe';
        }
        if ($isMassBounce) {
            $types[] = 'mass_bounce';
        }
        if ($isConditional) {
            $types[] = 'conditional_wipe';
        }

        return array_values(array_unique($types));
    }

    /**
     * @return list<string>
     */
    private function jsonList(mixed $value): array
    {
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            $value = is_array($decoded) ? $decoded : [];
        }
        if (!is_array($value)) {
            return [];
        }

        return array_values(array_filter(
            array_map(fn (mixed $item): ?string => $this->stringValue($item), $value),
            static fn (?string $item): bool => $item !== null,
        ));
    }

    private function boolValue(mixed $value): bool
    {
        return $value === true || $value === 1 || $value === '1' || $value === 't' || $value === 'true';
    }

    private function floatOrNull(mixed $value): ?float
    {
        return is_numeric($value) ? (float) $value : null;
    }

    private function stringValue(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $value = trim((string) $value);

        return $value === '' ? null : mb_strtolower($value);
    }

    private function nullableString(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }
}
