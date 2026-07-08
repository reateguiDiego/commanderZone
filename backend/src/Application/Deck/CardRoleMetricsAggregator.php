<?php

namespace App\Application\Deck;

final class CardRoleMetricsAggregator
{
    private const ROLE_METRICS = [
        'permanentRamp' => ['role' => 'ramp'],
        'fastMana' => ['role' => 'fast_mana'],
        'burstMana' => ['role' => 'burst_mana'],
        'rituals' => ['role' => 'ritual'],
        'manaFixing' => ['role' => 'mana_fixing'],
        'draw' => ['role' => 'draw'],
        'cardSelection' => ['role' => 'card_selection'],
        'spotRemoval' => ['role' => 'spot_removal'],
        'creatureRemoval' => ['role' => 'creature_removal'],
        'artifactRemoval' => ['role' => 'artifact_removal'],
        'enchantmentRemoval' => ['role' => 'enchantment_removal'],
        'counterspells' => ['role' => 'counterspell'],
        'protection' => ['role' => 'protection'],
        'graveyardHate' => ['role' => 'graveyard_hate'],
        'boardWipes' => ['role' => 'board_wipe'],
        'sacrificeOutlets' => ['role' => 'sacrifice_outlet'],
        'wincons' => ['role' => 'wincon'],
        'combatFinishers' => ['role' => 'combat_finisher'],
        'stax' => ['role' => 'stax'],
        'tax' => ['role' => 'tax'],
        'tokenMakers' => ['role' => 'token_maker'],
        'payoffs' => ['role' => 'payoff'],
        'enablers' => ['role' => 'enabler'],
        'comboPieces' => ['role' => 'combo_piece'],
        'recursion' => ['role' => 'recursion'],
        'reanimation' => ['role' => 'reanimation'],
        'costReducers' => ['role' => 'cost_reducer'],
        'discard' => ['role' => 'discard'],
        'lifegain' => ['role' => 'lifegain'],
    ];

    private const SUBROLE_METRICS = [
        'typedTutors' => 'typed_tutor',
        'landTutors' => 'land_tutor',
        'rampSearch' => 'ramp_search',
        'opponentTutors' => 'opponent_tutor',
        'massBounce' => 'mass_bounce',
        'pseudoWipes' => 'pseudo_wipe',
        'conditionalWipes' => 'conditional_wipe',
        'oneShotSacrifice' => 'one_shot_sacrifice',
        'selfSacrifice' => 'self_sacrifice',
        'sacrificePayoffs' => 'sacrifice_payoff',
        'combatSupport' => 'combat_support',
        'infectThreats' => 'infect_threat',
    ];

    /**
     * @param list<array{deckCardId:string,cardId:string,scryfallId:string,oracleId:string,name:string,imageUrl?:?string,imageUris?:array<string,mixed>,cardFaces?:list<array<string,mixed>>,quantity:int,section:string,analysisProfile:array<string,mixed>}> $resolvedCards
     * @param list<array{quantity:int}> $unmatchedCards
     * @return array{cards:array<string,int>,roles:array<string,int>,roleCards:array<string,list<array<string,mixed>>>,quality:array<string,array<string,int>>}
     */
    public function aggregate(array $resolvedCards, array $unmatchedCards): array
    {
        $roles = $this->emptyRoleMetrics();
        $roleCards = $this->emptyRoleCards();
        $quality = $this->emptyQualityMetrics();
        $lands = 0;
        $resolvedQuantity = 0;
        $unmatchedQuantity = $this->totalQuantity($unmatchedCards);

        foreach ($resolvedCards as $card) {
            $quantity = max(1, $card['quantity']);
            $resolvedQuantity += $quantity;
            $profile = $card['analysisProfile'];

            if ($this->isLand($profile)) {
                $lands += $quantity;
                $this->addMetricCard($roleCards, 'lands', $this->cardReference($card));
            }

            $reference = $this->cardReference($card);
            $this->addRoleMetrics($roles, $roleCards, $profile, $quantity, $reference);
            $this->addSubroleMetrics($roles, $roleCards, $profile, $quantity, $reference);
            $this->addSpecialMetrics($roles, $roleCards, $profile, $quantity, $reference);
            $this->addQualityMetrics($quality, $profile, $quantity);
        }

        $roles['lands'] = $lands;

        return [
            'cards' => [
                'totalCards' => $resolvedQuantity + $unmatchedQuantity,
                'uniqueCards' => count($resolvedCards) + count($unmatchedCards),
                'resolvedCards' => $resolvedQuantity,
                'unmatchedCards' => $unmatchedQuantity,
                'lands' => $lands,
                'nonlands' => max(0, $resolvedQuantity - $lands),
            ],
            'roles' => $roles,
            'roleCards' => $roleCards,
            'quality' => $quality,
        ];
    }

    /**
     * @return array<string,int>
     */
    private function emptyRoleMetrics(): array
    {
        return array_fill_keys([
            'lands',
            'permanentRamp',
            'fastMana',
            'burstMana',
            'rituals',
            'manaFixing',
            'oneShotMana',
            'draw',
            'cardSelection',
            'trueTutors',
            'typedTutors',
            'landTutors',
            'rampSearch',
            'opponentTutors',
            'spotRemoval',
            'creatureRemoval',
            'artifactRemoval',
            'enchantmentRemoval',
            'counterspells',
            'protection',
            'graveyardHate',
            'boardWipes',
            'massBounce',
            'pseudoWipes',
            'conditionalWipes',
            'sacrificeOutlets',
            'oneShotSacrifice',
            'selfSacrifice',
            'sacrificePayoffs',
            'wincons',
            'combatFinishers',
            'combatSupport',
            'infectThreats',
            'extraCombatEngines',
            'stax',
            'tax',
            'symmetricalStaxRisk',
            'tokenMakers',
            'payoffs',
            'enablers',
            'comboPieces',
            'recursion',
            'reanimation',
            'costReducers',
            'discard',
            'lifegain',
        ], 0);
    }

    /**
     * @return array<string,array<string,int>>
     */
    private function emptyQualityMetrics(): array
    {
        $empty = [
            'premium' => 0,
            'good' => 0,
            'medium' => 0,
            'slow' => 0,
            'oneShot' => 0,
        ];

        return [
            'ramp' => $empty,
            'tutor' => $empty,
            'wipe' => $empty,
            'protection' => $empty,
            'wincon' => $empty,
        ];
    }

    /**
     * @return array<string,list<array<string,mixed>>>
     */
    private function emptyRoleCards(): array
    {
        return array_fill_keys(array_keys($this->emptyRoleMetrics()), []);
    }

    /**
     * @param array<string,int> $roles
     * @param array<string,list<array<string,mixed>>> $roleCards
     * @param array<string,mixed> $profile
     * @param array<string,mixed> $reference
     */
    private function addRoleMetrics(array &$roles, array &$roleCards, array $profile, int $quantity, array $reference): void
    {
        foreach (self::ROLE_METRICS as $metric => $rule) {
            if (!$this->hasRole($profile, $rule['role'])) {
                continue;
            }

            if ($metric === 'permanentRamp' && $this->isOneShotRamp($profile)) {
                continue;
            }

            if ($metric === 'sacrificeOutlets' && ($this->hasSubrole($profile, 'one_shot_sacrifice') || $this->hasSubrole($profile, 'self_sacrifice'))) {
                continue;
            }

            $roles[$metric] += $quantity;
            $this->addMetricCard($roleCards, $metric, $reference);
        }
    }

    /**
     * @param array<string,int> $roles
     * @param array<string,list<array<string,mixed>>> $roleCards
     * @param array<string,mixed> $profile
     * @param array<string,mixed> $reference
     */
    private function addSubroleMetrics(array &$roles, array &$roleCards, array $profile, int $quantity, array $reference): void
    {
        $isLand = $this->isLand($profile);
        foreach (self::SUBROLE_METRICS as $metric => $subrole) {
            if ($isLand && in_array($metric, ['typedTutors', 'landTutors', 'rampSearch', 'opponentTutors'], true)) {
                continue;
            }

            if ($this->hasSubrole($profile, $subrole)) {
                $roles[$metric] += $quantity;
                $this->addMetricCard($roleCards, $metric, $reference);
            }
        }
    }

    /**
     * @param array<string,int> $roles
     * @param array<string,list<array<string,mixed>>> $roleCards
     * @param array<string,mixed> $profile
     * @param array<string,mixed> $reference
     */
    private function addSpecialMetrics(array &$roles, array &$roleCards, array $profile, int $quantity, array $reference): void
    {
        $isLand = $this->isLand($profile);
        if (!$isLand && $this->hasRole($profile, 'tutor') && !$this->hasAnySubrole($profile, ['true_tutor', 'typed_tutor', 'land_tutor', 'ramp_search', 'opponent_tutor'])) {
            $roles['trueTutors'] += $quantity;
            $this->addMetricCard($roleCards, 'trueTutors', $reference);
        }
        if (!$isLand && $this->hasSubrole($profile, 'true_tutor')) {
            $roles['trueTutors'] += $quantity;
            $this->addMetricCard($roleCards, 'trueTutors', $reference);
        }
        if ($this->isOneShotRamp($profile)) {
            $roles['oneShotMana'] += $quantity;
            $this->addMetricCard($roleCards, 'oneShotMana', $reference);
        }
        if ($this->boolPath($profile, ['flags', 'fastMana']) || $this->hasPowerFlag($profile, 'fast_mana')) {
            if (!$this->hasRole($profile, 'fast_mana')) {
                $roles['fastMana'] += $quantity;
                $this->addMetricCard($roleCards, 'fastMana', $reference);
            }
        }
        if ($this->hasCondition($profile, 'symmetrical_stax_risk')) {
            $roles['symmetricalStaxRisk'] += $quantity;
            $this->addMetricCard($roleCards, 'symmetricalStaxRisk', $reference);
        }
        if ($this->hasRole($profile, 'extra_combat') || $this->hasSubrole($profile, 'extra_combat_engine')) {
            $roles['extraCombatEngines'] += $quantity;
            $this->addMetricCard($roleCards, 'extraCombatEngines', $reference);
        }
    }

    /**
     * @param array<string,mixed> $card
     * @return array{deckCardId:string,cardId:string,scryfallId:string,oracleId:string,name:string,imageUrl:?string,imageUris:array<string,mixed>,cardFaces:list<array<string,mixed>>,quantity:int,section:string}
     */
    private function cardReference(array $card): array
    {
        return [
            'deckCardId' => (string) $card['deckCardId'],
            'cardId' => (string) $card['cardId'],
            'scryfallId' => (string) $card['scryfallId'],
            'oracleId' => (string) $card['oracleId'],
            'name' => (string) $card['name'],
            'imageUrl' => $this->nullableString($card['imageUrl'] ?? null),
            'imageUris' => is_array($card['imageUris'] ?? null) ? $card['imageUris'] : [],
            'cardFaces' => is_array($card['cardFaces'] ?? null) ? array_values($card['cardFaces']) : [],
            'quantity' => max(1, (int) $card['quantity']),
            'section' => (string) $card['section'],
        ];
    }

    /**
     * @param array<string,list<array<string,mixed>>> $roleCards
     * @param array<string,mixed> $reference
     */
    private function addMetricCard(array &$roleCards, string $metric, array $reference): void
    {
        $roleCards[$metric] ??= [];
        $key = (string) ($reference['deckCardId'] ?? $reference['cardId'] ?? $reference['oracleId'] ?? '');
        foreach ($roleCards[$metric] as $existing) {
            $existingKey = (string) ($existing['deckCardId'] ?? $existing['cardId'] ?? $existing['oracleId'] ?? '');
            if ($existingKey === $key) {
                return;
            }
        }

        $roleCards[$metric][] = $reference;
    }

    /**
     * @param array<string,array<string,int>> $quality
     * @param array<string,mixed> $profile
     */
    private function addQualityMetrics(array &$quality, array $profile, int $quantity): void
    {
        foreach ([
            'ramp' => 'ramp',
            'tutor' => 'tutor',
            'wipe' => 'board_wipe',
            'protection' => 'protection',
            'wincon' => 'wincon',
        ] as $qualityKey => $role) {
            if ($qualityKey === 'tutor' && $this->isLand($profile)) {
                continue;
            }

            $roleScore = $this->roleScore($profile, $role);
            if ($roleScore === []) {
                continue;
            }

            $qualityValue = $this->stringValue($roleScore['quality'] ?? null);
            if ($qualityValue !== null && isset($quality[$qualityKey][$qualityValue])) {
                $quality[$qualityKey][$qualityValue] += $quantity;
            }

            if ($this->stringValue($roleScore['repeatability'] ?? null) === 'one_shot') {
                $quality[$qualityKey]['oneShot'] += $quantity;
            }
        }
    }

    /**
     * @param list<array{quantity:int}> $cards
     */
    private function totalQuantity(array $cards): int
    {
        return array_reduce(
            $cards,
            static fn (int $total, array $card): int => $total + max(1, $card['quantity']),
            0,
        );
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isLand(array $profile): bool
    {
        return $this->boolPath($profile, ['types', 'land']) || $this->hasRole($profile, 'land');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isOneShotRamp(array $profile): bool
    {
        $rampScore = $this->roleScore($profile, 'ramp');

        return $this->stringValue($rampScore['repeatability'] ?? null) === 'one_shot'
            || $this->hasRole($profile, 'burst_mana')
            || $this->hasRole($profile, 'ritual')
            || $this->hasSubrole($profile, 'one_shot_mana');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function hasRole(array $profile, string $role): bool
    {
        return in_array($role, $this->stringList($profile['roles'] ?? []), true);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function hasSubrole(array $profile, string $subrole): bool
    {
        return in_array($subrole, $this->stringList($profile['subroles'] ?? []), true);
    }

    /**
     * @param array<string,mixed> $profile
     * @param list<string> $subroles
     */
    private function hasAnySubrole(array $profile, array $subroles): bool
    {
        foreach ($subroles as $subrole) {
            if ($this->hasSubrole($profile, $subrole)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function hasPowerFlag(array $profile, string $flag): bool
    {
        return in_array($flag, $this->stringList($profile['powerFlags'] ?? []), true);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function hasCondition(array $profile, string $condition): bool
    {
        return in_array($condition, $this->stringList($profile['conditionKeys'] ?? []), true);
    }

    /**
     * @param array<string,mixed> $profile
     * @return array<string,mixed>
     */
    private function roleScore(array $profile, string $role): array
    {
        $roleScores = $profile['roleScores'] ?? [];
        if (!is_array($roleScores) || !is_array($roleScores[$role] ?? null)) {
            return [];
        }

        return $roleScores[$role];
    }

    /**
     * @param array<string,mixed> $source
     * @param list<string> $path
     */
    private function boolPath(array $source, array $path): bool
    {
        $value = $source;
        foreach ($path as $segment) {
            if (!is_array($value) || !array_key_exists($segment, $value)) {
                return false;
            }
            $value = $value[$segment];
        }

        return $value === true;
    }

    /**
     * @return list<string>
     */
    private function stringList(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }

        return array_values(array_filter(
            array_map(fn (mixed $item): ?string => $this->stringValue($item), $value),
            static fn (?string $item): bool => $item !== null,
        ));
    }

    private function stringValue(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $string = trim((string) $value);

        return $string !== '' ? mb_strtolower($string) : null;
    }

    private function nullableString(mixed $value): ?string
    {
        return is_scalar($value) && trim((string) $value) !== '' ? (string) $value : null;
    }
}
